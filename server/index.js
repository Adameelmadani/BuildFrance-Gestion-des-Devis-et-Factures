/* Build France - serveur web (API + fichiers de l'application) */
'use strict';
const path = require('path');
const express = require('express');
const config = require('./config');
const store = require('./db');
const auth = require('./auth');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

/* ---------- en-têtes de sécurité ---------- */
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

app.use(express.json({ limit: '15mb' }));
app.use(auth.loadUser);

// Protection CSRF : les envois POST/PUT doivent être en JSON (impossible depuis un formulaire d'un autre site ;
// DELETE ne peut pas venir d'un autre site sans autorisation CORS, que ce serveur ne donne jamais)
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method) || req.is('application/json')) return next();
  res.status(415).json({ error: 'Requête JSON attendue.' });
});

/* ---------- API publique ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (auth.loginBlocked(ip)) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
  }
  const { username, password } = req.body || {};
  const user = auth.users.find(username);
  const ok = auth.verifyPassword(password || '', user ? user.password_hash : auth.DUMMY_HASH) && !!user;
  if (!ok) {
    auth.loginFailed(ip);
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
  }
  auth.loginOk(ip);
  auth.startSession(res, user.id);
  res.json({ user: { id: user.id, username: user.username } });
});

app.post('/api/logout', (req, res) => {
  auth.endSession(req, res);
  res.json({ ok: true });
});

/* ---------- API protégée ---------- */
const api = express.Router();
api.use(auth.requireUser);

api.get('/me', (req, res) => res.json({ user: req.user }));

api.post('/password', (req, res) => {
  const { current, next } = req.body || {};
  const u = auth.users.find(req.user.username);
  if (!u || !auth.verifyPassword(current || '', u.password_hash)) {
    return res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
  }
  try { auth.users.setPassword(u.id, next, req.sessionHash); } catch (e) { return res.status(400).json({ error: e.message }); }
  res.json({ ok: true });
});

api.get('/state', (req, res) => res.json(Object.assign(store.getState(), { user: req.user })));
api.get('/revision', (req, res) => res.json({ revision: store.revision() }));

api.put('/settings', (req, res) => res.json(store.saveSettings(req.body)));
api.put('/clients/:id', (req, res) => res.json(store.saveClient(req.params.id, req.body)));
api.delete('/clients/:id', (req, res) => res.json(store.deleteClient(req.params.id)));
api.put('/documents/:id', (req, res) => res.json(store.saveDoc(req.params.id, req.body)));
api.delete('/documents/:id', (req, res) => res.json(store.deleteDoc(req.params.id)));

api.get('/export', (req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  res.set('Content-Disposition', `attachment; filename="buildfrance-sauvegarde-${day}.json"`);
  res.type('application/json').send(JSON.stringify(store.exportAll(), null, 2));
});
api.post('/import', (req, res) => res.json(store.importAll(req.body)));

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Ressource introuvable.' }));

/* ---------- pages ---------- */
const page = (file) => (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(config.PUBLIC_DIR, file));
};
const loginRedirect = (req) => '/login' + (req.query.next ? '?next=' + encodeURIComponent(req.query.next) : '');

app.get('/login', (req, res, next) => (req.user ? res.redirect('/') : page('login.html')(req, res, next)));
app.get(['/', '/index.html'], (req, res, next) => (req.user ? page('index.html')(req, res, next) : res.redirect(loginRedirect(req))));
app.get('/login.html', (req, res) => res.redirect('/login'));

app.use(express.static(config.PUBLIC_DIR, { index: false, maxAge: 0 }));

/* ---------- erreurs ---------- */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  const message = status >= 500 ? 'Erreur interne du serveur.'
    : err.type === 'entity.too.large' ? 'Données trop volumineuses.'
    : err.type === 'entity.parse.failed' ? 'JSON invalide.'
    : err.message;
  if (req.path.startsWith('/api')) res.status(status).json({ error: message });
  else res.status(status).type('text').send(message);
});

/* ---------- démarrage ---------- */
const server = app.listen(config.port, config.host, () => {
  console.log(`Build France - serveur démarré sur http://${config.host}:${config.port}`);
  console.log(`Base de données : ${store.DB_FILE}`);
  if (!auth.users.count()) {
    console.warn('Aucun utilisateur : créez-en un avec « npm run user -- add <nom> ».');
  }
});

const shutdown = (sig) => {
  console.log(`${sig} reçu, arrêt du serveur…`);
  server.close(() => { store.db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
