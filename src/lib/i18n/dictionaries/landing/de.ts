import type { landingEn } from "./en";

export const landingDe: typeof landingEn = {
  nav: { features: "Funktionen", how: "So funktioniert's", pricing: "Preise", faq: "FAQ", login: "Anmelden", cta: "Kostenlos testen" },
  hero: {
    badge: "Entwickelt für die eBay-Dropshipping-Regeln 2026",
    title1: "Schluss mit Produkten,",
    title2: "die Geld verlieren.",
    subtitle:
      "{brand} prüft jedes Produkt anhand der echten eBay-Nachfrage und der Lieferkosten bei AliExpress und CJ – und lässt dich nur Produkte mit über 30 % Marge nach Gebühren einstellen. Das Einstellen und die Lieferantenbestellungen übernimmt das Tool für dich.",
    cta: "7 Tage kostenlos testen",
    secondary: "Kostenlosen Gewinnrechner ausprobieren",
    reassurance: "Kostenloses Konto · 7 Tage gratis testen · Jederzeit kündbar · Nie Ware von Amazon oder Walmart",
  },
  mock: {
    title: "Produktanalyse",
    product: "Elektrischer Dosenöffner",
    market: "Marktpreis eBay USA",
    cost: "Lieferantenkosten inkl. Versand",
    fees: "eBay-Gebühren",
    profit: "Dein Gewinn",
    verdict: "Profitabel – bereit zum Einstellen",
    rejected: "Katzen-Trinkbrunnen",
    rejectedNote: "Verliert 18,35 $ pro Verkauf – abgelehnt",
    caption: "Echte Zahlen aus unserem Test im September 2026",
  },
  proof: {
    title: "Wir haben es an echten Produkten getestet, bevor wir es gebaut haben",
    items: [
      { value: "19 → 4", label: "getestete vs. behaltene Produkte: die meisten „Winning Products“ verlieren nach Gebühren Geld" },
      { value: "9", label: "eBay-Marktplätze: US, CA, UK, AU, DE, FR, IT, ES, IE" },
      { value: "100 %", label: "offizielle eBay-API – kein Scraping, keine Bots auf deinem Konto" },
      { value: "5", label: "Sprachen: Englisch, Französisch, Deutsch, Italienisch, Spanisch" },
    ],
  },
  problem: {
    title: "Warum die meisten eBay-Dropshipper nach 90 Tagen aufgeben",
    items: [
      { title: "Verbotene Quellen", text: "Bei Amazon oder Walmart kaufen und direkt an den Käufer schicken verstößt gegen die eBay-Richtlinien. Konten werden markiert und eingeschränkt." },
      { title: "Gebühren fressen die Marge", text: "Verkaufsprovision + Gebühr pro Bestellung + Werbung. Ein Produkt mit scheinbar 10 $ Gewinn bringt oft 2 $ – oder Verlust." },
      { title: "Stundenlange Handarbeit", text: "Titel kopieren, Bestand prüfen, bestellen, Sendungsnummern eintragen. Jeden einzelnen Tag." },
    ],
  },
  how: {
    title: "In wenigen Minuten zum ersten profitablen Angebot",
    steps: [
      { title: "eBay verbinden", text: "Sichere Anmeldung über die offizielle eBay-API. Wir sehen dein Passwort nie." },
      { title: "Gewinner finden", text: "Produkt eingeben. Wir vergleichen die echte eBay-Nachfrage mit den Preisen von AliExpress und CJ aus lokalen Lagern." },
      { title: "Mit einem Klick einstellen", text: "Die KI schreibt Titel und Beschreibung in der Sprache deiner Käufer, zu einem Preis, der deine Marge sichert." },
      { title: "Bestellungen auf Autopilot", text: "Bei einem Verkauf bestellen wir beim Lieferanten und senden die Sendungsnummer an eBay zurück." },
    ],
  },
  features: {
    title: "Alles, was du brauchst, um sicher und profitabel zu verkaufen",
    items: [
      { title: "30-%-Margenfilter", text: "Jedes Produkt wird nach eBay-Gebühren, Steuern und Versand geprüft. Liegt es unter deiner Schwelle, wird es nie vorgeschlagen." },
      { title: "Preise gewichtet nach echten Verkäufen", text: "Angebote, die sich wirklich verkaufen, zählen mehr. Überteuerte Angebote ohne Verkäufe täuschen das Tool nicht." },
      { title: "Kontoschutz", text: "Tägliche Einstelllimits je nach Kontoalter, VeRO-Markenfilter und Regeln für schnelle Lieferung, die sich nicht umgehen lassen." },
      { title: "Automatische Bestellungen", text: "Lieferantenbestellungen über die offiziellen APIs von CJ und AliExpress, Sendungsnummer automatisch übermittelt." },
      { title: "Bestands- und Preisüberwachung", text: "Nicht mehr lieferbar oder Marge unter deiner Schwelle? Das Angebot wird pausiert, bevor du Geld verlierst." },
      { title: "9 Länder, 5 Sprachen", text: "Verkaufe auf eBay USA, Kanada, UK, Australien, Deutschland, Frankreich, Italien, Spanien und Irland." },
    ],
  },
  compare: {
    title: "Anders gebaut als typische Dropshipping-Tools",
    colTypical: "Typische Tools",
    colUs: "{brand}",
    rows: [
      { label: "Ware von Amazon / Walmart", typical: "Häufig", us: "Nie" },
      { label: "Echte Marge nach allen Gebühren", typical: "Selten", us: "Immer" },
      { label: "Nachfrage gewichtet nach echten Verkäufen", typical: "Nein", us: "Ja" },
      { label: "Einstelllimits nach Kontoalter", typical: "Optional oder „aggressiver Modus“", us: "Eingebaut" },
      { label: "Länder und Sprachen", typical: "Meist USA, Englisch", us: "9 Länder, 5 Sprachen" },
    ],
  },
  pricing: {
    title: "Einfache Preise. 7 Tage kostenlos starten.",
    subtitle: "Jährlich zahlen und 25 % sparen. Jederzeit in deinem Konto kündbar.",
    popular: "Am beliebtesten",
    taglines: { STARTER: "Erste Produkte testen", PRO: "Für wachsende Verkäufer", BUSINESS: "Mehrere Shops, ohne Limits", AGENCY: "Für Agenturen und Teams" },
    cta: "Kostenlos testen",
  },
  faq: {
    title: "Häufige Fragen",
    items: [
      { q: "Ist Dropshipping auf eBay erlaubt?", a: "Ja, mit einem Lieferanten, der dir zum Großhandelspreis verkauft und an deinen Käufer versendet. Verboten ist, den Artikel bei einem anderen Händler (z. B. Amazon oder Walmart) zu kaufen und direkt an deinen Käufer liefern zu lassen. {brand} arbeitet nur mit Lieferanten, die den eBay-Regeln entsprechen." },
      { q: "Welche Lieferanten werden unterstützt?", a: "CJDropshipping und AliExpress, mit Produkten aus lokalen Lagern für schnelle Lieferung. Das Tool wählt immer die günstigsten Lieferkosten, die deine Marge noch einhalten." },
      { q: "Woher stammen die Preisangaben?", a: "Aus der offiziellen eBay-API: Preise aktiver Neuware-Angebote, gewichtet nach der geschätzten Zahl verkaufter Einheiten. Wir scrapen eBay nicht." },
      { q: "Brauche ich ein angemeldetes Gewerbe?", a: "Du brauchst ein eBay-Verkäuferkonto und ein Lieferantenkonto. In Europa gelten die Gebühren für gewerbliche Verkäufer, und ein Gewerbe ist in der Regel erforderlich." },
      { q: "Kann ich jederzeit kündigen?", a: "Ja. Du verwaltest dein Abo selbst in deinem Konto, mit zwei Klicks. Die 7-tägige Testphase ist kostenlos." },
      { q: "Ist Gewinn garantiert?", a: "Kein Tool kann Gewinn garantieren. {brand} zeigt dir die echten Zahlen vor dem Einstellen und entfernt Produkte, die nicht mehr profitabel sind – so entscheidest du auf Basis von Fakten." },
    ],
  },
  reviews: {
    title: "Das sagen Verkäufer",
    subtitle: "Bewertungen echter Nutzer, veröffentlicht mit ihrer Zustimmung.",
    summary: "Durchschnitt {avg}/5 · {n} Bewertungen",
    verified: "Verifizierter Nutzer",
  },
  finalCta: {
    title: "Dein nächstes profitables Produkt ist nur eine Suche entfernt.",
    text: "Jetzt registrieren und die erste Analyse in unter fünf Minuten erhalten.",
    cta: "7 Tage kostenlos testen",
  },
  footer: {
    product: "Produkt",
    resources: "Ressourcen",
    calculator: "eBay-Gewinnrechner",
    affiliate: "Partnerprogramm (30 %)",
    contact: "Kontakt",
    rights: "© {year} {company}. Alle Rechte vorbehalten.",
    disclaimer: "{brand} ist ein unabhängiges Tool und steht in keiner Verbindung zu eBay Inc., wird nicht von eBay Inc. unterstützt oder gesponsert. eBay ist eine Marke von eBay Inc.",
  },
};
