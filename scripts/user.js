#!/usr/bin/env node
/* Build France - gestion des comptes en ligne de commande
   npm run user -- add <nom>       créer un compte (mot de passe demandé)
   npm run user -- passwd <nom>    changer le mot de passe (déconnecte ses sessions)
   npm run user -- remove <nom>    supprimer un compte
   npm run user -- list            lister les comptes
   Le mot de passe peut aussi être fourni par la variable BF_PASSWORD (scripts). */
'use strict';
const readline = require('readline');
const { users } = require('../server/auth');

function askHidden(question) {
  if (process.env.BF_PASSWORD) return Promise.resolve(process.env.BF_PASSWORD);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function askNewPassword() {
  const a = await askHidden('Mot de passe : ');
  if (process.env.BF_PASSWORD) return a;
  const b = await askHidden('Confirmer le mot de passe : ');
  if (a !== b) throw new Error('Les deux mots de passe ne correspondent pas.');
  return a;
}

const need = (u, name) => { if (!u) throw new Error(`Utilisateur « ${name} » introuvable.`); return u; };

async function main() {
  const [cmd, name] = process.argv.slice(2);
  switch (cmd) {
    case 'add': {
      if (!name) throw new Error('Usage : npm run user -- add <nom>');
      users.create(name, await askNewPassword());
      console.log(`Compte « ${name} » créé.`);
      break;
    }
    case 'passwd': {
      const u = need(users.find(name), name);
      users.setPassword(u.id, await askNewPassword());
      console.log(`Mot de passe de « ${u.username} » modifié. Ses sessions ouvertes ont été fermées.`);
      break;
    }
    case 'remove': {
      const u = need(users.find(name), name);
      users.remove(u.id);
      console.log(`Compte « ${u.username} » supprimé.`);
      break;
    }
    case 'list': {
      const all = users.list();
      if (!all.length) console.log('Aucun compte.');
      all.forEach((u) => console.log(`- ${u.username}  (créé le ${new Date(u.created_at).toLocaleString('fr-FR')})`));
      break;
    }
    default:
      console.log('Usage : npm run user -- <add|passwd|remove|list> [nom]');
      process.exitCode = 1;
  }
}

main().catch((e) => { console.error('Erreur : ' + e.message); process.exit(1); });
