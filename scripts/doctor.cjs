'use strict';
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../src/lib.cjs');

const object = value => value && typeof value === 'object' && !Array.isArray(value);

// Reads only. Never opens a connector, creates a state file or repairs anything.
function diagnose(root, { now = Date.now(), nodeVersion = process.versions.node } = {}) {
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });
  const json = (relative, validate, success) => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
      validate(data);
      add(relative, 'ok', success);
      return data;
    } catch (error) {
      add(relative, 'error', error.code === 'ENOENT'
        ? 'Arquivo ausente; siga o guia de instalação ou recuperação.'
        : 'Arquivo ilegível ou inválido; não substitua nem apague para tentar novamente.');
      return null;
    }
  };
  add('node', Number(nodeVersion.split('.')[0]) === 24 ? 'ok' : 'warning',
    Number(nodeVersion.split('.')[0]) === 24 ? 'Node.js compatível com a versão validada na CI.'
      : 'A CI valida Node.js 24; esta versão não foi validada por esse diagnóstico.');
  const config = json('config.json', c => {
    lib.validateConfig(c);
    if (typeof c.sendingEnabled !== 'boolean') throw Error('enabled');
    new Intl.DateTimeFormat('en', { timeZone: c.timezone }).format(new Date(now));
    if (c.schedule.weekdays.some(d => !['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].includes(d))) throw Error('weekday');
    if (c.studentLines.some(line => typeof line !== 'string' || !line.trim())) throw Error('participant');
    for (const date of c.pausedDates || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date + 'T00:00:00Z').toISOString().slice(0,10) !== date) throw Error('date');
    }
  }, 'Configuração válida; nomes e participantes não são exibidos.');
  if (config) add('sending', config.sendingEnabled ? 'ok' : 'warning',
    config.sendingEnabled ? 'Envios habilitados na configuração; isso não comprova entrega.'
      : 'Envios desabilitados; nenhum envio automático é esperado.');
  const state = json('runtime/state.json', state => {
    if (state.version !== 1 || !object(state.deliveries)) throw Error('state');
    for (const record of Object.values(state.deliveries)) {
      if (!object(record) || !['attempting','uncertain','sent','server_accepted','failed'].includes(record.status)) throw Error('record');
    }
  }, 'Registro de tentativas legível; conteúdo privado omitido.');
  if (state) {
    const unresolved = Object.values(state.deliveries).some(r => ['attempting','uncertain','failed'].includes(r.status));
    add('attempts', unresolved ? 'warning' : 'ok', unresolved
      ? 'Há tentativas sem sucesso confirmado; reconcilie manualmente sem apagar registros ou repetir envios.'
      : 'Nenhuma tentativa pendente nas categorias verificadas; não é prova de entrega.');
  }
  const heartbeat = json('runtime/heartbeat.json', h => {
    if (!Number.isInteger(h.pid) || h.pid < 2 || typeof h.timestamp !== 'string' || !Number.isFinite(Date.parse(h.timestamp))) throw Error('heartbeat');
  }, 'Heartbeat legível; não comprova que o processo está vivo.');
  if (heartbeat) {
    const age = now - Date.parse(heartbeat.timestamp);
    add('heartbeat-age', age >= 0 && age < 240000 ? 'ok' : 'error',
      age < 0 ? 'Heartbeat no futuro; confira o relógio do servidor.'
        : age >= 240000 ? 'Heartbeat atrasado; consulte o supervisor antes de agir.'
          : 'Heartbeat recente; ainda é necessário conferir supervisor e ACK.');
  }
  for (const relative of ['socket/node_modules/@whiskeysockets/baileys/package.json']) {
    json(relative, value => { if (!value.version) throw Error('dependency'); }, 'Dependência socket presente; conexão não foi testada.');
  }
  return { ok: !checks.some(c => c.status === 'error'), checks,
    limitations: ['Não verifica internet, login WhatsApp, processo ativo, ACK ou recuperação após reinicialização.'] };
}

function main(args) {
  let root = path.resolve(__dirname, '..'), jsonOutput = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') jsonOutput = true;
    else if (args[i] === '--root' && args[i + 1] && !args[i + 1].startsWith('--')) root = path.resolve(args[++i]);
    else throw Error('Uso: node scripts/doctor.cjs [--root DIRETORIO] [--json]');
  }
  const report = diagnose(root);
  if (jsonOutput) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('Diagnóstico somente leitura — não comprova entrega');
    for (const c of report.checks) console.log('[' + c.status.toUpperCase() + '] ' + c.id + ': ' + c.message);
    console.log(report.limitations.join('\n'));
  }
  process.exitCode = report.ok ? 0 : 1;
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch { console.error('Uso: node scripts/doctor.cjs [--root DIRETORIO] [--json]'); process.exitCode = 2; }
}
module.exports = { diagnose };
