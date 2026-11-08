/* Build France - application (routage, vues, éditeur) */
(function (BF) {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const e = BF.esc;
  const f = BF.fmt;
  const main = $('#main');

  let state = BF.load();
  let lastEditorId = null;
  let saveTimer = null;

  const persist = () => BF.save(state);
  const persistSoon = (cb) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { persist(); if (cb) cb(); }, 350);
  };
  const getDoc = (id) => state.documents.find((d) => d.id === id);
  const removeDoc = (id) => { state.documents = state.documents.filter((d) => d.id !== id); };

  function toast(html, ms = 4000) {
    const t = $('#toast');
    t.innerHTML = html;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), ms);
  }

  function setNav(key) {
    $$('.nav a').forEach((a) => {
      if (a.dataset.nav === key) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  const badge = (doc) => `<span class="badge badge-${e(doc.statut)}">${e(BF.statutLabel(doc.type, doc.statut))}</span>`;
  const docTitle = (doc) => doc.type === 'devis' ? 'Devis' : (doc.nature === 'acompte' ? "Facture d'acompte" : 'Facture');
  const listHash = (type) => type === 'devis' ? '#/devis' : '#/factures';

  const isEmptyDoc = (d) => d && !d.chantier.nom && !d.client.nom &&
    d.lignes.every((l) => !String(l.designation).trim() && !BF.parseNum(l.pu));

  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  const setPath = (obj, path, val) => {
    const ks = path.split('.'); const last = ks.pop();
    ks.reduce((o, k) => (o[k] = o[k] || {}), obj)[last] = val;
  };

  /* =========================================================
     Impression / PDF
     ========================================================= */
  function waitImages(root) {
    return Promise.all($$('img', root).map((i) => i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })));
  }

  function printDoc(doc) {
    const root = $('#print-root');
    root.innerHTML = BF.renderDoc(doc, state.settings);
    const old = document.title;
    document.title = BF.docFileName(doc); // nom proposé pour « Enregistrer en PDF »
    waitImages(root).then(() => {
      window.print();
      setTimeout(() => { document.title = old; }, 800);
    });
  }

  function downloadPdf(doc) {
    if (!window.html2pdf) {
      toast("Téléchargement direct indisponible (hors connexion). Choisissez « Enregistrer au format PDF » dans la fenêtre d'impression.");
      printDoc(doc);
      return;
    }
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-12000px;top:0;width:210mm;background:#fff';
    holder.innerHTML = BF.renderDoc(doc, state.settings);
    document.body.appendChild(holder);
    const el = holder.firstElementChild;
    el.style.minHeight = '296.5mm';
    toast('Préparation du PDF…', 2000);
    waitImages(holder).then(() => window.html2pdf().set({
      margin: 0,
      filename: BF.docFileName(doc) + '.pdf',
      image: { type: 'jpeg', quality: 0.97 },
      html2canvas: { scale: 2.5, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css'] },
    }).from(el).save())
      .then(() => toast(`PDF téléchargé : <b>${e(BF.docFileName(doc))}.pdf</b>`))
      .catch((err) => { console.error(err); toast("Erreur lors de la création du PDF - utilisez « Imprimer »."); })
      .finally(() => holder.remove());
  }

  /* =========================================================
     Facturer un devis (dialogue)
     ========================================================= */
  function openFacturer(devis) {
    const dlg = $('#dlg');
    const t = BF.totals(devis);
    const deja = state.documents.filter((d) => d.type === 'facture' && d.devisId === devis.id);
    dlg.innerHTML = `<form method="dialog">
      <div class="dlg-h"><h2>Facturer le devis ${e(devis.numero)}</h2>
        <button class="icon-btn" value="cancel" aria-label="Fermer">✕</button></div>
      <div class="dlg-b">
        ${deja.length ? `<div class="alert alert-warn">Ce devis a déjà été facturé : ${deja.map((d) => `N° ${e(d.numero)} (${f.eur(BF.totals(d).ttc)} TTC)`).join(', ')}.</div>` : ''}
        <div class="field">
          <label for="fx-date">Date de la facture</label>
          <input type="date" id="fx-date" class="input" value="${BF.todayISO()}" required>
        </div>
        <div class="radio-cards" role="radiogroup" aria-label="Type de facture">
          <label class="radio-card"><input type="radio" name="fx-n" value="totale" checked>
            <span><b>Facture totale</b><small>${f.eur(t.ht)} HT · reprend toutes les lignes du devis</small></span></label>
          <label class="radio-card"><input type="radio" name="fx-n" value="acompte">
            <span><b>Facture d'acompte</b><small>Un pourcentage du montant HT du devis</small></span></label>
        </div>
        <div class="field" id="fx-pct-f" hidden>
          <label for="fx-pct">Pourcentage d'acompte <span class="hint">- soit <span id="fx-pct-v"></span> HT</span></label>
          <input id="fx-pct" class="input is-num" inputmode="decimal" value="${e(state.settings.acomptePct)}">
        </div>
      </div>
      <div class="dlg-f">
        <button class="btn btn-tertiary" value="cancel">Annuler</button>
        <button class="btn" value="ok">Créer la facture</button>
      </div>
    </form>`;
    const pctF = $('#fx-pct-f', dlg);
    const upd = () => {
      const ac = $('input[name="fx-n"]:checked', dlg).value === 'acompte';
      pctF.hidden = !ac;
      $('#fx-pct-v', dlg).textContent = f.eur(t.ht * BF.parseNum($('#fx-pct', dlg).value) / 100);
    };
    dlg.addEventListener('input', upd);
    upd();
    dlg.returnValue = '';
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      const ac = $('input[name="fx-n"]:checked', dlg).value === 'acompte';
      const pct = ac ? Math.min(100, Math.max(1, BF.parseNum($('#fx-pct', dlg).value))) : 100;
      const fac = BF.devisToFacture(state, devis, { date: $('#fx-date', dlg).value || BF.todayISO(), pct });
      if (['brouillon', 'envoye'].includes(devis.statut)) devis.statut = 'accepte';
      persist();
      location.hash = '#/doc/' + fac.id;
      toast(`${docTitle(fac)} <b>${e(fac.numero)}</b> créée à partir du devis ${e(devis.numero)}.`);
    };
    dlg.showModal();
  }

  /* =========================================================
     Supprimer un devis / une facture (dialogue)
     ========================================================= */
  function openDelete(doc, done) {
    const dlg = $('#dlg');
    const isFact = doc.type === 'facture';
    const label = isFact ? `la facture ${doc.numero}` : `le devis ${doc.numero}`;
    const liees = isFact ? [] : state.documents.filter((d) => d.type === 'facture' && d.devisId === doc.id);
    const t = BF.totals(doc);
    dlg.innerHTML = `<form method="dialog">
      <div class="dlg-h"><h2>Supprimer ${e(label)} ?</h2>
        <button class="icon-btn" value="cancel" aria-label="Fermer">✕</button></div>
      <div class="dlg-b">
        <p><b>${docTitle(doc)} ${e(doc.numero)}</b> du ${f.dateShort(doc.date)}${doc.chantier.nom ? ` - ${e(doc.chantier.nom)}` : ''} - ${f.eur(t.ttc)} TTC.</p>
        <p>La suppression est définitive : le document ne pourra pas être récupéré, sauf depuis une sauvegarde exportée.</p>
        ${isFact ? `<div class="alert alert-warn">Une facture déjà envoyée au client ne doit normalement pas être supprimée : la numérotation doit rester continue. Préférez le statut « Annulée » (ou un avoir).</div>` : ''}
        ${liees.length ? `<div class="alert">Les factures issues de ce devis (${liees.map((x) => e(x.numero)).join(', ')}) seront conservées.</div>` : ''}
      </div>
      <div class="dlg-f">
        <button class="btn btn-tertiary" value="cancel">Annuler</button>
        ${isFact && doc.statut !== 'annulee' ? '<button class="btn btn-secondary" value="annulee">Marquer annulée</button>' : ''}
        <button class="btn btn-delete" value="delete">Supprimer</button>
      </div>
    </form>`;
    dlg.returnValue = '';
    dlg.onclose = () => {
      const v = dlg.returnValue;
      if (v === 'delete') {
        removeDoc(doc.id);
        liees.forEach((x) => { x.devisId = null; });
        persist();
        toast(`${docTitle(doc)} ${e(doc.numero)} supprimé${isFact ? 'e' : ''}.`);
        done && done('deleted');
      } else if (v === 'annulee') {
        doc.statut = 'annulee'; doc.updatedAt = Date.now();
        persist();
        toast(`Facture ${e(doc.numero)} marquée annulée.`);
        done && done('annulee');
      }
    };
    dlg.showModal();
  }

  /* =========================================================
     Accueil
     ========================================================= */
  function viewHome() {
    setNav('home');
    const docs = state.documents;
    const devis = docs.filter((d) => d.type === 'devis');
    const factures = docs.filter((d) => d.type === 'facture' && d.statut !== 'annulee');
    const enAttente = devis.filter((d) => ['brouillon', 'envoye'].includes(d.statut));
    const aPayer = factures.filter((d) => d.statut === 'a_payer');
    const year = String(new Date().getFullYear());
    const factYear = factures.filter((d) => d.date.startsWith(year));
    const sum = (arr, k) => arr.reduce((s, d) => s + BF.totals(d)[k], 0);
    const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const recent = docs.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);

    main.innerHTML = `
      <div class="page-head">
        <div><h1>Tableau de bord</h1><p>${e(state.settings.company.ville)}, ${e(today)}</p></div>
      </div>

      <dl class="figures">
        <div class="figure"><dt>Devis en attente de réponse</dt><dd>${enAttente.length}<small>${f.eur(sum(enAttente, 'ht'))} HT</small></dd></div>
        <div class="figure"><dt>Factures à encaisser</dt><dd>${f.eur(sum(aPayer, 'ttc'))}<small>${aPayer.length} facture${aPayer.length > 1 ? 's' : ''} TTC</small></dd></div>
        <div class="figure"><dt>Facturé en ${year}</dt><dd>${f.eur(sum(factYear, 'ht'))}<small>hors taxes</small></dd></div>
      </dl>

      <section aria-labelledby="r-title">
          <div class="panel-h" style="padding:0 0 12px;border:0">
            <h2 id="r-title">Derniers documents</h2>
            <a href="#/devis" class="nowrap">Tout voir</a>
          </div>
          ${recent.length ? `<div class="table-wrap"><table class="table table-cards cards-recent">
            <thead><tr><th>Document</th><th>Chantier</th><th class="num">TTC</th><th>Statut</th></tr></thead>
            <tbody>${recent.map((d) => `<tr>
              <td class="c-num"><a class="doc-num" href="#/doc/${d.id}">${docTitle(d)} ${e(d.numero)}</a><span class="sub">${f.dateShort(d.date)}</span></td>
              <td class="c-ch">${e(d.chantier.nom) || '<span class="muted">-</span>'}</td>
              <td class="num c-ttc">${f.eur(BF.totals(d).ttc)}</td>
              <td class="c-status">${badge(d)}</td></tr>`).join('')}</tbody></table></div>`
            : '<div class="panel empty">Aucun document pour le moment.</div>'}
      </section>`;
  }

  function tvaOptions(taux, autoliq) {
    const cur = autoliq ? 'autoliq' : String(taux);
    return [['20', 'TVA 20 %'], ['10', 'TVA 10 % (rénovation)'], ['5.5', 'TVA 5,5 % (rénovation énergétique)'], ['0', 'TVA 0 %'], ['autoliq', 'Autoliquidation (sous-traitance BTP)']]
      .map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
  }

  function clientOptions(selectedNom) {
    return `<option value="">- Choisir dans le carnet -</option>` + state.clients
      .map((c) => `<option value="${c.id}" ${c.nom === selectedNom ? 'selected' : ''}>${e(c.nom)}${c.ville ? ' - ' + e(c.ville) : ''}</option>`).join('');
  }

  /* =========================================================
     Listes (devis / factures)
     ========================================================= */
  function viewList(type) {
    setNav(type);
    const isDevis = type === 'devis';
    let filtre = 'tous';
    let q = '';
    main.innerHTML = `
      <div class="page-head">
        <div><h1>${isDevis ? 'Devis' : 'Factures'}</h1><p id="ls-count"></p></div>
        <a class="btn" href="#/nouveau/${type}">+ ${isDevis ? 'Nouveau devis' : 'Nouvelle facture'}</a>
      </div>
      <div class="tabs" role="tablist">
        ${[['tous', 'Tous']].concat(BF.STATUTS[type]).map(([v, l]) => `<button role="tab" data-f="${v}" aria-selected="${v === 'tous'}">${l}</button>`).join('')}
      </div>
      <div class="toolbar">
        <div class="field grow"><label for="ls-q">Rechercher</label><input id="ls-q" class="input" type="search" placeholder="N°, chantier, client, désignation…"></div>
      </div>
      <div id="ls"></div>`;

    const draw = () => {
      const all = state.documents.filter((d) => d.type === type);
      const rows = all.filter((d) => (filtre === 'tous' || d.statut === filtre) && (!q ||
        [d.numero, d.chantier.nom, d.chantier.lieu, d.client.nom, d.devisRef].concat(d.lignes.map((l) => l.designation))
          .join(' ').toLowerCase().includes(q)))
        .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
      $('#ls-count').textContent = `${all.length} ${isDevis ? 'devis' : `facture${all.length > 1 ? 's' : ''}`} au total`;
      $('#ls').innerHTML = rows.length ? `<div class="table-wrap"><table class="table table-cards">
        <thead><tr><th>N° / date</th><th>Chantier</th><th>Client</th><th class="num">HT</th><th class="num">TTC</th><th>Statut</th><th class="actions"><span class="sr">Actions</span></th></tr></thead>
        <tbody>${rows.map((d) => {
          const t = BF.totals(d);
          return `<tr>
            <td class="c-num"><a class="doc-num" href="#/doc/${d.id}">${e(d.numero)}</a>
              <span class="sub">${f.dateShort(d.date)}${d.nature === 'acompte' ? ' · acompte' : ''}${d.devisRef ? ` · devis ${e(d.devisRef)}` : ''}</span></td>
            <td class="c-ch" data-label="Chantier">${e(d.chantier.nom) || '<span class="muted">-</span>'}<span class="sub">${e(d.chantier.lieu)}</span></td>
            <td class="c-cl" data-label="Client">${e(d.client.nom) || '<span class="muted">-</span>'}</td>
            <td class="num c-ht" data-label="HT">${f.eur(t.ht)}</td>
            <td class="num c-ttc" data-label="TTC"><b>${f.eur(t.ttc)}</b></td>
            <td class="c-status">${badge(d)}</td>
            <td class="actions">
              ${isDevis ? `<button class="btn btn-sm btn-secondary" data-a="facturer" data-id="${d.id}">Facturer</button>` : ''}
              ${!isDevis && d.statut === 'a_payer' ? `<button class="btn btn-sm btn-secondary" data-a="payee" data-id="${d.id}">Marquer payée</button>` : ''}
              <button class="btn btn-sm btn-tertiary" data-a="pdf" data-id="${d.id}">PDF</button>
              <button class="btn btn-sm btn-tertiary" data-a="dup" data-id="${d.id}">Dupliquer</button>
              <button class="btn btn-sm btn-danger" data-a="del" data-id="${d.id}" aria-label="Supprimer ${isDevis ? 'le devis' : 'la facture'} ${e(d.numero)}">Supprimer</button>
            </td></tr>`;
        }).join('')}</tbody></table></div>`
        : `<div class="panel empty">${all.length ? 'Aucun résultat pour cette recherche.' : `${isDevis ? 'Aucun devis' : 'Aucune facture'} pour le moment.`}</div>`;
    };
    draw();

    $('.tabs').onclick = (ev) => {
      const b = ev.target.closest('button[data-f]'); if (!b) return;
      filtre = b.dataset.f;
      $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
      draw();
    };
    $('#ls-q').oninput = (ev) => { q = ev.target.value.trim().toLowerCase(); draw(); };
    $('#ls').onclick = (ev) => {
      const b = ev.target.closest('button[data-a]'); if (!b) return;
      const d = getDoc(b.dataset.id); if (!d) return;
      if (b.dataset.a === 'facturer') openFacturer(d);
      if (b.dataset.a === 'pdf') downloadPdf(d);
      if (b.dataset.a === 'payee') { d.statut = 'payee'; d.updatedAt = Date.now(); persist(); draw(); toast(`Facture ${e(d.numero)} marquée payée.`); }
      if (b.dataset.a === 'dup') { const c = BF.duplicate(state, d); persist(); location.hash = '#/doc/' + c.id; toast(`Copie créée : ${e(c.numero)}`); }
      if (b.dataset.a === 'del') openDelete(d, () => draw());
    };
  }

  /* =========================================================
     Éditeur de document
     ========================================================= */
  const UNITS = ['Ens', 'U', 'Forfait', 'm²', 'ml', 'm³', 'h', 'j', 'kg'];

  function viewEditor(id) {
    const doc = getDoc(id);
    if (!doc) {
      main.innerHTML = '<div class="panel empty">Document introuvable. <a href="#/">Retour à l\'accueil</a></div>';
      return;
    }
    lastEditorId = id;
    setNav(doc.type);
    const isDevis = doc.type === 'devis';
    const s = state.settings;
    const devisSrc = doc.devisId && getDoc(doc.devisId);
    const factures = isDevis ? state.documents.filter((d) => d.type === 'facture' && d.devisId === doc.id) : [];

    main.innerHTML = `
      <div class="crumbs"><a href="#/">Accueil</a> › <a href="${listHash(doc.type)}">${isDevis ? 'Devis' : 'Factures'}</a> › <span id="crumb-num">${e(doc.numero)}</span></div>
      <div class="editor-bar">
        <div>
          <h1><span id="ed-title">${docTitle(doc)}</span> <span id="ed-num">${e(doc.numero)}</span></h1>
          <div class="meta"><span id="ed-badge">${badge(doc)}</span><span class="saved" id="ed-saved" aria-live="polite">Enregistré</span>
            ${devisSrc ? `<span>· issue du <a href="#/doc/${devisSrc.id}">devis ${e(devisSrc.numero)}</a></span>` : ''}
            ${factures.length ? `<span>· facturé : ${factures.map((x) => `<a href="#/doc/${x.id}">${e(x.numero)}</a>`).join(', ')}</span>` : ''}
          </div>
        </div>
        <div class="btn-group">
          ${isDevis ? '<button class="btn btn-secondary" type="button" data-act="facturer">Transformer en facture</button>' : ''}
          <button class="btn btn-tertiary" type="button" data-act="dup">Dupliquer</button>
          <button class="btn btn-tertiary" type="button" data-act="print">Imprimer</button>
          <button class="btn" type="button" data-act="pdf">Télécharger le PDF</button>
        </div>
      </div>

      <div class="ed-switch" role="tablist" aria-label="Affichage">
        <button type="button" role="tab" data-view="form" aria-selected="true">Saisie</button>
        <button type="button" role="tab" data-view="preview" aria-selected="false">Aperçu A4 <span id="sw-ttc"></span></button>
      </div>
      <div class="editor" id="editor" data-view="form">
        <form class="editor-form" id="ed-form" autocomplete="off" onsubmit="return false">
          <section class="panel"><div class="panel-b">
            <h2 class="section-t">Document</h2>
            <div class="grid-2">
              <div class="field"><label for="ed-numero">Numéro</label>
                <input id="ed-numero" class="input" data-k="numero" value="${e(doc.numero)}">
                <button type="button" class="btn-link hint" data-act="renum" style="align-self:flex-start">Recalculer selon la date</button></div>
              <div class="field"><label for="ed-date">Date</label><input id="ed-date" type="date" class="input" data-k="date" value="${e(doc.date)}"></div>
            </div>
            <div class="grid-2">
              <div class="field"><label for="ed-statut">Statut</label>
                <select id="ed-statut" class="select" data-k="statut">${BF.STATUTS[doc.type].map(([v, l]) => `<option value="${v}" ${v === doc.statut ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
              ${isDevis ? '' : `<div class="field"><label for="ed-nature">Type</label>
                <select id="ed-nature" class="select" data-k="nature">
                  <option value="totale" ${doc.nature !== 'acompte' ? 'selected' : ''}>Facture</option>
                  <option value="acompte" ${doc.nature === 'acompte' ? 'selected' : ''}>Facture d'acompte</option></select></div>`}
            </div>
          </div></section>

          <section class="panel"><div class="panel-b">
            <h2 class="section-t">Chantier</h2>
            <div class="field"><label for="ed-cn">Nom du chantier</label><input id="ed-cn" class="input" data-k="chantier.nom" value="${e(doc.chantier.nom)}" placeholder="ex. METRO"></div>
            <div class="field"><label for="ed-cl">Lieu</label><input id="ed-cl" class="input" data-k="chantier.lieu" value="${e(doc.chantier.lieu)}" placeholder="ex. Les Pennes-Mirabeau"></div>
          </div></section>

          <section class="panel"><div class="panel-b">
            <h2 class="section-t">Client ${isDevis ? '<span class="hint" style="text-transform:none;letter-spacing:0">(facultatif sur le devis)</span>' : '- facturé à'}</h2>
            <div class="field"><label for="ed-pick">Carnet d'adresses</label><select id="ed-pick" class="select">${clientOptions(doc.client.nom)}</select></div>
            <div class="field"><label for="ed-c-nom">Raison sociale / nom</label><input id="ed-c-nom" class="input" data-k="client.nom" value="${e(doc.client.nom)}"></div>
            <div class="field"><label for="ed-c-adr">Adresse</label><input id="ed-c-adr" class="input" data-k="client.adresse" value="${e(doc.client.adresse)}"></div>
            <div class="grid-3">
              <div class="field"><label for="ed-c-cp">Code postal</label><input id="ed-c-cp" class="input" data-k="client.cp" value="${e(doc.client.cp)}"></div>
              <div class="field"><label for="ed-c-v">Ville</label><input id="ed-c-v" class="input" data-k="client.ville" value="${e(doc.client.ville)}"></div>
              <div class="field"><label for="ed-c-p">Pays</label><input id="ed-c-p" class="input" data-k="client.pays" value="${e(doc.client.pays)}"></div>
            </div>
            <button type="button" class="btn btn-sm btn-tertiary" data-act="saveclient">Enregistrer dans le carnet</button>
          </div></section>

          <section class="panel"><div class="panel-b">
            <h2 class="section-t">Désignation des ouvrages</h2>
            <datalist id="units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
            <div id="ed-lines"></div>
            <button type="button" class="btn btn-sm btn-secondary" data-act="addline">+ Ajouter une ligne</button>
            <div class="totals-mini" id="ed-totals"></div>
          </div></section>

          <section class="panel"><div class="panel-b">
            <h2 class="section-t">TVA et conditions</h2>
            <div class="field"><label for="ed-tva">Taux de TVA</label><select id="ed-tva" class="select">${tvaOptions(doc.tauxTVA, doc.autoliquidation)}</select></div>
            ${isDevis
              ? `<div class="field"><label for="ed-cond">Conditions (bas du devis)</label><textarea id="ed-cond" class="textarea" rows="3" data-k="conditions">${e(doc.conditions)}</textarea></div>`
              : `<div class="field"><label for="ed-ref">Référence devis</label><input id="ed-ref" class="input" data-k="devisRef" value="${e(doc.devisRef)}"></div>
                 <div class="field"><label for="ed-ech">Échéance / conditions de paiement</label><input id="ed-ech" class="input" data-k="echeance" value="${e(doc.echeance)}"></div>`}
          </div></section>

          <p style="margin-top:16px"><button type="button" class="btn btn-sm btn-danger" data-act="delete">Supprimer ${isDevis ? 'ce devis' : 'cette facture'}</button></p>
        </form>

        <div class="preview-col">
          <div class="preview-head"><h2 class="section-t" style="margin:0">Aperçu A4</h2><span class="muted" style="font-size:.85rem">mis à jour en direct</span></div>
          <div class="preview-stage" id="pv-stage"><div id="pv-box"><div class="preview-scale" id="pv"></div></div></div>
        </div>
      </div>`;

    const form = $('#ed-form');
    const editor = $('#editor');
    $('.ed-switch').onclick = (ev) => {
      const b = ev.target.closest('[data-view]'); if (!b) return;
      editor.dataset.view = b.dataset.view;
      $$('.ed-switch [data-view]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      requestAnimationFrame(() => fit());
    };
    const pv = $('#pv');
    const stage = $('#pv-stage');
    const box = $('#pv-box');

    /* --- aperçu --- */
    let raf = 0;
    const fit = () => {
      const sheet = pv.firstElementChild; if (!sheet) return;
      const avail = stage.clientWidth - parseFloat(getComputedStyle(stage).paddingLeft) * 2;
      const sc = Math.min(1, avail / sheet.offsetWidth);
      pv.style.transform = `scale(${sc})`;
      box.style.height = sheet.offsetHeight * sc + 'px';
    };
    const refresh = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        pv.innerHTML = BF.renderDoc(doc, s);
        fit();
        drawTotals();
      });
    };
    if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);

    /* --- lignes --- */
    const drawLines = () => {
      $('#ed-lines').innerHTML = doc.lignes.map((l, i) => `
        <div class="line-item">
          <div class="li-head"><span>Ligne ${i + 1}</span><div>
            <button type="button" class="icon-btn" data-la="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Monter la ligne ${i + 1}">↑</button>
            <button type="button" class="icon-btn" data-la="down" data-i="${i}" ${i === doc.lignes.length - 1 ? 'disabled' : ''} aria-label="Descendre la ligne ${i + 1}">↓</button>
            <button type="button" class="icon-btn del" data-la="del" data-i="${i}">Supprimer</button>
          </div></div>
          <div class="field"><label for="l${i}d">Désignation</label>
            <textarea id="l${i}d" class="textarea" rows="3" data-line="${i}" data-f="designation">${e(l.designation)}</textarea></div>
          <div class="grid-li">
            <div class="field"><label for="l${i}u">Unité</label><input id="l${i}u" class="input" list="units" data-line="${i}" data-f="unite" value="${e(l.unite)}"></div>
            <div class="field"><label for="l${i}q">Qté</label><input id="l${i}q" class="input is-num" inputmode="decimal" data-line="${i}" data-f="qte" value="${e(String(l.qte).replace('.', ','))}"></div>
            <div class="field"><label for="l${i}p">Prix unitaire HT (€)</label><input id="l${i}p" class="input is-num" inputmode="decimal" data-line="${i}" data-f="pu" value="${e(String(l.pu).replace('.', ','))}"></div>
          </div>
          <div class="line-total" id="lt${i}">Total ligne : ${f.eur(BF.parseNum(l.qte) * BF.parseNum(l.pu))} HT</div>
        </div>`).join('');
    };
    const drawTotals = () => {
      const t = BF.totals(doc);
      $('#sw-ttc').textContent = '· ' + f.eur(t.ttc);
      $('#ed-totals').innerHTML = `<div><span>Total HT</span><span>${f.eur(t.ht)}</span></div>
        <div><span>${doc.autoliquidation ? 'TVA (autoliquidation)' : 'TVA ' + f.taux(t.taux)}</span><span>${f.eur(t.tva)}</span></div>
        <div class="big"><span>Total TTC</span><span>${f.eur(t.ttc)}</span></div>`;
      doc.lignes.forEach((l, i) => { const el = $('#lt' + i); if (el) el.textContent = `Total ligne : ${f.eur(BF.parseNum(l.qte) * BF.parseNum(l.pu))} HT`; });
    };

    /* --- enregistrement --- */
    const savedEl = $('#ed-saved');
    const touched = () => {
      doc.updatedAt = Date.now();
      savedEl.textContent = 'Enregistrement…';
      savedEl.style.color = 'var(--muted)';
      persistSoon(() => { savedEl.textContent = 'Enregistré'; savedEl.style.color = ''; });
      refresh();
    };
    const syncNumero = () => {
      $('#ed-numero').value = doc.numero;
      $('#ed-num').textContent = doc.numero;
      $('#crumb-num').textContent = doc.numero;
    };

    const onEdit = (ev) => {
      const t = ev.target;
      if (t.dataset.k) {
        setPath(doc, t.dataset.k, t.value);
        if (t.dataset.k === 'numero') { doc.numeroAuto = false; $('#ed-num').textContent = doc.numero; $('#crumb-num').textContent = doc.numero; }
        if (t.dataset.k === 'date' && ev.type === 'change' && doc.numeroAuto !== false && t.value) {
          doc.numero = BF.nextNumero(state, doc.type, doc.date, doc.id); syncNumero();
        }
        if (t.dataset.k === 'statut') $('#ed-badge').innerHTML = badge(doc);
        if (t.dataset.k === 'nature') $('#ed-title').textContent = docTitle(doc);
      } else if (t.dataset.line != null) {
        doc.lignes[Number(t.dataset.line)][t.dataset.f] = t.value;
      } else if (t.id === 'ed-tva') {
        doc.autoliquidation = t.value === 'autoliq';
        if (!doc.autoliquidation) doc.tauxTVA = Number(t.value);
      } else if (t.id === 'ed-pick') {
        if (ev.type !== 'change') return;
        const c = state.clients.find((x) => x.id === t.value); if (!c) return;
        doc.client = { nom: c.nom, adresse: c.adresse, cp: c.cp, ville: c.ville, pays: c.pays || 'France' };
        ['nom', 'adresse', 'cp', 'ville', 'pays'].forEach((k) => { $(`[data-k="client.${k}"]`).value = doc.client[k] || ''; });
      } else return;
      touched();
    };
    form.addEventListener('input', onEdit);
    form.addEventListener('change', (ev) => { if (ev.target.dataset.k === 'date' || ev.target.id === 'ed-pick') onEdit(ev); });

    form.addEventListener('click', (ev) => {
      const la = ev.target.closest('[data-la]');
      if (la) {
        const i = Number(la.dataset.i);
        if (la.dataset.la === 'del') {
          if (doc.lignes.length === 1) doc.lignes[0] = { designation: '', unite: 'Ens', qte: 1, pu: 0 };
          else doc.lignes.splice(i, 1);
        }
        if (la.dataset.la === 'up' && i > 0) doc.lignes.splice(i - 1, 0, doc.lignes.splice(i, 1)[0]);
        if (la.dataset.la === 'down' && i < doc.lignes.length - 1) doc.lignes.splice(i + 1, 0, doc.lignes.splice(i, 1)[0]);
        drawLines(); touched();
      }
    });

    main.onclick = (ev) => {
      const b = ev.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'addline') {
        doc.lignes.push({ designation: '', unite: 'Ens', qte: 1, pu: 0 });
        drawLines(); touched();
        $(`#l${doc.lignes.length - 1}d`).focus();
      }
      if (a === 'renum') { doc.numeroAuto = true; doc.numero = BF.nextNumero(state, doc.type, doc.date, doc.id); syncNumero(); touched(); }
      if (a === 'saveclient') {
        if (!doc.client.nom.trim()) { toast('Indiquez au moins le nom du client.'); return; }
        const ex = state.clients.find((c) => c.nom.trim().toLowerCase() === doc.client.nom.trim().toLowerCase());
        if (ex) Object.assign(ex, doc.client); else state.clients.push(Object.assign({ id: BF.uid(), email: '', tel: '' }, doc.client));
        persist();
        $('#ed-pick').innerHTML = clientOptions(doc.client.nom);
        toast(ex ? 'Client mis à jour dans le carnet.' : 'Client ajouté au carnet.');
      }
      if (a === 'facturer') { persist(); openFacturer(doc); }
      if (a === 'dup') { persist(); const c = BF.duplicate(state, doc); persist(); location.hash = '#/doc/' + c.id; toast(`Copie créée : ${e(c.numero)}`); }
      if (a === 'print') { persist(); printDoc(doc); }
      if (a === 'pdf') { persist(); downloadPdf(doc); }
      if (a === 'delete') {
        persist();
        openDelete(doc, (res) => {
          if (res === 'deleted') { lastEditorId = null; location.hash = listHash(doc.type); }
          if (res === 'annulee') { $('#ed-statut').value = 'annulee'; $('#ed-badge').innerHTML = badge(doc); refresh(); }
        });
      }
    };

    drawLines();
    refresh();
  }

  /* =========================================================
     Clients
     ========================================================= */
  function viewClients() {
    setNav('clients');
    const count = (c) => state.documents.filter((d) => d.client && d.client.nom === c.nom).length;
    main.innerHTML = `
      <div class="page-head">
        <div><h1>Clients</h1><p>${state.clients.length} client${state.clients.length > 1 ? 's' : ''} dans le carnet d'adresses</p></div>
        <button class="btn" type="button" id="cl-add">+ Ajouter un client</button>
      </div>
      ${state.clients.length ? `<div class="table-wrap"><table class="table table-cards cards-clients">
        <thead><tr><th>Client</th><th>Adresse</th><th>Contact</th><th class="num">Documents</th><th class="actions"></th></tr></thead>
        <tbody>${state.clients.map((c) => `<tr>
          <td class="c-num"><b>${e(c.nom)}</b></td>
          <td class="c-ch" data-label="Adresse">${e(c.adresse)}<span class="sub">${e(c.cp)} ${e(c.ville)}${c.pays && c.pays !== 'France' ? ', ' + e(c.pays) : ''}</span></td>
          <td class="c-cl${c.tel || c.email ? '' : ' is-empty'}" data-label="Contact">${e(c.tel) || ''}<span class="sub">${e(c.email) || ''}</span></td>
          <td class="num c-status"><span class="badge badge-type">${count(c)} doc.</span></td>
          <td class="actions"><button class="btn btn-sm btn-tertiary" data-edit="${c.id}">Modifier</button>
            <button class="btn btn-sm btn-danger" data-del="${c.id}">Supprimer</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="panel empty">Aucun client enregistré.</div>'}`;

    $('#cl-add').onclick = () => clientDialog(null);
    main.onclick = (ev) => {
      const ed = ev.target.closest('[data-edit]');
      const del = ev.target.closest('[data-del]');
      if (ed) clientDialog(state.clients.find((c) => c.id === ed.dataset.edit));
      if (del) {
        const c = state.clients.find((x) => x.id === del.dataset.del);
        if (c && confirm(`Retirer « ${c.nom} » du carnet ? Les devis et factures existants ne sont pas modifiés.`)) {
          state.clients = state.clients.filter((x) => x !== c); persist(); viewClients();
        }
      }
    };
  }

  function clientDialog(client) {
    const c = client || { nom: '', adresse: '', cp: '', ville: '', pays: 'France', tel: '', email: '' };
    const dlg = $('#dlg');
    const fld = (k, l, type = 'text') => `<div class="field"><label for="cd-${k}">${l}</label><input id="cd-${k}" type="${type}" class="input" name="${k}" value="${e(c[k] || '')}"></div>`;
    dlg.innerHTML = `<form method="dialog">
      <div class="dlg-h"><h2>${client ? 'Modifier le client' : 'Nouveau client'}</h2><button class="icon-btn" value="cancel" aria-label="Fermer">✕</button></div>
      <div class="dlg-b">
        ${fld('nom', 'Raison sociale / nom')}
        ${fld('adresse', 'Adresse')}
        <div class="grid-3">${fld('cp', 'Code postal')}${fld('ville', 'Ville')}${fld('pays', 'Pays')}</div>
        <div class="grid-2">${fld('tel', 'Téléphone', 'tel')}${fld('email', 'Courriel', 'email')}</div>
      </div>
      <div class="dlg-f"><button class="btn btn-tertiary" value="cancel">Annuler</button><button class="btn" value="ok">Enregistrer</button></div>
    </form>`;
    dlg.returnValue = '';
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      const data = {};
      $$('input[name]', dlg).forEach((i) => { data[i.name] = i.value.trim(); });
      if (!data.nom) { toast('Le nom du client est obligatoire.'); return; }
      if (client) Object.assign(client, data); else state.clients.push(Object.assign({ id: BF.uid() }, data));
      persist(); viewClients();
      toast(client ? 'Client modifié.' : 'Client ajouté.');
    };
    dlg.showModal();
  }

  /* =========================================================
     Paramètres
     ========================================================= */
  function viewSettings() {
    setNav('parametres');
    const s = state.settings;
    const c = s.company;
    const fld = (k, l, hint = '') => `<div class="field"><label for="st-${k}">${l}${hint ? ` <span class="hint">${hint}</span>` : ''}</label>
      <input id="st-${k}" class="input" data-s="${k}" value="${e(getPath(s, k))}"></div>`;
    main.innerHTML = `
      <div class="page-head"><div><h1>Paramètres</h1><p>Informations reprises automatiquement sur chaque devis et facture.</p></div></div>
      <div class="home-grid">
        <div>
          <section class="panel"><div class="panel-b">
            <h2 class="section-t">Entreprise</h2>
            ${fld('company.nom', 'Raison sociale')}
            ${fld('company.adresse', 'Adresse')}
            <div class="grid-2">${fld('company.cp', 'Code postal')}${fld('company.ville', 'Ville', '(utilisée pour « Nîmes, le … »)')}</div>
            <div class="grid-2">${fld('company.tel', 'Téléphone')}${fld('company.email', 'Courriel')}</div>
            <div class="grid-2">${fld('company.siret', 'SIRET')}${fld('company.rcs', 'RCS')}</div>
            <div class="grid-2">${fld('company.tva', 'N° TVA intracommunautaire')}${fld('company.naf', 'Code NAF/APE')}</div>
            <div class="grid-2">${fld('company.iban', 'IBAN', '(affiché sur les factures si rempli)')}${fld('company.bic', 'BIC')}</div>
          </div></section>
        </div>
        <div>
          <section class="panel"><div class="panel-b">
            <h2 class="section-t">Numérotation et TVA</h2>
            <div class="field"><label for="st-num">Format des numéros</label>
              <input id="st-num" class="input" data-s="numFormat" value="${e(s.numFormat)}">
              <span class="hint">{NN} = compteur du jour, {JJ} jour, {MM} mois, {AAAA} année, {AA} année courte. Exemple aujourd'hui : <b id="st-num-ex"></b></span></div>
            <div class="grid-2">
              <div class="field"><label for="st-tva">TVA par défaut (%)</label><input id="st-tva" class="input is-num" data-s="tauxTVA" data-num="1" value="${e(s.tauxTVA)}"></div>
              <div class="field"><label for="st-ac">Acompte par défaut (%)</label><input id="st-ac" class="input is-num" data-s="acomptePct" data-num="1" value="${e(s.acomptePct)}"></div>
            </div>
          </div></section>
          <section class="panel" style="margin-top:16px"><div class="panel-b">
            <h2 class="section-t">Mentions par défaut</h2>
            <div class="field"><label for="st-dc">Conditions du devis</label><textarea id="st-dc" class="textarea" rows="3" data-s="devisConditions">${e(s.devisConditions)}</textarea></div>
            ${fld('factureEcheance', 'Échéance / conditions de paiement (factures)')}
            <div class="field"><label for="st-fm">Mentions légales en bas de facture</label><textarea id="st-fm" class="textarea" rows="4" data-s="factureMentions">${e(s.factureMentions)}</textarea></div>
            ${fld('autoliqMention', 'Mention d\'autoliquidation')}
          </div></section>
          <section class="panel" style="margin-top:16px"><div class="panel-b">
            <h2 class="section-t">Logo</h2>
            <img id="st-logo" src="${s.logo || BF.LOGO}" alt="Logo actuel" style="max-width:220px;display:block;margin-bottom:12px;border:1px solid var(--line);padding:8px">
            <div class="btn-group">
              <label class="btn btn-tertiary btn-sm" for="st-logo-f">Changer le logo</label>
              <input id="st-logo-f" type="file" accept="image/png,image/jpeg" hidden>
              ${s.logo ? '<button type="button" class="btn btn-sm btn-danger" id="st-logo-r">Revenir au logo d\'origine</button>' : ''}
            </div>
          </div></section>
          <section class="panel" style="margin-top:16px"><div class="panel-b">
            <h2 class="section-t">Sauvegarde</h2>
            <p class="muted" style="font-size:.92rem">Les données restent dans ce navigateur, sur cet ordinateur. Exportez régulièrement une sauvegarde (fichier .json) pour ne rien perdre ou pour passer sur un autre poste.</p>
            <div class="btn-group">
              <button type="button" class="btn btn-secondary btn-sm" id="st-exp">Exporter la sauvegarde</button>
              <label class="btn btn-tertiary btn-sm" for="st-imp">Importer une sauvegarde</label>
              <input id="st-imp" type="file" accept="application/json,.json" hidden>
            </div>
          </div></section>
        </div>
      </div>`;

    const ex = () => { $('#st-num-ex').textContent = BF.formatNumero(s.numFormat, BF.todayISO(), 1); };
    ex();
    main.oninput = (ev) => {
      const t = ev.target; if (!t.dataset.s) return;
      setPath(s, t.dataset.s, t.dataset.num ? BF.parseNum(t.value) : t.value);
      ex();
      persistSoon();
    };
    $('#st-logo-f').onchange = (ev) => {
      const file = ev.target.files[0]; if (!file) return;
      if (file.size > 1.5e6) { toast('Image trop lourde (1,5 Mo maximum).'); return; }
      const r = new FileReader();
      r.onload = () => { s.logo = r.result; persist(); viewSettings(); toast('Logo mis à jour.'); };
      r.readAsDataURL(file);
    };
    const reset = $('#st-logo-r');
    if (reset) reset.onclick = () => { s.logo = null; persist(); viewSettings(); };

    $('#st-exp').onclick = () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `buildfrance-sauvegarde-${BF.todayISO()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('#st-imp').onchange = (ev) => {
      const file = ev.target.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(r.result);
          if (!Array.isArray(data.documents) || !data.settings) throw new Error('format');
          if (!confirm(`Remplacer les données actuelles par cette sauvegarde (${data.documents.length} documents) ?`)) return;
          localStorage.setItem(BF.KEY, JSON.stringify(data));
          state = BF.load();
          toast('Sauvegarde importée.');
          location.hash = '#/';
          route();
        } catch (err) { toast("Fichier invalide : ce n'est pas une sauvegarde Build France."); }
      };
      r.readAsText(file);
    };
  }

  /* =========================================================
     Routage
     ========================================================= */
  function route() {
    // Un document créé puis laissé vide est supprimé en quittant l'éditeur
    const h = location.hash || '#/';
    if (lastEditorId && h !== '#/doc/' + lastEditorId) {
      const d = getDoc(lastEditorId);
      if (isEmptyDoc(d)) { removeDoc(d.id); persist(); }
      lastEditorId = null;
    }
    main.onclick = null; main.oninput = null;
    window.scrollTo(0, 0);

    let m;
    if ((m = h.match(/^#\/doc\/([\w-]+)/))) return viewEditor(m[1]);
    if ((m = h.match(/^#\/nouveau\/(devis|facture)/))) {
      const d = BF.newDoc(state, m[1]); persist();
      location.replace('#/doc/' + d.id);
      return;
    }
    if (h.startsWith('#/devis')) return viewList('devis');
    if (h.startsWith('#/factures')) return viewList('facture');
    if (h.startsWith('#/clients')) return viewClients();
    if (h.startsWith('#/parametres')) return viewSettings();
    return viewHome();
  }

  /* menu mobile */
  const hd = $('.hd');
  const menuBtn = $('#menu-btn');
  const setMenu = (open) => {
    hd.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    $('.menu-lbl', menuBtn).textContent = open ? 'Fermer' : 'Menu';
  };
  menuBtn.addEventListener('click', () => setMenu(!hd.classList.contains('open')));
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && hd.classList.contains('open')) { setMenu(false); menuBtn.focus(); } });
  window.addEventListener('hashchange', () => setMenu(false));

  window.addEventListener('hashchange', route);
  window.addEventListener('storage', (ev) => { if (ev.key === BF.KEY) { state = BF.load(); route(); } });
  route();
})(window.BF);
