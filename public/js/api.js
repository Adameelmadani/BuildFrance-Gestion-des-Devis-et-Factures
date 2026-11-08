/* Build France - communication avec le serveur */
window.BF = window.BF || {};
(function (BF) {
  'use strict';

  let inflight = 0;
  let known = 0; // dernière révision connue des données du serveur

  async function request(method, url, body) {
    const opt = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    let res;
    inflight++;
    try {
      res = await fetch(url, opt);
    } catch (e) {
      throw Object.assign(new Error('Serveur injoignable : vérifiez la connexion internet.'), { network: true });
    } finally {
      inflight--;
    }
    if (res.status === 401 && !url.endsWith('/api/login')) {
      location.href = '/login?next=' + encodeURIComponent('/' + location.hash);
      throw new Error('Session expirée : reconnectez-vous.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error((data && data.error) || `Erreur du serveur (${res.status}).`), { status: res.status });
    // Révision : on ne la suit que si personne d'autre n'a écrit entre-temps
    if (data && typeof data.revision === 'number' && method !== 'GET') {
      if (data.revision === known + 1) known = data.revision;
    }
    return data;
  }

  /* Les écritures sur un même objet partent dans l'ordre, l'une après l'autre */
  const lanes = {};
  const serial = (key, task) => {
    const p = (lanes[key] || Promise.resolve()).catch(() => {}).then(task);
    lanes[key] = p;
    p.finally(() => { if (lanes[key] === p) delete lanes[key]; }).catch(() => {});
    return p;
  };

  const enc = encodeURIComponent;

  BF.api = {
    busy: () => inflight > 0 || Object.keys(lanes).length > 0,

    async loadState() {
      const st = await request('GET', '/api/state');
      known = st.revision;
      st.settings = BF.mergeSettings(st.settings);
      st.clients = st.clients || [];
      st.documents = st.documents || [];
      return st;
    },

    /** true si les données du serveur ont changé depuis le dernier chargement */
    async changed() {
      const r = await request('GET', '/api/revision');
      return r.revision !== known;
    },

    /** Enregistre un document ; le serveur peut corriger le numéro s'il est déjà pris */
    saveDoc: (doc) => serial('doc:' + doc.id, async () => {
      const r = await request('PUT', '/api/documents/' + enc(doc.id), doc);
      if (r.doc.numero !== doc.numero) doc.numero = r.doc.numero;
      return r.doc;
    }),
    deleteDoc: (id) => serial('doc:' + id, () => request('DELETE', '/api/documents/' + enc(id))),

    saveClient: (c) => serial('client:' + c.id, () => request('PUT', '/api/clients/' + enc(c.id), c)),
    deleteClient: (id) => serial('client:' + id, () => request('DELETE', '/api/clients/' + enc(id))),

    saveSettings: (s) => serial('settings', () => request('PUT', '/api/settings', s)),

    importAll: (data) => request('POST', '/api/import', data),
    changePassword: (current, next) => request('POST', '/api/password', { current, next }),
    logout: () => request('POST', '/api/logout', {}),
    login: (username, password) => request('POST', '/api/login', { username, password }),
  };
})(window.BF);
