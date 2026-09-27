import type { landingEn } from "./en";

export const landingIt: typeof landingEn = {
  nav: { features: "Funzionalità", how: "Come funziona", pricing: "Prezzi", faq: "FAQ", login: "Accedi", cta: "Prova gratis" },
  hero: {
    badge: "Pensato per le regole eBay 2026 sul dropshipping",
    title1: "Smetti di mettere in vendita prodotti",
    title2: "che ti fanno perdere soldi.",
    subtitle:
      "{brand} confronta ogni prodotto con la domanda reale su eBay e con il costo consegnato su AliExpress e CJ, e ti lascia pubblicare solo quelli con oltre il 30% di margine dopo le commissioni. Pubblica le inserzioni ed effettua gli ordini ai fornitori al posto tuo.",
    cta: "Inizia la prova gratuita di 7 giorni",
    secondary: "Prova il calcolatore di profitto gratuito",
    reassurance: "Account gratuito · 7 giorni di prova gratis · Disdici quando vuoi · Mai prodotti da Amazon o Walmart",
  },
  mock: {
    title: "Analisi del prodotto",
    product: "Apriscatole elettrico",
    market: "Prezzo di mercato eBay USA",
    cost: "Costo fornitore consegnato",
    fees: "Commissioni eBay",
    profit: "Il tuo profitto",
    verdict: "Redditizio – pronto da pubblicare",
    rejected: "Fontanella per gatti",
    rejectedNote: "Perde 18,35 $ a vendita – scartato",
    caption: "Numeri reali del nostro test di settembre 2026",
  },
  proof: {
    title: "L'abbiamo testato su prodotti reali prima di costruirlo",
    items: [
      { value: "19 → 4", label: "prodotti testati vs. tenuti: la maggior parte dei \"prodotti vincenti\" perde soldi dopo le commissioni" },
      { value: "9", label: "marketplace eBay: US, CA, UK, AU, DE, FR, IT, ES, IE" },
      { value: "100%", label: "API ufficiale eBay – niente scraping, nessun bot sul tuo account" },
      { value: "5", label: "lingue: inglese, francese, tedesco, italiano, spagnolo" },
    ],
  },
  problem: {
    title: "Perché la maggior parte dei dropshipper eBay molla entro 90 giorni",
    items: [
      { title: "Fonti vietate", text: "Comprare su Amazon o Walmart e spedire direttamente all'acquirente viola le regole di eBay. Gli account vengono segnalati e limitati." },
      { title: "Le commissioni mangiano il margine", text: "Commissione sul venduto + costo per ordine + pubblicità. Un prodotto che sembra rendere 10 $ spesso ne rende 2 – o va in perdita." },
      { title: "Ore di lavoro manuale", text: "Copiare titoli, controllare le scorte, fare ordini, incollare i numeri di tracking. Ogni singolo giorno." },
    ],
  },
  how: {
    title: "Dalla prima ricerca alla prima inserzione redditizia in pochi minuti",
    steps: [
      { title: "Collega eBay", text: "Accesso sicuro tramite l'API ufficiale di eBay. Non vediamo mai la tua password." },
      { title: "Trova i vincenti", text: "Scrivi un prodotto. Confrontiamo la domanda reale su eBay con i prezzi di AliExpress e CJ da magazzini locali." },
      { title: "Pubblica in un clic", text: "L'IA scrive titolo e descrizione nella lingua dei tuoi acquirenti, a un prezzo che protegge il tuo margine." },
      { title: "Ordini in automatico", text: "Quando vendi, ordiniamo al fornitore e inviamo il numero di tracking a eBay." },
    ],
  },
  features: {
    title: "Tutto ciò che serve per vendere in sicurezza e con profitto",
    items: [
      { title: "Filtro margine 30%", text: "Ogni prodotto viene verificato dopo commissioni eBay, tasse e spedizione. Sotto la tua soglia, non viene mai proposto." },
      { title: "Prezzi ponderati sulle vendite reali", text: "Le inserzioni che vendono davvero contano di più. Quelle troppo care che non vendono non ingannano lo strumento." },
      { title: "Protezione dell'account", text: "Limiti giornalieri di pubblicazione in base all'anzianità dell'account, filtro marchi VeRO e regole di consegna rapida non aggirabili." },
      { title: "Ordini automatici", text: "Ordini ai fornitori tramite le API ufficiali di CJ e AliExpress, tracking inviato automaticamente." },
      { title: "Monitoraggio scorte e prezzi", text: "Prodotto esaurito o margine sotto la soglia? L'inserzione viene sospesa prima che tu perda soldi." },
      { title: "9 paesi, 5 lingue", text: "Vendi su eBay USA, Canada, Regno Unito, Australia, Germania, Francia, Italia, Spagna e Irlanda." },
    ],
  },
  compare: {
    title: "Costruito diversamente dai soliti strumenti di dropshipping",
    colTypical: "Strumenti tipici",
    colUs: "{brand}",
    rows: [
      { label: "Prodotti da Amazon / Walmart", typical: "Spesso", us: "Mai" },
      { label: "Margine reale dopo tutte le commissioni", typical: "Raramente", us: "Sempre" },
      { label: "Domanda ponderata sulle vendite reali", typical: "No", us: "Sì" },
      { label: "Limiti di pubblicazione per anzianità account", typical: "Opzionali o \"modalità aggressiva\"", us: "Integrati" },
      { label: "Paesi e lingue", typical: "Quasi solo USA, inglese", us: "9 paesi, 5 lingue" },
    ],
  },
  pricing: {
    title: "Prezzi semplici. Inizia gratis per 7 giorni.",
    subtitle: "Paga annualmente e risparmia il 25%. Disdici quando vuoi dal tuo account.",
    popular: "Il più scelto",
    taglines: { STARTER: "Testa i tuoi primi prodotti", PRO: "Per venditori in crescita", BUSINESS: "Più negozi, senza limiti", AGENCY: "Per agenzie e team" },
    cta: "Prova gratis",
  },
  faq: {
    title: "Domande frequenti",
    items: [
      { q: "Il dropshipping è consentito su eBay?", a: "Sì, con un fornitore che ti vende all'ingrosso e spedisce al tuo acquirente. eBay vieta invece di acquistare l'articolo da un altro rivenditore (come Amazon o Walmart) e farlo spedire direttamente all'acquirente. {brand} lavora solo con fornitori conformi alle regole di eBay." },
      { q: "Quali fornitori supportate?", a: "CJDropshipping e AliExpress, con prodotti in magazzini locali per una consegna rapida. Lo strumento sceglie sempre il costo consegnato più basso che rispetta il tuo margine." },
      { q: "Da dove vengono i prezzi?", a: "Dall'API ufficiale di eBay: prezzi delle inserzioni attive di prodotti nuovi, ponderati per il numero stimato di unità vendute. Non facciamo scraping di eBay." },
      { q: "Serve una partita IVA?", a: "Ti servono un account venditore eBay e un account fornitore. In Europa si applicano le commissioni per venditori professionali e di solito è richiesta un'attività registrata." },
      { q: "Posso disdire quando voglio?", a: "Sì. Gestisci tu l'abbonamento dal tuo account, in due clic. La prova di 7 giorni è gratuita." },
      { q: "Il profitto è garantito?", a: "Nessuno strumento può garantire un profitto. {brand} ti mostra i numeri reali prima di pubblicare e rimuove i prodotti che smettono di essere redditizi, così decidi sulla base dei fatti." },
    ],
  },
  finalCta: {
    title: "Il tuo prossimo prodotto redditizio è a una ricerca di distanza.",
    text: "Iscriviti ora e ottieni la tua prima analisi in meno di cinque minuti.",
    cta: "Inizia la prova gratuita di 7 giorni",
  },
  footer: {
    product: "Prodotto",
    resources: "Risorse",
    calculator: "Calcolatore di profitto eBay",
    affiliate: "Programma di affiliazione (30%)",
    contact: "Contatti",
    rights: "© {year} {company}. Tutti i diritti riservati.",
    disclaimer: "{brand} è uno strumento indipendente e non è affiliato, approvato o sponsorizzato da eBay Inc. eBay è un marchio di eBay Inc.",
  },
};
