# Extension Sellvela (Chrome, Manifest V3)

- `manifest.json` : permissions minimales (stockage, alarmes, notifications, menu clic droit) ; accès au site Sellvela uniquement ; scripts sur les pages CJdropshipping et la page « Connecter l'extension » de Sellvela.
- `src/background.js` : vérification du compte toutes les 5 minutes (badge, ventes, commandes bloquées, solde CJ bas), menu « Vérifier le risque de marque », relais des pages CJ.
- `src/content-cj.js` : panneau sur les pages produit CJ (profit eBay, stock US, marque, idées, créer l'annonce).
- `src/content-connect.js` : remise du jeton depuis https://sellvela.vercel.app/extension/connect.
- `popup.html` + `src/popup.js` : Aperçu, Idées, Outils (calculateur de frais, vérificateur de marque).
- `src/lib.js` : fonctions pures, testées par `npx vitest run extension` (depuis la racine du projet).

Tester en local : chrome://extensions → Mode développeur → « Charger l'extension non empaquetée » → ce dossier.
Paquet pour le Chrome Web Store : `python3 package.py` (crée `dist/sellvela-extension-<version>.zip`, sans les tests).
