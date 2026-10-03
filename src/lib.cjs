'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateConfig(config) {
  const errors = [];

  if (!config || typeof config !== 'object') errors.push('config deve ser um objeto');
  if (!config?.timezone || typeof config.timezone !== 'string') errors.push('timezone ausente');
  if (!config?.productionGroup || typeof config.productionGroup !== 'string') errors.push('productionGroup ausente');
  if (!config?.testGroup || typeof config.testGroup !== 'string') errors.push('testGroup ausente');
  for(const field of ['productionGroupId','testGroupId']) if(config?.[field]!==undefined && (typeof config[field]!=='string' || !/^\d+(?:-\d+)?@g\.us$/.test(config[field]))) errors.push(field+' invalido');
  if (!Array.isArray(config?.studentLines) || config.studentLines.length === 0) errors.push('studentLines deve ter pelo menos uma linha');
  if (config?.pausedDates !== undefined && (!Array.isArray(config.pausedDates)
    || config.pausedDates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date)))) {
    errors.push('pausedDates deve conter datas no formato AAAA-MM-DD');
  }
  if (!Array.isArray(config?.schedule?.weekdays) || config.schedule.weekdays.length === 0) errors.push('schedule.weekdays ausente');
  if (!Number.isInteger(config?.schedule?.hour) || config.schedule.hour < 0 || config.schedule.hour > 23) errors.push('schedule.hour invalido');
  if (!Number.isInteger(config?.schedule?.minute) || config.schedule.minute < 0 || config.schedule.minute > 59) errors.push('schedule.minute invalido');
  if (!Number.isInteger(config?.schedule?.graceMinutes) || config.schedule.graceMinutes < 0) errors.push('schedule.graceMinutes invalido');

  if (errors.length) throw new Error(`Configuracao invalida: ${errors.join('; ')}`);
  return config;
}

function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    weekday: values.weekday,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function buildMessage(config, date = new Date()) {
  const parts = getZonedParts(date, config.timezone);
  return `Lista ${parts.day}/${parts.month}\n\n${config.studentLines.join('\n')}`;
}

function getDateKey(config, date = new Date()) {
  const parts = getZonedParts(date, config.timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isInsideScheduledWindow(config, date = new Date()) {
  const parts = getZonedParts(date, config.timezone);
  if (!config.schedule.weekdays.includes(parts.weekday)) return false;

  const currentMinute = parts.hour * 60 + parts.minute;
  const startMinute = config.schedule.hour * 60 + config.schedule.minute;
  return currentMinute >= startMinute && currentMinute <= startMinute + config.schedule.graceMinutes;
}

function isPausedDate(config, date = new Date()) {
  return Array.isArray(config.pausedDates) && config.pausedDates.includes(getDateKey(config, date));
}

function normalizeGroupName(value) {
  return String(value)
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

module.exports = {
  buildMessage,
  getDateKey,
  getZonedParts,
  isInsideScheduledWindow,
  isPausedDate,
  normalizeGroupName,
  readJson,
  validateConfig,
  writeJsonAtomic
};
