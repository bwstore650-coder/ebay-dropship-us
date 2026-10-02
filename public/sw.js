/* Sellvela : notifications de vente (Web Push). */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Sellvela", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Sellvela", {
    body: data.body || "",
    icon: "/favicon.ico",
    data: { url: data.url || "/orders" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/orders", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if (w.url.startsWith(self.location.origin) && "focus" in w) { await w.navigate(url); return w.focus(); }
    return self.clients.openWindow(url);
  })());
});
