'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { classifyAck, waitForServerAck, requiresManualReview, assertSendingEnabled } = require('./confirmation.cjs');
const { createAckReader } = require('./ack-reader.cjs');
const {
  buildMessage,
  getDateKey,
  isInsideScheduledWindow,
  isPausedDate,
  normalizeGroupName,
  readJson,
  validateConfig,
  writeJsonAtomic
} = require('./lib.cjs');

const projectDir = path.resolve(__dirname, '..');
const configPath = path.join(projectDir, 'config.json');
const runtimeDir = path.join(projectDir, 'runtime');
const sessionDir = process.env.WHATSAPP_SESSION_DIR || path.join(projectDir, 'data', 'session');
const statePath = path.join(runtimeDir, 'state.json');
const logPath = path.join(runtimeDir, 'automation.jsonl');
const lockPath = path.join(runtimeDir, 'automation.lock');
const chromePath = process.env.CHROME_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';
const args = new Set(process.argv.slice(2));

function selectMode() {
  const selected = ['--auth', '--dry-run', '--inspect', '--verify', '--ack-check', '--compose-check', '--delivery-check', '--test', '--test-force', '--scheduled'].filter((flag) => args.has(flag));
  if (selected.length !== 1) throw new Error('Use exatamente um modo: --auth, --dry-run, --inspect, --verify, --compose-check, --delivery-check, --test, --test-force ou --scheduled');
  return selected[0].slice(2);
}

class BeforeSendError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BeforeSendError';
    this.beforeSend = true;
  }
}

function logEvent(event, details = {}) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const record = { timestamp: new Date().toISOString(), event, ...details };
  fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function loadState() {
  if (!fs.existsSync(statePath)) return { version: 1, deliveries: {} };
  const state = readJson(statePath);
  if (state?.version !== 1 || !state.deliveries || typeof state.deliveries !== 'object') {
    throw new Error('runtime/state.json esta corrompido; envio interrompido para evitar duplicidade');
  }
  return state;
}

