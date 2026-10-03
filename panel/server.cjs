'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const exec = promisify(execFile);
const scrypt = promisify(crypto.scrypt);
const model = require('./model.cjs');
const lib = require('../src/lib.cjs');
const publicDir = path.join(__dirname, 'public');
const fail = (message, status = 400) => Object.assign(Error(message), { status });
async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: (await scrypt(password, salt, 64)).toString('hex') };
}
async function validPassword(password, auth) {
  const hash = await hashPassword(password, auth.salt);
  return crypto.timingSafeEqual(Buffer.from(hash.hash, 'hex'), Buffer.from(auth.hash, 'hex'));
}
async function createPanel({ root = path.resolve(__dirname, '..'), host = '127.0.0.1', port = 8787, service, sendTest } = {}) {
  const runtime = path.join(root, 'runtime');
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const authPath = path.join(runtime, 'panel-auth.json');
  if (!fs.existsSync(authPath)) {
    const accessPath = path.join(runtime, 'panel-access.txt');
    let password;
    if (fs.existsSync(accessPath)) {
      password = fs.readFileSync(accessPath, 'utf8').match(/Senha inicial: ([A-Za-z0-9_-]{24})/)?.[1];
      if (!password) throw Error('Credencial inicial inválida; recuperação manual necessária.');
    } else {
      password = crypto.randomBytes(18).toString('base64url');
      const fd = fs.openSync(accessPath, 'wx', 0o600);
      try { fs.writeFileSync(fd, `Painel Rota\nEndereço: http://${host}:${port}\nSenha inicial: ${password}\n\nTroque a senha em Configurações. Guarde este arquivo em local privado.\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    model.durableWrite(authPath, await hashPassword(password));
  }
  const callService = service || (async action => {
    const result = await exec(process.execPath, [path.join(root, 'service.cjs'), action], { cwd: root, timeout: 30000, maxBuffer: 32768 });
    const line = result.stdout.trim().split('\n').filter(x => x.startsWith('{')).pop();
    return JSON.parse(line);
  });
  const callTest = sendTest || (async (id, expectedRevision, expectedText) => {
    try {
      await exec('/data/data/com.termux/files/usr/bin/sh', [path.join(root, 'socket/run.sh'), '--test-once'], {
        cwd: root, timeout: 120000, killSignal: 'SIGTERM', maxBuffer: 128 * 1024,
        env: { ...process.env, WHATSAPP_TEST_RECORD: id, WHATSAPP_TEST_REVISION: expectedRevision, WHATSAPP_TEST_TEXT_HASH: crypto.createHash('sha256').update(expectedText).digest('hex') }
      });
    } catch { /* Result is read from the durable attempt; never retry here. */ }
    const file = path.join(root, 'socket/runtime', `test-${id}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { status: 'not_started', error: 'Não foi possível iniciar o teste. Verifique a conexão e tente novamente após consultar o histórico.' };
  });
  const sessions = new Map(), attempts = new Map(), jobs = new Map();
  const credentials = () => JSON.parse(fs.readFileSync(authPath, 'utf8'));
  const config = () => lib.validateConfig(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')));
  const audit = (action, details = {}) => fs.appendFileSync(path.join(runtime, 'panel-audit.jsonl'), JSON.stringify({ timestamp: new Date().toISOString(), action, ...details }) + '\n', { mode: 0o600 });
  let mutation = Promise.resolve();
  const serialize = fn => { const result = mutation.then(fn); mutation = result.catch(() => {}); return result; };
  const maintenance = setInterval(() => {
    const now = Date.now();
    for (const [key, item] of sessions) if (item.expires < now) sessions.delete(key);
    for (const [key, item] of attempts) if (item.until < now) attempts.delete(key);
    for (const [key, item] of jobs) if (item.created < now - 86400000) jobs.delete(key);
  }, 60000); maintenance.unref();
  const server = http.createServer(async (req, res) => {
    const respond = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    const readBody = async () => {
      if (!String(req.headers['content-type']).startsWith('application/json')) throw fail('Use JSON.', 415);
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 16384) throw fail('Pedido muito grande.', 413); }
      try { return JSON.parse(body || '{}'); } catch { throw fail('Pedido inválido.'); }
    };
    try {
      const allowedHost = `${host}:${server.address().port}`;
      if (req.headers.host !== allowedHost) throw fail('Endereço não permitido.', 403);
      const origin = `http://${allowedHost}`;
      if (req.method !== 'GET' && req.headers.origin !== origin) throw fail('Origem não permitida.', 403);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      const url = new URL(req.url, origin);
      if (!url.pathname.startsWith('/api/')) {
        const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/icon.svg': ['icon.svg', 'image/svg+xml'] };
        const asset = assets[url.pathname];
        if (req.method !== 'GET' || !asset) throw fail('Não encontrado.', 404);
        res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(fs.readFileSync(path.join(publicDir, asset[0]))); return;
      }
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const body = await readBody();
        const ip = req.socket.remoteAddress;
        const attempt = attempts.get(ip) || { count: 0, until: Date.now() + 300000 };
        if (attempt.count >= 8) throw fail('Muitas tentativas. Aguarde cinco minutos.', 429);
        if (typeof body.password !== 'string' || body.password.length > 200 || !await validPassword(body.password, credentials())) {
          attempt.count++; attempts.set(ip, attempt); throw fail('Senha incorreta.', 401);
        }
        attempts.delete(ip);
        const token = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(24).toString('hex');
        if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
        sessions.set(token, { csrf, expires: Date.now() + 12 * 3600000 });
        res.setHeader('Set-Cookie', `rota_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
        respond(200, { csrf }); return;
      }
      const token = req.headers.cookie?.match(/(?:^|;\s*)rota_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      const session = sessions.get(token);
      if (!session || session.expires < Date.now()) throw fail('Entre no painel para continuar.', 401);
      if (req.method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf) throw fail('Sessão inválida. Entre novamente.', 403);
      if (url.pathname === '/api/session' && req.method === 'GET') { respond(200, { csrf: session.csrf }); return; }
      if (url.pathname === '/api/logout' && req.method === 'POST') {
        sessions.delete(token); res.setHeader('Set-Cookie', 'rota_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); respond(200, { ok: true }); return;
      }
      if (url.pathname === '/api/dashboard' && req.method === 'GET') {
        const c = config();
        const statePath = path.join(runtime, 'state.json');
        const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
        const deliveries = Object.entries(state?.deliveries || {}).map(([key, r]) => ({ key, group: r.group || key.split('|')[1], status: r.status, timestamp: r.timestamp || r.attemptedAt, confirmedAt: r.confirmedAt, messageId: r.messageId, text: r.text, error: typeof r.error === 'string' ? r.error.slice(0, 300) : undefined })).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 100);
        const testDir = path.join(root, 'socket/runtime');
        if (fs.existsSync(testDir)) for (const file of fs.readdirSync(testDir).filter(x => x === 'test-send.json' || /^test-[a-f0-9-]{36}\.json$/.test(x)).slice(-50)) {
          const record = JSON.parse(fs.readFileSync(path.join(testDir, file), 'utf8'));
          deliveries.push({ ...record, key: file, test: true });
        }
        deliveries.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
        let health; try { health = await callService('status'); } catch { health = { healthy: false, schedulerRunning: false }; }
        respond(200, { config: c, revision: model.revision(c), health, nextRun: model.nextRun(c), today: lib.getDateKey(c), preview: lib.buildMessage(c), history: deliveries.slice(0, 100), events: model.tailJson(path.join(root, 'socket/runtime/events.jsonl')), now: new Date().toISOString() }); return;
      }
      if (url.pathname === '/api/config' && req.method === 'PUT') {
        const body = await readBody();
        let changes; try { changes = model.validateChanges(body.changes); } catch (error) { throw fail(error.message); }
        await serialize(async () => {
          const current = config(); if (model.revision(current) !== body.revision) throw fail('A configuração mudou. Atualize o painel antes de salvar.', 409);
          const next = lib.validateConfig({ ...current, ...changes });
          model.durableWrite(path.join(runtime, 'panel-config-backup.json'), current);
          model.durableWrite(path.join(root, 'config.json'), next);
          audit('config_saved', { fields: Object.keys(changes) });
        }); respond(200, { ok: true }); return;
      }
      if (url.pathname === '/api/enabled' && req.method === 'POST') {
        const body = await readBody(); if (typeof body.enabled !== 'boolean') throw fail('Ação inválida.');
        await serialize(async () => {
          const current = config(); if (model.revision(current) !== body.revision) throw fail('A configuração mudou. Atualize o painel.', 409);
          if (body.enabled) {
            const health = await callService('start');
            if (!health.healthy) throw fail('O executor não está saudável. Consulte o estado do servidor.', 503);
          }
          const latest = config();
          if (model.revision(latest) !== body.revision) throw fail('A configuração mudou durante a operação. Atualize o painel.', 409);
          model.durableWrite(path.join(root, 'config.json'), { ...latest, sendingEnabled: body.enabled });
          audit(body.enabled ? 'enabled' : 'disabled');
        }); respond(200, { ok: true }); return;
      }
      if (url.pathname === '/api/password' && req.method === 'POST') {
        const body = await readBody();
        if (typeof body.newPassword !== 'string' || body.newPassword.length < 12 || body.newPassword.length > 200 || typeof body.oldPassword !== 'string' || body.oldPassword.length > 200 || !await validPassword(body.oldPassword, credentials())) throw fail('Confira a senha atual e use pelo menos 12 caracteres na nova senha.');
        model.durableWrite(authPath, await hashPassword(body.newPassword));
        sessions.clear();
        const initial = path.join(runtime, 'panel-access.txt');
        if (fs.existsSync(initial)) fs.unlinkSync(initial);
        audit('password_changed'); respond(200, { ok: true }); return;
      }
      if (url.pathname === '/api/test/prepare' && req.method === 'POST') {
        const c = config();
        const challenge = crypto.randomUUID();
        session.challenge = { id: challenge, expires: Date.now() + 60000, revision: model.revision(c), text: lib.buildMessage(c) };
        respond(200, { challenge, group: c.testGroup, text: session.challenge.text }); return;
      }
      if (url.pathname === '/api/test/send' && req.method === 'POST') {
        const body = await readBody();
        const challenge = session.challenge;
        if (!challenge || challenge.id !== body.challenge || challenge.expires < Date.now()) throw fail('Confirmação expirada. Abra o teste novamente.', 409);
        session.challenge = null;
        if (challenge.revision !== model.revision(config())) throw fail('A mensagem mudou. Confira a prévia novamente.', 409);
        if ([...jobs.values()].some(x => x.status === 'running')) throw fail('Já existe um teste em andamento.', 409);
        const id = crypto.randomUUID(); jobs.set(id, { status: 'running', created: Date.now() });
        audit('test_requested', { id });
        callTest(id, challenge.revision, challenge.text).then(result => { jobs.set(id, { ...result, created: Date.now() }); audit('test_finished', { id, status: result.status }); }).catch(() => { jobs.set(id, { status: 'uncertain', created: Date.now(), error: 'Resultado incerto. Consulte o histórico antes de repetir.' }); });
        respond(202, { id }); return;
      }
      if (url.pathname.startsWith('/api/test/') && req.method === 'GET') {
        const id = url.pathname.split('/').pop(); if (!jobs.has(id)) throw fail('Teste não encontrado.', 404);
        respond(200, jobs.get(id)); return;
      }
      throw fail('Não encontrado.', 404);
    } catch (error) { if (!res.headersSent) respond(error.status || 500, { error: error.status ? error.message : 'Não foi possível concluir. Confira o estado do servidor.' }); else res.end(); }
  });
  server.requestTimeout = 35000; server.headersTimeout = 10000;
  server.on('close', () => clearInterval(maintenance));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return server;
}
if (require.main === module) createPanel({ host: process.env.PANEL_HOST || '127.0.0.1', port: Number(process.env.PANEL_PORT || 8787) }).then(server => console.log(JSON.stringify({ event: 'panel_listening', address: server.address().address, port: server.address().port }))).catch(() => { console.error('Painel não iniciou. Confira a rede privada e a porta.'); process.exitCode = 1; });
module.exports = { createPanel };
