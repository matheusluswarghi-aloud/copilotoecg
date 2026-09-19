"use strict";
/* Copiloto de ECG — versão 2
   O roteiro das etapas segue o documento do Dr. Vitor ("Ferramenta ECG - Protótipo", 18/09/2026).
   Tudo roda no aparelho: a foto do eletro nunca sai do celular.
   Fotos ficam no IndexedDB, leituras no localStorage. */
(function(){

const app = document.getElementById("app");
const inputArquivo = document.getElementById("arquivo");
const MS_POR_MM = 40; // papel a 25 mm/s

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
async function apagarFoto(id){
  try { const b = await db(); await new Promise(ok => { const t = b.transaction(LOJA, "readwrite"); t.objectStore(LOJA).delete(id); t.oncomplete = ok; t.onerror = ok; }); } catch(_){}
}
function lerLeituras(){ try { return JSON.parse(localStorage.getItem(CHAVE) || "[]"); } catch(_){ return []; } }
function gravarLeituras(l){ try { localStorage.setItem(CHAVE, JSON.stringify(l)); } catch(_){} }

/* ---------- estado ---------- */
function nova(){
  return { id:"L" + Date.now(), quando:Date.now(), motivo:null,
    tela:null, foto:null, blob:null, escala:null, calQuadrados:5,
    pontos:{cal:null, fc:null, qrs:null},
    passo:2, r:{}, salva:false };
}
const S = { tela:"inicio", aba:"inicio", cur:nova(), leituras:lerLeituras(), visor:null, vista:null, detalhe:null, aberto:{}, medir:null };

/* ---------- o conteúdo do Dr. Vitor ---------- */
const MOTIVOS = [
  { k:"dor", nome:"Dor torácica", texto:[
    "Em um paciente com dor torácica, uma das principais condições que não podemos deixar passar é isquemia miocárdica aguda.",
    "Durante sua leitura, procure ativamente alterações de ST e onda T, avalie sua distribuição em derivações contíguas e lembre-se de que nem todo quadro de oclusão coronariana se apresenta com o supra de ST clássico.",
    "Não procure tudo de uma vez. Siga a sequência. Vamos voltar a esses pontos no momento certo."]},
  { k:"palp", nome:"Palpitação / taquicardia", texto:[
    "Diante de palpitações ou taquicardia, primeiro queremos entender como esse coração está sendo ativado.",
    "Durante a leitura, três informações serão especialmente importantes: presença de onda P, largura do QRS e regularidade do ritmo.",
    "Essas respostas vão organizar o raciocínio sobre a taquiarritmia. Siga a sequência."]},
  { k:"bradi", nome:"Bradicardia", texto:[
    "Diante de bradicardia, não basta saber que a frequência está baixa.",
    "Precisamos entender de onde vem o ritmo e como o estímulo atrial está sendo conduzido aos ventrículos.",
    "Durante a leitura, tenha atenção especial às ondas P, relação P-QRS e intervalo PR. Siga a sequência."]},
  { k:"sincope", nome:"Síncope / pré-síncope", texto:[
    "Diante de síncope, o ECG pode trazer pistas importantes de uma causa arrítmica.",
    "Durante a leitura, tenha atenção especial à frequência, ritmo, distúrbios de condução, intervalo QT e outros padrões associados a risco arrítmico.",
    "Não procure tudo de uma vez. Siga a sequência."]},
  { k:"disp", nome:"Dispneia", texto:[
    "Na dispneia, o ECG raramente deve ser interpretado isoladamente.",
    "Ele pode trazer pistas de isquemia, arritmias, sobrecarga das câmaras cardíacas, bloqueio de ramo, além de alterações que, dentro do contexto adequado, podem contribuir para determinadas hipóteses, como no caso de TEP.",
    "Siga a sequência e depois integre os achados ao quadro clínico."]},
  { k:"metab", nome:"Alteração eletrolítica / metabólica", texto:[
    "Alterações metabólicas podem modificar diferentes componentes do ECG.",
    "Durante a leitura, observe especialmente ondas T, duração do QRS, intervalo QT e onda U, sempre interpretando o traçado junto aos dados laboratoriais e ao contexto clínico.",
    "Siga a sequência."]},
  { k:"rotina", nome:"Assintomático / rotina", texto:[
    "Mesmo sem uma queixa aguda, todo ECG merece uma leitura sistemática.",
    "O objetivo aqui é reconhecer o ritmo, avaliar condução, eixo, intervalos, QRS e repolarização, identificando alterações que mereçam correlação clínica.",
    "Siga a sequência completa."]},
  { k:"outro", nome:"Outro motivo", texto:[
    "Quando não há uma das queixas anteriores, mantenha uma leitura sistemática e evite tentar encaixar o ECG precocemente em um diagnóstico.",
    "Siga uma sequência clara de análise. Ao final, volte ao paciente e integre os achados ao contexto clínico."]}
];
const motivo = () => MOTIVOS.find(m => m.k === S.cur.motivo);
const PASSOS = {2:"Técnica de realização", 3:"Ritmo", 4:"Regularidade e frequência", 5:"Eixo", 6:"Descarte de arritmias", 7:"Descarte de isquemia", 8:"QRS, QT e alto risco"};
const ULTIMO = 8;

/* ---------- raciocínio ---------- */
const R = () => S.cur.r;
function calibPadrao(){ const r = R(); return r.vel === "25" && r.amp === "10"; }
function sinusal(){
  const r = R();
  if (r.ritmo === "sim") return true;
  if (r.ritmo === "nao") return false;
  if (r.ritmo === "duvida" && r.wizFim) return r.wizFim === "sinusal";
  return null;
}
function eixo(){
  const r = R();
  if (!r.di || !r.avf) return null;
  if (r.di === "pos" && r.avf === "pos") return {t:"Eixo normal", k:"ok"};
  if (r.di === "pos" && r.avf === "neg"){
    if (!r.dii) return null;
    return r.dii === "pos" ? {t:"Eixo normal", k:"ok"} : {t:"Desvio do eixo para a esquerda", k:"warn"};
  }
  if (r.di === "neg" && r.avf === "pos") return {t:"Desvio do eixo para a direita", k:"warn"};
  return {t:"Desvio extremo do eixo", k:"bad"};
}
function faixaFC(){ const f = R().fc; if (!f) return null; return f > 100 ? "alta" : f < 50 ? "baixa" : "normal"; }

/* Etapa 6: parte do que o médico já respondeu e só pergunta o que falta.
   Devolve {html, pronto, res:{t, d, k}, extra} */
function arritmia(){
  const r = R(), fc = r.fc, reg = r.reg, sin = sinusal(), faixa = faixaFC();
  const partes = [];
  const q = (txt) => partes.push(`<p class="q" style="font-size:1rem">${txt}</p>`);
  const fim = (res, extra) => ({html:partes.join(""), pronto:true, res, extra});
  const falta = () => ({html:partes.join(""), pronto:false});
  if (sin === null || !fc || !reg) return falta();

  if (sin){
    const res = faixa === "alta" ? {t:"Taquicardia sinusal", d:`Ritmo sinusal com FC de ${fc} bpm.`, k:"warn"}
      : faixa === "baixa" ? {t:"Bradicardia sinusal", d:`Ritmo sinusal com FC de ${fc} bpm.`, k:"warn"}
      : {t:"Ritmo sinusal", d:`FC de ${fc} bpm.`, k:"ok"};
    partes.push(alerta(res.k, "✓ " + res.t, res.d));
    q("Há batimentos diferentes do ritmo habitual?");
    partes.push(`<div class="opts">${opt("extra","nao","Não")}${opt("extra","sim","Sim")}</div>`);
    if (!r.extra) return falta();
    if (r.extra === "nao") return fim(res, null);
    q("Vamos avaliar esses batimentos. O QRS desse batimento diferente é:");
    partes.push(`<div class="opts">${opt("extraQrs","estreito","Estreito")}${opt("extraQrs","largo","Largo")}</div>`);
    if (!r.extraQrs) return falta();
    const ex = r.extraQrs === "estreito" ? "Provável extrassístole supraventricular" : "Provável extrassístole ventricular";
    partes.push(alerta("warn", ex, ""));
    return fim(res, ex);
  }

  partes.push(`<div class="card small">O Copiloto já sabe: <b>ritmo não sinusal</b>, <b>${reg}</b>, <b>FC ${fc} bpm</b>.</div>`);

  const perguntaQRS = () => {
    q("O QRS é estreito ou largo?");
    partes.push(`<div class="opts">${opt("qrs","estreito","Estreito — menor que 120 ms")}${opt("qrs","largo","Largo — 120 ms ou mais")}</div>`);
    partes.push(ajudaBotao("medirqrs", "Não sei medir o QRS"));
    if (S.aberto.medirqrs){
      partes.push(`<div class="card small">
        ${S.cur.tela ? `<p>Meça o QRS com a régua na foto, do começo ao fim do complexo. O app diz se passa de 120 ms (3 quadradinhos).</p><button class="btn" type="button" data-medir="qrs">Medir o QRS na foto</button>`
          : `<p>Conte os quadradinhos do começo ao fim do QRS: a partir de 3 quadradinhos (120 ms), ele é largo.</p>`}
        ${pendente("Orientação do Dr. Vitor sobre como medir o QRS")}
      </div>`);
    }
    return !!r.qrs;
  };

  if (faixa === "alta"){
    partes.push(alerta("warn", "Vamos caracterizar a taquiarritmia", ""));
    if (!perguntaQRS()) return falta();
    if (r.qrs === "estreito" && reg === "regular"){
      q("Você identifica:");
      partes.push(`<div class="opts">${opt("tq","flutter","Ondas F de flutter")}${opt("tq","patrial","Ondas P não sinusais")}${opt("tq","nenhum","Nenhum dos dois")}</div>`);
      if (!r.tq) return falta();
      const res = {flutter:{t:"Flutter atrial"}, patrial:{t:"Taquicardia atrial"}, nenhum:{t:"Taquicardia supraventricular"}}[r.tq];
      res.d = `FC ${fc} bpm.`; res.k = "warn";
      partes.push(alerta(res.k, res.t, res.d));
      return fim(res);
    }
    if (r.qrs === "estreito"){
      q("Você identifica ondas P individualizadas?");
      partes.push(`<div class="opts">${opt("pind","nao","Não")}${opt("pind","sim","Sim")}</div>`);
      if (!r.pind) return falta();
      const res = r.pind === "nao" ? {t:"Fibrilação atrial de alta resposta ventricular", d:`FC ${fc} bpm.`, k:"warn"}
        : {t:"Taquicardia irregular com ondas P individualizadas", d:"Considere taquicardia atrial multifocal ou extrassístoles atriais frequentes como causa de irregularidade.", k:"warn"};
      partes.push(alerta(res.k, res.t, res.d));
      return fim(res);
    }
    if (reg === "regular"){
      const res = {t:"Taquicardia regular de QRS largo", d:"Considere taquicardia ventricular até que se prove o contrário.", k:"bad"};
      partes.push(alerta(res.k, "⚠️ " + res.t, res.d));
      return fim(res);
    }
    const res = {t:"Taquicardia irregular de QRS largo", d:"Pense principalmente em: fibrilação atrial com aberrância ou bloqueio de ramo · fibrilação atrial pré-excitada · taquicardia ventricular polimórfica.", k:"bad"};
    partes.push(alerta(res.k, "⚠️ " + res.t, res.d));
    return fim(res);
  }

  if (faixa === "baixa"){
    partes.push(alerta("warn", "Vamos caracterizar a bradiarritmia", ""));
    q("Tem onda P?");
    partes.push(`<div class="opts">${opt("temP","nao","Não")}${opt("temP","sim","Sim")}</div>`);
    if (!r.temP) return falta();
    if (r.temP === "nao"){
      if (reg === "irregular"){
        const res = {t:"Considerar fibrilação atrial com baixa resposta ventricular", d:"Ritmo irregular, sem ondas P individualizadas.", k:"warn"};
        partes.push(alerta(res.k, res.t, res.d));
        return fim(res);
      }
      if (!perguntaQRS()) return falta();
      const res = r.qrs === "estreito" ? {t:"Considerar escape juncional", d:`Ritmo regular, sem onda P, QRS estreito, FC ${fc} bpm.`, k:"warn"}
        : {t:"Considerar escape ventricular", d:`Ritmo regular, sem onda P, QRS largo, FC ${fc} bpm.`, k:"bad"};
      partes.push(alerta(res.k, res.t, res.d));
      return fim(res);
    }
    q("P e QRS têm relação?");
    partes.push(`<div class="opts">${opt("rel","nao","Não")}${opt("rel","algumas","Sim, mas algumas P não conduzem")}${opt("rel","todas","Todas conduzem 1:1")}</div>`);
    if (!r.rel) return falta();
    if (r.rel === "nao"){
      const res = {t:"BAV total", d:"P e QRS sem relação entre si.", k:"bad"};
      partes.push(alerta(res.k, res.t, res.d));
      return fim(res);
    }
    if (r.rel === "todas"){
      const res = {t:"Considerar ritmo atrial ectópico", d:"P não sinusal com bradicardia, todas conduzindo 1:1.", k:"warn"};
      partes.push(alerta(res.k, res.t, res.d));
      return fim(res);
    }
    q("Como as P deixam de conduzir?");
    partes.push(`<div class="opts">${opt("bav","m1","PR aumenta progressivamente até uma P bloquear")}${opt("bav","m2","PR constante, até que uma P bloqueia")}${opt("bav","21","Condução 2:1")}${opt("bav","avancado","Duas ou mais P consecutivas não conduzidas")}</div>`);
    if (!r.bav) return falta();
    const res = {m1:{t:"BAV de 2º grau Mobitz I", k:"warn"}, m2:{t:"BAV de 2º grau Mobitz II", k:"bad"}, "21":{t:"BAV 2:1", k:"bad"}, avancado:{t:"BAV avançado", k:"bad"}}[r.bav];
    res.d = `FC ${fc} bpm.`;
    partes.push(alerta(res.k, res.t, res.d));
    return fim(res);
  }

  // não sinusal, FC de 50 a 100
  if (reg === "irregular"){
    q("Você identifica ondas P individualizadas?");
    partes.push(`<div class="opts">${opt("pind","nao","Não")}${opt("pind","sim","Sim")}</div>`);
    if (!r.pind) return falta();
    const res = r.pind === "nao" ? {t:"Padrão compatível com fibrilação atrial", d:`Ritmo irregular, sem ondas P individualizadas, FC ${fc} bpm.`, k:"warn"}
      : {t:"Ritmo irregular com atividade atrial identificável", d:"Considere extrassístoles atriais frequentes ou atividade atrial multifocal.", k:"warn"};
    partes.push(alerta(res.k, res.t, res.d));
    return fim(res);
  }
  q("Você identifica ondas P não sinusais?");
  partes.push(`<div class="opts">${opt("pns","sim","Sim")}${opt("pns","nao","Não")}</div>`);
  if (!r.pns) return falta();
  if (r.pns === "sim"){
    const res = {t:"Considerar ritmo atrial ectópico", d:`FC ${fc} bpm.`, k:"warn"};
    partes.push(alerta(res.k, res.t, res.d));
    return fim(res);
  }
  if (!perguntaQRS()) return falta();
  const res = r.qrs === "estreito" ? {t:"Considerar ritmo juncional", d:`QRS estreito, FC ${fc} bpm.`, k:"warn"}
    : {t:"Considerar ritmo idioventricular", d:`QRS largo, FC ${fc} bpm.`, k:"warn"};
  partes.push(alerta(res.k, res.t, res.d));
  return fim(res);
}

const PADROES = [["wellens","Padrão de Wellens"],["dewinter","Padrão de de Winter"],["aslanger","Padrão de Aslanger"],["avr","Infra difuso de ST + supra em aVR"],["hiper","Ondas T hiperagudas"]];
const TERR = [["inf","Inferior: DII · DIII · aVF"],["lat","Lateral: DI · aVL · V5 · V6"],["ant","Anterior/Septal: V1 · V2 · V3 · V4"]];
const PAREDE = {inf:"inferior", lat:"lateral", ant:"anterior/septal"};
function isquemia(){
  const r = R(), m = r.isq || [];
  if (!m.length) return {pronto:false};
  const achados = [];
  if (m.includes("supra")){
    if (!(r.terr || []).length) return {pronto:false};
    achados.push("Supradesnivelamento de ST em parede " + r.terr.map(t => PAREDE[t]).join(", "));
  }
  if (m.includes("infra")){
    if (!r.infraV1) return {pronto:false};
    achados.push(r.infraV1 === "sim" ? "Infradesnivelamento de ST predominante em V1–V3 (considerar infarto com supra posterior; avaliar V7–V9)" : "Infradesnivelamento de ST em derivações contíguas");
  }
  if (m.includes("tinv")) achados.push("Ondas T invertidas e simétricas em derivações contíguas");
  if (m.includes("nenhuma")){
    const p = r.padroes || [];
    if (!p.length) return {pronto:false};
    p.filter(x => x !== "nenhum").forEach(x => achados.push(PADROES.find(y => y[0] === x)[1]));
  }
  return {pronto:true, achados};
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
  return { largura:tela.width, altura:tela.height, nitidez:n ? s2/n - (s/n)*(s/n) : 0, luz:soma/px, claros:claros/px, escuros:escuros/px };
}
function avisosFoto(q){
  const a = [];
  if (q.largura < 1100) a.push({n:"bad", t:"Foto pequena demais", d:"A imagem tem " + q.largura + " pixels de largura. Chegue mais perto do papel e enquadre só o eletro: de longe, o quadradinho vira um borrão."});
  if (q.nitidez < 70) a.push({n:"bad", t:"Traçado desfocado", d:"Apoie o cotovelo na mesa, toque na tela em cima do papel para o celular focar e tire de novo."});
  else if (q.nitidez < 190) a.push({n:"warn", t:"Foco no limite", d:"Dá para usar, mas o traçado está macio. Se puder, tire outra com o celular mais firme."});
  if (q.luz < 62) a.push({n:"bad", t:"Foto escura", d:"Leve o papel para perto de uma luz, ou acenda a luz do plantão. No escuro o celular borra sozinho para compensar."});
  else if (q.luz > 214) a.push({n:"warn", t:"Foto estourada", d:"A luz apagou parte da grade. Afaste a lâmpada ou tire de um ângulo diferente."});
  if (q.claros > .06) a.push({n:"warn", t:"Reflexo na folha", d:"Tem brilho branco estourado em cima do papel. Desligue o flash e incline a folha ou o corpo até o reflexo sair."});
  if (q.escuros > .35) a.push({n:"warn", t:"Sombra sobre o papel", d:"Sua mão ou seu corpo está fazendo sombra. Ilumine de lado, não de frente."});
  return a;
}
function msEntre(p1, p2){
  const e = S.cur.escala; if (!e) return 0;
  const u = {x:Math.cos(e.angulo), y:Math.sin(e.angulo)};
  return Math.round(Math.abs((p2.x - p1.x) * u.x + (p2.y - p1.y) * u.y) / e.pxPorMm * MS_POR_MM);
}

/* ---------- visor da foto ---------- */
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
    if (S.vista) this.v = Object.assign({}, S.vista);
    this.canvas.addEventListener("pointerdown", e => this.baixou(e));
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
    this.v.escala = Math.min(this.larg / this.tela.width, this.alt / this.tela.height) * .98;
    this.v.tx = this.larg / 2; this.v.ty = this.alt / 2;
    this.v.giro = S.cur.escala ? -S.cur.escala.angulo : 0;
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
      this.pinca = {d:Math.hypot(a.x-b.x, a.y-b.y)};
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
      const antes = this.paraImagem(m);
      this.v.escala = Math.max(.05, Math.min(14, this.v.escala * (d / (this.pinca.d || d))));
      const depois = this.paraTela(antes);
      this.v.tx += m.x - depois.x; this.v.ty += m.y - depois.y;
      this.pinca = {d};
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
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
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
    const c = this.ctx, css = getComputedStyle(document.documentElement);
    const a = this.paraTela(this.pontos[0]), b = this.paraTela(this.pontos[1]);
    const cor = (this.modo === "calibrar" ? css.getPropertyValue("--cal-2") : css.getPropertyValue("--cal")).trim() || "#E8433B";
    const perp = {x:-Math.sin(this.v.giro), y:Math.cos(this.v.giro)};
    const L = Math.max(this.larg, this.alt);
    c.save();
    c.lineWidth = 2; c.strokeStyle = cor; c.setLineDash([7, 5]);
    [a, b].forEach(p => { c.beginPath(); c.moveTo(p.x - perp.x*L, p.y - perp.y*L); c.lineTo(p.x + perp.x*L, p.y + perp.y*L); c.stroke(); });
    c.setLineDash([]);
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineWidth = 3; c.stroke();
    [a, b].forEach(p => { c.beginPath(); c.arc(p.x, p.y, 13, 0, 7); c.fillStyle = cor; c.fill(); c.lineWidth = 3; c.strokeStyle = "#fff"; c.stroke(); });
    const txt = this.rotulo();
    if (txt){
      const m = {x:(a.x+b.x)/2, y:(a.y+b.y)/2 - 22};
      c.font = "700 15px ui-monospace, Menlo, monospace";
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
    if (this.modo === "calibrar" || !S.cur.escala) return "";
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
  host.querySelectorAll("[data-zoom]").forEach(b => b.onclick = () => S.visor.aproximar(+b.dataset.zoom));
  const fit = host.querySelector("[data-fit]");
  if (fit) fit.onclick = () => { S.visor.enquadrar(); S.visor.desenhar(); };
  return S.visor;
}
function visorHTML(classe, dica){
  return `<div class="visor ${classe}" id="visor">
    <div class="tools"><button type="button" data-zoom="1.6">+</button><button type="button" data-zoom="0.65">−</button><button type="button" data-fit="1">ajustar</button></div>
    <div class="zoomtag">100%</div>
    ${dica ? `<div class="hint">${dica}</div>` : ""}
  </div>`;
}
function pontosPadrao(ms){
  const t = S.cur.tela, e = S.cur.escala;
  const meio = {x:t.width * .38, y:t.height * .62};
  const d = e ? (ms / MS_POR_MM) * e.pxPorMm : t.width * .12;
  const ang = e ? e.angulo : 0;
  return [meio, {x:meio.x + Math.cos(ang) * d, y:meio.y + Math.sin(ang) * d}];
}
function lerCalibracao(){
  const q = S.cur.calQuadrados || 5, mm = q * 5;
  const [a, b] = S.cur.pontos.cal;
  const px = Math.hypot(b.x - a.x, b.y - a.y);
  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (Math.abs(ang) > Math.PI/2) ang = ang > 0 ? ang - Math.PI : ang + Math.PI;
  return {px, pxmm:px / mm, ang};
}

/* ---------- pedaços de interface ---------- */
function opt(chave, valor, rotulo, multi){
  const atual = R()[chave];
  const on = multi ? (atual || []).includes(valor) : atual === valor;
  return `<button type="button" class="opt${multi ? " multi" : ""}" data-ans="${chave}" data-val="${valor}" data-multi="${multi ? 1 : 0}" aria-pressed="${on}">${rotulo}</button>`;
}
function alerta(k, t, d){ return `<div class="alert ${k}"><strong>${t}</strong>${d || ""}</div>`; }
function pendente(o){ return `<div class="pendente"><span class="tag">a enviar</span> ${o}</div>`; }
function ajudaBotao(chave, rotulo){ return `<button class="btn small ghost ajuda-btn" type="button" data-toggle="${chave}" aria-expanded="${!!S.aberto[chave]}">${rotulo}</button>`; }
function qrsFig(tipo){
  // desenho esquemático, sem escala clínica
  const base = tipo === "qs" || tipo === "rs" ? 40 : 60;
  const d = {
    ralto:"M4 60 L24 60 L36 8 L46 66 L52 60 L76 60",
    qr:"M4 60 L22 60 L26 70 L36 10 L46 60 L76 60",
    qs:"M4 40 L22 40 L36 92 L50 40 L76 40",
    rs:"M4 40 L22 40 L27 30 L38 92 L50 40 L76 40"
  }[tipo];
  return `<svg viewBox="0 0 80 100" class="fig" aria-hidden="true"><line x1="0" y1="${base}" x2="80" y2="${base}" stroke="var(--line-strong)" stroke-dasharray="3 3"/><path d="${d}" fill="none" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round"/></svg>`;
}
function progresso(i){ return Array.from({length:ULTIMO}, (_, k) => `<i class="${k+1 < i ? "done" : k+1 === i ? "now" : ""}"></i>`).join(""); }

/* ---------- telas fora da leitura ---------- */
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
    <span class="tag ${l.alerta ? "bad" : "ok"}">${l.alerta ? "atenção" : "sem alerta"}</span>
  </button>`;
}
function inicio(){
  const ult = S.leituras.slice(0, 3);
  return `<div class="scroll">
    <div><div class="eyebrow">Sequência de Leitura Ativa</div><h2 style="margin-top:4px">Copiloto de ECG</h2></div>
    <button class="hero" type="button" data-ir="motivo">
      <span class="eyebrow">Com o eletro na mão</span>
      <strong>Vamos interpretar um ECG?</strong>
      <span class="small" style="opacity:.8">Siga a sequência etapa por etapa. O Copiloto organiza o raciocínio, faz as contas e monta o laudo.</span>
      <span class="go">Começar</span>
    </button>
    ${ult.length ? `<div class="card"><h3>Últimas leituras</h3><div class="list">${ult.map(itemLeitura).join("")}</div></div>`
      : `<div class="card"><h3>Nenhuma leitura ainda</h3><p class="muted small">A primeira leitura fica guardada aqui. Nada sai deste aparelho.</p></div>`}
    <p class="muted small">O Copiloto não lê o eletro por você. Quem interpreta é você; ele garante que nenhuma etapa fique para trás.</p>
  </div>${nav()}`;
}
function biblioteca(){
  return `<div class="scroll">
    <div><div class="eyebrow">Só você vê</div><h2 style="margin-top:4px">Biblioteca</h2></div>
    ${S.leituras.length ? `<div class="card"><div class="list">${S.leituras.map(itemLeitura).join("")}</div></div>` : `<div class="card"><p class="muted">Ainda não há leituras salvas.</p></div>`}
    <p class="muted small">As leituras ficam guardadas neste celular, no navegador. Se você limpar os dados do site, elas somem.</p>
  </div>${nav()}`;
}
function ajuda(){
  return `<div class="scroll">
    <div><div class="eyebrow">Como usar</div><h2 style="margin-top:4px">Ajuda</h2></div>
    <div class="card"><h3>A sequência</h3><p class="small">Motivo do exame → técnica → ritmo → regularidade e frequência → eixo → descarte de arritmias → descarte de isquemia → QRS, QT e alto risco. O Copiloto guarda cada resposta e usa nas etapas seguintes, sem perguntar de novo.</p></div>
    <div class="card"><h3>A foto é opcional</h3><p class="small">Você pode ler direto no papel. Com a foto, o eletro fica à mão durante a leitura (botão <b>Eletro</b> no topo) e dá para medir com a régua na tela. Use <b>Câmera</b> para fotografar na hora ou <b>Galeria</b> para uma foto já tirada.</p></div>
    <div class="card"><h3>A régua na foto</h3><p class="small">Antes de medir, arraste as duas bolinhas sobre cinco quadradões (1 segundo de papel). O app aprende a escala daquela foto e passa a medir em milissegundos.</p></div>
    <div class="card"><h3>O laudo</h3><p class="small">O texto final é montado com as suas respostas. Confira antes de copiar.</p></div>
    <div class="card"><h3>Privacidade</h3><p class="small">A foto e as respostas ficam neste aparelho. O app não envia nada para servidor nenhum.</p></div>
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

/* ---------- etapa 1: o paciente ---------- */
function telaMotivo(){
  const m = motivo();
  return `<div class="bar"><button class="back" type="button" data-ir="inicio" aria-label="Voltar">←</button><div class="t"><small>Etapa 1 de ${ULTIMO}</small><strong>Antes do traçado, olhe para o paciente</strong></div></div>
  <div class="prog" style="grid-template-columns:repeat(${ULTIMO},1fr)">${progresso(1)}</div>
  <div class="scroll" id="seq-scroll">
    <p class="q">O que motivou este ECG?</p>
    <div class="opts">${MOTIVOS.map(x => `<button type="button" class="opt" data-motivo="${x.k}" aria-pressed="${S.cur.motivo === x.k}">${x.nome}</button>`).join("")}</div>
    ${m ? `<div class="card orientacao"><span class="eyebrow">${m.nome}</span>${m.texto.map(t => `<p>${t}</p>`).join("")}</div>` : ""}
  </div>
  <div class="foot"><button class="btn primary" type="button" data-ir="foto" ${m ? "" : "disabled"}>Iniciar leitura →</button></div>`;
}

/* ---------- foto (opcional) ---------- */
function telaFoto(){
  const c = S.cur;
  if (!c.tela){
    return `<div class="bar"><button class="back" type="button" data-ir="motivo" aria-label="Voltar">←</button><div class="t"><small>Opcional</small><strong>Quer usar a foto do eletro?</strong></div></div>
    <div class="scroll">
      <p class="small muted">Com a foto, o traçado fica à mão durante toda a leitura e dá para medir com a régua na tela. Sem ela, você lê direto no papel.</p>
      <button class="dropzone" type="button" data-fonte="camera">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.4"/><path d="M8 6l1.4-2h5.2L16 6"/></svg>
        <strong>Fotografar o eletro</strong><span class="muted small">Abre a câmera</span>
      </button>
      <button class="btn wide" type="button" data-fonte="galeria">Escolher uma foto já tirada</button>
      <div class="card"><h3>Para a foto sair boa</h3><p class="small">Papel esticado numa superfície plana · luz de lado, sem flash · celular paralelo ao papel · enquadre só o eletro, o mais perto que der.</p></div>
      <p class="muted small">A foto fica neste aparelho. O app não envia imagem para lugar nenhum.</p>
    </div>
    <div class="foot"><button class="btn primary" type="button" data-ir="seq">Seguir sem foto</button></div>`;
  }
  const q = c.foto, avisos = avisosFoto(q), ruim = avisos.some(a => a.n === "bad");
  return `<div class="bar"><button class="back" type="button" data-ir="motivo" aria-label="Voltar">←</button><div class="t"><small>Opcional</small><strong>A foto ficou boa?</strong></div></div>
  ${visorHTML("full", "Arraste para mover, pince para aproximar.")}
  <div class="scroll">
    ${avisos.length ? avisos.map(a => alerta(a.n, a.t, a.d)).join("") : alerta("ok", "Foto boa", "Nitidez, luz e tamanho estão dentro do esperado.")}
    <p class="muted small">O conferidor é automático, não um veredito. Se essa é a única foto possível agora, dá para seguir.</p>
  </div>
  <div class="foot">
    <button class="btn small" type="button" data-fonte="camera">Câmera</button>
    <button class="btn small" type="button" data-fonte="galeria">Galeria</button>
    <button class="btn primary" type="button" data-ir="seq">${ruim ? "Usar assim mesmo" : "Usar esta foto"}</button>
  </div>`;
}

/* ---------- régua na foto: calibrar e medir ---------- */
function telaMedir(){
  const m = S.medir, c = S.cur;
  if (!c.escala){
    const quad = c.calQuadrados || 5;
    return `<div class="bar"><button class="back" type="button" data-sair-medir="1" aria-label="Voltar">←</button><div class="t"><small>Régua na foto</small><strong>Primeiro, calibre</strong></div></div>
    ${visorHTML("full", "Ponha cada bolinha em uma linha grossa, contando " + quad + " quadradão" + (quad > 1 ? "es" : "") + ".")}
    <div class="scroll">
      <p class="q">Diga ao app quanto vale um quadradinho nesta foto.</p>
      <div class="chips">
        <button class="chip" type="button" data-quad="5" aria-pressed="${quad===5}">5 quadradões · 1 s</button>
        <button class="chip" type="button" data-quad="3" aria-pressed="${quad===3}">3 quadradões</button>
        <button class="chip" type="button" data-quad="1" aria-pressed="${quad===1}">1 quadradão · 0,2 s</button>
      </div>
      <div class="card" id="cal-out"></div>
      <div id="cal-aviso"></div>
    </div>
    <div class="foot"><button class="btn primary" type="button" id="usar-cal">Calibrar</button></div>`;
  }
  const titulo = m.alvo === "fc" ? "Medir o RR" : "Medir o QRS";
  const dica = m.alvo === "fc" ? "Uma bolinha em cada pico de QRS, em dois batimentos seguidos." : "Do começo ao fim do QRS.";
  return `<div class="bar"><button class="back" type="button" data-sair-medir="1" aria-label="Voltar">←</button><div class="t"><small>Régua na foto</small><strong>${titulo}</strong></div><button class="btn small ghost" type="button" data-recalibrar="1">Recalibrar</button></div>
  ${visorHTML("full", dica)}
  <div class="scroll"><div class="card" id="medir-out"></div></div>
  <div class="foot"><button class="btn primary" type="button" id="usar-medida">Usar esta medida</button></div>`;
}
function telaVer(){
  return `<div class="bar"><button class="back" type="button" data-fechar-ver="1" aria-label="Voltar">←</button><div class="t"><small>Etapa ${S.cur.passo} de ${ULTIMO}</small><strong>O eletro</strong></div><button class="btn small ghost" type="button" data-fechar-ver="1">Fechar</button></div>
  ${visorHTML("tudo", "Arraste para mover, pince para aproximar.")}`;
}

/* ---------- etapas 2 a 8 ---------- */
const ETAPAS = {
  2: () => {
    const r = R(), cal = r.vel && r.amp, calOk = calibPadrao();
    let h = `<p class="small muted">Vamos confirmar rapidamente se o traçado é adequado para interpretação.</p>
    <h3>2.1 — Calibração</h3><p class="small">Confira a calibração impressa no ECG.</p>
    <p class="small muted">Velocidade</p><div class="opts">${opt("vel","25","25 mm/s")}${opt("vel","outra","Outra / não sei")}</div>
    <p class="small muted">Amplitude</p><div class="opts">${opt("amp","10","10 mm/mV")}${opt("amp","outra","Outra / não sei")}</div>
    ${ajudaBotao("ondecal", "Onde encontro isso?")}
    ${S.aberto.ondecal ? `<div class="card small">${pendente("Foto padrão de um ECG mostrando onde ficam a velocidade e a amplitude impressas")}</div>` : ""}`;
    if (cal){
      h += calOk ? alerta("ok", "✓ Calibração padrão", "")
        : alerta("warn", "⚠️ Atenção à calibração", "Este ECG não foi confirmado em 25 mm/s e 10 mm/mV. Isso modifica a relação entre os quadrados do papel e o tempo. Sugiro repetir o ECG.") + `<div class="opts">${opt("calSeguir","sim","Continuar mesmo assim")}</div>`;
    }
    if (cal && (calOk || r.calSeguir)){
      h += `<h3 style="margin-top:8px">2.2 — Colocação dos eletrodos dos membros</h3>
      <div class="card small"><p>☑ DI com onda P positiva e/ou QRS predominantemente positivo</p><p>☑ aVR com onda P negativa e/ou QRS predominantemente negativo</p></div>
      <p class="q" style="font-size:1rem">O traçado está assim?</p>
      <div class="opts">${opt("elet","sim","Sim")}${opt("elet","nao","Não")}</div>`;
      if (r.elet === "sim") h += alerta("ok", "✓ Padrão habitual das derivações dos membros", "");
      if (r.elet === "nao"){
        h += alerta("warn", "⚠️ Antes de interpretar, considere possível troca de eletrodos", "Quando onda P e QRS estão negativos em DI e positivos em aVR, suspeite especialmente de inversão dos eletrodos dos braços. Entretanto, alterações isoladas da polaridade do QRS podem representar o próprio padrão do paciente.");
        h += ajudaBotao("eletajuda", "Me ajude a conferir os eletrodos");
        if (S.aberto.eletajuda) h += `<div class="card small"><p>Confira a posição dos eletrodos dos membros e, se houver suspeita de inversão, corrija a posição e repita o ECG antes de interpretar, sempre que possível.</p>${pendente("Imagem com a colocação correta dos eletrodos dos membros")}</div>`;
        h += `<div class="opts">${opt("eletSeguir","sim","Seguir mesmo assim")}</div>`;
      }
    }
    return {html:h, ok:() => !!(R().vel && R().amp && (calibPadrao() || R().calSeguir) && (R().elet === "sim" || (R().elet === "nao" && R().eletSeguir)))};
  },
  3: () => {
    const r = R();
    let h = `<p class="q">O ritmo é sinusal?</p>
    <div class="card small"><p>☑ P positiva em DI, DII e aVF</p><p>☑ P negativa em aVR</p><p>☑ Ondas P precedem os QRS do ritmo de base</p><p>☑ Ondas P com a mesma morfologia em uma mesma derivação</p></div>
    <div class="opts">${opt("ritmo","sim","Sim")}${opt("ritmo","nao","Não")}${opt("ritmo","duvida","Não tenho certeza")}</div>`;
    if (r.ritmo === "sim") h += alerta("ok", "✓ Ritmo sinusal", "");
    if (r.ritmo === "nao") h += alerta("warn", "⚠️ O ritmo não apresenta todos os critérios de ritmo sinusal", "Continue a sequência. Na etapa Descarte de arritmias, vamos caracterizá-lo melhor.");
    if (r.ritmo === "duvida"){
      h += `<div class="card"><span class="eyebrow">Como identificar o ritmo sinusal</span>
        <h3>1. Primeiro, encontre a onda P</h3><p class="small">DII costuma ser uma boa derivação para começar.</p>${pendente("Imagem de um ECG sinusal destacando apenas a P em DII")}
        <div class="opts">${opt("wiz1","sim","Encontrei a onda P")}${opt("wiz1","nao","Não encontrei")}</div>`;
      if (r.wiz1 === "nao") h += alerta("warn", "Sem uma onda P claramente identificável, o ritmo não é sinusal", "Continue a sequência. Vamos caracterizar melhor o ritmo em Descarte de arritmias.");
      if (r.wiz1 === "sim"){
        h += `<h3>2. Agora confira a polaridade da P</h3><p class="small">Para uma onda P de origem sinusal, procure: positiva em DI, positiva em DII, positiva em aVF, negativa em aVR. Observe apenas se a onda P está predominantemente acima ou abaixo da linha de base.</p>${pendente("Imagem pequena com DI, DII, aVF e aVR mostrando a polaridade esperada da P")}
          <div class="opts">${opt("wiz2","sim","Tem característica sinusal")}${opt("wiz2","nao","Não tem característica sinusal")}</div>`;
        if (r.wiz2 === "nao") h += alerta("warn", "Os critérios de ritmo sinusal não estão todos presentes", "Não precisamos definir a arritmia agora. Continue a sequência: vamos caracterizar melhor o ritmo em Descarte de arritmias.");
        if (r.wiz2 === "sim"){
          h += `<h3>3. Olhe o ritmo de base</h3><p class="small">As ondas P apresentam morfologia semelhante em uma mesma derivação e precedem os QRS do ritmo de base?</p><p class="small muted">Importante: um batimento diferente isolado, como uma extrassístole, não exclui necessariamente um ritmo de base sinusal.</p>
            <div class="opts">${opt("wiz3","sim","Sim")}${opt("wiz3","nao","Não")}</div>`;
          if (r.wiz3 === "sim") h += alerta("ok", "✓ Os achados são compatíveis com ritmo sinusal", "");
          if (r.wiz3 === "nao") h += alerta("warn", "Os critérios de ritmo sinusal não estão todos presentes", "Não precisamos definir a arritmia agora. Continue a sequência: vamos caracterizar melhor o ritmo em Descarte de arritmias.");
        }
      }
      h += `</div>`;
    }
    return {html:h, ok:() => sinusal() !== null};
  },
  4: () => {
    const r = R();
    let h = `<h3>4.1 — Regularidade</h3><p class="q" style="font-size:1rem">O ritmo é regular?</p><p class="small muted">Compare os intervalos R-R ao longo do traçado.</p>
    <div class="opts">${opt("reg","regular","Regular")}${opt("reg","irregular","Irregular")}</div>`;
    if (r.reg){
      h += `<h3 style="margin-top:8px">4.2 — Frequência cardíaca</h3>
      <div class="field"><label for="fc">Qual a frequência cardíaca?</label><div class="linha"><input type="number" id="fc" inputmode="numeric" min="10" max="350" value="${r.fc || ""}" placeholder="—"><span class="u">bpm</span></div></div>
      ${ajudaBotao("calcfc", "Me ajude a calcular a FC")}`;
      if (S.aberto.calcfc){
        const calc = (id, rot, fator, tipo) => `<div class="calc"><label for="${id}">${rot}</label><div class="linha"><input type="number" id="${id}" inputmode="decimal" min="0" step="0.5" value="${r[id] || ""}" data-calc="${tipo}" data-fator="${fator}"><span class="u" id="${id}-res">—</span><button class="btn small" type="button" data-usar-calc="${id}">Usar</button></div></div>`;
        h += `<div class="card small">`;
        if (r.reg === "regular"){
          h += `<p><b>1. Quadradinhos pequenos</b> — conte quantos quadradinhos pequenos existem entre dois QRS consecutivos. FC = 1500 ÷ quadradinhos.</p>${calc("cq","Quadradinhos entre dois QRS",1500,"div")}
            <p><b>2. Quadrados grandes</b> — conte quantos quadrados grandes existem entre dois QRS consecutivos. FC = 300 ÷ quadrados grandes.</p>${calc("cg","Quadrados grandes entre dois QRS",300,"div")}`;
        }
        h += `<p><b>${r.reg === "regular" ? "3. " : ""}Contagem em 10 segundos</b> — em um trecho contínuo de 10 segundos, como o DII longo, conte o número de QRS. FC ${r.reg === "irregular" ? "média " : ""}= QRS × 6.</p>${calc("c10","QRS em 10 segundos",6,"mul")}`;
        if (r.reg === "regular" && S.cur.tela) h += `<p><b>4. Régua na foto</b> — meça a distância entre dois QRS na própria foto.</p><button class="btn" type="button" data-medir="fc">Medir na foto</button>`;
        h += `</div>`;
      }
      if (r.fc) h += alerta("ok", "FC registrada: " + r.fc + " bpm", r.reg === "irregular" ? "Frequência média estimada." : "");
    }
    return {html:h, ok:() => !!(R().reg && R().fc)};
  },
  5: () => {
    const r = R(), e = eixo();
    let h = `<h3>5.1 — Como é o QRS em DI?</h3><div class="opts">${opt("di","pos","Predominantemente positivo")}${opt("di","neg","Predominantemente negativo")}</div>
    <h3>5.2 — Como é o QRS em aVF?</h3><div class="opts">${opt("avf","pos","Predominantemente positivo")}${opt("avf","neg","Predominantemente negativo")}</div>
    ${ajudaBotao("polqrs", "Me ajude a saber se o QRS é positivo ou negativo")}`;
    if (S.aberto.polqrs){
      h += `<div class="card small"><p>Observe o QRS em relação à linha de base.</p><p><b>Predominantemente positivo</b> → a maior parte do QRS está acima da linha de base.</p><p><b>Predominantemente negativo</b> → a maior parte do QRS está abaixo da linha de base.</p>
        <div class="figs"><figure>${qrsFig("ralto")}<figcaption>R alto</figcaption></figure><figure>${qrsFig("qr")}<figcaption>qR</figcaption></figure><figure>${qrsFig("qs")}<figcaption>QS</figcaption></figure><figure>${qrsFig("rs")}<figcaption>rS</figcaption></figure></div>
        <p class="muted" style="font-size:.76rem">Os dois primeiros são positivos; os dois últimos, negativos. Desenho esquemático, a validar pelo Dr. Vitor.</p></div>`;
    }
    if (r.di === "pos" && r.avf === "neg"){
      h += `<h3>Agora observe DII</h3><p class="q" style="font-size:1rem">Como é o QRS em DII?</p><div class="opts">${opt("dii","pos","Predominantemente positivo")}${opt("dii","neg","Predominantemente negativo")}</div>`;
    }
    if (e) h += alerta(e.k, (e.k === "ok" ? "✓ " : "") + e.t, "");
    return {html:h, ok:() => !!eixo()};
  },
  6: () => {
    const a = arritmia();
    return {html:`<p class="small muted">O Copiloto já sabe o ritmo, a regularidade e a frequência. Ele parte daí e só pergunta o que falta.</p>` + a.html, ok:() => arritmia().pronto};
  },
  7: () => {
    const r = R(), m = r.isq || [];
    let h = `<h3>Antes de procurar alterações, pense em territórios</h3>
    <p class="small">Não analise uma derivação isoladamente. Procure alterações em derivações anatomicamente contíguas.</p>
    <div class="card small terr"><p><b>Inferior:</b> DII · DIII · aVF</p><p><b>Lateral:</b> DI · aVL · V5 · V6</p><p><b>Anterior/Septal:</b> V1 · V2 · V3 · V4</p></div>
    <p class="q" style="font-size:1rem">Você identifica alguma destas alterações em pelo menos duas derivações contíguas?</p>
    <div class="opts">${opt("isq","supra","Supradesnivelamento do segmento ST",true)}${opt("isq","infra","Infradesnivelamento do segmento ST",true)}${opt("isq","tinv","Inversão simétrica da onda T",true)}${opt("isq","nenhuma","Nenhuma dessas alterações",true)}</div>
    ${ajudaBotao("critsupra", "Me ajude a revisar os critérios de supra")}
    ${S.aberto.critsupra ? `<div class="card small">${pendente("Critérios de supra de ST por derivação, sexo e idade")}</div>` : ""}`;
    if (m.includes("supra")) h += alerta("bad", "⚠️ Supradesnivelamento de ST", "Em quais derivações?") + `<div class="opts">${TERR.map(([k,l]) => opt("terr", k, l, true)).join("")}</div>`;
    if (m.includes("infra")){
      h += alerta("warn", "⚠️ Infradesnivelamento de ST em derivações contíguas", "") + `<p class="q" style="font-size:1rem">Infra predominante em V1–V3?</p><div class="opts">${opt("infraV1","sim","Sim")}${opt("infraV1","nao","Não")}</div>`;
      if (r.infraV1 === "sim") h += alerta("bad", "Lembre-se de considerar infarto com supra posterior", "Avalie as derivações posteriores (V7–V9).");
      if (r.infraV1 === "nao") h += alerta("warn", "Pode representar isquemia subendocárdica", "Dependendo da morfologia e do contexto clínico.");
    }
    if (m.includes("tinv")) h += alerta("warn", "⚠️ Ondas T invertidas e simétricas em derivações contíguas", "Avalie distribuição, profundidade, comparação com ECG prévio e contexto clínico.");
    if (m.includes("nenhuma")){
      h += `<h3 style="margin-top:6px">Antes de seguir, procure padrões de alto risco</h3><p class="small">Faça uma última checagem:</p>
        <div class="opts">${PADROES.map(([k,l]) => opt("padroes", k, l, true)).join("")}${opt("padroes","nenhum","Nenhum desses padrões",true)}</div>
        ${ajudaBotao("padraoajuda", "Não sei identificar")}
        ${S.aberto.padraoajuda ? `<div class="card small">${PADROES.map(([,l]) => pendente(l + ": imagem validada e 2 ou 3 características")).join("")}</div>` : ""}`;
      const p = r.padroes || [];
      if (p.includes("nenhum")) h += alerta("ok", "✓ Nenhum padrão isquêmico evidente identificado nesta etapa", "");
      else if (p.length) h += alerta("bad", "⚠️ Padrão de alto risco marcado", p.map(x => PADROES.find(y => y[0] === x)[1]).join(" · "));
    }
    return {html:h, ok:() => isquemia().pronto};
  },
  8: () => ({html:`${alerta("warn", "Etapa em construção", "O Dr. Vitor está escrevendo esta parte: QRS, intervalo QT e padrões de alto risco. Assim que ela chegar, entra aqui.")}
    <p class="small muted">Por enquanto, siga para o resumo. O laudo avisa que esta etapa ainda não foi feita.</p>`, ok:() => true})
};

function telaSeq(){
  const i = S.cur.passo, v = ETAPAS[i]();
  return `<div class="bar"><button class="back" type="button" data-voltar="1" aria-label="Voltar">←</button><div class="t"><small>Etapa ${i} de ${ULTIMO} · ${motivo() ? motivo().nome : ""}</small><strong>${PASSOS[i]}</strong></div>
    ${S.cur.tela ? `<button class="btn small" type="button" data-ver="1">Eletro</button>` : ""}<button class="btn small ghost" type="button" data-ir="inicio">Sair</button></div>
  <div class="prog" style="grid-template-columns:repeat(${ULTIMO},1fr)">${progresso(i)}</div>
  <div class="scroll" id="seq-scroll">${v.html}</div>
  <div class="foot"><button class="btn primary" type="button" id="proxima" ${v.ok() ? "" : "disabled"}>${i === ULTIMO ? "Ver resumo e laudo" : "Próxima etapa"}</button></div>`;
}

/* ---------- laudo ---------- */
const minuscula = s => s.charAt(0).toLowerCase() + s.slice(1);
function resumo(){
  const r = R(), m = motivo(), e = eixo(), a = arritmia(), isq = isquemia();
  const linhas = [], conc = [], atencao = [];
  linhas.push("Motivo do exame: " + (m ? minuscula(m.nome) : "não informado") + ".");
  if (r.vel && r.amp){
    if (calibPadrao()) linhas.push("Calibração padrão (25 mm/s, 10 mm/mV).");
    else { linhas.push("Calibração fora do padrão ou não confirmada."); atencao.push("Calibração fora do padrão"); }
  }
  if (r.elet === "sim") linhas.push("Eletrodos dos membros em padrão habitual.");
  if (r.elet === "nao"){ linhas.push("Possível troca de eletrodos dos membros."); atencao.push("Possível troca de eletrodos"); }
  if (a.pronto){
    const complemento = a.res.d && !/FC (de )?\d+ bpm\.$/.test(a.res.d) ? " " + a.res.d : "";
    linhas.push(a.res.t + (/regular/.test(a.res.t) ? "" : ", " + r.reg) + ", FC " + r.fc + " bpm." + complemento);
    conc.push(a.res.t);
    if (a.res.k !== "ok") atencao.push(a.res.t);
    if (a.extra){ linhas.push(a.extra + "."); conc.push(minuscula(a.extra)); atencao.push(a.extra); }
  }
  if (e){
    linhas.push(e.t + ".");
    if (e.k !== "ok"){ conc.push(minuscula(e.t)); atencao.push(e.t); }
  }
  if (isq.pronto){
    if (isq.achados.length) isq.achados.forEach(x => { linhas.push(x + "."); conc.push(minuscula(x)); atencao.push(x); });
    else linhas.push("Nenhum padrão isquêmico evidente identificado.");
  }
  linhas.push("Etapa de QRS, QT e padrões de alto risco ainda não disponível nesta versão.");
  linhas.push("");
  if (!atencao.length && conc.length) conc[conc.length - 1] += ", sem alterações nas demais etapas avaliadas";
  linhas.push("Conclusão: " + (conc.length ? conc.join("; ") : "sem alterações nas etapas avaliadas") + ".");
  const titulo = conc.length ? conc[0].charAt(0).toUpperCase() + conc[0].slice(1) + (conc.length > 1 ? " + " + (conc.length - 1) + (conc.length > 2 ? " achados" : " achado") : "") : "Sem alterações nas etapas avaliadas";
  return {texto:linhas.join("\n"), titulo, atencao};
}
function telaLaudo(){
  const s = resumo(), m = motivo();
  return `<div class="bar"><button class="back" type="button" data-voltar="1" aria-label="Voltar">←</button><div class="t"><small>Leitura concluída · ${m ? m.nome : ""}</small><strong>Resumo e laudo</strong></div></div>
  <div class="scroll">
    ${s.atencao.length ? alerta("bad", s.atencao.length === 1 ? "1 ponto de atenção" : s.atencao.length + " pontos de atenção", s.atencao.join(" · ")) : alerta("ok", "Nenhum ponto de atenção nas etapas avaliadas", "")}
    ${m ? `<div class="card small"><span class="eyebrow">Volte ao paciente · ${m.nome}</span><p>${m.texto[0]}</p></div>` : ""}
    <div><div class="eyebrow" style="margin-bottom:6px">Laudo montado com as suas respostas</div><div class="laudo" id="laudo">${s.texto}</div></div>
    <div class="row2"><button class="btn" type="button" data-copiar="1">Copiar laudo</button><button class="btn" type="button" id="salvar">${S.cur.salva ? "Salvo ✓" : "Salvar"}</button></div>
    <div class="card"><h3>Ficou com dúvida?</h3><p class="muted small">Copie o laudo e leve para o PreceptorIA, ou para discutir o caso no Clube do Plantonista.</p></div>
    <p class="muted small">Quem leu foi você. O Copiloto garantiu que nenhuma etapa ficou para trás e fez as contas.</p>
  </div>
  <div class="foot"><button class="btn primary" type="button" data-ir="inicio">Nova leitura</button></div>`;
}

/* ---------- desenhar e ligar ---------- */
function aviso(msg){
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  app.appendChild(t);
  setTimeout(() => t.remove(), 1700);
}
function manterRolagem(fn){
  const sc = document.getElementById("seq-scroll"), topo = sc ? sc.scrollTop : 0;
  fn();
  const sc2 = document.getElementById("seq-scroll");
  if (sc2) sc2.scrollTop = topo;
}
/* respostas que dependem de outras: mudar a de cima apaga as de baixo */
const RAMO6 = ["extra","extraQrs","qrs","tq","pind","temP","rel","bav","pns"];
const DEPENDE = {
  vel:["calSeguir"], amp:["calSeguir"], elet:["eletSeguir"],
  ritmo:["wiz1"].concat(RAMO6), wiz1:["wiz2"].concat(RAMO6), wiz2:["wiz3"].concat(RAMO6), wiz3:RAMO6,
  reg:RAMO6.concat(["cq","cg","c10"]), fc:RAMO6, extra:["extraQrs"], qrs:["tq","pind"], temP:["rel","bav","qrs"], rel:["bav"], pns:["qrs"],
  di:["dii"], avf:["dii"]
};
function limpar(k){ (DEPENDE[k] || []).forEach(x => { if (x in R()){ delete R()[x]; limpar(x); } }); }
function definirFC(v){ if (R().fc !== v) limpar("fc"); R().fc = v; }
function atualizarWiz(){
  const r = R();
  if (r.ritmo !== "duvida"){ delete r.wizFim; return; }
  if (r.wiz1 === "nao" || r.wiz2 === "nao" || r.wiz3 === "nao") r.wizFim = "nao";
  else if (r.wiz3 === "sim") r.wizFim = "sinusal";
  else delete r.wizFim;
}
function ligarOpts(raiz){
  raiz.querySelectorAll("[data-ans]").forEach(b => b.onclick = () => {
    const k = b.dataset.ans, v = b.dataset.val, r = R();
    if (b.dataset.multi === "1"){
      let arr = (r[k] || []).slice();
      if (v === "nenhuma" || v === "nenhum") arr = arr.includes(v) ? [] : [v];
      else { arr = arr.filter(x => x !== "nenhuma" && x !== "nenhum"); arr = arr.includes(v) ? arr.filter(x => x !== v) : arr.concat(v); }
      r[k] = arr;
      if (k === "isq"){ if (!arr.includes("supra")) delete r.terr; if (!arr.includes("infra")) delete r.infraV1; if (!arr.includes("nenhuma")) delete r.padroes; }
    } else {
      if (r[k] !== v) limpar(k);
      r[k] = v;
    }
    atualizarWiz();
    manterRolagem(desenhar);
  });
}
function miniatura(){
  if (!S.cur.tela) return null;
  try {
    const t = S.cur.tela, c = document.createElement("canvas"), k = Math.min(1, 220 / t.width);
    c.width = Math.round(t.width * k); c.height = Math.round(t.height * k);
    c.getContext("2d").drawImage(t, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", .6);
  } catch(_){ return null; }
}
function salvarLeitura(){
  const s = resumo();
  const reg = { id:S.cur.id, quando:S.cur.quando, queixa:motivo() ? motivo().nome : "Leitura",
    conc:s.titulo, alerta:s.atencao.length > 0, laudo:s.texto, thumb:miniatura() };
  S.leituras = [reg].concat(S.leituras.filter(l => l.id !== reg.id));
  gravarLeituras(S.leituras);
  if (S.cur.blob) guardarFoto(S.cur.id, S.cur.blob);
  S.cur.salva = true;
  aviso("Salvo neste aparelho");
  desenhar();
}
function soltarVisor(){ if (S.visor){ S.visor.destruir(); S.visor = null; } }
function irPara(t){
  if (t === "motivo" && (S.tela === "inicio" || S.tela === "detalhe" || S.tela === "laudo")){ S.cur = nova(); S.vista = null; S.aberto = {}; }
  if (t === "inicio") S.aba = "inicio";
  soltarVisor();
  S.tela = t;
  desenhar();
  const sc = document.getElementById("seq-scroll"); if (sc) sc.scrollTop = 0;
}
function desenhar(){
  const telas = { inicio:() => S.aba === "biblioteca" ? biblioteca() : S.aba === "ajuda" ? ajuda() : inicio(),
    motivo:telaMotivo, foto:telaFoto, seq:telaSeq, medir:telaMedir, ver:telaVer, detalhe, laudo:telaLaudo };
  app.innerHTML = (telas[S.tela] || telas.inicio)();

  app.querySelectorAll("[data-aba]").forEach(b => b.onclick = () => { S.tela = "inicio"; S.aba = b.dataset.aba; desenhar(); });
  app.querySelectorAll("[data-ir]").forEach(b => b.onclick = () => irPara(b.dataset.ir));
  app.querySelectorAll("[data-motivo]").forEach(b => b.onclick = () => {
    S.cur.motivo = b.dataset.motivo; manterRolagem(desenhar);
    const o = app.querySelector(".orientacao"); if (o) o.scrollIntoView({block:"nearest", behavior:"smooth"});
  });
  app.querySelectorAll("[data-fonte]").forEach(b => b.onclick = () => pedirFoto(b.dataset.fonte));
  app.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => { const k = b.dataset.toggle; S.aberto[k] = !S.aberto[k]; manterRolagem(desenhar); });
  app.querySelectorAll("[data-quad]").forEach(b => b.onclick = () => { S.cur.calQuadrados = +b.dataset.quad; desenhar(); });
  app.querySelectorAll("[data-ver]").forEach(b => b.onclick = () => { soltarVisor(); S.tela = "ver"; desenhar(); });
  app.querySelectorAll("[data-fechar-ver]").forEach(b => b.onclick = () => { soltarVisor(); S.tela = "seq"; desenhar(); });
  app.querySelectorAll("[data-medir]").forEach(b => b.onclick = () => { S.medir = {alvo:b.dataset.medir}; soltarVisor(); S.tela = "medir"; desenhar(); });
  app.querySelectorAll("[data-sair-medir]").forEach(b => b.onclick = () => { soltarVisor(); S.tela = "seq"; desenhar(); });
  app.querySelectorAll("[data-recalibrar]").forEach(b => b.onclick = () => { S.cur.escala = null; S.cur.pontos.fc = null; S.cur.pontos.qrs = null; S.vista = null; soltarVisor(); desenhar(); });
  app.querySelectorAll("[data-voltar]").forEach(b => b.onclick = () => {
    if (S.tela === "laudo"){ S.tela = "seq"; S.cur.passo = ULTIMO; }
    else if (S.cur.passo > 2) S.cur.passo--;
    else S.tela = "foto";
    soltarVisor(); desenhar();
  });
  app.querySelectorAll("[data-abrir]").forEach(b => b.onclick = () => {
    S.detalhe = S.leituras.find(l => l.id === b.dataset.abrir);
    if (S.detalhe){ S.tela = "detalhe"; desenhar(); }
  });
  app.querySelectorAll("[data-copiar]").forEach(b => b.onclick = () => {
    const txt = S.tela === "detalhe" ? S.detalhe.laudo : resumo().texto;
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
  ligarOpts(app);

  // etapa 4: FC digitada e calculadoras
  const fcIn = document.getElementById("fc");
  if (fcIn){
    fcIn.oninput = () => {
      const v = Math.round(+fcIn.value);
      if (v >= 10 && v <= 350) definirFC(v); else { limpar("fc"); delete R().fc; }
      const b = document.getElementById("proxima"); if (b) b.disabled = !ETAPAS[4]().ok();
    };
    fcIn.onchange = () => manterRolagem(desenhar);
  }
  const contaCalc = inp => { const n = +inp.value, f = +inp.dataset.fator; return !n ? null : inp.dataset.calc === "div" ? Math.round(f / n) : Math.round(n * f); };
  app.querySelectorAll("[data-calc]").forEach(inp => {
    const res = document.getElementById(inp.id + "-res");
    const mostrar = () => { R()[inp.id] = inp.value; const fc = contaCalc(inp); res.textContent = fc ? fc + " bpm" : "—"; };
    inp.oninput = mostrar; mostrar();
  });
  app.querySelectorAll("[data-usar-calc]").forEach(b => b.onclick = () => {
    const fc = contaCalc(document.getElementById(b.dataset.usarCalc));
    if (fc && fc >= 10 && fc <= 350){ definirFC(fc); manterRolagem(desenhar); aviso("FC " + fc + " bpm"); }
    else aviso("Confira o número digitado");
  });

  if (S.tela === "foto" && S.cur.tela) montarVisor("#visor", {modo:"livre"});
  if (S.tela === "ver") montarVisor("#visor", {modo:"livre"});
  if (S.tela === "medir") ligarMedir();
  if (S.tela === "seq"){
    const b = document.getElementById("proxima");
    if (b) b.onclick = () => {
      if (S.cur.passo < ULTIMO){ S.cur.passo++; desenhar(); const sc = document.getElementById("seq-scroll"); if (sc) sc.scrollTop = 0; }
      else { S.tela = "laudo"; desenhar(); }
    };
  }
  if (S.tela === "laudo"){
    const s = document.getElementById("salvar");
    if (s) s.onclick = () => { if (!S.cur.salva) salvarLeitura(); };
  }
}
function ligarMedir(){
  const c = S.cur;
  if (!c.escala){
    if (!c.pontos.cal){ const t = c.tela; c.pontos.cal = [{x:t.width*.35, y:t.height*.6}, {x:t.width*.5, y:t.height*.6}]; }
    const recalcular = () => {
      const {px, pxmm, ang} = lerCalibracao(), prec = pxmm ? MS_POR_MM / pxmm : 0;
      const bom = pxmm >= 4, aceitavel = pxmm >= 2.6, inclinado = Math.abs(ang * 180 / Math.PI) > 4;
      document.getElementById("cal-out").innerHTML = `<div class="readout"><span class="n">${pxmm.toFixed(1)}</span><span class="u">pixels por mm</span><span class="tag ${bom ? "ok" : aceitavel ? "warn" : "bad"}">${bom ? "boa" : aceitavel ? "no limite" : "insuficiente"}</span></div>
        <div class="kv"><span>Precisão da medida</span><span>± ${Math.max(1, Math.round(prec))} ms por pixel</span></div>
        <div class="kv"><span>Inclinação do papel</span><span>${(ang*180/Math.PI).toFixed(1)}°</span></div>`;
      document.getElementById("cal-aviso").innerHTML =
        (!aceitavel ? alerta("bad", "A foto não dá resolução para medir", "Cada pixel vale " + Math.round(prec) + " ms: o erro de um dedo na tela já muda a medida. Tire outra foto mais perto do papel.") : "")
        + (aceitavel && !bom ? alerta("warn", "Resolução no limite", "Dá para medir, mas chegando mais perto na próxima foto a medida fica bem mais firme.") : "")
        + (inclinado ? alerta("warn", "Papel torto na foto", "O app corrige a conta, mas endireitar a foto facilita a sua leitura.") : "");
      document.getElementById("usar-cal").disabled = !px;
    };
    montarVisor("#visor", {modo:"calibrar", pontos:c.pontos.cal, aoMudar:recalcular});
    recalcular();
    document.getElementById("usar-cal").onclick = () => {
      const {px, pxmm, ang} = lerCalibracao();
      if (!px) return;
      c.escala = {pxPorMm:pxmm, angulo:ang};
      S.vista = null; soltarVisor(); desenhar();
    };
    return;
  }
  const alvo = S.medir.alvo;
  if (!c.pontos[alvo]) c.pontos[alvo] = pontosPadrao(alvo === "fc" ? 800 : 100);
  const quadr = ms => (ms / MS_POR_MM).toLocaleString("pt-BR", {maximumFractionDigits:1});
  const out = () => {
    const p = c.pontos[alvo], ms = msEntre(p[0], p[1]), el = document.getElementById("medir-out");
    if (alvo === "fc"){
      const f = ms ? Math.round(60000 / ms) : 0;
      el.innerHTML = `<div class="readout"><span class="n">${f || "—"}</span><span class="u">bpm</span></div><div class="kv"><span>RR medido</span><span>${ms} ms · ${quadr(ms)} quadradinhos</span></div>`;
    } else {
      el.innerHTML = `<div class="readout"><span class="n">${ms}</span><span class="u">ms</span><span class="tag ${ms >= 120 ? "bad" : "ok"}">${ms >= 120 ? "largo" : "estreito"}</span></div><div class="kv"><span>Quadradinhos</span><span>${quadr(ms)}</span></div>`;
    }
  };
  montarVisor("#visor", {modo:alvo === "fc" ? "fc" : "int", pontos:c.pontos[alvo], aoMudar:out});
  out();
  document.getElementById("usar-medida").onclick = () => {
    const p = c.pontos[alvo], ms = msEntre(p[0], p[1]);
    if (!ms) return;
    if (alvo === "fc"){
      const f = Math.round(60000 / ms);
      if (f < 10 || f > 350) return aviso("Confira as bolinhas");
      definirFC(f); aviso("FC " + f + " bpm");
    } else {
      const v = ms >= 120 ? "largo" : "estreito";
      if (R().qrs !== v) limpar("qrs");
      R().qrs = v; S.aberto.medirqrs = false; aviso("QRS " + ms + " ms · " + v);
    }
    soltarVisor(); S.tela = "seq"; desenhar();
  };
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
    S.cur.escala = null; S.cur.pontos = {cal:null, fc:null, qrs:null};
    S.vista = null;
    tela.toBlob(b => { S.cur.blob = b; }, "image/jpeg", .88);
    soltarVisor();
    S.tela = "foto";
    desenhar();
  } catch(_){ aviso("Não consegui abrir essa imagem"); }
});

desenhar();
})();