function acquireLock() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  try {
    const handle = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(handle, `${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
    return () => {
      try { fs.closeSync(handle); } catch {}
      try { fs.unlinkSync(lockPath); } catch {}
    };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const lockPid = Number(fs.readFileSync(lockPath, 'utf8').split(/\r?\n/, 1)[0]);
    let lockProcessIsAlive = Number.isInteger(lockPid) && lockPid > 0;
    if (lockProcessIsAlive) {
      try {
        process.kill(lockPid, 0);
      } catch (processError) {
        lockProcessIsAlive = processError.code !== 'ESRCH';
      }
    }
    if (lockProcessIsAlive) throw new Error('Outra instancia da automacao esta em execucao');
    fs.unlinkSync(lockPath);
    return acquireLock();
  }
}

async function closeClient(client) {
  const browserProcess = client.pupBrowser?.process?.();
  const result = await Promise.race([
    client.destroy().then(() => 'closed').catch(() => 'failed'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 8_000))
  ]);

  if (browserProcess && browserProcess.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => browserProcess.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 8_000))
    ]);
  }

  if (result === 'timeout' || (browserProcess && browserProcess.exitCode === null)) {
    logEvent('client_close_timeout');
    if (browserProcess && !browserProcess.killed) {
      try { browserProcess.kill(); } catch {}
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
}

function createClient(mode) {
  if (!fs.existsSync(chromePath)) throw new Error(`Google Chrome nao encontrado em: ${chromePath}`);
  const versionOutput = execFileSync(chromePath, ['--version'], { encoding: 'utf8', timeout: 10000 });
  const version = versionOutput.match(/(?:Chromium|Google Chrome)\s+(\d+\.\d+\.\d+\.\d+)/)?.[1];
  if (!version) throw new Error('Nao foi possivel identificar a versao real do Chromium');
  fs.mkdirSync(sessionDir, { recursive: true });
  const options = {
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
    webVersionCache: { type: 'none' },
    authStrategy: new LocalAuth({
      dataPath: sessionDir
    }),
    authTimeoutMs: 90_000,
    qrMaxRetries: mode === 'auth' ? 0 : 1,
    puppeteer: {
      executablePath: chromePath,
      headless: true,
      args: ['--disable-dev-shm-usage', '--disable-gpu', '--browser-subprocess-path=/data/data/com.termux/files/usr/lib/chromium/chrome']
    }
  };
  if (process.env.WHATSAPP_NATIVE_CLIENT === '1') {
    const { NativeClient } = require('./native-client.cjs');
    logEvent('native_client_selected', { version });
    return new NativeClient({ ...options, sessionDir });
  }
  return new Client(options);
}

function waitUntilReady(client, mode) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tempo limite aguardando o WhatsApp ficar pronto')), ['auth', 'delivery-check'].includes(mode) ? 15 * 60_000 : 5 * 60_000);

    client.once('ready', () => {
      clearTimeout(timeout);
      resolve();
    });
    client.once('auth_failure', (message) => {
      clearTimeout(timeout);
      reject(new Error(`Falha de autenticacao: ${message}`));
    });
    client.once('disconnected', (reason) => {
      clearTimeout(timeout);
      reject(new Error(`WhatsApp desconectado antes de ficar pronto: ${reason}`));
    });
    client.on('qr', async () => {
      logEvent('qr_required', { mode });
      if (mode === 'auth') {
        try {
          await new Promise(resolve => setTimeout(resolve, 1500));
          await client.pupPage.screenshot({ path: path.join(runtimeDir, 'login.png') });
          logEvent('qr_image_ready', { path: path.join(runtimeDir, 'login.png') });
        } catch (error) { clearTimeout(timeout); reject(error); }
      }
      if (mode !== 'auth') {
        clearTimeout(timeout);
        reject(new Error('Sessao do WhatsApp expirada; execute npm run auth novamente'));
      } else {
        process.stdout.write('Escaneie o QR code exibido na janela do Chrome.\n');
      }
    });

    client.initialize().catch((error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function normalizeUiText(value) {
  return String(value)
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
}

async function pressSelectAll(page) {
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
}

async function pressSoftLineBreak(page) {
  await page.keyboard.down('Shift');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Shift');
}

async function clearComposer(page, composer) {
  await composer.click();
  await pressSelectAll(page);
  await page.keyboard.press('Backspace');
}

async function dismissKnownPopups(page) {
  const popupHandles = await page.$$('[data-testid="confirm-popup"]');
  for (const popup of popupHandles) {
    const details = await popup.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { visible: rect.width > 0 && rect.height > 0, text: String(element.innerText || '') };
    });
    if (!details.visible) continue;
    if (!details.text.includes('Novidades do WhatsApp Web')) {
      throw new Error('Um pop-up desconhecido esta bloqueando o WhatsApp Web');
    }

    const buttons = await popup.$$('button');
    let continueButton = null;
    for (const button of buttons) {
      if ((await button.evaluate((element) => String(element.innerText || '').trim())) === 'Continuar') {
        continueButton = button;
        break;
      }
    }
    if (!continueButton) throw new Error('O aviso de novidades nao possui o botao Continuar esperado');
    await continueButton.click();
    await page.waitForFunction(
      () => ![...document.querySelectorAll('[data-testid="confirm-popup"]')].some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }),
      { timeout: 10_000 }
    );
  }
}

async function waitForExactGroupHeader(page, targetName, timeout) {
  try {
    await page.waitForFunction(
      (name) => {
        const main = document.querySelector('#main');
        if (!main) return false;
        const headerCandidates = [
          main.querySelector('header'),
          main.querySelector('[data-testid="conversation-header"]')
        ].filter(Boolean);
        return headerCandidates.some((header) => {
          const titleMatch = [...header.querySelectorAll('[title]')]
            .some((element) => element.getAttribute('title') === name);
          const textLines = String(header.innerText || '').split(/\r?\n/).map((line) => line.trim());
          return titleMatch || textLines.includes(name);
        });
      },
      { timeout },
      targetName
    );
    return true;
  } catch (error) {
    if (error.name === 'TimeoutError') return false;
    throw error;
  }
}

async function fillGroupSearch(page, searchSelector, targetName) {
  const searchBox = await page.waitForSelector(searchSelector, { visible: true, timeout: 30_000 });
  await searchBox.click();
  await pressSelectAll(page);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(targetName, { delay: 20 });
  await page.waitForFunction(
    (name) => {
      const side = document.querySelector('#side');
      if (!side) return false;
      return [...side.querySelectorAll('[data-testid="cell-frame-container"] [title]')]
        .some((element) => {
          const rect = element.getBoundingClientRect();
          return element.getAttribute('title') === name && rect.width > 0 && rect.height > 0;
        });
    },
    { timeout: 20_000 },
    targetName
  );
  await new Promise((resolve) => setTimeout(resolve, 750));
}

async function openGroupInUi(client, targetName) {
  const page = client.pupPage;
  if (!page) throw new Error('Pagina do WhatsApp Web indisponivel');
  await dismissKnownPopups(page);

  const searchSelector = '#side input[role="textbox"][data-tab="3"], #side [contenteditable="true"][role="textbox"]';
  await fillGroupSearch(page, searchSelector, targetName);

  const exactMatch = await page.evaluate((name) => {
    const side = document.querySelector('#side');
    if (!side) return { count: 0, rows: [] };
    const matchingElements = [...side.querySelectorAll('[title]')].filter((element) => {
      const rect = element.getBoundingClientRect();
      return element.getAttribute('title') === name
        && rect.width > 0
        && rect.height > 0
        && element.closest('[data-testid="cell-frame-container"]');
    });
    const matchingRows = [...new Set(matchingElements.map((element) => (
      element.closest('[data-testid="cell-frame-container"]')
    )))];
    return {
      count: matchingRows.length,
      rows: matchingRows.map((row) => ({
        role: row.getAttribute('role'),
        dataTestId: row.getAttribute('data-testid'),
        childTestIds: [...new Set([...row.querySelectorAll('[data-testid]')]
          .map((element) => element.getAttribute('data-testid')))].slice(0, 30),
        titledElements: [...row.querySelectorAll('[title]')]
          .filter((element) => element.getAttribute('title') === name).length
      }))
    };
  }, targetName);

  if (exactMatch.count !== 1) {
    throw new Error(`Esperado exatamente um resultado visivel chamado "${targetName}", encontrados: ${exactMatch.count}; estrutura: ${JSON.stringify(exactMatch.rows)}`);
  }

  const rowWasScrolled = await page.evaluate((name) => {
    const rows = [...new Set([...document.querySelectorAll('#side [data-testid="cell-frame-container"] [title]')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return element.getAttribute('title') === name && rect.width > 0 && rect.height > 0;
      })
      .map((element) => element.closest('[data-testid="cell-frame-container"]')))];
    if (rows.length !== 1) return false;
    rows[0].scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  }, targetName);
  if (!rowWasScrolled) throw new Error(`Resultado "${targetName}" desapareceu antes do clique`);
  await new Promise((resolve) => setTimeout(resolve, 250));

  const clickPoint = await page.evaluate((name) => {
    const rows = [...new Set([...document.querySelectorAll('#side [data-testid="cell-frame-container"] [title]')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return element.getAttribute('title') === name && rect.width > 0 && rect.height > 0;
      })
      .map((element) => element.closest('[data-testid="cell-frame-container"]')))];
    if (rows.length !== 1 || !rows[0].isConnected) return null;
    const rect = rows[0].getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(x, y);
    if (!topElement || !(rows[0] === topElement || rows[0].contains(topElement))) return null;
    return { x, y };
  }, targetName);
  if (clickPoint) await page.mouse.click(clickPoint.x, clickPoint.y);

  let headerConfirmed = await waitForExactGroupHeader(page, targetName, 5_000);

  if (!headerConfirmed) {
    await fillGroupSearch(page, searchSelector, targetName);
    await page.evaluate((name) => {
      const side = document.querySelector('#side');
      if (!side) return false;
      const rows = [...new Set([...side.querySelectorAll('[title]')]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return element.getAttribute('title') === name
            && rect.width > 0
            && rect.height > 0
            && element.closest('[data-testid="cell-frame-container"]');
        })
        .map((element) => element.closest('[data-testid="cell-frame-container"]')))];
      if (rows.length !== 1) return false;
      rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    }, targetName);
    headerConfirmed = await waitForExactGroupHeader(page, targetName, 5_000);
  }

  if (!headerConfirmed) {
    await fillGroupSearch(page, searchSelector, targetName);
    await page.keyboard.press('Enter');
    headerConfirmed = await waitForExactGroupHeader(page, targetName, 10_000);
  }

  if (!headerConfirmed) {
    const diagnostics = await page.evaluate((name) => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const describe = (element) => ({
        tag: element.tagName,
        role: element.getAttribute('role'),
        title: element.getAttribute('title'),
        ariaLabel: element.getAttribute('aria-label'),
        dataTestId: element.getAttribute('data-testid'),
        parentTestId: element.parentElement?.getAttribute('data-testid') || null
      });
      const main = document.querySelector('#main');
      return {
        hasMain: Boolean(main),
        exactTitles: [...document.querySelectorAll('[title]')]
          .filter((element) => visible(element) && element.getAttribute('title') === name)
          .slice(0, 10)
          .map(describe),
        exactTextElements: [...document.querySelectorAll('#main *')]
          .filter((element) => visible(element) && String(element.innerText || '').trim() === name)
          .slice(0, 10)
          .map(describe),
        headerTestIds: main ? [...new Set([...main.querySelectorAll('[data-testid]')]
          .map((element) => element.getAttribute('data-testid'))
          .filter((value) => /header|conversation/i.test(value || '')))].slice(0, 30) : []
      };
    }, targetName);
    throw new Error(`O resultado foi acionado por tres metodos, mas o cabecalho do grupo nao foi confirmado: ${JSON.stringify(diagnostics)}`);
  }

  return page;
}

async function isOwnMessageVisible(page, message) {
  return page.evaluate((expected) => {
    const normalize = (value) => String(value)
      .replace(/\r/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{2,}/g, '\n\n')
      .trim();
    const main = document.querySelector('#main');
    if (!main) return false;
    const serializeMessage = (container) => {
      const roots = [...container.querySelectorAll('[data-testid="selectable-text"]')];
    const root = roots.find((candidate) => !candidate.parentElement?.closest('[data-testid="selectable-text"]'));
      if (!root) return '';
      const serializeNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const prefix = /^\d+\.\s$/.test(node.getAttribute('data-pre-plain-text') || '')
          ? node.getAttribute('data-pre-plain-text')
          : '';
        return prefix + [...node.childNodes].map(serializeNode).join('');
      };
      return serializeNode(root);
    };
    const outgoing = [...main.querySelectorAll('[data-testid="msg-container"]')]
      .filter((element) => element.querySelector('[data-testid="tail-out"]'));
    const matches = outgoing.filter((element) => normalize(serializeMessage(element)) === normalize(expected));
    if (!matches.length) return null;
    const id = matches.at(-1).closest('[data-id]')?.getAttribute('data-id');
    if (!id) throw new Error('Mensagem existente sem ID; reconciliacao recusada');
    return id;
  }, message);
}

async function composeMessageDraft(page, message) {
  const composerSelector = '#main footer [contenteditable="true"][role="textbox"]';
  const composer = await page.waitForSelector(composerSelector, { visible: true, timeout: 20_000 });
  const existingDraft = await composer.evaluate(element => String(element.innerText || '').trim());
  if (existingDraft) throw new BeforeSendError('Ha um rascunho existente; nao sera apagado');
  await clearComposer(page, composer);

  const lines = message.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]) await page.keyboard.type(lines[index], { delay: 15 });
    if (index < lines.length - 1) await pressSoftLineBreak(page);
  }

  const draft = await composer.evaluate((element) => ({
    innerText: element.innerText,
    textContent: element.textContent,
    innerHTML: element.innerHTML,
    logicalText: element.children.length
      ? [...element.children].map((block) => block.textContent || '').join('\n')
      : element.innerText
  }));
  return { composer, draft };
}

async function sendMessageThroughUi(page, targetName, message) {
  const { draft } = await composeMessageDraft(page, message);
  if (normalizeUiText(draft.logicalText) !== normalizeUiText(message)) {
    throw new BeforeSendError('O texto montado no WhatsApp nao corresponde a mensagem esperada; envio cancelado');
  }

  const headerIsCorrect = await page.evaluate((name) => {
    const main = document.querySelector('#main');
    const header = main?.querySelector('header') || main?.querySelector('[data-testid="conversation-header"]');
    if (!header) return false;
    const titleMatch = [...header.querySelectorAll('[title]')].some((element) => element.getAttribute('title') === name);
    const textLines = String(header.innerText || '').split(/\r?\n/).map((line) => line.trim());
    return titleMatch || textLines.includes(name);
  }, targetName);
  if (!headerIsCorrect) throw new BeforeSendError('O grupo aberto mudou antes do envio; operacao cancelada');

  const previousMatchingMessageIds = await page.evaluate((expected) => {
    const normalize = (value) => String(value)
      .replace(/\r/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{2,}/g, '\n\n')
      .trim();
    const serializeMessage = (container) => {
      const roots = [...container.querySelectorAll('[data-testid="selectable-text"]')];
      const root = roots.find((candidate) => !candidate.parentElement?.closest('[data-testid="selectable-text"]'));
      if (!root) return '';
      const serializeNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const prefix = /^\d+\.\s$/.test(node.getAttribute('data-pre-plain-text') || '')
          ? node.getAttribute('data-pre-plain-text')
          : '';
        return prefix + [...node.childNodes].map(serializeNode).join('');
      };
      return serializeNode(root);
    };
    const main = document.querySelector('#main');
    if (!main) return [];
    return [...main.querySelectorAll('[data-testid="msg-container"]')]
      .filter((element) => element.querySelector('[data-testid="tail-out"]'))
      .map((element) => element.closest('[data-id]')?.getAttribute('data-id'))
      .filter(Boolean);
  }, message);

  await page.keyboard.press('Enter');
  const newMessageHandle = await page.waitForFunction(
    (expected, previousIds) => {
      const normalize = (value) => String(value)
        .replace(/\r/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{2,}/g, '\n\n')
        .trim();
      const main = document.querySelector('#main');
      if (!main) return false;
      const failed = [...main.querySelectorAll('[data-testid="msg-container"]')].find(element => {
        const id = element.closest('[data-id]')?.getAttribute('data-id');
        return id && !previousIds.includes(id)
          && element.querySelector('[data-testid="tail-out"]')
          && element.querySelector('[data-testid="fail-container"]');
      });
      if (failed) return { failed: true, messageId: failed.closest('[data-id]').getAttribute('data-id') };
      const serializeMessage = (container) => {
        const roots = [...container.querySelectorAll('[data-testid="selectable-text"]')];
        const root = roots.find((candidate) => !candidate.parentElement?.closest('[data-testid="selectable-text"]'));
        if (!root) return '';
        const serializeNode = (node) => {
          if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
          if (node.nodeType !== Node.ELEMENT_NODE) return '';
          const prefix = /^\d+\.\s$/.test(node.getAttribute('data-pre-plain-text') || '')
            ? node.getAttribute('data-pre-plain-text')
            : '';
          return prefix + [...node.childNodes].map(serializeNode).join('');
        };
        return serializeNode(root);
      };
      const newMessage = [...main.querySelectorAll('[data-testid="msg-container"]')]
        .filter((element) => element.querySelector('[data-testid="tail-out"]'))
        .find((element) => {
          const messageId = element.closest('[data-id]')?.getAttribute('data-id');
          return messageId
            && !previousIds.includes(messageId)
            && normalize(serializeMessage(element)) === normalize(expected);
        });
      return newMessage?.closest('[data-id]')?.getAttribute('data-id') || false;
    },
    { timeout: 20_000 },
    message,
    previousMatchingMessageIds
  );
  try {
    const result = await newMessageHandle.jsonValue();
    if (result?.failed) {
      const error = new Error('WhatsApp exibiu falha de envio na nova mensagem; nao sera reenviada automaticamente');
      error.messageId = result.messageId;
      throw error;
    }
    return result;
  } finally { await newMessageHandle.dispose(); }
}

async function deliver(client, config, mode, now) {
  const forceTest = mode === 'test-force';
  const targetGroup = ['test', 'test-force', 'compose-check', 'delivery-check', 'ack-check'].includes(mode) ? config.testGroup : config.productionGroup;
  const dateKey = getDateKey(config, now);
  const normalDeliveryKey = `${dateKey}|${normalizeGroupName(targetGroup)}`;
  const deliveryKey = forceTest ? `${normalDeliveryKey}|manual-${now.toISOString()}` : normalDeliveryKey;
  const message = buildMessage(config, now);
  const state = loadState();

  if (!forceTest && state.deliveries[deliveryKey]?.status === 'sent') {
    if (state.deliveries[deliveryKey].confirmation !== 'server_ack') {
      throw new Error('Registro antigo sem ACK verificavel; revisar manualmente antes de reenviar');
    }
    logEvent('skipped_already_sent', { mode, targetGroup, dateKey });
    return { status: 'skipped', reason: 'already_sent' };
  }
  const page = await openGroupInUi(client, targetGroup);
  const existingMessageId = !forceTest && await isOwnMessageVisible(page, message);
  if (existingMessageId) {
    const confirmation = await waitForServerAck(createAckReader(client), existingMessageId);
    state.deliveries[deliveryKey] = {
      status: 'sent',
      reconciled: true,
      sentAt: new Date().toISOString(),
      ...confirmation
    };
    writeJsonAtomic(statePath, state);
    logEvent('reconciled_existing_message', { mode, targetGroup, dateKey });
    return { status: 'skipped', reason: 'message_already_exists' };
  }
  if (!forceTest && requiresManualReview(state.deliveries[deliveryKey])) {
    throw new Error('Existe um envio anterior com resultado incerto para este grupo e esta data; a mensagem nao foi localizada no historico e nao sera reenviada automaticamente');
  }

  state.deliveries[deliveryKey] = { status: 'attempting', attemptedAt: new Date().toISOString() };
  writeJsonAtomic(statePath, state);
  logEvent('send_started', { mode, targetGroup, dateKey, forced: forceTest });

  let messageId = null;
  let confirmation;
  try {
    messageId = await sendMessageThroughUi(page, targetGroup, message);
    state.deliveries[deliveryKey].messageId = messageId;
    writeJsonAtomic(statePath, state);
    confirmation = await waitForServerAck(createAckReader(client), messageId);
  } catch (error) {
    messageId = messageId || error.messageId || null;
    if (error.beforeSend) {
      state.deliveries[deliveryKey] = {
        status: 'not_sent',
        attemptedAt: state.deliveries[deliveryKey].attemptedAt,
        messageId: null,
        error: error.message
      };
      writeJsonAtomic(statePath, state);
      logEvent('send_cancelled_before_enter', { mode, targetGroup, dateKey, error: error.message });
      throw new Error(`O envio foi cancelado antes do Enter: ${error.message}`);
    }
    state.deliveries[deliveryKey] = {
      status: 'uncertain',
      attemptedAt: state.deliveries[deliveryKey].attemptedAt,
      messageId,
      error: error.message
    };
    writeJsonAtomic(statePath, state);
    throw new Error(`O envio nao foi confirmado e nao havera retentativa automatica: ${error.message}`);
  }

  state.deliveries[deliveryKey] = {
    status: 'sent',
    sentAt: new Date().toISOString(),
    ...confirmation
  };
  writeJsonAtomic(statePath, state);
  logEvent('send_confirmed', { mode, targetGroup, dateKey, forced: forceTest });
  return { status: 'sent', targetGroup, dateKey };
}

async function main() {
  const mode = selectMode();
  const config = validateConfig(readJson(configPath));
  const authorizedSingleTest = mode === 'test-force' && args.has('--authorized-test-once');
  assertSendingEnabled(authorizedSingleTest ? { ...config, sendingEnabled: true } : config, mode);
  const now = new Date();
  const targetGroup = ['test', 'test-force', 'compose-check', 'delivery-check', 'ack-check'].includes(mode) ? config.testGroup : config.productionGroup;

  if (mode === 'dry-run') {
    const output = {
      mode,
      targetGroup: config.productionGroup,
      dateKey: getDateKey(config, now),
      insideScheduledWindow: isInsideScheduledWindow(config, now),
      pausedToday: isPausedDate(config, now),
      pausedDates: config.pausedDates || [],
      message: buildMessage(config, now)
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (mode === 'scheduled' && isPausedDate(config, now)) {
    logEvent('skipped_paused_date', { mode, targetGroup, dateKey: getDateKey(config, now) });
    return;
  }

  if (mode === 'scheduled' && !isInsideScheduledWindow(config, now)) {
    logEvent('skipped_outside_window', { mode, targetGroup, dateKey: getDateKey(config, now) });
    return;
  }

  const releaseLock = acquireLock();
  let client;
  try {
    client = createClient(mode);
    logEvent('client_starting', { mode, targetGroup: ['auth', 'inspect', 'verify'].includes(mode) ? null : targetGroup });
    await waitUntilReady(client, mode);
    logEvent('client_ready', { mode });
    if (authorizedSingleTest) {
      logEvent('authorized_single_test', { targetGroup: config.testGroup, scheduledSendingEnabled: config.sendingEnabled });
      client.pupPage.on('pageerror', error => logEvent('test_browser_error', { error: String(error.message).slice(0, 1500) }));
      client.pupPage.on('console', msg => {
        if (msg.type() === 'error') logEvent('test_console_error', { error: msg.text().slice(0, 1500) });
      });
      client.pupPage.on('requestfailed', req => {
        const url = new URL(req.url());
        logEvent('test_request_failed', { host: url.hostname, error: req.failure()?.errorText });
      });
    }

    if (mode === 'auth') {
      process.stdout.write('Sessao vinculada com sucesso.\n');
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 3_000));

    if (mode === 'inspect') {
      const page = client.pupPage;
      const diagnostics = await page.evaluate(() => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const describe = (element) => ({
          tag: element.tagName,
          id: element.id || null,
          type: element.getAttribute('type'),
          role: element.getAttribute('role'),
          ariaLabel: element.getAttribute('aria-label'),
          placeholder: element.getAttribute('placeholder'),
          contenteditable: element.getAttribute('contenteditable'),
          dataTab: element.getAttribute('data-tab'),
          dataTestId: element.getAttribute('data-testid'),
          ancestorIds: [...element.parents || []]
        });
        return {
          url: location.href,
          title: document.title,
          hasSide: Boolean(document.querySelector('#side')),
          hasMain: Boolean(document.querySelector('#main')),
          popups: [...document.querySelectorAll('[data-testid="confirm-popup"]')]
            .filter(visible)
            .map((element) => String(element.innerText || '').slice(0, 500)),
          inputs: [...document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]')]
            .filter(visible)
            .map((element) => {
              const item = describe(element);
              item.ancestorIds = [];
              let parent = element.parentElement;
              while (parent && item.ancestorIds.length < 5) {
                if (parent.id) item.ancestorIds.push(parent.id);
                parent = parent.parentElement;
              }
              return item;
            }),
          testIds: [...new Set([...document.querySelectorAll('[data-testid]')]
            .filter(visible)
            .map((element) => element.getAttribute('data-testid')))]
            .slice(0, 100)
        };
      });
      process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
      return;
    }

    if (mode === 'verify') {
      await openGroupInUi(client, config.testGroup);
      await openGroupInUi(client, config.productionGroup);
      logEvent('groups_verified', {
        testGroup: config.testGroup,
        productionGroup: config.productionGroup
      });
      return;
    }

    if (mode === 'ack-check') {
      const page = await openGroupInUi(client, config.testGroup);
      const ids = await page.evaluate(() => [...document.querySelectorAll('#main [data-testid="msg-container"]')]
        .filter(element => element.querySelector('[data-testid="tail-out"]'))
        .map(element => element.closest('[data-id]')?.getAttribute('data-id')).filter(Boolean).slice(-5));
      if (!ids.length) throw new Error('Nenhuma mensagem propria visivel para testar leitura de ACK');
      const results = [];
      for (const id of ids) {
        try {
          const message = await createAckReader(client).getMessageById(id);
          results.push({ ack: message?.ack ?? null, state: classifyAck(message, id), resolved: !!message });
        } catch (error) { results.push({ state: 'error', error: error.message }); }
      }
      logEvent('ack_read_check', { results });
      if (!results.some(result => ['accepted', 'pending', 'failed'].includes(result.state))) throw new Error('Leitura ACK nao validada: nenhum modelo exato encontrado');
      return;
    }

    if (mode === 'compose-check') {
      const message = buildMessage(config, now);
      const page = await openGroupInUi(client, config.testGroup);
      const { composer, draft } = await composeMessageDraft(page, message);
      try {
        process.stdout.write(`${JSON.stringify({
          expected: message,
          normalizedExpected: normalizeUiText(message),
          draft,
          normalizedDraft: normalizeUiText(draft.logicalText),
          matches: normalizeUiText(draft.logicalText) === normalizeUiText(message)
        }, null, 2)}\n`);
      } finally {
        await clearComposer(page, composer);
      }
      return;
    }

    if (mode === 'delivery-check') {
      const message = buildMessage(config, now);
      const page = await openGroupInUi(client, config.testGroup);
      const diagnostics = await page.evaluate((expected) => {
        const main = document.querySelector('#main');
        const composer = main?.querySelector('footer [contenteditable="true"][role="textbox"]');
        const fragments = String(expected).split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
        const containsExpected = (value) => fragments.every((part) => String(value || '').includes(part));
        const describe = (element) => ({
          tag: element.tagName,
          className: typeof element.className === 'string' ? element.className : null,
          role: element.getAttribute('role'),
          dataTestId: element.getAttribute('data-testid'),
          dataId: element.getAttribute('data-id'),
          contenteditable: element.getAttribute('contenteditable')
        });
        const minimalMatches = main
          ? [...main.querySelectorAll('*')].filter((element) => (
            containsExpected(element.innerText)
            && ![...element.children].some((child) => containsExpected(child.innerText))
          )).slice(0, 10)
          : [];
        return {
          hasMain: Boolean(main),
          failureModels: (() => {
            const ids = [...(main?.querySelectorAll('[data-testid="fail-container"]') || [])]
              .map(el => el.closest('[data-id]')?.getAttribute('data-id')).filter(Boolean);
            const models = window.require('WAWebCollections').Msg.getModelsArray();
            return ids.map(id => {
              const matches = models.filter(m => m.id?.fromMe === true && (m.id.id === id || m.id._serialized === id));
              if (matches.length !== 1) return { id, resolved: false };
              const m = matches[0];
              const details = {};
              for (const key of ['ack', 'sendState', 'sendError', 'errorCode', 'isFailed', 'isUnsent', 'type']) {
                const value = m[key];
                if (['string', 'number', 'boolean'].includes(typeof value)) details[key] = value;
              }
              return { id, resolved: true, ...details };
            });
          })(),
          composer: composer ? {
            innerText: composer.innerText,
            logicalText: composer.children.length
              ? [...composer.children].map((block) => block.textContent || '').join('\n')
              : composer.innerText,
            innerHTML: composer.innerHTML
          } : null,
          selectorCounts: main ? {
            messageOut: main.querySelectorAll('.message-out').length,
            messageIn: main.querySelectorAll('.message-in').length,
            msgContainer: main.querySelectorAll('[data-testid="msg-container"]').length,
            dataId: main.querySelectorAll('[data-id]').length
          } : null,
          recentMessageContainers: main ? [...main.querySelectorAll('[data-testid="msg-container"]')]
            .slice(-5)
            .map((element) => ({
              innerText: element.innerText,
              textContent: element.textContent,
              innerHTML: element.innerHTML,
              dataId: element.closest('[data-id]')?.getAttribute('data-id') || null,
              className: typeof element.className === 'string' ? element.className : null,
              childTestIds: [...new Set([...element.querySelectorAll('[data-testid]')]
                .map((child) => child.getAttribute('data-testid')))].slice(0, 30)
            })) : [],
          minimalMatches: minimalMatches.map((element) => {
            const ancestors = [];
            let current = element;
            for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
              ancestors.push(describe(current));
            }
            return { text: element.innerText, structure: ancestors };
          })
        };
      }, message);
      const messageContainers = await page.$$('#main [data-testid="msg-container"]');
      const lastMessageContainer = messageContainers.at(-1);
      const screenshotPath = path.join(runtimeDir, 'delivery-check.png');
      if (lastMessageContainer) {
        fs.mkdirSync(runtimeDir, { recursive: true });
        await lastMessageContainer.screenshot({ path: screenshotPath });
        diagnostics.screenshotPath = screenshotPath;
      }
      if (process.env.WHATSAPP_ERROR_DETAILS === '1') {
        const errorButton = await page.$('#main [data-testid="fail-container"] [role="button"][aria-label="Ocorreu um erro. Clique para saber mais."]');
        if (errorButton) {
          await errorButton.click();
          await new Promise(resolve => setTimeout(resolve, 1500));
          diagnostics.errorDetails = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [data-testid="confirm-popup"], [role="alert"]')]
            .map(el => el.innerText));
          await page.screenshot({ path: path.join(runtimeDir, 'failure-details.png') });
        }
        process.stdout.write(`${JSON.stringify({ failureModels: diagnostics.failureModels, errorDetails: diagnostics.errorDetails }, null, 2)}\n`);
      } else process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
      return;
    }

    const result = await deliver(client, config, mode, now);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (client) await closeClient(client);
    releaseLock();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    try { logEvent('fatal_error', { error: error.message }); } catch {}
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  }
);
