import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduledKey } from './policy.mjs';
const config = { sendingEnabled: true, timezone: 'America/Fortaleza', productionGroup: 'Grupo Exemplo da Rota', testGroup: 'Grupo', studentLines: ['1. Participante Exemplo - Instituição Exemplo'], pausedDates: [], schedule: { weekdays: ['Mon','Tue','Thu','Fri'], hour: 2, minute: 0, graceMinutes: 20 } };
const empty = () => ({ version: 1, deliveries: {} });
test('schedule, timezone, pause and disabled gates', () => {
  const valid = new Date('2026-09-22T05:00:00Z');
  assert.ok(scheduledKey(config, empty(), valid));
  for (const time of ['2026-09-22T04:59:00Z','2026-09-22T05:21:00Z','2026-09-23T05:00:00Z','2026-09-26T05:00:00Z']) assert.equal(scheduledKey(config, empty(), new Date(time)), null);
  assert.equal(scheduledKey({ ...config, sendingEnabled: false }, empty(), valid), null);
  assert.equal(scheduledKey({ ...config, pausedDates: ['2026-09-22'] }, empty(), valid), null);
});
test('every existing attempt prevents a second scheduled send', () => {
  const now = new Date('2026-09-22T05:00:00Z');
  const key = scheduledKey(config, empty(), now);
  for (const status of ['sent','attempting','uncertain','failed','server_accepted']) assert.equal(scheduledKey(config, { version: 1, deliveries: { [key]: { status } } }, now), null);
  assert.throws(() => scheduledKey(config, {}, now));
});
