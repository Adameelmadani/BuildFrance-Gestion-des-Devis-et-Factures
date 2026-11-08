/* Build France - configuration (variables d'environnement / fichier .env) */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// Charge .env s'il existe (les variables déjà définies, ex. par systemd, sont prioritaires)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const env = process.env;
const bool = (v, def) => (v == null || v === '' ? def : /^(1|true|yes|on)$/i.test(String(v)));
const int = (v, def) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);
const dir = (v, def) => path.resolve(ROOT, v || def);

if (!env.TZ) process.env.TZ = 'Europe/Paris';

module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  host: env.HOST || '127.0.0.1',
  port: int(env.PORT, 3000),
  dataDir: dir(env.DATA_DIR, 'data'),
  backupDir: dir(env.BACKUP_DIR, 'backups'),
  backupKeep: int(env.BACKUP_KEEP, 30),
  trustProxy: int(env.TRUST_PROXY, 1),
  cookieSecure: bool(env.COOKIE_SECURE, env.NODE_ENV === 'production'),
  sessionDays: int(env.SESSION_DAYS, 30),
  seedDemo: bool(env.SEED_DEMO, false),
};
