import fs from 'node:fs';
import path from 'node:path';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

// Single-process store: the entry point holds an exclusive lock for its lifetime.
// Signal-key batches and credentials share one atomic snapshot. No silent reset.
export function openAuthStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const data = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'), BufferJSON.reviver)
    : { version: 1, creds: initAuthCreds(), keys: {} };
  if (data.version !== 1 || !data.creds?.noiseKey || !data.keys || typeof data.keys !== 'object') {
    throw Error('Estado de autenticacao invalido; nao sera substituido');
  }
  const persist = () => {
    const temp = file + '.tmp';
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(data, BufferJSON.replacer)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    // Android/Linux directory fsync makes the rename durable across power loss.
    if (process.platform !== 'win32') {
      const dir = fs.openSync(path.dirname(file), 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    }
  };
  return {
    state: {
      creds: data.creds,
      keys: {
        get: async (type, ids) => Object.fromEntries(ids.map(id => {
          const value = data.keys[type]?.[id];
          return [id, type === 'app-state-sync-key' && value ? proto.Message.AppStateSyncKeyData.fromObject(value) : value];
        })),
        set: async batch => {
          for (const [type, values] of Object.entries(batch)) {
            data.keys[type] ||= {};
            for (const [id, value] of Object.entries(values)) {
              if (value == null) delete data.keys[type][id];
              else data.keys[type][id] = value;
            }
          }
          persist();
        }
      }
    },
    saveCreds: async () => persist()
  };
}
