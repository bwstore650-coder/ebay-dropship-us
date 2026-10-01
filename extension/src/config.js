/** Adresse de Sellvela. Toutes les données passent par ce serveur (API officielles eBay et CJ). */
export const API_BASE = "https://sellvela.vercel.app";
/** Vérification des ventes, commandes bloquées et solde CJ (minutes). */
export const POLL_MINUTES = 5;
/** Rappel « solde CJ bas » au plus toutes les 12 heures. */
export const LOW_BALANCE_REMIND_MS = 12 * 3600_000;
