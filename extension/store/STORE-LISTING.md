# Sellvela – Chrome Web Store listing (copy and paste)

Package to upload: `sellvela-extension-1.0.0.zip`
Images in this folder: 5 screenshots (1280×800), small tile (440×280), marquee (1400×560). The 128×128 icon is already inside the zip.

---

## 1. "Store listing" tab

**Main language:** English (United States). French can be added afterwards under "Add a language".

**Name** (taken from the zip): Sellvela – eBay profit for CJ products

**Short description** (taken from the zip, 132 characters max):
Real eBay profit, US stock and brand risk on CJdropshipping products. Save ideas, get sale and low CJ balance alerts.

**Category:** Productivity → Tools. If the list differs, pick the closest "tools / workflow" category. Avoid "Shopping", which is for buyers.

**Detailed description (EN):**

```
Sellvela shows your real eBay profit right on CJdropshipping product pages, so you only list products that make money.

HOW IT WORKS
Open any product on CJdropshipping and click "Analyze eBay profit". In a few seconds you see:
• Profit per sale and margin after every eBay fee
• Whether the product is profitable at YOUR minimum margin
• The minimum selling price for your margin
• US warehouse stock and delivery time
• A warning when the title contains a protected (VeRO) brand

Then click "Create the listing" to finish it in Sellvela, or "Save to ideas" to keep it for later.

FEATURES
• Profit panel on CJdropshipping product pages
• Ideas list: save products while you browse, then send the whole list to the Sellvela Sniper in one click
• Account overview: CJ balance, orders to check, paused listings, open returns
• Low CJ balance alert, so automatic orders don't fail
• Notifications for new sales and blocked orders
• eBay fee calculator for 9 eBay sites (US, CA, UK, AU, DE, FR, IT, ES, IE)
• Brand checker: paste a title, or right-click any selected text
• Referral link and earnings at a glance
• Available in English, French, Spanish, German and Italian

PRIVACY
The extension only sends Sellvela the CJdropshipping product you choose to analyze or save. It never reads eBay pages, other websites or your browsing history. You can disconnect any browser from your Sellvela settings.

REQUIREMENTS
A Sellvela account (sellvela.vercel.app). Live analyses use your own CJdropshipping account, connected in Sellvela.

Sellvela is an independent tool. It is not affiliated with, endorsed or sponsored by eBay Inc. or CJdropshipping.
```

**Detailed description (FR)**, for the French version of the listing:

```
Sellvela affiche ton vrai profit eBay directement sur les pages produit CJdropshipping, pour ne mettre en vente que des produits qui rapportent.

COMMENT ÇA MARCHE
Ouvre un produit sur CJdropshipping et clique sur « Analyser le profit eBay ». En quelques secondes, tu vois :
• Le profit par vente et la marge après tous les frais eBay
• Si le produit est rentable avec TA marge minimum
• Le prix de vente minimum pour ta marge
• Le stock en entrepôt aux États-Unis et le délai de livraison
• Une alerte si le titre contient une marque protégée (VeRO)

Clique ensuite sur « Créer l'annonce » pour la finir dans Sellvela, ou sur « Garder dans mes idées » pour plus tard.

FONCTIONS
• Panneau de profit sur les pages produit CJdropshipping
• Liste d'idées : garde des produits en naviguant, puis envoie toute la liste au Sniper Sellvela en un clic
• Aperçu du compte : solde CJ, commandes à vérifier, annonces en pause, retours ouverts
• Alerte de solde CJ bas, pour que les commandes automatiques n'échouent pas
• Notifications de nouvelles ventes et de commandes bloquées
• Calculateur de frais eBay pour 9 sites eBay (US, CA, UK, AU, DE, FR, IT, ES, IE)
• Vérificateur de marque : colle un titre, ou fais un clic droit sur un texte sélectionné
• Lien de parrainage et gains en un coup d'œil
• Disponible en français, anglais, espagnol, allemand et italien

CONFIDENTIALITÉ
L'extension envoie à Sellvela seulement le produit CJdropshipping que tu choisis d'analyser ou de garder. Elle ne lit jamais les pages eBay, les autres sites ni ton historique. Tu peux déconnecter un navigateur depuis tes réglages Sellvela.

PRÉREQUIS
Un compte Sellvela (sellvela.vercel.app). Les analyses en direct utilisent ton propre compte CJdropshipping, connecté dans Sellvela.

Sellvela est un outil indépendant, sans lien avec eBay Inc. ou CJdropshipping, qui ne le soutiennent ni ne le sponsorisent.
```

