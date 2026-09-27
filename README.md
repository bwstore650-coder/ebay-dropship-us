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

## Croissance (ajouté le 27/09/2026)

- **Calculateur de profit gratuit** (`/ebay-profit-calculator`, en anglais pour Google US) + récolte d'emails (table `Lead`).
- **Affiliation 30 % à vie** : lien `?ref=CODE` (cookie 60 jours), commission créée à chaque facture Stripe payée,
  disponible après 30 jours, versement manuel dès 50 $ (page `/affiliate`). Remboursement : passer la commission en `VOID` à la main.
- **Formule Agence** (249 $/mois, 10 comptes eBay) et **paiement annuel −25 %** ; Business passe à 3 comptes eBay.
- **eBay Canada, Royaume-Uni, Australie** : frais par pays (`src/lib/marketplaces.ts`), conversion des coûts USD
  (taux BCE + 2 % de sécurité), détaillants interdits par pays. Frais UK et AU marqués « à confirmer ».

## Europe et langues (ajouté le 27/09/2026)

- **eBay Allemagne, France, Italie, Espagne, Irlande** : frais vendeurs pro vérifiés sur les pages officielles d'eBay
  (hors TVA, frais réglementaires 0,35 % inclus pour FR/IT/ES/IE), coûts convertis en EUR, détaillants interdits par pays
  (Amazon, Cdiscount, Otto, MediaMarkt…). CJ n'a pas d'entrepôt dans tous ces pays : « aucun fournisseur local » est normal.
- **5 langues** : anglais (par défaut), français, allemand, italien, espagnol. Langue choisie par le sélecteur (cookie `lang`)
  ou celle du navigateur. Textes dans `src/lib/i18n/dictionaries/` ; un test vérifie que chaque langue a toutes les clés
  et les mêmes variables `{…}`. Les API renvoient des codes d'erreur traduits côté écran.

## Source des prix eBay

100 % API officielle : prix des annonces actives neuves aux US, pondérés par les ventes estimées de chaque annonce
(`estimatedSoldQuantity` de l'API Browse). Pas de scraping : depuis fin août 2026, les ventes réussies d'eBay exigent une
connexion, et les récupérer autrement irait contre les conditions d'eBay. Limite par défaut de l'API Browse : environ 5 000 appels
par jour (1 recherche = 1 + 20 appels) — à faire relever par eBay avant le lancement.

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
5. **Stripe** (mode test) : 4 produits (Starter 29 $, Pro 59 $, Business 99 $, Agence 249 $), chacun avec un prix mensuel
   et un prix annuel (261 $, 531 $, 891 $, 2 241 $) → les 8 variables `STRIPE_PRICE_*`. Webhook vers `APP_URL/api/stripe/webhook`
   avec les événements `customer.subscription.created/updated/deleted` et `invoice.paid`.

## À faire ensuite (semaines 3–8)

- Déposer la demande « Application Growth Check » chez eBay pour l'API Marketplace Insights (ventes réelles 90 jours).
- Recherche multi-produits, fiche produit, bouton « Mettre en vente » (titres et descriptions IA).
- Tâches planifiées : suivi stock/prix, retrait automatique, commande automatique, renvoi du suivi.
- Tableau de bord complet, quotas par formule, bêta fermée.

## Espace administrateur (/admin)

Mettre ton email dans `ADMIN_EMAILS` (plusieurs emails séparés par des virgules), puis te connecter avec ce compte : un bouton « Admin » apparaît dans l'app.
- **Vue d'ensemble** : MRR, ARR, progression vers 100 k$/mois, clients payants, essais, inscriptions des 30 derniers jours, leads.
- **Clients** : recherche par email, formule, statut, parrain.
- **Affiliés** : commissions à payer, « Marquer payé » après le virement, annulation en cas de remboursement.
- **Exporter les emails (CSV)** : leads du calculateur.
Pour tout autre compte, /admin répond « page introuvable ».

## Marque

Nom provisoire « ProfitLister » : changer `NEXT_PUBLIC_BRAND_NAME` et `NEXT_PUBLIC_SUPPORT_EMAIL` dans `.env`. Ne pas mettre « eBay » dans le nom (marque déposée).

## Commandes automatiques

Toutes les 15 minutes (tâche planifiée `vercel.json` → `/api/cron/orders`, protégée par `CRON_SECRET`) :
1. les nouvelles ventes eBay des annonces créées avec l'outil sont importées ;
2. chaque vente payée est commandée chez CJ (numéro unique `EB-<commande eBay>`, payée avec le solde CJ du vendeur) ;
3. le numéro de suivi CJ est renvoyé à eBay.
Jamais de commande à perte, en rupture ou annulée sans l'accord du vendeur (statut « À vérifier » dans /orders).
L'adresse de l'acheteur est relue chez eBay au moment de commander : elle n'est pas enregistrée dans la base.
Sur Vercel, une tâche toutes les 15 minutes demande la formule Pro ; sinon, appeler l'URL depuis un service externe (ex. cron-job.org) avec l'en-tête `Authorization: Bearer <CRON_SECRET>`.

## Surveillance du stock et des prix

Toutes les heures (`/api/cron/monitor`, protégée par `CRON_SECRET`), chaque annonce est relue chez CJ :
- rupture, produit retiré, livraison lente ou marge sous le minimum → annonce en pause (quantité 0 sur eBay) ;
- de nouveau en stock et rentable → remise en ligne automatiquement ;
- stock faible → quantité affichée réduite (jamais plus que le stock réel, 3 au maximum).
L'option eBay « rupture de stock » (annonce masquée à quantité 0 au lieu d'être terminée) est activée automatiquement lors des réglages eBay du pays.

## AliExpress

1. Sur https://openservice.aliexpress.com, créer une app avec l'accès **Dropshipping** (validation par AliExpress).
2. Déclarer l'URL de retour : `<APP_URL>/api/suppliers/aliexpress/callback`, puis mettre `ALIEXPRESS_APP_KEY` et `ALIEXPRESS_APP_SECRET` dans `.env`.
3. Chaque client connecte son compte AliExpress dans Réglages (jeton renouvelé automatiquement).

Fonctionnement : dans le chercheur, le client colle le lien d'un produit AliExpress ; seules les variantes expédiées depuis un entrepôt du pays (propriété « Ships From ») sont comparées, pour garder une livraison rapide. Publication, commandes automatiques, suivi et surveillance fonctionnent comme pour CJ.
Paiement : la commande est payée automatiquement si le paiement automatique est activé sur le compte AliExpress ; sinon elle apparaît « à payer » dans la page Commandes.
Méthodes API : aliexpress.ds.product.get, aliexpress.logistics.buyer.freight.calculate, aliexpress.ds.order.create, aliexpress.trade.ds.order.get (signature vérifiée contre le SDK de référence ae_sdk).
