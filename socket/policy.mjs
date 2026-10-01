import lib from '../src/lib.cjs';

export function scheduledKey(config, state, now = new Date()) {
  lib.validateConfig(config);
  if (state.version !== 1 || !state.deliveries || typeof state.deliveries !== 'object') throw Error('Estado invalido');
  if (config.sendingEnabled !== true || lib.isPausedDate(config, now) || !lib.isInsideScheduledWindow(config, now)) return null;
  const key = `${lib.getDateKey(config, now)}|${lib.normalizeGroupName(config.productionGroup)}`;
  // Any prior record requires reconciliation, not an automatic repeat.
  if (Object.hasOwn(state.deliveries, key)) return null;
  return key;
}
