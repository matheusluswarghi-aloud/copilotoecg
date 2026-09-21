/* Copiloto de ECG — service worker.
   Rede primeiro, com limite de 3 s; o cache é a reserva para plantão sem sinal.
   Assim, com internet, a versão nova aparece na hora. */
const VERSAO = "copiloto-v6", FONTES = "copiloto-fontes";
const CASCA = ["./", "index.html", "style.css", "controles.css", "app.js", "controles.js", "manifest.webmanifest",
  "icones/icon-192.png", "icones/icon-512.png", "icones/apple-touch-icon.png"];

self.addEventListener("install", e => {
  // allSettled: um arquivo faltando não pode impedir a instalação
  e.waitUntil(caches.open(VERSAO).then(c => Promise.allSettled(CASCA.map(u => c.add(new Request(u, {cache:"reload"}))))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO && k !== FONTES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const comLimite = (p, ms) => new Promise((ok, erro) => { const r = setTimeout(() => erro(new Error("rede lenta")), ms); p.then(v => { clearTimeout(r); ok(v); }, x => { clearTimeout(r); erro(x); }); });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"){
    e.respondWith(caches.open(FONTES).then(async c => {
      const guardado = await c.match(req); if (guardado) return guardado;
      const r = await fetch(req); if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSAO);
    // requisição de navegação não aceita opções extras no fetch
    const rede = (req.mode === "navigate" ? fetch(req) : fetch(req, {cache:"no-cache"})).then(r => { if (r.ok) c.put(req, r.clone()); return r; });
    try { return await comLimite(rede, 3000); }
    catch(_){
      const guardado = await c.match(req, {ignoreSearch:true}) || (req.mode === "navigate" ? await c.match("index.html") : null);
      return guardado || rede;
    }
  })());
});
