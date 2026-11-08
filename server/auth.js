/* Build France - comptes utilisateurs et sessions (cookie HttpOnly) */
'use strict';
const crypto = require('crypto');
const { db } = require('./db');
const config = require('./config');

const COOKIE = 'bf_session';
const DAY = 24 * 60 * 60 * 1000;

/* ---------- mots de passe (scrypt, sans dépendance) ---------- */
const SCRYPT = { N: 16384, r: 8, p: 1 };
const MIN_PASSWORD = 8;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(expected, got);
}

// Hash factice : la vérification prend le même temps que l'utilisateur existe ou non
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

/* ---------- utilisateurs ---------- */
const qUserByName = db.prepare('SELECT * FROM users WHERE username = ?');
const qUserById = db.prepare('SELECT id, username FROM users WHERE id = ?');
const qUsers = db.prepare('SELECT id, username, created_at FROM users ORDER BY username');
const insUser = db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)');
const updPass = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const delUser = db.prepare('DELETE FROM users WHERE id = ?');

function checkPasswordStrength(pw) {
  if (String(pw || '').length < MIN_PASSWORD) throw new Error(`Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`);
}

const users = {
  list: () => qUsers.all(),
  find: (username) => qUserByName.get(String(username || '').trim()),
  create(username, password) {
    username = String(username || '').trim();
    if (!/^[\w.@-]{2,64}$/.test(username)) throw new Error("Nom d'utilisateur invalide (2 à 64 caractères : lettres, chiffres, . _ - @).");
    checkPasswordStrength(password);
    if (qUserByName.get(username)) throw new Error(`L'utilisateur « ${username} » existe déjà.`);
    return insUser.run(username, hashPassword(password), Date.now()).lastInsertRowid;
  },
  /** Change le mot de passe et déconnecte les autres sessions (sauf celle indiquée) */
  setPassword(id, password, keepSessionHash) {
    checkPasswordStrength(password);
    updPass.run(hashPassword(password), id);
    revokeSessions(id, keepSessionHash);
  },
  remove: (id) => delUser.run(id),
  count: () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
};

/* ---------- sessions ---------- */
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const insSession = db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
const qSession = db.prepare(`SELECT s.token_hash, s.expires_at, u.id AS user_id, u.username
  FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`);
const touchSession = db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?');
const delSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const delUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');
const purge = db.prepare('DELETE FROM sessions WHERE expires_at < ?');

function revokeSessions(userId, exceptHash) {
  if (!exceptHash) return delUserSessions.run(userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, exceptHash);
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setCookie(res, value, maxAgeMs) {
  const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (config.cookieSecure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttl = config.sessionDays * DAY;
  insSession.run(sha(token), userId, Date.now(), Date.now() + ttl);
  setCookie(res, token, ttl);
}

function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) delSession.run(sha(token));
  setCookie(res, '', 0);
}

/** Middleware : renseigne req.user si la session est valide (et la prolonge si besoin) */
function loadUser(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const h = sha(token);
    const s = qSession.get(h);
    if (s && s.expires_at > Date.now()) {
      req.user = { id: s.user_id, username: s.username };
      req.sessionHash = h;
      // Prolongation glissante, au plus une fois par jour
      const ttl = config.sessionDays * DAY;
      if (s.expires_at - Date.now() < ttl - DAY) {
        touchSession.run(Date.now() + ttl, h);
        setCookie(res, token, ttl);
      }
    } else if (s) {
      delSession.run(h);
    }
  }
  next();
}

function requireUser(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'Session expirée : reconnectez-vous.' });
}

/* ---------- limitation des tentatives de connexion ---------- */
const attempts = new Map(); // ip -> { n, until }
const MAX_FAILS = 10;
const WINDOW = 15 * 60 * 1000;

function loginBlocked(ip) {
  const a = attempts.get(ip);
  if (!a) return false;
  if (a.until < Date.now()) { attempts.delete(ip); return false; }
  return a.n >= MAX_FAILS;
}
function loginFailed(ip) {
  const a = attempts.get(ip);
  if (!a || a.until < Date.now()) attempts.set(ip, { n: 1, until: Date.now() + WINDOW });
  else a.n++;
}
const loginOk = (ip) => attempts.delete(ip);

setInterval(() => {
  purge.run(Date.now());
  const now = Date.now();
  for (const [ip, a] of attempts) if (a.until < now) attempts.delete(ip);
}, 60 * 60 * 1000).unref();

module.exports = {
  users, hashPassword, verifyPassword, DUMMY_HASH, startSession, endSession, revokeSessions,
  loadUser, requireUser, loginBlocked, loginFailed, loginOk, qUserById,
};
