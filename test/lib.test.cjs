'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMessage,
  getDateKey,
  isInsideScheduledWindow,
  isPausedDate,
  normalizeGroupName,
  validateConfig
} = require('../src/lib.cjs');

const config = validateConfig({
  timezone: 'America/Fortaleza',
  productionGroup: 'Grupo Exemplo da Rota',
  testGroup: 'Grupo',
  studentLines: ['1. Participante Exemplo - Instituição Exemplo'],
  pausedDates: ['2026-09-07', '2026-09-08'],
  schedule: {
    weekdays: ['Mon', 'Tue', 'Thu', 'Fri'],
    hour: 2,
    minute: 0,
    graceMinutes: 20
  }
});

test('gera a mensagem sem o nome do onibus', () => {
  const date = new Date('2026-08-27T05:05:00.000Z');
  assert.equal(buildMessage(config, date), 'Lista 27/08\n\n1. Participante Exemplo - Instituição Exemplo');
});

test('usa a data de Fortaleza', () => {
  const date = new Date('2026-08-28T01:30:00.000Z');
  assert.equal(getDateKey(config, date), '2026-08-27');
});

test('aceita quinta-feira dentro da janela', () => {
  const date = new Date('2026-08-27T05:15:00.000Z');
  assert.equal(isInsideScheduledWindow(config, date), true);
});

test('recusa quarta-feira e horario atrasado', () => {
  assert.equal(isInsideScheduledWindow(config, new Date('2026-08-26T05:05:00.000Z')), false);
  assert.equal(isInsideScheduledWindow(config, new Date('2026-08-27T05:21:00.000Z')), false);
});

test('normaliza nome do grupo sem perder acentos', () => {
  assert.equal(normalizeGroupName('  Ônibus   universitário (Rota 1) '), 'ônibus universitário (rota 1)');
});

test('pausa somente as datas configuradas no fuso de Fortaleza', () => {
  assert.equal(isPausedDate(config, new Date('2026-09-07T05:05:00.000Z')), true);
  assert.equal(isPausedDate(config, new Date('2026-09-08T05:05:00.000Z')), true);
  assert.equal(isPausedDate(config, new Date('2026-09-10T05:05:00.000Z')), false);
});
