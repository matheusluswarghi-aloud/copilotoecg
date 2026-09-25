/* Copiloto de ECG — service worker.
   Rede primeiro, com limite de 3 s; o cache é a reserva para plantão sem sinal.
   Assim, com internet, a versão nova aparece na hora. */
const VERSAO = "copiloto-v10.1";
const CASCA = ["./", "index.html", "style.css", "controles.css", "ia.css", "plantao.css", "app.js", "controles.js", "ia-regras.js", "ia.js", "plantao.js", "referencias.js", "plataforma.js",
  "config.js", "conta-falsa.js", "conta.js", "sync.js", "vendor/supabase.js", "fontes/fontes.css",
  "fontes/Geist-300.woff2", "fontes/Geist-400.woff2", "fontes/Geist-500.woff2", "fontes/Geist-600.woff2",
  "fontes/GeistMono-400.woff2", "fontes/GeistMono-500.woff2", "manifest.webmanifest",
  "icones/icon-192.png", "icones/icon-512.png", "icones/apple-touch-icon.png",
  // imagens de referência: o plantão sem sinal também precisa delas
  "ref/aslanger.webp", "ref/avr.webp", "ref/calibracao.webp", "ref/dewinter.webp", "ref/eletrodos.webp", "ref/hiper.webp", "ref/hk1.webp", "ref/hk2.webp", "ref/hpk1.webp", "ref/hpk2.webp", "ref/p-dii.webp", "ref/p-polaridade.webp", "ref/qrs-inicio-fim.webp", "ref/s1q3t3.webp", "ref/v1-brd-bre.webp", "ref/wellens-a.webp", "ref/wellens.webp"];

self.addEventListener("install", e => {
  // allSettled: um arquivo faltando não pode impedir a instalação
  e.waitUntil(caches.open(VERSAO).then(c => Promise.allSettled(CASCA.map(u => c.add(new Request(u, {cache:"reload"}))))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const comLimite = (p, ms) => new Promise((ok, erro) => { const r = setTimeout(() => erro(new Error("rede lenta")), ms); p.then(v => { clearTimeout(r); ok(v); }, x => { clearTimeout(r); erro(x); }); });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith(".supabase.co")) return;  // sessão, sincronização e a função da IA nunca passam pelo cache
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSAO);
    // a requisição de navegação não aceita opções extras: refazê-la pela URL é o jeito de revalidar
    // (sem isso o Pages serve a página do cache HTTP, com max-age de 10 min)
    const rede = (req.mode === "navigate" ? fetch(req.url, {cache:"no-cache"}) : fetch(req, {cache:"no-cache"})).then(r => { if (r.ok) c.put(req, r.clone()); return r; });
    try { return await comLimite(rede, 3000); }
    catch(_){
      const guardado = await c.match(req, {ignoreSearch:true}) || (req.mode === "navigate" ? await c.match("index.html") : null);
      return guardado || rede;
    }
  })());
});
