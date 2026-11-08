/* Build France - données, calculs, numérotation */
window.BF = window.BF || {};
(function (BF) {
  'use strict';

  BF.KEY = 'buildfrance-gestion-v1';

  /* ---------- utilitaires ---------- */
  BF.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  BF.esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  BF.nl2br = (s) => BF.esc(s).replace(/\n/g, '<br>');

  BF.round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  /** "2 400,50" | "2400.50" | "2.400,50" -> 2400.5 */
  BF.parseNum = (v) => {
    if (typeof v === 'number') return v;
    let s = String(v || '').replace(/[\s  €]/g, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  const pad = (n, l = 2) => String(n).padStart(l, '0');

  BF.todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const toDate = (iso) => {
    const [y, m, d] = String(iso || BF.todayISO()).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };

  const eurFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  BF.fmt = {
    eur: (n) => eurFmt.format(BF.round2(n || 0)).replace(/ /g, ' '),
    num: (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n || 0),
    dateLong: (iso) => toDate(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
    dateShort: (iso) => toDate(iso).toLocaleDateString('fr-FR'),
    taux: (t) => String(t).replace('.', ',') + ' %',
  };

  /* ---------- valeurs par défaut ---------- */
  BF.defaultSettings = () => ({
    company: {
      nom: 'BUILD FRANCE SAS',
      adresse: '6 impasse Jean Macé',
      cp: '30900',
      ville: 'Nîmes',
      tel: '0652473005',
      email: 'buildfrance.sas@gmail.com',
      siret: '10671295300012',
      rcs: 'RCS Nîmes',
      tva: 'FR 71106712953',
      naf: '4120A',
      iban: '',
      bic: '',
    },
    tauxTVA: 20,
    numFormat: '{NN}{JJ}{MM}{AAAA}',
    devisConditions: "Acceptation de devis acompte 35 %\nFacturation en fonction de l'avancement de travaux",
    acomptePct: 35,
    factureEcheance: 'À réception de facture',
    factureMentions:
      "En cas de retard de paiement : pénalités au taux de 3 fois le taux d'intérêt légal et indemnité forfaitaire " +
      "pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce). Pas d'escompte pour paiement anticipé.",
    autoliqMention: 'Autoliquidation - TVA due par le preneur (art. 283-2 nonies du CGI)',
    logo: null,
  });

  BF.STATUTS = {
    devis: [
      ['brouillon', 'Brouillon'],
      ['envoye', 'Envoyé'],
      ['accepte', 'Accepté'],
      ['refuse', 'Refusé'],
    ],
    facture: [
      ['a_payer', 'À payer'],
      ['payee', 'Payée'],
      ['annulee', 'Annulée'],
    ],
  };
  BF.statutLabel = (type, code) => (BF.STATUTS[type].find((s) => s[0] === code) || [code, code])[1];

  /* ---------- calculs ---------- */
  BF.totals = (doc) => {
    const ht = BF.round2((doc.lignes || []).reduce((s, l) => s + BF.round2(BF.parseNum(l.qte) * BF.parseNum(l.pu)), 0));
    const taux = doc.autoliquidation ? 0 : Number(doc.tauxTVA) || 0;
    const tva = BF.round2(ht * taux / 100);
    return { ht, tva, ttc: BF.round2(ht + tva), taux };
  };

  /* ---------- numérotation ---------- */
  BF.formatNumero = (pattern, iso, seq) => {
    const d = toDate(iso);
    return (pattern || '{NN}{JJ}{MM}{AAAA}')
      .replace(/\{NNN\}/g, pad(seq, 3))
      .replace(/\{NN\}/g, pad(seq, 2))
      .replace(/\{JJ\}/g, pad(d.getDate()))
      .replace(/\{MM\}/g, pad(d.getMonth() + 1))
      .replace(/\{AAAA\}/g, d.getFullYear())
      .replace(/\{AA\}/g, String(d.getFullYear()).slice(2));
  };

  /** Numéro suivant pour ce type à cette date (compteur du jour, sans doublon). */
  BF.nextNumero = (state, type, iso, exceptId) => {
    const pattern = state.settings.numFormat;
    const others = state.documents.filter((d) => d.type === type && d.id !== exceptId);
    const taken = new Set(others.map((d) => d.numero));
    let seq = others.filter((d) => d.date === iso).length + 1;
    let num = BF.formatNumero(pattern, iso, seq);
    while (taken.has(num)) num = BF.formatNumero(pattern, iso, ++seq);
    return num;
  };

  /* ---------- création ---------- */
  BF.newDoc = (state, type, patch = {}) => {
    const s = state.settings;
    const date = patch.date || BF.todayISO();
    const doc = Object.assign({
      id: BF.uid(),
      type,
      nature: 'totale', // facture : totale | acompte
      numero: '',
      date,
      statut: type === 'devis' ? 'brouillon' : 'a_payer',
      chantier: { nom: '', lieu: '' },
      client: { nom: '', adresse: '', cp: '', ville: '', pays: 'France' },
      lignes: [{ designation: '', unite: 'Ens', qte: 1, pu: 0 }],
      tauxTVA: s.tauxTVA,
      autoliquidation: false,
      conditions: type === 'devis' ? s.devisConditions : '',
      echeance: type === 'facture' ? s.factureEcheance : '',
      devisRef: '',
      devisId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, patch);
    if (!doc.numero) doc.numero = BF.nextNumero(state, type, date);
    state.documents.unshift(doc);
    return doc;
  };

  /** Devis -> facture (totale ou acompte en %) */
  BF.devisToFacture = (state, devis, { date, pct }) => {
    const p = Number(pct) || 100;
    const isAcompte = p < 100;
    const t = BF.totals(devis);
    const lignes = isAcompte
      ? [{
          designation: `Acompte de ${BF.fmt.num(p)} % sur devis N° ${devis.numero}\n` +
            (devis.lignes || []).map((l) => l.designation).filter(Boolean).join('\n'),
          unite: 'Ens', qte: 1, pu: BF.round2(t.ht * p / 100),
        }]
      : JSON.parse(JSON.stringify(devis.lignes));
    return BF.newDoc(state, 'facture', {
      date,
      nature: isAcompte ? 'acompte' : 'totale',
      chantier: Object.assign({}, devis.chantier),
      client: Object.assign({}, devis.client),
      lignes,
      tauxTVA: devis.tauxTVA,
      autoliquidation: devis.autoliquidation,
      devisRef: devis.numero,
      devisId: devis.id,
    });
  };

  BF.duplicate = (state, doc) => {
    const copy = JSON.parse(JSON.stringify(doc));
    delete copy.id; delete copy.numero;
    copy.date = BF.todayISO();
    copy.statut = doc.type === 'devis' ? 'brouillon' : 'a_payer';
    copy.devisId = doc.type === 'facture' ? doc.devisId : null;
    copy.createdAt = copy.updatedAt = Date.now();
    return BF.newDoc(state, doc.type, copy);
  };

  /* ---------- persistance ---------- */
  BF.seed = () => {
    const state = { version: 1, tiretsOk: true, settings: BF.defaultSettings(), clients: [], documents: [] };
    const azza = {
      id: BF.uid(), nom: 'Azza Protection Incendie', adresse: '30 chemin des Cadeneaux',
      cp: '13570', ville: 'Barbentane', pays: 'France', email: '', tel: '',
    };
    state.clients.push(azza);
    const client = { nom: azza.nom, adresse: azza.adresse, cp: azza.cp, ville: azza.ville, pays: azza.pays };

    // Exemple demandé : chantier Adidas - Terrasses du Port
    const devis = BF.newDoc(state, 'devis', {
      date: '2026-10-29',
      statut: 'accepte',
      chantier: { nom: 'ADIDAS', lieu: 'Terrasses du Port - Marseille' },
      client,
      lignes: [{
        designation: 'Création nappe basse 10 têtes, essai et mise en service - boutique Adidas, Terrasses du Port',
        unite: 'Ens', qte: 1, pu: 2400,
      }],
    });
    BF.devisToFacture(state, devis, { date: '2026-11-05', pct: 100 });
    return state;
  };

  BF.load = () => {
    try {
      const raw = localStorage.getItem(BF.KEY);
      if (raw) {
        let st = JSON.parse(raw);
        // Conversion unique : tirets longs « — » remplacés par « - » dans les données enregistrées
        if (!st.tiretsOk) {
          const fix = (v) => typeof v === 'string' ? v.replace(/—/g, '-')
            : Array.isArray(v) ? v.map(fix)
            : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]))
            : v;
          st = fix(st);
          st.tiretsOk = true;
          BF.save(st);
        }
        st.settings = Object.assign(BF.defaultSettings(), st.settings);
        st.settings.company = Object.assign(BF.defaultSettings().company, st.settings.company);
        st.clients = st.clients || [];
        st.documents = st.documents || [];
        return st;
      }
    } catch (e) { console.warn('Lecture impossible', e); }
    const st = BF.seed();
    BF.save(st);
    return st;
  };

  BF.save = (state) => {
    try { localStorage.setItem(BF.KEY, JSON.stringify(state)); return true; }
    catch (e) { console.error(e); alert("Impossible d'enregistrer (stockage plein ?). Pensez à exporter une sauvegarde."); return false; }
  };
})(window.BF);
