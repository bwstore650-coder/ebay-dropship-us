# eBay Dropship US — V1

Outil par abonnement qui trouve, met en vente et commande automatiquement des produits **rentables (≥ 30 % de marge)
et conformes** sur eBay US, avec AliExpress et CJ comme fournisseurs. Cahier des charges : voir le document « Cahier des charges V1 ».

## Ce qui est fait (semaines 1–2 : la base)

- **Calcul de marge** (`src/lib/margin.ts`) : frais eBay 13,6 % + 0,40 $, taxe fournisseur, choix du meilleur fournisseur,
  prix minimum pour la marge visée — testé avec les chiffres réels du 27/09/2026.
- **Règles de conformité** (`src/lib/compliance.ts`) : détaillants interdits, marques VeRO, livraison ≤ 8 jours, limites par âge du compte.
- **Client eBay** (`src/lib/ebay.ts`) : OAuth vendeur, recherche Browse, mise en vente (Inventory), commandes et suivi (Fulfillment).
- **Client CJ** (`src/lib/suppliers/cj.ts`) : jeton, recherche entrepôt US, produit, frais de port, commande, suivi.
- **Client AliExpress** (`src/lib/suppliers/aliexpress.ts`) : OAuth + signature HMAC-SHA256 ; méthodes « DS » à confirmer une fois l'accès validé.
- **Comptes** (email + mot de passe), **abonnements Stripe** (essai 7 jours, portail client, webhook).
- **Écrans** : accueil, inscription, connexion, tableau de bord, chercheur de produits, réglages (eBay, CJ), abonnement.
- **Base de données** : `prisma/schema.prisma` (utilisateurs, comptes eBay/fournisseurs chiffrés, annonces, commandes).

## Démarrer en local

```bash
npm install
cp .env.example .env        # puis remplis les valeurs
npx prisma db push          # crée les tables
npm test                    # tests du calcul de marge et de la conformité
npm run dev                 # http://localhost:3000
```

## Comptes à créer (dans cet ordre)

1. **Base Postgres** gratuite : Neon ou Supabase → `DATABASE_URL`.
2. **eBay Developer Program** (developer.ebay.com) : clés sandbox, puis un RuName dont l'« Auth accepted URL » = `APP_URL/api/ebay/callback`.
3. **CJDropshipping** : ta clé API se trouve dans CJ > Apps > API (à coller dans Réglages).
4. **AliExpress Open Platform** (openservice.aliexpress.com) : créer une app et demander l'accès Dropshipping.
5. **Stripe** (mode test) : 3 produits à 29 $, 59 $, 99 $/mois → `STRIPE_PRICE_*`, puis un webhook vers `APP_URL/api/stripe/webhook`
   (événements `customer.subscription.*`).

## À faire ensuite (semaines 3–8)

- Choisir la **source des prix vendus** eBay (le chercheur utilise pour l'instant les annonces actives).
- Recherche multi-produits, fiche produit, bouton « Mettre en vente » (titres et descriptions IA).
- Tâches planifiées : suivi stock/prix, retrait automatique, commande automatique, renvoi du suivi.
- Tableau de bord complet, quotas par formule, bêta fermée.
