'use strict';

function classifyAck(message, messageId) {
  const resolvedId = message?.messageId ?? message?.id?._serialized;
  if (!message || (message.uiMessageId ?? resolvedId) !== messageId
    || typeof resolvedId !== 'string' || !resolvedId || message.fromMe !== true) return 'unknown';
  if (message.ack === -1 || message.isSendFailure === true) return 'failed';
  if ([1, 2, 3, 4].includes(message.ack)) return 'accepted';
  return message.ack === 0 ? 'pending' : 'unknown';
}

async function waitForServerAck(client, messageId, options = {}) {
  if (typeof messageId !== 'string' || !messageId) throw new Error('Mensagem sem ID: confirmacao recusada');
  const timeoutMs = options.timeoutMs ?? 60000;
  const intervalMs = options.intervalMs ?? 1000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  let lastState = 'unknown';
  while (now() < deadline) {
    let timer;
    let message;
    try {
      message = await Promise.race([
        client.getMessageById(messageId),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Consulta ACK excedeu o limite')), Math.min(10000, Math.max(1, deadline - now()))); })
      ]);
    } finally { clearTimeout(timer); }
    lastState = classifyAck(message, messageId);
    if (lastState === 'accepted') return { messageId: message.messageId ?? message.id._serialized, ack: message.ack, confirmation: 'server_ack' };
    if (lastState === 'failed') throw new Error(message.isSendFailure === true
      ? 'WhatsApp reportou falha de envio (isSendFailure=true)'
      : 'WhatsApp reportou falha de envio (ACK_ERROR)');
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  throw new Error(`Envio sem confirmacao do servidor; estado=${lastState}; ID=${messageId}`);
}

function requiresManualReview(record) {
  return ['attempting', 'uncertain'].includes(record?.status);
}

function assertSendingEnabled(config, mode) {
  if (['test', 'test-force', 'scheduled'].includes(mode) && config.sendingEnabled !== true) {
    throw new Error('Envios desativados nesta instalacao (sendingEnabled=false)');
  }
}

module.exports = { classifyAck, waitForServerAck, requiresManualReview, assertSendingEnabled };
