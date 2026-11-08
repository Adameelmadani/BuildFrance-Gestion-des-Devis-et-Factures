/* Build France - gabarits A4 des devis et factures (fidèles aux modèles de l'entreprise) */
window.BF = window.BF || {};
(function (BF) {
  'use strict';
  const e = BF.esc;
  const f = BF.fmt;

  const logoSrc = (s) => s.logo || BF.LOGO || 'assets/logo-build-france.png';

  const legalLine = (c) =>
    `${e(c.nom)} - SIRET : ${e(c.siret)} - ${e(c.rcs)} - TVA intracommunautaire : ${e(c.tva)} - Code NAF/APE : ${e(c.naf)}`;

  const linesBlock = (doc, cls) => {
    const rows = (doc.lignes || []).map((l) => {
      const total = BF.round2(BF.parseNum(l.qte) * BF.parseNum(l.pu));
      return `<div class="l-row">
        <div class="c-des">${BF.nl2br(l.designation)}</div>
        <div class="c-u">${e(l.unite)}</div>
        <div class="c-qt">${e(f.num(BF.parseNum(l.qte)))}</div>
        <div class="c-pu">${f.eur(BF.parseNum(l.pu))}</div>
        <div class="c-tot">${f.eur(total)}</div>
      </div>`;
    }).join('');
    return `<div class="lines ${cls}">
      <div class="l-head">
        <div class="c-des">DESIGNATION DES OUVRAGES</div>
        <div class="c-u">U</div>
        <div class="c-qt">QT</div>
        <div class="c-pv">PRIX DE VENTE H.T</div>
        <div class="c-pu sub">P.U</div>
        <div class="c-tot sub">${cls === 'lines-facture' ? 'TOTAL HT' : 'TOTAL'}</div>
      </div>
      <div class="l-body">
        <span class="v v1"></span><span class="v v2"></span><span class="v v3"></span><span class="v v4"></span>
        ${rows}
      </div>
    </div>`;
  };

  const clientLines = (c) => [c.nom, c.adresse, [c.cp, c.ville].filter(Boolean).join(' '), c.pays]
    .filter((x) => x && String(x).trim());

  /* ---------------- DEVIS ---------------- */
  function devis(doc, s) {
    const c = s.company;
    const t = BF.totals(doc);
    const cl = clientLines(doc.client || {});
    const tvaLabel = doc.autoliquidation ? 'TVA (autoliquidation)' : `TVA ${f.taux(t.taux)}`;
    return `<article class="sheet sheet-devis">
      <header class="d-head">
        <img class="d-logo" src="${logoSrc(s)}" alt="Build France SAS">
        <div class="d-company">
          ${e(c.adresse)}<br>${e(c.cp)} ${e(c.ville)}<br>Tél : ${e(c.tel)}<br>Courriel : ${e(c.email)}
        </div>
      </header>

      <section class="d-meta">
        <div class="d-chantier">
          <div><b>Chantier : ${e(doc.chantier.nom)}</b></div>
          <div class="up">${e(doc.chantier.lieu)}</div>
          ${cl.length ? `<div class="d-client"><b>Client :</b> ${cl.map(e).join('<br>')}</div>` : ''}
        </div>
        <div class="d-num">
          <div>Devis N° : ${e(doc.numero)}</div>
          <div class="d-date">${e(c.ville)}, le ${f.dateLong(doc.date)}</div>
        </div>
      </section>

      ${linesBlock(doc, 'lines-devis')}

      <section class="d-bottom">
        <div class="d-cond">${BF.nl2br(doc.conditions)}${doc.autoliquidation ? `<br>${e(s.autoliqMention)}` : ''}</div>
        <table class="d-tot">
          <tr><td>Total HT</td><td>${f.eur(t.ht)}</td></tr>
          <tr><td>${tvaLabel}</td><td>${f.eur(t.tva)}</td></tr>
          <tr class="strong"><td>Total TTC</td><td>${f.eur(t.ttc)}</td></tr>
        </table>
      </section>

      <section class="d-sign">
        <p>Signature du client précédée de la mention « Bon pour accord »</p>
        <div class="d-sign-row"><span>Date :</span><span>Signature :</span></div>
      </section>

      <footer class="sheet-foot">${e(c.nom)} - Siret: ${e(c.siret)} - ${e(c.rcs.toUpperCase())} - TVA ${e(c.tva)} - code NAF/APE ${e(c.naf)}</footer>
    </article>`;
  }

  /* ---------------- FACTURE ---------------- */
  function facture(doc, s) {
    const c = s.company;
    const t = BF.totals(doc);
    const cl = clientLines(doc.client || {});
    const titre = doc.nature === 'acompte' ? "Facture d'acompte" : 'Facture';
    const chantierRef = [doc.chantier.nom, doc.chantier.lieu].filter(Boolean).join(' - ');
    const bank = c.iban ? `<div class="f-bank"><b>Règlement par virement</b> - IBAN : ${e(c.iban)}${c.bic ? ` - BIC : ${e(c.bic)}` : ''}</div>` : '';
    return `<article class="sheet sheet-facture">
      <header class="f-head">
        <img class="f-logo" src="${logoSrc(s)}" alt="Build France SAS">
        <div class="f-title">${titre}<br>${e(doc.numero)}</div>
      </header>

      <section class="f-row">
        <div class="f-company">${e(c.adresse)}<br>${e(c.cp)} ${e(c.ville)}<br>${e(c.tel)}<br>${e(c.email)}</div>
        <div class="f-date">${e(c.ville)}, le ${f.dateShort(doc.date)}</div>
      </section>

      <table class="f-box">
        <thead><tr><th>FACTURÉ À</th><th>INFORMATIONS DE FACTURATION</th></tr></thead>
        <tbody><tr>
          <td>${cl.length ? cl.map(e).join('<br>') : '<span class="todo">Client à compléter</span>'}</td>
          <td>
            Date d'émission : ${f.dateLong(doc.date)}<br>
            ${chantierRef ? `Référence chantier : ${e(chantierRef)}<br>` : ''}
            ${doc.devisRef ? `Référence devis : ${e(doc.devisRef)}<br>` : ''}
            Échéance / conditions de paiement : ${e(doc.echeance || 'à préciser')}
          </td>
        </tr></tbody>
      </table>

      <h2 class="f-h">Détail de la prestation</h2>
      ${linesBlock(doc, 'lines-facture')}

      <table class="f-tot">
        <tr><td>Total H.T</td><td>${f.eur(t.ht)}</td></tr>
        <tr><td>${doc.autoliquidation ? 'TVA' : `TVA ${f.taux(t.taux)}`}</td><td>${f.eur(t.tva)}</td></tr>
        <tr><td>Total TTC</td><td>${f.eur(t.ttc)}</td></tr>
      </table>
      ${doc.autoliquidation ? `<p class="f-autoliq">${e(s.autoliqMention)}</p>` : ''}
      ${bank}

      <section class="f-emetteur">
        <b>Coordonnées de l'émetteur</b><br>
        ${legalLine(c)}
      </section>
      ${s.factureMentions ? `<p class="f-mentions">${BF.nl2br(s.factureMentions)}</p>` : ''}

      <footer class="sheet-foot sheet-foot-light">${e(c.nom)} - SIRET : ${e(c.siret)} - ${e(c.rcs)} - TVA intracommunautaire : ${e(c.tva)}</footer>
    </article>`;
  }

  BF.renderDoc = (doc, settings) => (doc.type === 'devis' ? devis : facture)(doc, settings);

  BF.docFileName = (doc) => {
    const base = `${doc.type === 'devis' ? 'Devis' : doc.nature === 'acompte' ? "Facture d'acompte" : 'Facture'} ${doc.numero}`;
    const ch = (doc.chantier && doc.chantier.nom) ? ` - ${doc.chantier.nom}` : '';
    return (base + ch).replace(/[\\/:*?"<>|]/g, '-');
  };
})(window.BF);