**Images:**
- Screenshots, in this order: `screenshot-1-profit-panel.png`, `screenshot-2-overview.png`, `screenshot-3-ideas.png`, `screenshot-4-tools.png`, `screenshot-5-privacy.png`
- Small promo tile: `promo-small-440x280.png`
- Marquee (optional): `promo-marquee-1400x560.png`

**Links:**
- Homepage: https://sellvela.vercel.app
- Support: https://sellvela.vercel.app/terms, or better, the real support email once it is set (see the to-do list at the end)
- Mature content: No

---

## 2. "Privacy practices" tab

**Single purpose:**
```
Help eBay sellers decide which CJdropshipping products to list: show the estimated eBay profit, US stock and brand risk of the CJdropshipping product the user is viewing, and alert them about their Sellvela account (sales, orders to check, low CJ balance).
```

**Permission justifications:**

- **storage**
  ```
  Stores the user's Sellvela connection key, display language and the last account summary, so the popup opens instantly and the user stays signed in.
  ```
- **alarms**
  ```
  Checks the user's Sellvela account every 5 minutes to update the badge and show alerts for new sales, blocked orders and a low CJ balance.
  ```
- **notifications**
  ```
  Shows alerts the user relies on: a new eBay sale, an order that needs attention, and a low CJ balance that would make automatic orders fail. Also shows the result of the right-click brand check.
  ```
- **contextMenus**
  ```
  Adds one right-click item, "Check brand risk with Sellvela", which checks the selected text for protected (VeRO) brands.
  ```
- **Host permission https://sellvela.vercel.app/\***
  ```
  The extension's own back-end: account summary, product analysis, ideas list, fee calculator and brand check. No other host is contacted.
  ```
- **Content scripts on cjdropshipping.com**
  ```
  Shows the profit panel on CJdropshipping product pages. It only reads the product ID from the page address, and the page title and image when the user clicks "Save to ideas". The script on sellvela.vercel.app/extension/connect only receives the connection key when the user clicks "Connect this browser".
  ```
- **web_accessible_resources (src/lib.js, CJdropshipping only)**
  ```
  A local helper file loaded by the CJdropshipping page script. It contains no remote code.
  ```

**Remote code:** "No, I am not using remote code." All the code is in the package. The server only sends data (JSON).

**Data usage.** Check only these two:
- ☑ **Authentication information**: the Sellvela connection key, stored in the browser.
- ☑ **Website content**: the ID, title and image of the CJdropshipping product the user chooses to analyze or save.
- ☐ Leave everything else unchecked: personally identifiable info, health, financial and payment info, personal communications, location, web history, user activity.

**Certifications.** Check all three:
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://sellvela.vercel.app/privacy

---

## 3. "Test instructions" for the reviewer (if the dashboard asks for them)

```
1. Sign in at https://sellvela.vercel.app/login with the test account below.
2. Click the Sellvela icon → "Connect to Sellvela" → "Connect this browser".
3. Open a CJdropshipping product page, for example the products linked from https://sellvela.vercel.app/high-ticket ("View on CJ"), then click "Analyze eBay profit" (bottom right).
4. Try "Save to ideas", then the popup tabs Overview / Ideas / Tools.

Test account: [EMAIL] / [PASSWORD]
```
→ Create this account yourself, then grant it access from Admin → Clients → "Offrir Pro". Connect your CJ key on it so live analyses work.

---

## 4. To do before submitting

1. **Real support email (blocking):** the site still shows *support@example.com*, including in the privacy policy. Set `NEXT_PUBLIC_SUPPORT_EMAIL` in Vercel to a mailbox you actually read, then redeploy.
2. Chrome Web Store developer account ($5, one time) and identity verification.
3. Create the reviewer test account and click "Offrir Pro" for it in Admin.
4. Upload the zip, the images and the text above, then click "Submit for review". Review usually takes a few days.
