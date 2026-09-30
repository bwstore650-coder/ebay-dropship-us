import type { landingEn } from "./en";

export const landingFr: typeof landingEn = {
  nav: { features: "Fonctionnalités", how: "Comment ça marche", pricing: "Tarifs", faq: "FAQ", login: "Se connecter", cta: "Commencer l'essai" },
  hero: {
    badge: "Conçu pour les règles eBay 2026 sur le dropshipping",
    title1: "Arrête de mettre en vente",
    title2: "des produits qui te font perdre de l'argent.",
    subtitle:
      "{brand} vérifie chaque produit face à la vraie demande eBay et au coût livré chez AliExpress et CJ, puis ne te laisse lister que ceux qui gardent 30 % de marge après les frais. Il les met en vente et passe les commandes fournisseur pour toi.",
    cta: "Commencer l'essai de 3 jours à 0,99 $",
    secondary: "Essayer le calculateur de profit gratuit",
    reassurance: "Compte gratuit · Essai de 3 jours à 0,99 $ · Annulable à tout moment · Jamais de produits Amazon ou Walmart",
  },
  mock: {
    title: "Analyse du produit",
    product: "Ouvre-boîte électrique",
    market: "Prix du marché eBay US",
    cost: "Coût fournisseur livré",
    fees: "Frais eBay",
    profit: "Ton profit",
    verdict: "Rentable — prêt à lister",
    rejected: "Fontaine à eau pour chat",
    rejectedNote: "Perd 18,35 $ par vente — écarté",
    caption: "Chiffres réels de notre test de septembre 2026",
  },
  proof: {
    title: "On l'a testé sur de vrais produits avant de le construire",
    items: [
      { value: "19 → 4", label: "produits testés vs gardés : la plupart des « produits gagnants » perdent de l'argent après les frais" },
      { value: "9", label: "marketplaces eBay : US, CA, UK, AU, DE, FR, IT, ES, IE" },
      { value: "100 %", label: "API officielle eBay — aucun scraping, aucun robot sur ton compte" },
      { value: "5", label: "langues : anglais, français, allemand, italien, espagnol" },
    ],
  },
  problem: {
    title: "Pourquoi la plupart des dropshippers eBay abandonnent en 90 jours",
    items: [
      { title: "Sources interdites", text: "Acheter sur Amazon ou Walmart pour livrer ton client enfreint la règle d'eBay. Les comptes sont signalés et restreints." },
      { title: "Les frais mangent la marge", text: "Commission, frais par commande, taxe, publicité. Un produit qui semble rapporter 10 $ en rapporte souvent 2 — ou en fait perdre." },
      { title: "Des heures de travail manuel", text: "Copier les titres, vérifier le stock, passer les commandes, coller les numéros de suivi. Tous les jours." },
    ],
  },
  how: {
    title: "De zéro à ta première annonce rentable en quelques minutes",
    steps: [
      { title: "Connecte eBay", text: "Connexion sécurisée via l'API officielle d'eBay. Nous ne voyons jamais ton mot de passe." },
      { title: "Trouve les gagnants", text: "Tape un produit. Nous comparons la vraie demande eBay aux prix AliExpress et CJ en entrepôt local." },
      { title: "Liste en un clic", text: "L'IA écrit le titre et la description dans la langue de ton acheteur, à un prix qui garde ta marge." },
      { title: "Commandes en pilote automatique", text: "Quand ça se vend, nous commandons chez le fournisseur et renvoyons le numéro de suivi à eBay." },
    ],
  },
  features: {
    title: "Tout ce qu'il faut pour vendre en sécurité et avec profit",
    items: [
      { title: "Filtre de marge à 30 %", text: "Chaque produit est vérifié après frais eBay, taxe et livraison. Sous ton seuil, il n'est jamais proposé." },
      { title: "Prix pondérés par les vraies ventes", text: "Les annonces qui vendent vraiment comptent plus. Les annonces trop chères qui ne vendent pas ne trompent pas l'outil." },
      { title: "Protection du compte", text: "Limites d'annonces selon l'âge du compte, filtre des marques VeRO et règles de livraison rapide impossibles à contourner." },
      { title: "Commande automatique", text: "Commandes fournisseur via les API officielles de CJ et AliExpress, suivi renvoyé automatiquement." },
      { title: "Surveillance du stock et des prix", text: "Rupture ou marge sous ton seuil ? L'annonce est mise en pause avant que tu perdes de l'argent." },
      { title: "9 pays, 5 langues", text: "Vends sur eBay États-Unis, Canada, Royaume-Uni, Australie, Allemagne, France, Italie, Espagne et Irlande." },
    ],
  },
  compare: {
    title: "Pensé autrement que les outils de dropshipping classiques",
    colTypical: "Outils classiques",
    colUs: "{brand}",
    rows: [
      { label: "Sources Amazon / Walmart", typical: "Souvent", us: "Jamais" },
      { label: "Vraie marge affichée après tous les frais", typical: "Rarement", us: "Toujours" },
      { label: "Demande pondérée par les ventes réelles", typical: "Non", us: "Oui" },
      { label: "Limites d'annonces selon l'âge du compte", typical: "Optionnelles ou « mode agressif »", us: "Intégrées" },
      { label: "Pays et langues", typical: "Surtout US, en anglais", us: "9 pays, 5 langues" },
    ],
  },
  pricing: {
    title: "Des tarifs simples. 3 jours d'essai pour 0,99 $.",
    subtitle: "Paie à l'année et économise 20 %. Annulable à tout moment depuis ton compte.",
    popular: "Le plus choisi",
    taglines: { STARTER: "Pour tester vos premiers produits", PRO: "Pour les vendeurs en croissance", BUSINESS: "Plusieurs boutiques, gros volume", AGENCY: "Illimité, pour les agences et les équipes" },
    cta: "Commencer l'essai",
  },
  faq: {
    title: "Questions fréquentes",
    items: [
      { q: "Le dropshipping est-il autorisé sur eBay ?", a: "Oui, avec un fournisseur qui te vend en gros et livre ton acheteur. Ce qu'eBay interdit, c'est d'acheter l'article chez un autre détaillant (comme Amazon ou Walmart) pour le faire livrer directement à ton acheteur. {brand} ne travaille qu'avec des fournisseurs conformes aux règles d'eBay." },
      { q: "Quels fournisseurs sont pris en charge ?", a: "CJDropshipping et AliExpress, avec des produits stockés en entrepôt local pour une livraison rapide. L'outil choisit toujours le coût livré le plus bas qui respecte ta marge." },
      { q: "D'où viennent vos chiffres de prix ?", a: "De l'API officielle d'eBay : prix des annonces actives neuves, pondérés par le nombre estimé d'unités vendues par chacune. Nous ne faisons pas de scraping d'eBay." },
      { q: "Faut-il une entreprise ?", a: "Il te faut un compte vendeur eBay et un compte fournisseur. En Europe, ce sont les frais eBay des vendeurs professionnels qui s'appliquent, et une entreprise enregistrée est généralement nécessaire." },
      { q: "Puis-je annuler à tout moment ?", a: "Oui. Tu gères ton abonnement toi-même depuis ton compte, en deux clics. L'essai de 3 jours coûte 0,99 $." },
      { q: "Le profit est-il garanti ?", a: "Aucun outil ne peut garantir un profit. {brand} te montre les vrais chiffres avant de lister et retire les produits qui ne sont plus rentables, pour que tu décides sur des faits." },
    ],
  },
  reviews: {
    title: "Ce qu'en disent les vendeurs",
    subtitle: "Avis de vrais utilisateurs, publiés avec leur accord.",
    summary: "Note moyenne {avg}/5 · {n} avis",
    verified: "Utilisateur vérifié",
  },
  finalCta: {
    title: "Ton prochain produit rentable est à une recherche.",
    text: "Inscris-toi maintenant et obtiens ta première analyse en moins de cinq minutes.",
    cta: "Commencer l'essai de 3 jours à 0,99 $",
  },
  footer: {
    product: "Produit",
    resources: "Ressources",
    calculator: "Calculateur de profit eBay",
    affiliate: "Programme d'affiliation (30 %)",
    contact: "Contact",
    rights: "© {year} {company}. Tous droits réservés.",
    disclaimer: "{brand} est un outil indépendant, non affilié, approuvé ni sponsorisé par eBay Inc. eBay est une marque d'eBay Inc.",
  },
};
