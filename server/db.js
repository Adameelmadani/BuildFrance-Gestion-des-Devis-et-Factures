/* Build France - base de données SQLite (devis, factures, clients, paramètres, utilisateurs) */
'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');
const BF = require('../public/js/store.js');

fs.mkdirSync(config.dataDir, { recursive: true });
const DB_FILE = path.join(config.dataDir, 'buildfrance.sqlite');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/* ---------- schéma ---------- */
db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS clients (
    id         TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS documents (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL CHECK (type IN ('devis', 'facture')),
    numero     TEXT NOT NULL,
    date       TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS documents_type_numero ON documents (type, numero);
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);
`);

/* ---------- erreurs HTTP ---------- */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- révision (change à chaque écriture, permet aux navigateurs de se resynchroniser) ---------- */
const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const revision = () => Number((getMeta.get('revision') || {}).value || 0);
const bump = () => { const r = revision() + 1; setMeta.run('revision', String(r)); return r; };

/* ---------- nettoyage / validation des données reçues ---------- */
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 5000) => String(v == null ? '' : v).slice(0, max);
const numOrStr = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : str(v, 40));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[\w-]{1,64}$/;

function checkId(id) {
  if (!ID.test(String(id || ''))) throw new HttpError(400, 'Identifiant invalide.');
  return String(id);
}

function cleanDoc(input, id) {
  const d = isObj(input) ? input : {};
  const type = d.type;
  if (type !== 'devis' && type !== 'facture') throw new HttpError(400, 'Type de document invalide.');
  const statuts = BF.STATUTS[type].map((s) => s[0]);
  const ch = isObj(d.chantier) ? d.chantier : {};
  const cl = isObj(d.client) ? d.client : {};
  const lignes = (Array.isArray(d.lignes) ? d.lignes : []).slice(0, 500).filter(isObj).map((l) => ({
    designation: str(l.designation, 20000),
    unite: str(l.unite, 40),
    qte: numOrStr(l.qte),
    pu: numOrStr(l.pu),
  }));
  const now = Date.now();
  const doc = {
    id,
    type,
    nature: d.nature === 'acompte' ? 'acompte' : 'totale',
    numero: str(d.numero, 60),
    date: ISO.test(d.date) ? d.date : BF.todayISO(),
    statut: statuts.includes(d.statut) ? d.statut : statuts[0],
    chantier: { nom: str(ch.nom, 300), lieu: str(ch.lieu, 300) },
    client: {
      nom: str(cl.nom, 300), adresse: str(cl.adresse, 500), cp: str(cl.cp, 20),
      ville: str(cl.ville, 200), pays: str(cl.pays, 100),
    },
    lignes: lignes.length ? lignes : [{ designation: '', unite: 'Ens', qte: 1, pu: 0 }],
    tauxTVA: Number.isFinite(Number(d.tauxTVA)) ? Number(d.tauxTVA) : 20,
    autoliquidation: !!d.autoliquidation,
    conditions: str(d.conditions, 10000),
    echeance: str(d.echeance, 1000),
    devisRef: str(d.devisRef, 60),
    devisId: d.devisId && ID.test(String(d.devisId)) ? String(d.devisId) : null,
    createdAt: Number.isFinite(Number(d.createdAt)) && Number(d.createdAt) > 0 ? Number(d.createdAt) : now,
    updatedAt: now,
  };
  if (d.numeroAuto === false) doc.numeroAuto = false;
  return doc;
}

function cleanClient(input, id) {
  const c = isObj(input) ? input : {};
  const client = { id };
  ['nom', 'adresse', 'cp', 'ville', 'pays', 'tel', 'email'].forEach((k) => { client[k] = str(c[k], 500).trim(); });
  if (!client.nom) throw new HttpError(400, 'Le nom du client est obligatoire.');
  if (!client.pays) client.pays = 'France';
  return client;
}

function cleanSettings(input) {
  const def = BF.defaultSettings();
  const merged = BF.mergeSettings(isObj(input) ? input : {});
  const out = {};
  Object.keys(def).forEach((k) => {
    if (k === 'company') {
      out.company = {};
      Object.keys(def.company).forEach((ck) => { out.company[ck] = str(merged.company[ck], 500); });
    } else if (k === 'logo') {
      const l = merged.logo;
      out.logo = typeof l === 'string' && /^data:image\/(png|jpe?g);base64,/.test(l) && l.length < 3e6 ? l : null;
    } else if (typeof def[k] === 'number') {
      out[k] = Number.isFinite(Number(merged[k])) ? Number(merged[k]) : def[k];
    } else {
      out[k] = str(merged[k], 10000);
    }
  });
  return out;
}

/* ---------- lecture ---------- */
const qSettings = db.prepare('SELECT data FROM settings WHERE id = 1');
const qClients = db.prepare('SELECT data FROM clients ORDER BY rowid');
const qDocs = db.prepare('SELECT data FROM documents ORDER BY created_at DESC, rowid DESC');
const qDoc = db.prepare('SELECT data FROM documents WHERE id = ?');
const qDocsOfType = db.prepare('SELECT id, type, numero, date FROM documents WHERE type = ?');
const qNumeroTaken = db.prepare('SELECT 1 FROM documents WHERE type = ? AND numero = ? AND id <> ? LIMIT 1');
const qLinked = db.prepare("SELECT id, data FROM documents WHERE type = 'facture' AND json_extract(data, '$.devisId') = ?");

const parse = (row) => (row ? JSON.parse(row.data) : null);
const getSettings = () => BF.mergeSettings(parse(qSettings.get()));

function getState() {
  return {
    revision: revision(),
    settings: getSettings(),
    clients: qClients.all().map(parse),
    documents: qDocs.all().map(parse),
  };
}

/* ---------- écriture ---------- */
const upSettings = db.prepare(`INSERT INTO settings (id, data, updated_at) VALUES (1, ?, ?)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`);
const upClient = db.prepare(`INSERT INTO clients (id, data, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`);
const delClient = db.prepare('DELETE FROM clients WHERE id = ?');
const upDoc = db.prepare(`INSERT INTO documents (id, type, numero, date, data, created_at, updated_at)
  VALUES (@id, @type, @numero, @date, @data, @createdAt, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET type = excluded.type, numero = excluded.numero, date = excluded.date,
    data = excluded.data, updated_at = excluded.updated_at`);
const delDoc = db.prepare('DELETE FROM documents WHERE id = ?');
const setDocData = db.prepare('UPDATE documents SET data = ? WHERE id = ?');

function writeDoc(doc) {
  upDoc.run({ id: doc.id, type: doc.type, numero: doc.numero, date: doc.date, data: JSON.stringify(doc),
    createdAt: doc.createdAt, updatedAt: doc.updatedAt });
}

const saveSettings = db.transaction((input) => {
  const s = cleanSettings(input);
  upSettings.run(JSON.stringify(s), Date.now());
  return { settings: s, revision: bump() };
});

const saveClient = db.transaction((id, input) => {
  const c = cleanClient(input, checkId(id));
  upClient.run(c.id, JSON.stringify(c), Date.now());
  return { client: c, revision: bump() };
});

const deleteClient = db.transaction((id) => {
  delClient.run(checkId(id));
  return { revision: bump() };
});

/** Crée ou met à jour un document. Le serveur garantit qu'un numéro n'est pas attribué deux fois. */
const saveDoc = db.transaction((id, input) => {
  id = checkId(id);
  const existing = parse(qDoc.get(id));
  const doc = cleanDoc(input, id);
  if (existing) {
    doc.type = existing.type; // le type d'un document ne change pas
    doc.createdAt = existing.createdAt || doc.createdAt;
  }
  const numeroChanged = !existing || existing.numero !== doc.numero;
  const taken = doc.numero && numeroChanged && qNumeroTaken.get(doc.type, doc.numero, id);
  if (!doc.numero || taken) {
    if (taken && doc.numeroAuto === false) {
      throw new HttpError(409, `Le numéro ${doc.numero} est déjà utilisé par ${doc.type === 'devis' ? 'un autre devis' : 'une autre facture'}.`);
    }
    const state = { settings: getSettings(), documents: qDocsOfType.all(doc.type) };
    doc.numero = BF.nextNumero(state, doc.type, doc.date, id);
  }
  writeDoc(doc);
  return { doc, revision: bump() };
});

const deleteDoc = db.transaction((id) => {
  id = checkId(id);
  delDoc.run(id);
  // Les factures issues d'un devis supprimé sont conservées, sans lien
  qLinked.all(id).forEach((row) => {
    const f = JSON.parse(row.data);
    f.devisId = null;
    setDocData.run(JSON.stringify(f), row.id);
  });
  return { revision: bump() };
});

/** Remplace toutes les données (import d'une sauvegarde .json) */
const importAll = db.transaction((data) => {
  if (!isObj(data) || !Array.isArray(data.documents) || !isObj(data.settings)) {
    throw new HttpError(400, "Fichier invalide : ce n'est pas une sauvegarde Build France.");
  }
  if (!data.tiretsOk) data = BF.fixDashes(data);
  db.prepare('DELETE FROM documents').run();
  db.prepare('DELETE FROM clients').run();
  upSettings.run(JSON.stringify(cleanSettings(data.settings)), Date.now());
  const seen = new Set();
  (Array.isArray(data.clients) ? data.clients : []).forEach((c) => {
    if (!isObj(c) || !String(c.nom || '').trim()) return;
    let id = ID.test(String(c.id || '')) ? String(c.id) : BF.uid();
    while (seen.has(id)) id = BF.uid();
    seen.add(id);
    const clean = cleanClient(c, id);
    upClient.run(id, JSON.stringify(clean), Date.now());
  });
  seen.clear();
  let n = 0;
  data.documents.forEach((d) => {
    if (!isObj(d) || (d.type !== 'devis' && d.type !== 'facture')) return;
    let id = ID.test(String(d.id || '')) ? String(d.id) : BF.uid();
    while (seen.has(id)) id = BF.uid();
    seen.add(id);
    const doc = cleanDoc(d, id);
    if (Number.isFinite(Number(d.updatedAt))) doc.updatedAt = Number(d.updatedAt);
    if (!doc.numero) doc.numero = BF.nextNumero({ settings: getSettings(), documents: qDocsOfType.all(doc.type) }, doc.type, doc.date, id);
    writeDoc(doc);
    n++;
  });
  return { documents: n, revision: bump() };
});

function exportAll() {
  const st = getState();
  return { version: 1, tiretsOk: true, exportedAt: new Date().toISOString(),
    settings: st.settings, clients: st.clients, documents: st.documents };
}

/* ---------- premier démarrage ---------- */
if (!qSettings.get()) {
  db.transaction(() => {
    if (config.seedDemo) {
      const st = BF.seed();
      upSettings.run(JSON.stringify(st.settings), Date.now());
      st.clients.forEach((c) => upClient.run(c.id, JSON.stringify(c), Date.now()));
      st.documents.slice().reverse().forEach(writeDoc);
    } else {
      upSettings.run(JSON.stringify(BF.defaultSettings()), Date.now());
    }
    bump();
  })();
}

module.exports = {
  db, DB_FILE, HttpError, revision, getState, saveSettings, saveClient, deleteClient,
  saveDoc, deleteDoc, importAll, exportAll,
};
