/** Appels à Sellvela avec le jeton de l'extension (popup et service worker). */
import { API_BASE } from "./config.js";

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function getToken() {
  const { token } = await chrome.storage.local.get("token");
  return token || null;
}

export async function api(path, { method = "GET", body } = {}) {
  const token = await getToken();
  if (!token) throw new ApiError("EXT_UNAUTHORIZED", 401);
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("NETWORK", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // Jeton révoqué (déconnecté depuis les réglages Sellvela) : l'extension repasse en « non connectée ».
    await chrome.storage.local.remove(["token", "summary", "since", "seen"]);
    throw new ApiError("EXT_UNAUTHORIZED", 401);
  }
  if (!res.ok) throw new ApiError(data.error || "UPSTREAM", res.status);
  return data;
}

/** Déconnexion : le jeton est supprimé chez Sellvela puis dans l'extension. */
export async function logout() {
  const token = await getToken();
  if (token) await fetch(`${API_BASE}/api/ext/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  await chrome.storage.local.remove(["token", "summary", "since", "seen", "lowWarnedAt"]);
}
