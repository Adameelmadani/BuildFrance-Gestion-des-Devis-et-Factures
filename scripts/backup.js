#!/usr/bin/env node
/* Build France - sauvegarde de la base SQLite (sans arrêter le serveur)
   npm run backup
   Crée backups/buildfrance-AAAA-MM-JJ_HHMMSS.sqlite et ne garde que les BACKUP_KEEP plus récentes. */
'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../server/config');
const { db } = require('../server/db');

async function main() {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name = `buildfrance-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.sqlite`;
  const dest = path.join(config.backupDir, name);
  await db.backup(dest);
  console.log(`Sauvegarde créée : ${dest}`);

  const files = fs.readdirSync(config.backupDir)
    .filter((f) => /^buildfrance-.*\.sqlite$/.test(f))
    .sort()
    .reverse();
  files.slice(Math.max(1, config.backupKeep)).forEach((f) => {
    fs.unlinkSync(path.join(config.backupDir, f));
    console.log(`Ancienne sauvegarde supprimée : ${f}`);
  });
  db.close();
}

main().catch((e) => { console.error('Erreur de sauvegarde : ' + e.message); process.exit(1); });
