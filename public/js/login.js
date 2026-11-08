/* Build France - page de connexion */
(function (BF) {
  'use strict';
  const form = document.getElementById('login-form');
  const err = document.getElementById('err');
  const btn = document.getElementById('submit');

  // Ne redirige que vers une adresse de ce site (« /#/devis »…)
  const next = new URLSearchParams(location.search).get('next') || '/';
  const target = /^\/(?![/\\])/.test(next) ? next : '/';

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) {
      err.textContent = 'Saisissez votre identifiant et votre mot de passe.';
      err.hidden = false;
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Connexion…';
    try {
      await BF.api.login(username, password);
      location.replace(target);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      form.password.value = '';
      form.password.focus();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Se connecter';
    }
  });
})(window.BF);
