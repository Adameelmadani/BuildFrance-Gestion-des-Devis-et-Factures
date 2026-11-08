# Build France - Gestion des devis et factures

Application web locale (HTML/CSS/JS, sans installation) pour créer les devis et factures de Build France SAS au format de l'entreprise.

## Lancer
Double-cliquer sur `index.html` (Chrome ou Edge conseillé).
Une connexion internet est utile pour la police d'écriture et le bouton « Télécharger le PDF » ; sans connexion, utiliser « Imprimer » → « Enregistrer au format PDF ».

## Fonctions
- **Éditeur** avec aperçu A4 en direct, plusieurs lignes, unités, TVA 20 / 10 / 5,5 / 0 % ou autoliquidation (sous-traitance BTP).
- **Devis → facture** en un clic : facture totale ou facture d'acompte (35 % par défaut), référence du devis reprise automatiquement.
- **Numérotation automatique** : format `{NN}{JJ}{MM}{AAAA}` (ex. 0129102026 = 1er document du 29/10/2026), modifiable dans Paramètres.
- Carnet de **clients**, statuts (brouillon, envoyé, accepté, payée…), recherche, duplication.
- **Paramètres** : coordonnées, SIRET, TVA, IBAN, mentions, logo.

## Données
Tout est enregistré dans le navigateur de l'ordinateur utilisé. Exporter régulièrement une sauvegarde : Paramètres → « Exporter la sauvegarde » (fichier .json, réimportable sur un autre poste).
