"use strict";
/* Copiloto de ECG — versão 1
   Tudo roda no aparelho: a foto do eletro nunca sai do celular.
   Fotos ficam no IndexedDB, leituras e medidas no localStorage. */
(function(){

const app = document.getElementById("app");
const inputArquivo = document.getElementById("arquivo");
const MM_POR_S = 25;              // velocidade do papel
const MS_POR_MM = 1000 / MM_POR_S; // 40 ms por milímetro

/* ---------- guardar no aparelho ---------- */
const DB_NOME = "copiloto", LOJA = "fotos", CHAVE = "copiloto.leituras";
let dbp = null;
function db(){
  if (dbp) return dbp;
  dbp = new Promise((ok, erro) => {
    const r = indexedDB.open(DB_NOME, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(LOJA)) r.result.createObjectStore(LOJA); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
  return dbp;
}
async function guardarFoto(id, blob){
  try { const b = await db(); await new Promise((ok, e) => { const t = b.transaction(LOJA, "readwrite"); t.objectStore(LOJA).put(blob, id); t.oncomplete = ok; t.onerror = () => e(t.error); }); }
  catch(_){ /* modo privado: segue sem guardar a foto */ }
}
async function lerFoto(id){
  try { const b = await db(); return await new Promise((ok, e) => { const t = b.transaction(LOJA, "readonly"); const q = t.objectStore(LOJA).get(id); q.onsuccess = () => ok(q.result || null); q.onerror = () => e(q.error); }); }
  catch(_){ return null; }
}
async function apagarFoto(id){
  try { const b = await db(); await new Promise(ok => { const t = b.transaction(LOJA, "readwrite"); t.objectStore(LOJA).delete(id); t.oncomplete = ok; t.onerror = ok; }); } catch(_){}
}
function lerLeituras(){ try { return JSON.parse(localStorage.getItem(CHAVE) || "[]"); } catch(_){ return []; } }
function gravarLeituras(l){ try { localStorage.setItem(CHAVE, JSON.stringify(l)); } catch(_){} }

/* ---------- estado ---------- */
function nova(){
  return { id:"L" + Date.now(), quando:Date.now(),
    ctx:{idade:null, sexo:"M", queixa:"sincope"},
    foto:null, tela:null, escala:null,
    passo:0, ans:{}, meas:{rr:null, pr:null, qrs:null, qt:null},
    axis:{d1:0, avf:0, ang:null}, intSel:"PR",
    pontos:{cal:null, fc:null, PR:null, QRS:null, QT:null}, salva:false };
}
const S = { tela:"inicio", aba:"inicio", cur:nova(), leituras:lerLeituras(), visor:null, detalhe:null };

const PASSOS = ["Contexto do paciente","O exame foi bem feito?","Ritmo","Frequência","Regularidade","Eixo","Ondas","Intervalos","Segmentos"];
const ONDE = ["Olhe o eletro inteiro antes de começar.","Confira a calibração, as 12 derivações e o D2 longo.",
  "Vá para o D2 longo, embaixo do traçado.","No D2 longo, marque dois QRS seguidos.","Percorra o D2 longo inteiro.",
  "Olhe D1 e aVF.","Olhe V1, D1 e V6.","No D2 longo, meça PR, QRS e QT.","Olhe o ST em todas as derivações."];

/* ---------- contas ---------- */
const fc = () => S.cur.meas.rr ? Math.round(60000 / S.cur.meas.rr) : null;
const qtc = () => { const m = S.cur.meas; if (!m.qt) return null; const rr = (m.rr || 1000) / 1000; return Math.round(m.qt / Math.sqrt(rr)); };
const limiteQT = () => S.cur.ctx.sexo === "F" ? 460 : 450;
const quadr = ms => (ms / MS_POR_MM).toLocaleString("pt-BR", {maximumFractionDigits:1});
const largo = () => (S.cur.meas.qrs || 0) >= 120;
const brd = () => { const o = S.cur.ans.ondas || []; return o.includes("rsr") && o.includes("slargo"); };
const bdas = () => S.cur.ans.bdas === "sim";
function classeEixo(a){
  if (a === null) return null;
  if (a >= -30 && a <= 90) return {k:"ok", t:"normal"};
  if (a > 90) return {k:"warn", t:"desvio à direita"};
  if (a >= -90) return {k:"warn", t:"desvio à esquerda"};
  return {k:"bad", t:"eixo extremo"};
}
function msEntre(p1, p2){
  const e = S.cur.escala; if (!e) return 0;
  const u = {x:Math.cos(e.angulo), y:Math.sin(e.angulo)};
  const d = Math.abs((p2.x - p1.x) * u.x + (p2.y - p1.y) * u.y);
  return Math.round(d / e.pxPorMm * MS_POR_MM);
}

/* ---------- foto ---------- */
function pedirFoto(fonte){
  if (fonte === "camera") inputArquivo.setAttribute("capture", "environment");
  else inputArquivo.removeAttribute("capture");
  inputArquivo.click();
}
async function prepararFoto(file){
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try { if (img.decode) await img.decode(); else await new Promise((ok, e) => { img.onload = ok; img.onerror = e; }); }
  catch(_){ URL.revokeObjectURL(url); throw new Error("imagem"); }
  const MAX = 2600, k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c;
}
function analisarQualidade(tela){
  const L = 720, k = Math.min(1, L / tela.width);
  const w = Math.max(2, Math.round(tela.width * k)), h = Math.max(2, Math.round(tela.height * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d", {willReadFrequently:true});
  ctx.drawImage(tela, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  let soma = 0, claros = 0, escuros = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++){
    const v = .299 * d[i] + .587 * d[i+1] + .114 * d[i+2];
    g[p] = v; soma += v;
    if (v > 247) claros++;
    if (v < 30) escuros++;
  }
  let s = 0, s2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++){
    const p = y * w + x;
    const lap = 4 * g[p] - g[p-1] - g[p+1] - g[p-w] - g[p+w];
    s += lap; s2 += lap * lap; n++;
  }
  const px = w * h;
  return { largura:tela.width, altura:tela.height, nitidez:n ? s2/n - (s/n)*(s/n) : 0,
    luz:soma/px, claros:claros/px, escuros:escuros/px };
}
function avisosFoto(q){
  const a = [];
  if (q.largura < 1100)
    a.push({n:"bad", t:"Foto pequena demais", d:"A imagem tem " + q.largura + " pixels de largura. Chegue mais perto do papel e enquadre só o eletro: de longe, o quadradinho vira um borrão e a medida perde o sentido."});
  if (q.nitidez < 70)
    a.push({n:"bad", t:"Traçado desfocado", d:"Apoie o cotovelo na mesa, toque na tela em cima do papel para o celular focar e tire de novo."});
  else if (q.nitidez < 190)
    a.push({n:"warn", t:"Foco no limite", d:"Dá para medir, mas o traçado está macio. Se puder, tire outra com o celular mais firme."});
  if (q.luz < 62)
    a.push({n:"bad", t:"Foto escura", d:"Leve o papel para perto de uma luz, ou acenda a luz do plantão. No escuro o celular borra sozinho para compensar."});
  else if (q.luz > 214)
    a.push({n:"warn", t:"Foto estourada", d:"A luz apagou parte da grade. Afaste a lâmpada ou tire de um ângulo diferente."});
  if (q.claros > .06)
    a.push({n:"warn", t:"Reflexo na folha", d:"Tem brilho branco estourado em cima do papel. Desligue o flash e incline a folha ou o corpo até o reflexo sair."});
  if (q.escuros > .35)
    a.push({n:"warn", t:"Sombra sobre o papel", d:"Sua mão ou seu corpo está fazendo sombra. Ilumine de lado, não de frente."});
  return a;
}

/* ---------- visor ---------- */
class Visor{
  constructor(host, tela, opts){
    opts = opts || {};
    this.host = host; this.tela = tela; this.modo = opts.modo || "livre";
    this.pontos = opts.pontos || null; this.aoMudar = opts.aoMudar || function(){};
    this.v = {escala:1, tx:0, ty:0, giro:0};
    this.canvas = document.createElement("canvas");
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.ponteiros = new Map(); this.pegou = -1; this.pinca = null;
    this.ajustar();
    if (S.vista){ this.v = Object.assign({}, S.vista); }
    const ev = e => this.baixou(e);
    this.canvas.addEventListener("pointerdown", ev);
    this.canvas.addEventListener("pointermove", e => this.moveu(e));
    this.canvas.addEventListener("pointerup", e => this.soltou(e));
    this.canvas.addEventListener("pointercancel", e => this.soltou(e));
    this._resize = () => { this.ajustar(); this.desenhar(); };
    window.addEventListener("resize", this._resize);
  }
  destruir(){ window.removeEventListener("resize", this._resize); }
  ajustar(){
    const r = this.host.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr; this.larg = r.width; this.alt = r.height;
    if (!this._posicionado){ this.enquadrar(); this._posicionado = true; }
  }
  enquadrar(){
    const e = Math.min(this.larg / this.tela.width, this.alt / this.tela.height) * .98;
    this.v.escala = e; this.v.tx = this.larg / 2; this.v.ty = this.alt / 2;
    const ang = S.cur.escala ? S.cur.escala.angulo : 0;
    this.v.giro = -ang;
  }
  aproximar(f){
    const c = {x:this.larg/2, y:this.alt/2}, antes = this.paraImagem(c);
    this.v.escala = Math.max(.05, Math.min(14, this.v.escala * f));
    const depois = this.paraTela(antes);
    this.v.tx += c.x - depois.x; this.v.ty += c.y - depois.y;
    this.desenhar();
  }
  paraTela(p){
    const c = Math.cos(this.v.giro), s = Math.sin(this.v.giro);
    const x = p.x - this.tela.width/2, y = p.y - this.tela.height/2;
    return {x:(x*c - y*s) * this.v.escala + this.v.tx, y:(x*s + y*c) * this.v.escala + this.v.ty};
  }
  paraImagem(q){
    const c = Math.cos(-this.v.giro), s = Math.sin(-this.v.giro);
    const x = (q.x - this.v.tx) / this.v.escala, y = (q.y - this.v.ty) / this.v.escala;
    return {x:(x*c - y*s) + this.tela.width/2, y:(x*s + y*c) + this.tela.height/2};
  }
  local(e){ const r = this.canvas.getBoundingClientRect(); return {x:e.clientX - r.left, y:e.clientY - r.top}; }
  baixou(e){
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.ponteiros.set(e.pointerId, p);
    if (this.ponteiros.size === 2){
      const [a, b] = [...this.ponteiros.values()];
      this.pinca = {d:Math.hypot(a.x-b.x, a.y-b.y), m:{x:(a.x+b.x)/2, y:(a.y+b.y)/2}};
      this.pegou = -1;
      return;
    }
    this.pegou = -1;
    if (this.pontos){
      let melhor = 40;
      this.pontos.forEach((pt, i) => { const t = this.paraTela(pt), d = Math.hypot(t.x-p.x, t.y-p.y); if (d < melhor){ melhor = d; this.pegou = i; } });
    }
    this.ultimo = p;
  }
  moveu(e){
    if (!this.ponteiros.has(e.pointerId)) return;
    e.preventDefault();
    const p = this.local(e);
    this.ponteiros.set(e.pointerId, p);
    if (this.ponteiros.size === 2 && this.pinca){
      const [a, b] = [...this.ponteiros.values()];
      const d = Math.hypot(a.x-b.x, a.y-b.y), m = {x:(a.x+b.x)/2, y:(a.y+b.y)/2};
      const f = d / (this.pinca.d || d);
      const antes = this.paraImagem(m);
      this.v.escala = Math.max(.05, Math.min(14, this.v.escala * f));
      const depois = this.paraTela(antes);
      this.v.tx += m.x - depois.x; this.v.ty += m.y - depois.y;
      this.pinca = {d, m};
      this.desenhar();
      return;
    }
    if (this.pegou >= 0 && this.pontos){
      this.pontos[this.pegou] = this.paraImagem(p);
      this.desenhar(); this.aoMudar();
      return;
    }
    this.v.tx += p.x - this.ultimo.x; this.v.ty += p.y - this.ultimo.y;
    this.ultimo = p;
    this.desenhar();
  }
  soltou(e){
    this.ponteiros.delete(e.pointerId);
    if (this.ponteiros.size < 2) this.pinca = null;
    if (this.ponteiros.size === 1) this.ultimo = [...this.ponteiros.values()][0];
    this.pegou = -1;
  }
  desenhar(){
    const c = this.ctx, dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.larg, this.alt);
    c.save();
    c.translate(this.v.tx, this.v.ty); c.rotate(this.v.giro); c.scale(this.v.escala, this.v.escala);
    c.imageSmoothingQuality = "high";
    c.drawImage(this.tela, -this.tela.width/2, -this.tela.height/2);
    c.restore();
    if (this.pontos && this.pontos.length === 2) this.desenharCompasso();
    S.vista = Object.assign({}, this.v);
    const z = this.host.querySelector(".zoomtag");
    if (z) z.textContent = Math.round(this.v.escala * 100) + "%";
  }
  desenharCompasso(){
    const c = this.ctx;
    const a = this.paraTela(this.pontos[0]), b = this.paraTela(this.pontos[1]);
    const cor = this.modo === "calibrar" ? getComputedStyle(document.documentElement).getPropertyValue("--cal-2").trim() || "#2FA8FF"
                                         : getComputedStyle(document.documentElement).getPropertyValue("--cal").trim() || "#E8433B";
    const dir = this.v.giro;
    const perp = {x:-Math.sin(dir), y:Math.cos(dir)};
    const L = Math.max(this.larg, this.alt);
    c.save();
    c.lineWidth = 2; c.strokeStyle = cor; c.setLineDash([7, 5]);
    [a, b].forEach(p => { c.beginPath(); c.moveTo(p.x - perp.x*L, p.y - perp.y*L); c.lineTo(p.x + perp.x*L, p.y + perp.y*L); c.stroke(); });
    c.setLineDash([]);
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineWidth = 3; c.stroke();
    [a, b].forEach(p => {
      c.beginPath(); c.arc(p.x, p.y, 13, 0, 7); c.fillStyle = cor; c.fill();
      c.lineWidth = 3; c.strokeStyle = "#fff"; c.stroke();
    });
    const m = {x:(a.x+b.x)/2, y:(a.y+b.y)/2 - 22};
    const txt = this.rotulo();
    if (txt){
      c.font = "700 15px " + (getComputedStyle(document.body).getPropertyValue("--mono") || "monospace");
      const w = c.measureText(txt).width + 16;
      c.fillStyle = "rgba(10,12,16,.85)";
      c.beginPath();
      if (c.roundRect) c.roundRect(m.x - w/2, m.y - 15, w, 26, 13); else c.rect(m.x - w/2, m.y - 15, w, 26);
      c.fill();
      c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(txt, m.x, m.y - 1);
    }
    c.restore();
  }
  rotulo(){
    if (this.modo === "calibrar") return "";
    if (!S.cur.escala) return "";
    const ms = msEntre(this.pontos[0], this.pontos[1]);
    return this.modo === "fc" ? (ms ? Math.round(60000/ms) + " bpm · " + ms + " ms" : "") : ms + " ms";
  }
}
function montarVisor(sel, opts){
  const host = document.querySelector(sel);
  if (!host || !S.cur.tela) return null;
  if (S.visor) S.visor.destruir();
  S.visor = new Visor(host, S.cur.tela, opts);
  S.visor.desenhar();
  const tools = host.querySelector(".tools");
  if (tools){
    tools.querySelectorAll("[data-zoom]").forEach(b => b.onclick = () => S.visor.aproximar(+b.dataset.zoom));
    const fit = tools.querySelector("[data-fit]");
    if (fit) fit.onclick = () => { S.visor.enquadrar(); S.visor.desenhar(); };
  }
  return S.visor;
}
function visorHTML(classe, dica){
  return `<div class="visor ${classe}" id="visor">
    <div class="tools"><button type="button" data-zoom="1.6">+</button><button type="button" data-zoom="0.65">−</button><button type="button" data-fit="1">ajustar</button></div>
    <div class="zoomtag">100%</div>
    ${dica ? `<div class="hint">${dica}</div>` : ""}
  </div>`;
}
/* dois pontos iniciais, separados por um tanto de milissegundos */
function pontosPadrao(ms){
  const t = S.cur.tela, e = S.cur.escala;
  const meio = {x:t.width * .38, y:t.height * .62};
  const d = e ? (ms / MS_POR_MM) * e.pxPorMm : t.width * .12;
  const ang = e ? e.angulo : 0;
  return [meio, {x:meio.x + Math.cos(ang) * d, y:meio.y + Math.sin(ang) * d}];
}

/* ---------- telas ---------- */
const ICONE = {
  inicio:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
  biblioteca:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  ajuda:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3 2.45V14"/><path d="M12 17h.01"/></svg>'
};
function nav(){
  const itens = [["inicio","Início"],["biblioteca","Biblioteca"],["ajuda","Ajuda"]];
  return `<nav class="nav">${itens.map(([k,l]) => `<button type="button" data-aba="${k}" ${S.aba===k?'aria-current="page"':""}>${ICONE[k]}${l}</button>`).join("")}</nav>`;
}
function dataCurta(ms){
  const d = new Date(ms);
  return d.toLocaleDateString("pt-BR", {day:"2-digit", month:"2-digit"}) + " · " + d.toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"});
}
function itemLeitura(l){
  return `<button class="item" type="button" data-abrir="${l.id}">
    ${l.thumb ? `<img class="thumb" src="${l.thumb}" alt="">` : ""}
    <span class="l" style="flex:1"><strong>${l.conc}</strong><span>${l.queixa} · ${dataCurta(l.quando)}</span></span>
    <span class="tag ${l.alerta ? "bad" : "ok"}">${l.alerta ? "alerta" : "sem alerta"}</span>
  </button>`;
}
function inicio(){
  const ult = S.leituras.slice(0, 3);
  return `<div class="scroll">
    <div><div class="eyebrow">Sequência de Leitura Ativa</div><h2 style="margin-top:4px">Copiloto de ECG</h2></div>
    <button class="hero" type="button" data-ir="foto">
      <span class="eyebrow">Com o eletro na mão</span>
      <strong>Ler um eletro agora</strong>
      <span class="small" style="opacity:.8">Fotografe o traçado e passe pelas 9 etapas, medindo na própria foto.</span>
      <span class="go">Começar</span>
    </button>
    ${ult.length ? `<div class="card"><h3>Últimas leituras</h3><div class="list">${ult.map(itemLeitura).join("")}</div></div>`
      : `<div class="card"><h3>Nenhuma leitura ainda</h3><p class="muted small">A primeira leitura fica guardada aqui, junto com a foto e as medidas. Nada sai deste aparelho.</p></div>`}
    <p class="muted small">O Copiloto não lê o eletro por você. Ele guia a sequência, faz as contas e cobra o que não pode passar.</p>
  </div>${nav()}`;
}
function biblioteca(){
  return `<div class="scroll">
    <div><div class="eyebrow">Só você vê</div><h2 style="margin-top:4px">Biblioteca</h2></div>
    ${S.leituras.length ? `<div class="card"><div class="list">${S.leituras.map(itemLeitura).join("")}</div></div>`
      : `<div class="card"><p class="muted">Ainda não há leituras salvas.</p></div>`}
    <p class="muted small">As fotos ficam guardadas neste celular, no navegador. Se você limpar os dados do site, elas somem.</p>
  </div>${nav()}`;
}
function ajuda(){
  return `<div class="scroll">
    <div><div class="eyebrow">Como usar</div><h2 style="margin-top:4px">Ajuda</h2></div>
    <div class="card"><h3>A foto</h3><p class="small">Ponha o eletro numa superfície plana, com luz de lado e sem flash. Enquadre só o papel. Quanto mais perto, melhor a medida.</p><p class="small">Dá para fotografar na hora ou usar uma foto que já está no celular: são os botões <b>Câmera</b> e <b>Galeria</b>.</p></div>
    <div class="card"><h3>A calibração</h3><p class="small">Antes de medir, o app precisa saber quanto vale um quadradinho na sua foto. Você arrasta as duas bolinhas sobre cinco quadradões (1 segundo de papel) e ele aprende a escala.</p></div>
    <div class="card"><h3>O compasso</h3><p class="small">Nas etapas de frequência e de intervalos, arraste as bolinhas sobre o traçado. O app mostra a medida em milissegundos e em quadradinhos, e usa esse número para a pergunta seguinte.</p></div>
    <div class="card"><h3>O laudo</h3><p class="small">O texto final é montado com as suas medidas e as suas respostas. Confira antes de copiar. Quem lê o eletro é você.</p></div>
    <div class="card"><h3>Privacidade</h3><p class="small">A foto e as medidas ficam neste aparelho. O app não envia nada para servidor nenhum.</p></div>
  </div>${nav()}`;
}
function detalhe(){
  const l = S.detalhe;
  return `<div class="bar"><button class="back" type="button" data-ir="inicio" aria-label="Voltar">←</button><div class="t"><small>${l.queixa} · ${dataCurta(l.quando)}</small><strong>Leitura salva</strong></div></div>
  <div class="scroll">
    ${l.thumb ? `<img src="${l.thumb}" alt="Miniatura do eletro" style="width:100%;border-radius:12px;border:1px solid var(--line)">` : ""}
    <div class="laudo">${l.laudo}</div>
    <div class="row2"><button class="btn" type="button" data-copiar="1">Copiar laudo</button><button class="btn" type="button" data-apagar="${l.id}">Apagar</button></div>
  </div>`;
}

/* ---------- foto e calibração ---------- */
function telaFoto(){
  const c = S.cur;
  if (!c.tela){
    return `<div class="bar"><button class="back" type="button" data-ir="inicio" aria-label="Voltar">←</button><div class="t"><small>Nova leitura</small><strong>Foto do eletro</strong></div></div>
    <div class="scroll">
      <button class="dropzone" type="button" data-fonte="camera">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.4"/><path d="M8 6l1.4-2h5.2L16 6"/></svg>
        <strong>Fotografar o eletro</strong>
        <span class="muted small">Abre a câmera</span>
      </button>
      <button class="btn wide" type="button" data-fonte="galeria">Escolher uma foto já tirada</button>
      <div class="card"><h3>Para a medida sair certa</h3>
        <p class="small">Papel esticado numa superfície plana · luz de lado, sem flash · celular paralelo ao papel · enquadre só o eletro, o mais perto que der.</p></div>
      <p class="muted small">A foto fica neste aparelho. O app não envia imagem para lugar nenhum.</p>
    </div>`;
  }
  const q = c.foto, avisos = avisosFoto(q);
  const ruim = avisos.some(a => a.n === "bad");
  return `<div class="bar"><button class="back" type="button" data-ir="inicio" aria-label="Voltar">←</button><div class="t"><small>Nova leitura</small><strong>A foto ficou boa?</strong></div></div>
  ${visorHTML("full", "Arraste para mover, pince para aproximar.")}
  <div class="scroll">
    ${avisos.length ? avisos.map(a => `<div class="alert ${a.n}"><strong>${a.t}</strong>${a.d}</div>`).join("")
      : `<div class="alert ok"><strong>Foto boa para medir</strong>Nitidez, luz e tamanho estão dentro do esperado.</div>`}
    <div class="card">
      <div class="check"><span>Tamanho</span><span class="tag ${q.largura >= 1600 ? "ok" : q.largura >= 1100 ? "warn" : "bad"}">${q.largura} × ${q.altura}</span></div>
      <div class="check"><span>Nitidez</span><span class="tag ${q.nitidez >= 190 ? "ok" : q.nitidez >= 70 ? "warn" : "bad"}">${Math.round(q.nitidez)}</span></div>
      <div class="check"><span>Luz</span><span class="tag ${q.luz >= 62 && q.luz <= 214 ? "ok" : "warn"}">${Math.round(q.luz)}</span></div>
      <div class="check"><span>Reflexo</span><span class="tag ${q.claros > .06 ? "warn" : "ok"}">${(q.claros*100).toFixed(1)}%</span></div>
    </div>
    <p class="muted small">Os avisos são um conferidor automático, não um veredito. Se essa é a única foto possível agora, dá para seguir — mas a medida herda o defeito da imagem.</p>
  </div>
  <div class="foot">
    <button class="btn small" type="button" data-fonte="camera">Câmera</button>
    <button class="btn small" type="button" data-fonte="galeria">Galeria</button>
    <button class="btn primary" type="button" data-ir="calibrar">${ruim ? "Usar assim mesmo" : "Usar esta foto"}</button>
  </div>`;
}
function telaCalibrar(){
  const c = S.cur;
  const quadrados = c.calQuadrados || 5;
  const mm = quadrados * 5;
  let px = 0, ang = 0, pxmm = 0, precisao = 0;
  if (c.pontos.cal){
    const [a, b] = c.pontos.cal;
    px = Math.hypot(b.x - a.x, b.y - a.y);
    ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (Math.abs(ang) > Math.PI/2) ang = ang > 0 ? ang - Math.PI : ang + Math.PI;
    pxmm = px / mm;
    precisao = pxmm ? MS_POR_MM / pxmm : 0;
  }
  const bom = pxmm >= 4, aceitavel = pxmm >= 2.6;
  const inclinado = Math.abs(ang * 180 / Math.PI) > 4;
  return `<div class="bar"><button class="back" type="button" data-ir="foto" aria-label="Voltar">←</button><div class="t"><small>Nova leitura</small><strong>Calibrar a régua</strong></div></div>
  ${visorHTML("full", "Ponha cada bolinha em uma linha grossa, contando " + quadrados + " quadradão" + (quadrados > 1 ? "es" : "") + ".")}
  <div class="scroll">
    <p class="q">Diga ao app quanto vale um quadradinho nesta foto.</p>
    <div class="chips">
      <button class="chip" type="button" data-quad="5" aria-pressed="${quadrados===5}">5 quadradões · 1 s</button>
      <button class="chip" type="button" data-quad="3" aria-pressed="${quadrados===3}">3 quadradões</button>
      <button class="chip" type="button" data-quad="1" aria-pressed="${quadrados===1}">1 quadradão · 0,2 s</button>
    </div>
    <div class="card" id="cal-out">
      ${pxmm ? `<div class="readout"><span class="n">${pxmm.toFixed(1)}</span><span class="u">pixels por mm</span><span class="tag ${bom ? "ok" : aceitavel ? "warn" : "bad"}">${bom ? "boa" : aceitavel ? "no limite" : "insuficiente"}</span></div>
        <div class="kv"><span>Precisão da medida</span><span>± ${Math.max(1, Math.round(precisao))} ms por pixel</span></div>
        <div class="kv"><span>Inclinação do papel</span><span>${(ang*180/Math.PI).toFixed(1)}°</span></div>`
        : `<p class="muted">Arraste as duas bolinhas sobre a grade do papel.</p>`}
    </div>
    ${pxmm && !aceitavel ? `<div class="alert bad"><strong>A foto não dá resolução para medir</strong>Cada pixel vale ${Math.round(precisao)} ms, então o erro de um dedo na tela já muda o laudo. Tire outra foto mais perto do papel.</div>` : ""}
    ${pxmm && aceitavel && !bom ? `<div class="alert warn"><strong>Resolução no limite</strong>Dá para medir, mas chegando mais perto na próxima foto a medida fica bem mais firme.</div>` : ""}
    ${inclinado ? `<div class="alert warn"><strong>Papel torto na foto</strong>Estão ${Math.abs(ang*180/Math.PI).toFixed(0)}° fora da horizontal. O app corrige a conta, mas endireitar a foto facilita a sua leitura.</div>` : ""}
    <div class="tip">A escala vale só para esta foto. Cada eletro novo pede uma calibração nova, e ela leva dez segundos.</div>
  </div>
  <div class="foot">
    <button class="btn small" type="button" data-fonte="camera">Câmera</button>
    <button class="btn small" type="button" data-fonte="galeria">Galeria</button>
    <button class="btn primary" type="button" id="usar-cal" ${pxmm ? "" : "disabled"}>Calibrar e começar</button>
  </div>`;
}
function telaContexto(){
  const c = S.cur.ctx;
  const q = [["dor","Dor torácica"],["sincope","Síncope"],["palp","Palpitação"],["disp","Dispneia"],["rotina","Rotina"]];
  return `<div class="bar"><button class="back" type="button" data-ir="calibrar" aria-label="Voltar">←</button><div class="t"><small>Nova leitura</small><strong>Antes de começar</strong></div></div>
  <div class="scroll">
    <div class="row2">
      <div class="field"><label for="idade">Idade</label><input type="number" id="idade" inputmode="numeric" value="${c.idade === null ? "" : c.idade}" min="0" max="120" placeholder="68"></div>
      <div class="field"><label>Sexo</label><div class="seg"><button type="button" data-sexo="M" aria-pressed="${c.sexo==="M"}">M</button><button type="button" data-sexo="F" aria-pressed="${c.sexo==="F"}">F</button></div></div>
    </div>
    <div class="field"><label>Por que esse eletro foi feito?</label>
      <div class="chips">${q.map(([k,l]) => `<button class="chip" type="button" data-queixa="${k}" aria-pressed="${c.queixa===k}" ${k!=="sincope"?"disabled":""}>${l}</button>`).join("")}</div>
      <p class="muted small">Nesta versão, só a síncope está montada. As outras queixas entram depois da revisão do Dr. Vitor.</p>
    </div>
    <div class="tip">A queixa muda a leitura: cada uma tem uma lista do que <b>não pode passar</b>, e o app cobra esses pontos nas etapas certas.</div>
  </div>
  <div class="foot"><button class="btn primary" type="button" data-ir="seq">Começar a leitura</button></div>`;
}

/* ---------- etapas ---------- */
function opt(chave, valor, rotulo, multi){
  const atual = S.cur.ans[chave];
  const on = multi ? (atual || []).includes(valor) : atual === valor;
  return `<button type="button" class="opt${multi ? " multi" : ""}" data-ans="${chave}" data-val="${valor}" data-multi="${multi ? 1 : 0}" aria-pressed="${on}">${rotulo}</button>`;
}
const ETAPAS = [
  // 0 contexto
  () => ({modo:"livre", corpo:`
    <p class="q">${S.cur.ctx.idade ? S.cur.ctx.sexo === "F" ? "Mulher, " + S.cur.ctx.idade + " anos" : "Homem, " + S.cur.ctx.idade + " anos" : "Paciente"}, síncope.</p>
    <div class="card"><h3>O que não pode passar na síncope</h3>
      <div class="list">
        <div class="item"><div class="l"><strong>Bloqueio AV avançado</strong><span>2º grau tipo II ou BAV total</span></div></div>
        <div class="item"><div class="l"><strong>QT longo</strong><span>Risco de torsades</span></div></div>
        <div class="item"><div class="l"><strong>Pré-excitação</strong><span>PR curto com onda delta</span></div></div>
        <div class="item"><div class="l"><strong>Padrão de Brugada</strong><span>Supra de ST em V1 e V2</span></div></div>
        <div class="item"><div class="l"><strong>Bloqueio bifascicular</strong><span>Ramo direito ou esquerdo com bloqueio divisional</span></div></div>
        <div class="item"><div class="l"><strong>Bradicardia importante</strong><span>Frequência muito baixa ou pausas</span></div></div>
      </div>
    </div>
    <div class="tip">Você não precisa decorar a lista. Cada item volta na etapa em que ele é checado.</div>`, ok:() => true}),
  // 1 exame
  () => ({modo:"livre", corpo:`
    <p class="q">Antes de ler, confira se dá para confiar no traçado.</p>
    <div class="opts">
      ${opt("exame","cal","Calibração de 10 mm/mV e 25 mm/s", true)}
      ${opt("exame","doze","As 12 derivações e o D2 longo estão lá", true)}
      ${opt("exame","ruido","Sem tremor ou ruído que atrapalhe", true)}
      ${opt("exame","avr","aVR predominantemente negativo", true)}
    </div>
    <div class="tip"><b>Por que importa:</b> eletrodo dos braços trocado deixa D1 negativo e aVR positivo, e simula desvio de eixo e até infarto.</div>`,
    ok:() => (S.cur.ans.exame || []).length === 4}),
  // 2 ritmo
  () => ({modo:"livre", corpo:`
    <p class="q">No D2 longo: tem onda P antes de todo QRS, positiva em D2?</p>
    <div class="opts">${opt("ritmo","sinusal","Sim, ritmo sinusal")}${opt("ritmo","nao","Não")}${opt("ritmo","duvida","Não tenho certeza")}</div>
    ${S.cur.ans.ritmo === "duvida" ? `<div class="tip">Procure a mesma ondinha arredondada logo antes de cada QRS. Se ela está lá, sempre com o mesmo formato e positiva em D2, o ritmo é sinusal.</div>` : ""}
    ${S.cur.ans.ritmo === "nao" ? `<div class="alert warn"><strong>Ritmo não sinusal</strong>Na etapa de regularidade, vamos separar se é fibrilação atrial, flutter ou ritmo juncional.</div>` : ""}`,
    ok:() => S.cur.ans.ritmo && S.cur.ans.ritmo !== "duvida"}),
  // 3 frequência
  () => ({modo:"fc", pontos:"fc", corpo:`
    <p class="q">Ponha uma bolinha em cada pico de QRS, em dois batimentos seguidos.</p>
    <div id="fc-out" class="card"></div>
    <div class="tip">Se o aparelho imprimiu a frequência, compare com a sua medida. Se as duas não batem, confira onde as bolinhas estão antes de seguir.</div>`,
    montar:() => {
      const sair = () => {
        const p = S.cur.pontos.fc, ms = msEntre(p[0], p[1]), f = ms ? Math.round(60000/ms) : 0;
        const alvo = document.getElementById("fc-out");
        if (!alvo) return;
        alvo.innerHTML = `<div class="readout"><span class="n">${f || "—"}</span><span class="u">bpm</span></div>
          <div class="kv"><span>RR medido</span><span>${ms} ms · ${quadr(ms)} quadr.</span></div>
          <button class="btn" type="button" id="usar-fc" ${ms ? "" : "disabled"}>Usar ${f} bpm</button>`;
        const b = document.getElementById("usar-fc");
        if (b) b.onclick = () => { S.cur.meas.rr = ms; desenhar(); };
      };
      const v = montarVisor("#visor", {modo:"fc", pontos:S.cur.pontos.fc, aoMudar:sair});
      if (v) sair();
    },
    depois:() => S.cur.meas.rr ? `<div class="alert ${fc() < 40 ? "bad" : fc() < 60 ? "warn" : "ok"}"><strong>FC ${fc()} bpm registrada</strong>${fc() < 40 ? "Bradicardia importante: item da lista de síncope." : "Sem bradicardia importante."}</div>` : "",
    ok:() => !!S.cur.meas.rr}),
  // 4 regularidade
  () => ({modo:"livre", corpo:`
    <p class="q">Os intervalos entre um QRS e outro são iguais ao longo do D2 longo?</p>
    <div class="opts">${opt("reg","regular","Sim, regular")}${opt("reg","irregular","Não, irregular")}</div>
    <div class="tip">Truque do compasso: guarde a distância medida na etapa anterior e leve para o próximo par de QRS. Se couber igual, é regular.</div>`,
    ok:() => !!S.cur.ans.reg}),
  // 5 eixo
  () => ({modo:"livre", corpo:`
    <p class="q">Em D1 e em aVF: o QRS vai mais para cima ou mais para baixo?</p>
    <div class="card">
      <div class="field"><label for="d1">Saldo do QRS em D1 (R menos S, em quadradinhos) · <b id="d1v"></b></label><input type="range" id="d1" min="-10" max="10" step="1" value="${S.cur.axis.d1}"></div>
      <div class="field"><label for="avf">Saldo do QRS em aVF · <b id="avfv"></b></label><input type="range" id="avf" min="-10" max="10" step="1" value="${S.cur.axis.avf}"></div>
    </div>
    <div class="card" id="axis-out"></div>
    <div id="axis-follow"></div>`,
    montar:() => {
      const upd = () => {
        const a = S.cur.axis;
        a.d1 = +document.getElementById("d1").value; a.avf = +document.getElementById("avf").value;
        document.getElementById("d1v").textContent = (a.d1 > 0 ? "+" : "") + a.d1;
        document.getElementById("avfv").textContent = (a.avf > 0 ? "+" : "") + a.avf;
        a.ang = (a.d1 || a.avf) ? Math.round(Math.atan2(a.avf, a.d1) * 180 / Math.PI) : null;
        const cls = classeEixo(a.ang);
        const r = 44, cx = 54, cy = 54, rad = x => x * Math.PI / 180;
        const arco = `M${cx} ${cy}L${cx + r*Math.cos(rad(-30))} ${cy + r*Math.sin(rad(-30))}A${r} ${r} 0 0 1 ${cx + r*Math.cos(rad(90))} ${cy + r*Math.sin(rad(90))}Z`;
        const seta = a.ang === null ? "" : `<line x1="${cx}" y1="${cy}" x2="${cx + (r-5)*Math.cos(rad(a.ang))}" y2="${cy + (r-5)*Math.sin(rad(a.ang))}" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round"/>`;
        document.getElementById("axis-out").innerHTML = `<div class="wheel"><svg viewBox="0 0 108 108" aria-hidden="true"><circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--app)" stroke="var(--line-strong)"/><path d="${arco}" fill="var(--ok)" opacity=".18"/><line x1="${cx-r}" y1="${cy}" x2="${cx+r}" y2="${cy}" stroke="var(--line-strong)"/><line x1="${cx}" y1="${cy-r}" x2="${cx}" y2="${cy+r}" stroke="var(--line-strong)"/>${seta}<circle cx="${cx}" cy="${cy}" r="3" fill="var(--ink)"/></svg>
          <div style="display:flex;flex-direction:column;gap:6px">${a.ang === null ? `<p class="muted">Mova os controles com o que você vê no traçado.</p>` : `<div class="readout"><span class="n">${a.ang > 0 ? "+" : ""}${a.ang}°</span></div><span class="tag ${cls.k}" style="align-self:flex-start">${cls.t}</span>`}</div></div>`;
        const f = document.getElementById("axis-follow");
        if (a.ang !== null && a.ang < -45 && a.ang >= -90){
          f.innerHTML = `<div class="card"><p class="q" style="font-size:.98rem">Eixo além de −45°. Tem qR em aVL e rS em D2, D3 e aVF?</p><div class="opts">${opt("bdas","sim","Sim")}${opt("bdas","nao","Não")}</div>${S.cur.ans.bdas === "sim" ? `<div class="alert warn"><strong>Bloqueio divisional anterossuperior esquerdo</strong>Guarde isso: com bloqueio de ramo direito junto, vira bloqueio bifascicular.</div>` : ""}</div>`;
          ligarOpts(f);
        } else { f.innerHTML = ""; if (S.cur.ans.bdas) delete S.cur.ans.bdas; }
        sincronizarProxima();
      };
      montarVisor("#visor", {modo:"livre"});
      document.getElementById("d1").oninput = upd;
      document.getElementById("avf").oninput = upd;
      upd();
    },
    ok:() => S.cur.axis.ang !== null && (!(S.cur.axis.ang < -45 && S.cur.axis.ang >= -90) || !!S.cur.ans.bdas)}),
  // 6 ondas
  () => ({modo:"livre", corpo:`
    <p class="q">Olhando V1, D1 e V6, o que você encontra?</p>
    <div class="opts">
      ${opt("ondas","rsr","rSR' em V1 (orelha de coelho)", true)}
      ${opt("ondas","slargo","S largo e empastado em D1 e V6", true)}
      ${opt("ondas","delta","Onda delta: subida lenta no começo do QRS", true)}
      ${opt("ondas","nada","Nada disso", true)}
    </div>
    ${brd() ? `<div class="alert warn"><strong>Padrão de bloqueio de ramo direito</strong>Confirme a largura do QRS na etapa de intervalos.</div>` : ""}
    ${(S.cur.ans.ondas || []).includes("delta") ? `<div class="alert bad"><strong>Onda delta: pré-excitação</strong>Item da lista de síncope. Confira o PR curto na etapa de intervalos.</div>` : ""}`,
    ok:() => (S.cur.ans.ondas || []).length > 0}),
  // 7 intervalos
  () => {
    const m = S.cur.meas, sel = S.cur.intSel;
    const st = k => m[k.toLowerCase()] ? `<span class="tag ok">${m[k.toLowerCase()]} ms</span>` : `<span class="tag">pendente</span>`;
    return {modo:"int", pontos:sel, corpo:`
    <div class="chips">${["PR","QRS","QT"].map(k => `<button class="chip" type="button" data-int="${k}" aria-pressed="${sel===k}">${k} ${m[k.toLowerCase()] ? "✓" : ""}</button>`).join("")}</div>
    <p class="q" id="int-q"></p>
    <div class="card" id="int-out"></div>
    <div class="card"><div class="check"><span>PR</span>${st("PR")}</div><div class="check"><span>QRS</span>${st("QRS")}</div><div class="check"><span>QT</span>${st("QT")}</div>
      ${m.qt ? `<div class="check"><span>QTc (Bazett, FC ${m.rr ? fc() : 60})</span><span class="tag ${qtc() > limiteQT() ? "bad" : "ok"}">${qtc()} ms</span></div>` : ""}
    </div>
    ${m.pr && m.pr > 200 ? `<div class="card"><p class="q" style="font-size:.98rem">PR acima de 200 ms. Toda onda P é seguida de QRS, sempre com o mesmo PR?</p><div class="opts">${opt("prf","sim","Sim, todos iguais")}${opt("prf","nao","Não, tem P sem QRS ou o PR muda")}</div>
      ${S.cur.ans.prf === "sim" ? `<div class="alert warn"><strong>BAV de 1º grau</strong>Todos os estímulos chegam, só que atrasados.</div>` : ""}
      ${S.cur.ans.prf === "nao" ? `<div class="alert bad"><strong>Pense em BAV de 2º grau ou avançado</strong>Item da lista de síncope. Procure P bloqueada no D2 longo.</div>` : ""}</div>` : ""}
    ${m.pr && m.pr < 120 ? `<div class="alert bad"><strong>PR curto</strong>Procure onda delta: pré-excitação está na lista de síncope.</div>` : ""}
    ${m.qrs && m.qrs >= 120 ? `<div class="alert warn"><strong>QRS largo (${m.qrs} ms)</strong>Isso muda como ler o ST. O app lembra na etapa de segmentos.</div>` : ""}`,
    montar:() => {
      const k = S.cur.intSel;
      const textos = {PR:"Do começo da onda P ao começo do QRS.", QRS:"Do começo ao fim do QRS.", QT:"Do começo do QRS ao fim da onda T."};
      const refs = {PR:"Normal: 120 a 200 ms (3 a 5 quadradinhos).", QRS:"Largo a partir de 120 ms (3 quadradinhos).", QT:"O app corrige pela frequência (Bazett)."};
      const q = document.getElementById("int-q");
      if (q) q.textContent = "Meça o " + k + ". " + textos[k];
      const sair = () => {
        const p = S.cur.pontos[k], ms = msEntre(p[0], p[1]);
        let tag = "";
        if (k === "PR") tag = ms < 120 ? `<span class="tag warn">curto</span>` : ms <= 200 ? `<span class="tag ok">normal</span>` : `<span class="tag bad">longo</span>`;
        if (k === "QRS") tag = ms < 120 ? `<span class="tag ok">estreito</span>` : `<span class="tag bad">largo</span>`;
        const alvo = document.getElementById("int-out");
        if (!alvo) return;
        alvo.innerHTML = `<div class="readout"><span class="n">${ms}</span><span class="u">ms · ${quadr(ms)} quadr.</span>${tag}</div>
          <p class="muted small">${refs[k]}</p>
          <button class="btn" type="button" id="salvar-int" ${ms ? "" : "disabled"}>Salvar ${k} = ${ms} ms</button>`;
        const b = document.getElementById("salvar-int");
        if (b) b.onclick = () => {
          S.cur.meas[k.toLowerCase()] = ms;
          const prox = ["PR","QRS","QT"].find(x => !S.cur.meas[x.toLowerCase()]);
          if (prox) S.cur.intSel = prox;
          desenhar();
        };
      };
      const v = montarVisor("#visor", {modo:"int", pontos:S.cur.pontos[k], aoMudar:sair});
      if (v) sair();
    },
    ok:() => m.pr && m.qrs && m.qt && (!(m.pr > 200) || !!S.cur.ans.prf)};
  },
  // 8 segmentos
  () => ({modo:"livre", corpo:`
    ${largo() ? `<div class="alert warn"><strong>Lembrete da etapa de intervalos</strong>O QRS é largo${brd() ? ", com padrão de bloqueio de ramo direito" : ""}. Alteração de ST e T em V1 e V2 pode ser do próprio bloqueio. Procure o que foge desse padrão.</div>` : ""}
    <p class="q">Tem supra ou infra de ST fora do esperado?</p>
    <div class="opts">${opt("st","nao","Não")}${opt("st","sim","Sim")}</div>
    ${S.cur.ans.st === "sim" ? `<div class="alert bad"><strong>Alteração de ST</strong>Registre as derivações e compare com um eletro anterior.</div>` : ""}
    <p class="q" style="margin-top:6px">Em V1 e V2: supra de ST em cúpula, descendo para uma T negativa?</p>
    <div class="opts">${opt("brugada","nao","Não")}${opt("brugada","sim","Sim")}</div>
    ${S.cur.ans.brugada === "sim" ? `<div class="alert bad"><strong>Padrão sugestivo de Brugada</strong>Item da lista de síncope.</div>` : ""}`,
    ok:() => !!S.cur.ans.st && !!S.cur.ans.brugada})
];

function telaSeq(){
  const i = S.cur.passo, v = ETAPAS[i]();
  if ((v.modo === "fc" || v.modo === "int") && v.pontos){
    const chave = v.modo === "fc" ? "fc" : S.cur.intSel;
    if (!S.cur.pontos[chave]) S.cur.pontos[chave] = pontosPadrao(v.modo === "fc" ? 800 : 160);
  }
  const prog = PASSOS.map((_, k) => `<i class="${k < i ? "done" : k === i ? "now" : ""}"></i>`).join("");
  return `<div class="bar"><button class="back" type="button" data-voltar="1" aria-label="Voltar">←</button><div class="t"><small>Etapa ${i+1} de 9 · síncope</small><strong>${PASSOS[i]}</strong></div><button class="btn small ghost" type="button" data-ir="inicio">Sair</button></div>
  <div class="prog">${prog}</div>
  ${visorHTML("seq", ONDE[i])}
  <div class="scroll" id="seq-scroll">
    ${v.corpo}
    ${v.depois ? v.depois() : ""}
  </div>
  <div class="foot"><button class="btn primary" type="button" id="proxima" ${v.ok() ? "" : "disabled"}>${i === 8 ? "Ver resumo e laudo" : "Próxima etapa"}</button></div>`;
}

/* ---------- laudo ---------- */
function checagens(){
  const m = S.cur.meas, a = S.cur.ans, q = qtc(), f = [];
  f.push(["Bloqueio AV avançado", a.prf === "nao" ? ["bad","suspeita"] : ["ok","não visto"]]);
  f.push(["QT longo", q === null ? ["", "sem medida"] : q > limiteQT() ? ["bad", q + " ms"] : ["ok", q + " ms"]]);
  f.push(["Pré-excitação", (m.pr && m.pr < 120) || (a.ondas || []).includes("delta") ? ["bad","suspeita"] : ["ok","não visto"]]);
  f.push(["Padrão de Brugada", a.brugada === "sim" ? ["bad","suspeita"] : ["ok","não visto"]]);
  f.push(["Bloqueio bifascicular", brd() && largo() && bdas() ? ["bad","presente"] : ["ok","não visto"]]);
  f.push(["Bradicardia importante", fc() === null ? ["","sem medida"] : fc() < 40 ? ["bad", fc() + " bpm"] : ["ok", fc() + " bpm"]]);
  return f;
}
function textoLaudo(){
  const m = S.cur.meas, a = S.cur.ans, c = [], linhas = [];
  const id = S.cur.ctx.idade ? (S.cur.ctx.sexo === "F" ? "Mulher" : "Homem") + ", " + S.cur.ctx.idade + " anos. Síncope." : "Síncope.";
  linhas.push(id);
  linhas.push((a.ritmo === "sinusal" ? "Ritmo sinusal" : "Ritmo não sinusal") + (a.reg ? (a.reg === "regular" ? ", regular" : ", irregular") : "") + (m.rr ? `, FC ${fc()} bpm.` : "."));
  if (S.cur.axis.ang !== null){ const cls = classeEixo(S.cur.axis.ang); linhas.push(`Eixo elétrico ${cls.t === "normal" ? "normal" : "com " + cls.t} (${S.cur.axis.ang > 0 ? "+" : ""}${S.cur.axis.ang}°).`); }
  if (m.pr){ let t = `PR ${m.pr} ms`; if (m.pr > 200 && a.prf === "sim"){ t += " (BAV de 1º grau)"; c.push("BAV de 1º grau"); } if (m.pr > 200 && a.prf === "nao"){ t += " (investigar BAV de 2º grau)"; c.push("suspeita de BAV de 2º grau"); } if (m.pr < 120) t += " (PR curto)"; linhas.push(t + "."); }
  if (m.qrs){ let t = `QRS ${m.qrs} ms`; if (largo() && brd()) t += ", com padrão de bloqueio de ramo direito"; else if (largo()) t += ", alargado"; linhas.push(t + "."); }
  if (bdas()) linhas.push("Padrão de bloqueio divisional anterossuperior esquerdo.");
  if (m.qt) linhas.push(`QT ${m.qt} ms, QTc ${qtc()} ms (Bazett)${largo() ? ", interpretado com cautela pelo QRS largo" : ""}.`);
  if (a.st) linhas.push(a.st === "nao" ? `Sem alteração de ST além do esperado${largo() ? " para o bloqueio" : ""}.` : "Alteração de ST a esclarecer.");
  if (a.brugada === "sim"){ linhas.push("Padrão sugestivo de Brugada em V1 e V2."); c.push("padrão sugestivo de Brugada"); }
  if (largo() && brd() && bdas()) c.push("bloqueio bifascicular (BRD + BDAS)");
  else { if (largo() && brd()) c.push("bloqueio de ramo direito"); if (bdas()) c.push("BDAS"); }
  if ((m.pr && m.pr < 120) || (a.ondas || []).includes("delta")) c.push("suspeita de pré-excitação");
  if (qtc() && qtc() > limiteQT()) c.push("QTc prolongado");
  linhas.push("");
  linhas.push("Conclusão: " + (c.length ? c.join(" + ") : "sem alterações relevantes") + ".");
  return linhas.join("\n");
}
function telaLaudo(){
  const f = checagens(), alertas = f.filter(x => x[1][0] === "bad");
  return `<div class="bar"><button class="back" type="button" data-voltar="1" aria-label="Voltar">←</button><div class="t"><small>Leitura concluída · síncope</small><strong>Resumo e laudo</strong></div></div>
  <div class="scroll">
    ${alertas.length ? `<div class="alert bad"><strong>${alertas.length === 1 ? "1 achado" : alertas.length + " achados"} da lista de síncope</strong>${alertas.map(x => x[0]).join(", ")}.</div>`
      : `<div class="alert ok"><strong>Nada da lista de síncope</strong>Todos os itens foram checados.</div>`}
    <div class="card"><h3>Não pode passar · síncope</h3><div>${f.map(([l,[k,t]]) => `<div class="check"><span>${l}</span><span class="tag ${k}">${t}</span></div>`).join("")}</div></div>
    <div><div class="eyebrow" style="margin-bottom:6px">Laudo montado com as suas medidas e respostas</div><div class="laudo" id="laudo">${textoLaudo()}</div></div>
    <div class="row2"><button class="btn" type="button" data-copiar="1">Copiar laudo</button><button class="btn" type="button" id="salvar">${S.cur.salva ? "Salvo ✓" : "Salvar"}</button></div>
    <div class="card"><h3>Ficou com dúvida?</h3><p class="muted small">Copie o laudo e leve para o PreceptorIA, ou para discutir o caso no Clube do Plantonista.</p></div>
    <p class="muted small">Quem leu foi você. O Copiloto garantiu que nenhuma etapa ficou para trás e fez as contas.</p>
  </div>
  <div class="foot"><button class="btn primary" type="button" data-ir="inicio">Nova leitura</button></div>`;
}

/* ---------- render ---------- */
function aviso(msg){
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  app.appendChild(t);
  setTimeout(() => t.remove(), 1700);
}
function ligarOpts(raiz){
  raiz.querySelectorAll("[data-ans]").forEach(b => b.onclick = () => {
    const k = b.dataset.ans, v = b.dataset.val;
    if (b.dataset.multi === "1"){
      let arr = (S.cur.ans[k] || []).slice();
      if (v === "nada") arr = arr.includes("nada") ? [] : ["nada"];
      else { arr = arr.filter(x => x !== "nada"); arr = arr.includes(v) ? arr.filter(x => x !== v) : arr.concat(v); }
      S.cur.ans[k] = arr;
    } else S.cur.ans[k] = v;
    const sc = document.getElementById("seq-scroll"), topo = sc ? sc.scrollTop : 0;
    desenhar();
    const sc2 = document.getElementById("seq-scroll");
    if (sc2) sc2.scrollTop = topo;
  });
}
function sincronizarProxima(){
  const b = document.getElementById("proxima");
  if (b && S.tela === "seq") b.disabled = !ETAPAS[S.cur.passo]().ok();
}
function miniatura(){
  try {
    const t = S.cur.tela, c = document.createElement("canvas");
    const k = Math.min(1, 220 / t.width);
    c.width = Math.round(t.width * k); c.height = Math.round(t.height * k);
    c.getContext("2d").drawImage(t, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", .6);
  } catch(_){ return null; }
}
function salvarLeitura(){
  const laudo = textoLaudo();
  const conc = (laudo.split("Conclusão: ")[1] || "sem conclusão").replace(/\.$/, "");
  const reg = { id:S.cur.id, quando:S.cur.quando, queixa:"Síncope",
    conc:conc.charAt(0).toUpperCase() + conc.slice(1),
    alerta:checagens().some(x => x[1][0] === "bad"),
    laudo, thumb:miniatura(), meas:S.cur.meas };
  S.leituras = [reg].concat(S.leituras.filter(l => l.id !== reg.id));
  gravarLeituras(S.leituras);
  if (S.cur.blob) guardarFoto(S.cur.id, S.cur.blob);
  S.cur.salva = true;
  aviso("Salvo neste aparelho");
  desenhar();
}
function irPara(t){
  if (t === "foto" && (S.tela === "inicio" || S.tela === "biblioteca" || S.tela === "ajuda")) S.cur = nova();
  if (t === "inicio"){ S.aba = "inicio"; if (S.visor){ S.visor.destruir(); S.visor = null; } }
  S.tela = t;
  desenhar();
}
function desenhar(){
  let html;
  if (S.tela === "inicio") html = S.aba === "biblioteca" ? biblioteca() : S.aba === "ajuda" ? ajuda() : inicio();
  else if (S.tela === "foto") html = telaFoto();
  else if (S.tela === "calibrar") html = telaCalibrar();
  else if (S.tela === "contexto") html = telaContexto();
  else if (S.tela === "seq") html = telaSeq();
  else if (S.tela === "detalhe") html = detalhe();
  else html = telaLaudo();
  app.innerHTML = html;

  app.querySelectorAll("[data-aba]").forEach(b => b.onclick = () => { S.tela = "inicio"; S.aba = b.dataset.aba; desenhar(); });
  app.querySelectorAll("[data-ir]").forEach(b => b.onclick = () => irPara(b.dataset.ir));
  app.querySelectorAll("[data-sexo]").forEach(b => b.onclick = () => { S.cur.ctx.sexo = b.dataset.sexo; desenhar(); });
  app.querySelectorAll("[data-queixa]").forEach(b => b.onclick = () => { S.cur.ctx.queixa = b.dataset.queixa; desenhar(); });
  app.querySelectorAll("[data-int]").forEach(b => b.onclick = () => { S.cur.intSel = b.dataset.int; desenhar(); });
  app.querySelectorAll("[data-quad]").forEach(b => b.onclick = () => { S.cur.calQuadrados = +b.dataset.quad; desenhar(); });
  app.querySelectorAll("[data-voltar]").forEach(b => b.onclick = () => {
    if (S.tela === "laudo"){ S.tela = "seq"; S.cur.passo = 8; }
    else if (S.cur.passo > 0) S.cur.passo--;
    else S.tela = "contexto";
    desenhar();
  });
  app.querySelectorAll("[data-abrir]").forEach(b => b.onclick = () => {
    S.detalhe = S.leituras.find(l => l.id === b.dataset.abrir);
    if (S.detalhe){ S.tela = "detalhe"; desenhar(); }
  });
  app.querySelectorAll("[data-copiar]").forEach(b => b.onclick = () => {
    const txt = S.tela === "detalhe" ? S.detalhe.laudo : textoLaudo();
    try { navigator.clipboard.writeText(txt).then(() => aviso("Laudo copiado"), () => aviso("Não deu para copiar aqui")); }
    catch(_){ aviso("Não deu para copiar aqui"); }
  });
  app.querySelectorAll("[data-apagar]").forEach(b => b.onclick = () => {
    const id = b.dataset.apagar;
    S.leituras = S.leituras.filter(l => l.id !== id);
    gravarLeituras(S.leituras);
    apagarFoto(id);
    S.tela = "inicio"; S.aba = "biblioteca";
    aviso("Leitura apagada");
    desenhar();
  });
  const idade = document.getElementById("idade");
  if (idade) idade.oninput = () => { S.cur.ctx.idade = idade.value === "" ? null : +idade.value; };
  app.querySelectorAll("[data-fonte]").forEach(b => b.onclick = () => pedirFoto(b.dataset.fonte));
  ligarOpts(app);

  if (S.tela === "foto" && S.cur.tela) montarVisor("#visor", {modo:"livre"});
  if (S.tela === "calibrar"){
    if (!S.cur.pontos.cal){
      const t = S.cur.tela;
      S.cur.pontos.cal = [{x:t.width*.35, y:t.height*.6}, {x:t.width*.5, y:t.height*.6}];
    }
    const recalcular = () => {
      const q = S.cur.calQuadrados || 5, mm = q * 5;
      const [a, b] = S.cur.pontos.cal;
      const px = Math.hypot(b.x - a.x, b.y - a.y);
      let ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (Math.abs(ang) > Math.PI/2) ang = ang > 0 ? ang - Math.PI : ang + Math.PI;
      S.cur.previa = {pxmm:px/mm, ang};
      const alvo = document.getElementById("cal-out");
      if (!alvo) return;
      const pxmm = px / mm, precisao = pxmm ? MS_POR_MM / pxmm : 0;
      const bom = pxmm >= 4, aceitavel = pxmm >= 2.6;
      alvo.innerHTML = `<div class="readout"><span class="n">${pxmm.toFixed(1)}</span><span class="u">pixels por mm</span><span class="tag ${bom ? "ok" : aceitavel ? "warn" : "bad"}">${bom ? "boa" : aceitavel ? "no limite" : "insuficiente"}</span></div>
        <div class="kv"><span>Precisão da medida</span><span>± ${Math.max(1, Math.round(precisao))} ms por pixel</span></div>
        <div class="kv"><span>Inclinação do papel</span><span>${(ang*180/Math.PI).toFixed(1)}°</span></div>`;
      const usar = document.getElementById("usar-cal");
      if (usar) usar.disabled = !px;
    };
    montarVisor("#visor", {modo:"calibrar", pontos:S.cur.pontos.cal, aoMudar:recalcular});
    recalcular();
    const usar = document.getElementById("usar-cal");
    if (usar) usar.onclick = () => {
      const q = S.cur.calQuadrados || 5, mm = q * 5;
      const [a, b] = S.cur.pontos.cal;
      const px = Math.hypot(b.x - a.x, b.y - a.y);
      let ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (Math.abs(ang) > Math.PI/2) ang = ang > 0 ? ang - Math.PI : ang + Math.PI;
      if (!px) return;
      S.cur.escala = {pxPorMm:px/mm, angulo:ang};
      S.cur.pontos.fc = null; S.cur.pontos.PR = null; S.cur.pontos.QRS = null; S.cur.pontos.QT = null;
      irPara("contexto");
    };
  }
  if (S.tela === "seq"){
    const v = ETAPAS[S.cur.passo]();
    if (v.montar) v.montar();
    else montarVisor("#visor", {modo:"livre"});
    const b = document.getElementById("proxima");
    if (b) b.onclick = () => {
      if (S.cur.passo < 8){ S.cur.passo++; desenhar(); const sc = document.getElementById("seq-scroll"); if (sc) sc.scrollTop = 0; }
      else { S.tela = "laudo"; if (S.visor){ S.visor.destruir(); S.visor = null; } desenhar(); }
    };
  }
  if (S.tela === "laudo"){
    const s = document.getElementById("salvar");
    if (s) s.onclick = () => { if (!S.cur.salva) salvarLeitura(); };
  }
}

/* ---------- entrada da foto ---------- */
inputArquivo.addEventListener("change", async () => {
  const f = inputArquivo.files && inputArquivo.files[0];
  inputArquivo.value = "";
  if (!f) return;
  aviso("Preparando a foto…");
  try {
    const tela = await prepararFoto(f);
    S.cur.tela = tela;
    S.cur.foto = analisarQualidade(tela);
    S.cur.escala = null; S.cur.pontos = {cal:null, fc:null, PR:null, QRS:null, QT:null};
    S.vista = null;
    tela.toBlob(b => { S.cur.blob = b; }, "image/jpeg", .88);
    S.tela = "foto";
    if (S.visor){ S.visor.destruir(); S.visor = null; }
    desenhar();
  } catch(_){
    aviso("Não consegui abrir essa imagem");
  }
});

desenhar();
})();
