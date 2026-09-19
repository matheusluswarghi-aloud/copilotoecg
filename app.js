"use strict";
/* Copiloto de ECG — versão 3
   Roteiro clínico: documento do Dr. Vitor ("Ferramenta ECG - Protótipo", 18/09/2026).
   Tudo roda no aparelho: a foto do eletro nunca sai do celular.
   Fotos no IndexedDB; leituras e preferências no localStorage. */
(function(){

const app = document.getElementById("app");
const inputArquivo = document.getElementById("arquivo");
const MS_POR_MM = 40; // papel a 25 mm/s

/* ---------- guardar no aparelho ---------- */
const DB_NOME = "copiloto", LOJA = "fotos", CHAVE = "copiloto.leituras", CHAVE_PREFS = "copiloto.prefs";
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
const lerJSON = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) || padrao; } catch(_){ return padrao; } };
const gravarJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(_){} };

/* ---------- estado ---------- */
function nova(){
  return { id:"L" + Date.now(), quando:Date.now(), motivo:null,
    tela:null, foto:null, blob:null, escala:null, calQuadrados:5,
    pontos:{cal:null, fc:null, qrs:null},
    passo:2, r:{}, salva:false };
}
const S = {
  tela:"inicio", aba:"inicio", cur:nova(), leituras:lerJSON(CHAVE, []),
  prefs:Object.assign({nome:"", assinatura:true, tema:"escuro"}, lerJSON(CHAVE_PREFS, {})),
  visor:null, vista:null, detalhe:null, aberto:{}, medir:null, calc:{},
  filtro:{busca:"", motivo:"todas", atencao:false}, guiaAba:"calc"
};
function aplicarTema(){ document.documentElement.setAttribute("data-theme", S.prefs.tema === "claro" ? "light" : "dark"); }
aplicarTema();

/* ---------- o conteúdo do Dr. Vitor ---------- */
const MOTIVOS = [
  { k:"dor", nome:"Dor torácica", curto:"Dor torácica", texto:[
    "Em um paciente com dor torácica, uma das principais condições que não podemos deixar passar é isquemia miocárdica aguda.",
    "Durante sua leitura, procure ativamente alterações de ST e onda T, avalie sua distribuição em derivações contíguas e lembre-se de que nem todo quadro de oclusão coronariana se apresenta com o supra de ST clássico.",
    "Não procure tudo de uma vez. Siga a sequência. Vamos voltar a esses pontos no momento certo."]},
  { k:"palp", nome:"Palpitação / taquicardia", curto:"Palpitação", texto:[
    "Diante de palpitações ou taquicardia, primeiro queremos entender como esse coração está sendo ativado.",
    "Durante a leitura, três informações serão especialmente importantes: presença de onda P, largura do QRS e regularidade do ritmo.",
    "Essas respostas vão organizar o raciocínio sobre a taquiarritmia. Siga a sequência."]},
  { k:"bradi", nome:"Bradicardia", curto:"Bradicardia", texto:[
    "Diante de bradicardia, não basta saber que a frequência está baixa.",
    "Precisamos entender de onde vem o ritmo e como o estímulo atrial está sendo conduzido aos ventrículos.",
    "Durante a leitura, tenha atenção especial às ondas P, relação P-QRS e intervalo PR. Siga a sequência."]},
  { k:"sincope", nome:"Síncope / pré-síncope", curto:"Síncope", texto:[
    "Diante de síncope, o ECG pode trazer pistas importantes de uma causa arrítmica.",
    "Durante a leitura, tenha atenção especial à frequência, ritmo, distúrbios de condução, intervalo QT e outros padrões associados a risco arrítmico.",
    "Não procure tudo de uma vez. Siga a sequência."]},
  { k:"disp", nome:"Dispneia", curto:"Dispneia", texto:[
    "Na dispneia, o ECG raramente deve ser interpretado isoladamente.",
    "Ele pode trazer pistas de isquemia, arritmias, sobrecarga das câmaras cardíacas, bloqueio de ramo, além de alterações que, dentro do contexto adequado, podem contribuir para determinadas hipóteses, como no caso de TEP.",
    "Siga a sequência e depois integre os achados ao quadro clínico."]},
  { k:"metab", nome:"Alteração eletrolítica / metabólica", curto:"Metabólica", texto:[
    "Alterações metabólicas podem modificar diferentes componentes do ECG.",
    "Durante a leitura, observe especialmente ondas T, duração do QRS, intervalo QT e onda U, sempre interpretando o traçado junto aos dados laboratoriais e ao contexto clínico.",
    "Siga a sequência."]},
  { k:"rotina", nome:"Assintomático / rotina", curto:"Rotina", texto:[
    "Mesmo sem uma queixa aguda, todo ECG merece uma leitura sistemática.",
    "O objetivo aqui é reconhecer o ritmo, avaliar condução, eixo, intervalos, QRS e repolarização, identificando alterações que mereçam correlação clínica.",
    "Siga a sequência completa."]},
  { k:"outro", nome:"Outro motivo", curto:"Outro", texto:[
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

/* Etapa 6: parte do que o médico já respondeu e só pergunta o que falta. */
function arritmia(){
  const r = R(), fc = r.fc, reg = r.reg, sin = sinusal(), faixa = faixaFC();
  const partes = [];
  const q = txt => partes.push(`<p class="q sm">${txt}</p>`);
  const fim = (res, extra) => ({html:partes.join(""), pronto:true, res, extra});
  const falta = () => ({html:partes.join(""), pronto:false});
  if (sin === null || !fc || !reg) return falta();

  if (sin){
    const res = faixa === "alta" ? {t:"Taquicardia sinusal", d:`Ritmo sinusal com FC de ${fc} bpm.`, k:"warn"}
      : faixa === "baixa" ? {t:"Bradicardia sinusal", d:`Ritmo sinusal com FC de ${fc} bpm.`, k:"warn"}
      : {t:"Ritmo sinusal", d:`FC de ${fc} bpm.`, k:"ok"};
    partes.push(ins(res.k, res.t, res.d));
    q("Há batimentos diferentes do ritmo habitual?");
    partes.push(`<div class="opts">${opt("extra","nao","Não")}${opt("extra","sim","Sim")}</div>`);
    if (!r.extra) return falta();
    if (r.extra === "nao") return fim(res, null);
    q("Vamos avaliar esses batimentos. O QRS desse batimento diferente é:");
    partes.push(`<div class="opts">${opt("extraQrs","estreito","Estreito")}${opt("extraQrs","largo","Largo")}</div>`);
    if (!r.extraQrs) return falta();
    const ex = r.extraQrs === "estreito" ? "Provável extrassístole supraventricular" : "Provável extrassístole ventricular";
    partes.push(ins("warn", ex, ""));
    return fim(res, ex);
  }

  partes.push(`<div class="chips"><span class="chip info">ritmo <b>não sinusal</b></span><span class="chip info"><b>${reg}</b></span><span class="chip info">FC <b>${fc}</b> bpm</span></div>`);

  const perguntaQRS = () => {
    q("O QRS é estreito ou largo?");
    partes.push(`<div class="opts">${opt("qrs","estreito","Estreito — menor que 120 ms")}${opt("qrs","largo","Largo — 120 ms ou mais")}</div>`);
    partes.push(ajuda("medirqrs", "Não sei medir o QRS"));
    if (S.aberto.medirqrs){
      partes.push(`<div class="helpbox">
        ${S.cur.tela ? `<p>Meça o QRS com a régua na foto, do começo ao fim do complexo. O app diz se passa de 120 ms (3 quadradinhos).</p><button class="btn small" type="button" data-medir="qrs">${I.regua}Medir o QRS na foto</button>`
          : `<p>Conte os quadradinhos do começo ao fim do QRS: a partir de 3 quadradinhos (120 ms), ele é largo.</p>`}
        ${pendente("Orientação do Dr. Vitor sobre como medir o QRS")}
      </div>`);
    }
    return !!r.qrs;
  };

  if (faixa === "alta"){
    partes.push(ins("info", "Vamos caracterizar a taquiarritmia", ""));
    if (!perguntaQRS()) return falta();
    if (r.qrs === "estreito" && reg === "regular"){
      q("Você identifica:");
      partes.push(`<div class="opts">${opt("tq","flutter","Ondas F de flutter")}${opt("tq","patrial","Ondas P não sinusais")}${opt("tq","nenhum","Nenhum dos dois")}</div>`);
      if (!r.tq) return falta();
      const res = {flutter:{t:"Flutter atrial"}, patrial:{t:"Taquicardia atrial"}, nenhum:{t:"Taquicardia supraventricular"}}[r.tq];
      res.d = `FC ${fc} bpm.`; res.k = "warn";
      partes.push(ins(res.k, res.t, res.d));
      return fim(res);
    }
    if (r.qrs === "estreito"){
      q("Você identifica ondas P individualizadas?");
      partes.push(`<div class="opts">${opt("pind","nao","Não")}${opt("pind","sim","Sim")}</div>`);
      if (!r.pind) return falta();
      const res = r.pind === "nao" ? {t:"Fibrilação atrial de alta resposta ventricular", d:`FC ${fc} bpm.`, k:"warn"}
        : {t:"Taquicardia irregular com ondas P individualizadas", d:"Considere taquicardia atrial multifocal ou extrassístoles atriais frequentes como causa de irregularidade.", k:"warn"};
      partes.push(ins(res.k, res.t, res.d));
      return fim(res);
    }
    if (reg === "regular"){
      const res = {t:"Taquicardia regular de QRS largo", d:"Considere taquicardia ventricular até que se prove o contrário.", k:"bad"};
      partes.push(ins(res.k, res.t, res.d));
      return fim(res);
    }
    const res = {t:"Taquicardia irregular de QRS largo", d:"Pense principalmente em: fibrilação atrial com aberrância ou bloqueio de ramo · fibrilação atrial pré-excitada · taquicardia ventricular polimórfica.", k:"bad"};
    partes.push(ins(res.k, res.t, res.d));
    return fim(res);
  }

  if (faixa === "baixa"){
    partes.push(ins("info", "Vamos caracterizar a bradiarritmia", ""));
    q("Tem onda P?");
    partes.push(`<div class="opts">${opt("temP","nao","Não")}${opt("temP","sim","Sim")}</div>`);
    if (!r.temP) return falta();
    if (r.temP === "nao"){
      if (reg === "irregular"){
        const res = {t:"Considerar fibrilação atrial com baixa resposta ventricular", d:"Ritmo irregular, sem ondas P individualizadas.", k:"warn"};
        partes.push(ins(res.k, res.t, res.d));
        return fim(res);
      }
      if (!perguntaQRS()) return falta();
      const res = r.qrs === "estreito" ? {t:"Considerar escape juncional", d:`Ritmo regular, sem onda P, QRS estreito, FC ${fc} bpm.`, k:"warn"}
        : {t:"Considerar escape ventricular", d:`Ritmo regular, sem onda P, QRS largo, FC ${fc} bpm.`, k:"bad"};
      partes.push(ins(res.k, res.t, res.d));
      return fim(res);
    }
    q("P e QRS têm relação?");
    partes.push(`<div class="opts">${opt("rel","nao","Não")}${opt("rel","algumas","Sim, mas algumas P não conduzem")}${opt("rel","todas","Todas conduzem 1:1")}</div>`);
    if (!r.rel) return falta();
    if (r.rel === "nao"){
      const res = {t:"BAV total", d:"P e QRS sem relação entre si.", k:"bad"};
      partes.push(ins(res.k, res.t, res.d));
      return fim(res);
    }
    if (r.rel === "todas"){
      const res = {t:"Considerar ritmo atrial ectópico", d:"P não sinusal com bradicardia, todas conduzindo 1:1.", k:"warn"};
      partes.push(ins(res.k, res.t, res.d));
      return fim(res);
    }
    q("Como as P deixam de conduzir?");
    partes.push(`<div class="opts">${opt("bav","m1","PR aumenta progressivamente até uma P bloquear")}${opt("bav","m2","PR constante, até que uma P bloqueia")}${opt("bav","21","Condução 2:1")}${opt("bav","avancado","Duas ou mais P consecutivas não conduzidas")}</div>`);
    if (!r.bav) return falta();
    const res = {m1:{t:"BAV de 2º grau Mobitz I", k:"warn"}, m2:{t:"BAV de 2º grau Mobitz II", k:"bad"}, "21":{t:"BAV 2:1", k:"bad"}, avancado:{t:"BAV avançado", k:"bad"}}[r.bav];
    res.d = `FC ${fc} bpm.`;
    partes.push(ins(res.k, res.t, res.d));
    return fim(res);
  }

  if (reg === "irregular"){
    q("Você identifica ondas P individualizadas?");
    partes.push(`<div class="opts">${opt("pind","nao","Não")}${opt("pind","sim","Sim")}</div>`);
    if (!r.pind) return falta();
    const res = r.pind === "nao" ? {t:"Padrão compatível com fibrilação atrial", d:`Ritmo irregular, sem ondas P individualizadas, FC ${fc} bpm.`, k:"warn"}
      : {t:"Ritmo irregular com atividade atrial identificável", d:"Considere extrassístoles atriais frequentes ou atividade atrial multifocal.", k:"warn"};
    partes.push(ins(res.k, res.t, res.d));
    return fim(res);
  }
  q("Você identifica ondas P não sinusais?");
  partes.push(`<div class="opts">${opt("pns","sim","Sim")}${opt("pns","nao","Não")}</div>`);
  if (!r.pns) return falta();
  if (r.pns === "sim"){
    const res = {t:"Considerar ritmo atrial ectópico", d:`FC ${fc} bpm.`, k:"warn"};
    partes.push(ins(res.k, res.t, res.d));
    return fim(res);
  }
  if (!perguntaQRS()) return falta();
  const res = r.qrs === "estreito" ? {t:"Considerar ritmo juncional", d:`QRS estreito, FC ${fc} bpm.`, k:"warn"}
    : {t:"Considerar ritmo idioventricular", d:`QRS largo, FC ${fc} bpm.`, k:"warn"};
  partes.push(ins(res.k, res.t, res.d));
  return fim(res);
}

const PADROES = [["wellens","Padrão de Wellens"],["dewinter","Padrão de de Winter"],["aslanger","Padrão de Aslanger"],["avr","Infra difuso de ST + supra em aVR"],["hiper","Ondas T hiperagudas"]];
const TERR = [["inf","Inferior","DII · DIII · aVF"],["lat","Lateral","DI · aVL · V5 · V6"],["ant","Anterior/Septal","V1 · V2 · V3 · V4"]];
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
    const cor = (this.modo === "calibrar" ? css.getPropertyValue("--cal-2") : css.getPropertyValue("--cal")).trim() || "#FF6A7A";
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
      c.font = "500 15px ui-monospace, Menlo, monospace";
      const w = c.measureText(txt).width + 18;
      c.fillStyle = "rgba(8,8,10,.86)";
      c.beginPath();
      if (c.roundRect) c.roundRect(m.x - w/2, m.y - 15, w, 28, 14); else c.rect(m.x - w/2, m.y - 15, w, 28);
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
const svg = (d, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra || ""}>${d}</svg>`;
const I = {
  casa:svg('<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10.5V20h12v-9.5"/>'),
  lista:svg('<path d="M4 6h16M4 12h10M4 18h13"/>'),
  mais:svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  voltar:svg('<path d="M15 5l-7 7 7 7"/>'),
  fechar:svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  config:svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  busca:svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  seta:svg('<path d="M9 6l6 6-6 6"/>'),
  maisPeq:svg('<path d="M12 6v12M6 12h12"/>'),
  camera:svg('<rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="12" cy="13.5" r="3.4"/><path d="M8 7l1.4-2h5.2L16 7"/>'),
  galeria:svg('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>'),
  copiar:svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
  salvar:svg('<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>'),
  lixo:svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  olho:svg('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  regua:svg('<path d="M3 17 17 3l4 4L7 21z"/><path d="M8 12l2 2M11 9l2 2M14 6l2 2"/>'),
  check:svg('<path d="M5 12l5 5L20 7"/>'),
  ecg:svg('<path d="M3 12h4l2-6 3 12 3-8 2 2h4"/>'),
  guia:svg('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/><path d="M9 8h7M9 11.5h5"/>'),
  vazio:svg('<path d="M3 12h3l2-5 3 10 3-8 2 3h5"/><path d="M4 19h16" stroke-dasharray="2 3"/>')
};
const marca = () => `<span class="mark"><svg viewBox="0 0 24 24"><path d="M4 13h4l2-6 3 11 2.5-7 1.5 2H20"/></svg></span>`;
function opt(chave, valor, rotulo, multi){
  const atual = R()[chave];
  const on = multi ? (atual || []).includes(valor) : atual === valor;
  return `<button type="button" class="opt${multi ? " multi" : ""}" data-ans="${chave}" data-val="${valor}" data-multi="${multi ? 1 : 0}" aria-pressed="${on}"><span>${rotulo}</span></button>`;
}
function ins(k, t, d){ return `<div class="ins ${k}"><strong>${t}</strong>${d ? `<p>${d}</p>` : ""}</div>`; }
function pendente(o){ return `<div class="pendente"><span class="tag">a enviar</span> ${o}</div>`; }
function ajuda(chave, rotulo){ return `<button class="help" type="button" data-toggle="${chave}" aria-expanded="${!!S.aberto[chave]}">${I.maisPeq}${rotulo}</button>`; }
function qrsFig(tipo){
  const base = tipo === "qs" || tipo === "rs" ? 40 : 60;
  const d = { ralto:"M4 60 L24 60 L36 8 L46 66 L52 60 L76 60", qr:"M4 60 L22 60 L26 70 L36 10 L46 60 L76 60",
    qs:"M4 40 L22 40 L36 92 L50 40 L76 40", rs:"M4 40 L22 40 L27 30 L38 92 L50 40 L76 40" }[tipo];
  return `<svg viewBox="0 0 80 100" class="fig" aria-hidden="true"><line x1="0" y1="${base}" x2="80" y2="${base}" stroke="var(--line-3)" stroke-dasharray="3 3"/><path d="${d}" fill="none" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round"/></svg>`;
}
function progresso(i){ return `<div class="prog" style="grid-template-columns:repeat(${ULTIMO},1fr)">${Array.from({length:ULTIMO}, (_, k) => `<i class="${k+1 < i ? "done" : k+1 === i ? "now" : ""}"></i>`).join("")}</div>`; }
const dois = n => String(n).padStart(2, "0");
function topo(passo, titulo, extra){
  return `<div class="top"><span class="ghostnum" aria-hidden="true">${dois(passo)}</span><button class="icobtn ghost" type="button" data-voltar="1" aria-label="Voltar">${I.voltar}</button>
    <span class="step-num">${dois(passo)}</span>
    <div class="t"><small>Etapa ${passo} de ${ULTIMO}${motivo() ? " · " + motivo().curto : ""}</small><strong>${titulo}</strong></div>${extra || ""}</div>`;
}
/* traçado decorativo, derivado da leitura: FC dá o espaçamento, QRS largo alarga o complexo, irregular embaralha */
function spark(l){
  const fc = l.fc || 72, largo = l.qrsLargo, irr = l.irregular;
  const W = 160, H = 36, base = 22, rr = Math.max(14, Math.min(60, 60000 / fc / 25));
  let d = `M0 ${base}`, x = 4, k = 0;
  const seed = l.id ? parseInt(l.id.slice(-4), 10) || 7 : 7;
  while (x < W - 10){
    const j = irr ? ((seed * (k + 3)) % 7 - 3) * 2 : 0;
    const w = largo ? 7 : 4;
    d += ` L${x} ${base} L${x+2} ${base-2} L${x+4} ${base} L${x+w} ${base+3} L${x+w+2} ${base-14} L${x+w+4} ${base+6} L${x+w+6} ${base} L${x+w+11} ${base-3} L${x+w+15} ${base}`;
    x += rr + j; k++;
  }
  d += ` L${W} ${base}`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}
function saudacao(){
  const h = new Date().getHours();
  const p = h < 5 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const n = (S.prefs.nome || "").trim();
  return n ? `${p}, ${n}.` : `${p}, doutor.`;
}
function mesmoDia(a, b){ const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); }
function mapaDias(){
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  const dias = 12 * 7, inicio = new Date(hoje); inicio.setDate(hoje.getDate() - (dias - 1) - ((hoje.getDay() + 6) % 7));
  const cont = new Map();
  S.leituras.forEach(l => { const d = new Date(l.quando); const k = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); cont.set(k, (cont.get(k) || 0) + 1); });
  let h = "", d = new Date(inicio);
  const total = Math.ceil((hoje - inicio) / 864e5) + 1;
  for (let i = 0; i < total; i++){
    const k = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(), n = cont.get(k) || 0;
    h += `<i class="${n >= 4 ? "l3" : n >= 2 ? "l2" : n ? "l1" : ""}${mesmoDia(d, hoje) ? " hoje" : ""}" title="${n} leitura${n === 1 ? "" : "s"}"></i>`;
    d.setDate(d.getDate() + 1);
  }
  return h;
}
function frase(){
  const n = S.leituras.length;
  if (!n) return `<b>Pronto para a primeira leitura.</b> Siga a sequência e o Copiloto monta o laudo com você.`;
  const u = S.leituras[0], h = Math.round((Date.now() - u.quando) / 36e5);
  const quando = h < 1 ? "agora há pouco" : h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
  const at = S.leituras.filter(l => l.alerta).length;
  return `Última leitura ${quando}: <b>${u.conc}</b>.${at ? ` ${at} de ${n} com ponto de atenção.` : ` ${n} leitura${n > 1 ? "s" : ""} sem alerta.`}`;
}
function contagemMotivos(){
  const c = {};
  S.leituras.forEach(l => { c[l.motivo || "outro"] = (c[l.motivo || "outro"] || 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}
const curtoDe = l => (MOTIVOS.find(m => m.k === l.motivo) || {curto:l.queixa || "Leitura"}).curto;

/* ---------- navegação ---------- */
function nav(){
  const itens = [["inicio","Início",I.casa],["biblioteca","Biblioteca",I.lista]];
  return `<nav class="nav">
    ${itens.map(([k,l,ic]) => `<button type="button" data-aba="${k}" ${S.aba===k?'aria-current="page"':""}>${ic}${l}</button>`).join("")}
    <button type="button" class="plus" data-ir="motivo">${I.mais}Nova leitura</button>
    <button type="button" data-aba="guia" ${S.aba==="guia"?'aria-current="page"':""}>${I.guia}Guia</button>
  </nav>`;
}
function dataCurta(ms){
  const d = new Date(ms);
  return d.toLocaleDateString("pt-BR", {day:"2-digit", month:"2-digit"}) + " · " + d.toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"});
}

/* ---------- painel ---------- */
function inicio(){
  const ult = S.leituras.slice(0, 2), n = S.leituras.length, at = S.leituras.filter(l => l.alerta).length;
  const top = contagemMotivos()[0];
  const nomeTop = top ? (MOTIVOS.find(m => m.k === top[0]) || {curto:"—"}).curto : "—";
  return `<div class="screen">
  <div class="top"><div class="brand">${marca()}<strong>Copiloto</strong></div><div class="t"></div>
    <button class="icobtn" type="button" data-aba="config" aria-label="Configurações">${I.config}</button></div>
  <div class="scroll stagger com-nav">
    <div><h1>${saudacao()}</h1><p class="mute" style="margin-top:4px">Vamos interpretar um ECG?</p></div>
    ${monitorHTML()}
    <div class="stats">
      <div class="stat"><span class="n" data-count="${n}">0</span><span class="l">leitura${n === 1 ? "" : "s"}</span></div>
      <div class="stat"><span class="n" data-count="${at}">0</span><span class="l">com atenção</span></div>
      <div class="stat"><span class="n" data-count="${semana()}">0</span><span class="l">esta semana</span></div>
    </div>
    <button class="btn primary big wide" type="button" data-ir="motivo">${I.ecg}Ler um eletro agora</button>
    <div class="card"><div class="sec" style="margin:0"><h3>Últimos 7 dias</h3><span class="tiny mute">${top ? "mais comum: " + nomeTop : "por dia"}</span></div>${barrasSemana()}</div>
    <div class="sec"><h3>Suas leituras</h3>${n ? `<button class="textbtn" type="button" data-aba="biblioteca">Ver todas ${I.seta}</button>` : ""}</div>
    ${n ? `<div class="rgrid">${ult.map(cardLeitura).join("")}</div>`
      : `<div class="card"><div class="empty" style="padding:14px 6px"><p class="ink2">Nenhuma leitura guardada.</p><p class="tiny">A primeira fica aqui, com o laudo e a foto. Nada sai deste aparelho.</p></div></div>`}
    <div class="card"><div class="sec" style="margin:0"><h3>Mapa de leituras</h3><span class="tiny mute">12 semanas</span></div>
      <div class="dots">${mapaDias()}</div>
      <p class="tiny mute">Cada ponto é um dia. Quanto mais claro, mais eletros lidos.</p></div>
    <p class="tiny mute" style="text-align:center;padding:4px 10px">Quem interpreta é você. O Copiloto garante que nenhuma etapa fique para trás.</p>
  </div>${nav()}</div>`;
}
function semana(){ const d = Date.now() - 7 * 864e5; return S.leituras.filter(l => l.quando >= d).length; }
function barrasSemana(){
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  const dias = [], nomes = ["D","S","T","Q","Q","S","S"];
  for (let i = 6; i >= 0; i--){ const d = new Date(hoje); d.setDate(hoje.getDate() - i); dias.push({d, n:S.leituras.filter(l => mesmoDia(l.quando, d)).length}); }
  const max = Math.max(1, ...dias.map(x => x.n));
  return `<div class="bars">${dias.map((x, i) => `<div><span class="tr${i === 6 ? " hoje" : ""}"><i style="--h:${x.n ? Math.round(18 + 82 * x.n / max) : 4}%"></i></span><span>${nomes[x.d.getDay()]}</span></div>`).join("")}</div>`;
}
function monitorHTML(){
  const u = S.leituras[0];
  const fc = u && u.fc ? u.fc : 72;
  const titulo = u ? u.conc : "Ritmo sinusal, 72 bpm";
  const sub = u ? `${curtoDe(u)} · ${dataCurta(u.quando)}` : "traçado de demonstração";
  return `<div class="hero" id="hero">
    <div class="mon-top"><div><span class="eyebrow">${u ? "Última leitura" : "Monitor"}</span><strong>${titulo}</strong><p class="tiny mute">${sub}</p></div><span class="live"><i></i>${u ? (u.irregular ? "irregular" : "regular") : "demo"}</span></div>
    <canvas id="mon" aria-hidden="true"></canvas>
    <div class="mon-foot"><span class="num" data-count="${fc}">0<span class="u">bpm</span></span><span class="pill">${u ? (u.qrsLargo ? "QRS largo" : "QRS estreito") : "25 mm/s"}</span></div>
  </div>`;
}
/* monitor: traçado varrendo como num monitor de beira de leito, derivado da última leitura */
function montarMonitor(){
  const c = document.getElementById("mon");
  if (!c) return;
  const u = S.leituras[0], fc = u && u.fc ? u.fc : 72, largo = !!(u && u.qrsLargo), irr = !!(u && u.irregular);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = c.clientWidth || 340, H = 118;
  c.width = W * dpr; c.height = H * dpr;
  const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
  const RR = 60000 / fc, pxMs = W / 3200; // 3,2 s na tela
  const forma = t => {
    let v = 0;
    if (t >= 0 && t <= 90) v += .12 * Math.sin(Math.PI * t / 90);
    const q0 = 160, qd = largo ? 130 : 80, u2 = t - q0;
    if (u2 >= 0 && u2 <= qd){ const pts = [[0,0],[.15,-.12],[.4,1],[.65,-.28],[1,0]]; for (let i = 0; i < 4; i++){ const [a,va] = pts[i], [b,vb] = pts[i+1]; const A = a*qd, B = b*qd; if (u2 >= A && u2 <= B){ v += va + (vb-va)*(u2-A)/(B-A); break; } } }
    const t0 = q0 + qd + 90; if (t >= t0 && t <= t0 + 200) v += .22 * Math.pow(Math.sin(Math.PI * (t - t0) / 200), 1.3);
    return v;
  };
  const volt = ms => { let v = 0, acc = 0, k = 0; while (acc < ms + RR){ const rr = irr ? RR * (1 + (((k * 7919) % 11) - 5) / 22) : RR; const t = ms - acc; if (t >= 0 && t < rr) v += forma(t); acc += rr; k++; if (k > 400) break; } return v; };
  const base = H * .6, amp = H * .34;
  const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const grade = () => { ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1; for (let x = 0; x < W; x += 20){ ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } for (let y = 0; y < H; y += 20){ ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } };
  const cor = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#fff";
  let cursor = 0, t0 = performance.now();
  const desenharTudo = (ate) => {
    ctx.clearRect(0, 0, W, H); grade();
    ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.strokeStyle = cor;
    ctx.shadowColor = "rgba(255,255,255,.35)"; ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let x = 0; x <= ate; x += 2){ const y = base - volt(x / pxMs) * amp; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke(); ctx.shadowBlur = 0;
  };
  if (reduzido){ desenharTudo(W); return; }
  const passo = () => {
    if (!c.isConnected) return;
    const el = performance.now() - t0;
    cursor = (el * pxMs) % W;
    ctx.clearRect(0, 0, W, H); grade();
    ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.strokeStyle = cor; ctx.shadowColor = "rgba(255,255,255,.35)"; ctx.shadowBlur = 6;
    // à esquerda do cursor: a volta atual; à direita: a volta anterior, mais apagada
    const volta = Math.floor(el * pxMs / W);
    const tracar = (x0, x1, off, alpha) => { ctx.globalAlpha = alpha; ctx.beginPath(); for (let x = x0; x <= x1; x += 2){ const ms = (x + off) / pxMs; const y = base - volt(ms) * amp; if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); };
    tracar(0, cursor, volta * W, 1);
    if (volta > 0) tracar(Math.min(W, cursor + 22), W, (volta - 1) * W, .35);
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    ctx.fillStyle = cor; ctx.beginPath(); ctx.arc(cursor, base - volt((cursor + volta * W) / pxMs) * amp, 2.6, 0, 7); ctx.fill();
    requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}
function animarNumeros(){
  const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  app.querySelectorAll("[data-count]").forEach(el => {
    const alvo = +el.dataset.count, sufixo = el.querySelector(".u") ? el.querySelector(".u").outerHTML : "";
    if (reduzido || !alvo){ el.innerHTML = alvo + sufixo; return; }
    const t0 = performance.now(), dur = 700;
    const tick = () => { const p = Math.min(1, (performance.now() - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.innerHTML = Math.round(alvo * e) + sufixo; if (p < 1 && el.isConnected) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}
function cardLeitura(l){
  return `<button class="card grad ${l.alerta ? "pulso" : "vital"} rcard" type="button" data-abrir="${l.id}">
    <div class="top-l"><div><strong>${l.conc}</strong><div class="meta">${curtoDe(l)} · ${dataCurta(l.quando)}</div></div><span class="tag">${l.alerta ? "atenção" : "ok"}</span></div>
    ${spark(l)}
  </button>`;
}

/* ---------- biblioteca ---------- */
function filtradas(){
  const f = S.filtro, b = f.busca.trim().toLowerCase();
  return S.leituras.filter(l => (f.motivo === "todas" || l.motivo === f.motivo) && (!f.atencao || l.alerta)
    && (!b || (l.conc + " " + l.laudo + " " + (l.queixa || "")).toLowerCase().includes(b)));
}
function biblioteca(){
  const lista = filtradas(), motivos = contagemMotivos();
  return `<div class="screen">
  <div class="top"><div class="t"><small>Só você vê</small><strong>Biblioteca</strong></div><span class="pill"><b>${S.leituras.length}</b> leitura${S.leituras.length === 1 ? "" : "s"}</span></div>
  <div class="scroll stagger com-nav">
    <label class="search">${I.busca}<input type="search" id="busca" placeholder="Buscar no laudo" value="${S.filtro.busca.replace(/"/g, "&quot;")}" autocomplete="off"></label>
    <div class="hscroll">
      <button class="chip" type="button" data-fmotivo="todas" aria-pressed="${S.filtro.motivo === "todas"}">Todas</button>
      <button class="chip" type="button" data-fatencao="1" aria-pressed="${S.filtro.atencao}">Com atenção</button>
      ${motivos.map(([k, n]) => `<button class="chip" type="button" data-fmotivo="${k}" aria-pressed="${S.filtro.motivo === k}">${(MOTIVOS.find(m => m.k === k) || {curto:k}).curto} · ${n}</button>`).join("")}
    </div>
    ${lista.length ? `<div class="rlist">${lista.map(itemLeitura).join("")}</div>`
      : `<div class="empty">${I.vazio}<p class="ink2">${S.leituras.length ? "Nada com esse filtro." : "Ainda não há leituras salvas."}</p><p class="tiny">${S.leituras.length ? "Tente outra busca ou limpe os filtros." : "Cada leitura guarda o laudo, as respostas e a foto, só neste celular."}</p></div>`}
  </div>${nav()}</div>`;
}
function itemLeitura(l){
  return `<button class="ritem" type="button" data-abrir="${l.id}">
    <span class="sw grad ${l.alerta ? "pulso" : "vital"}">${l.thumb ? `<img src="${l.thumb}" alt="">` : spark(l)}</span>
    <span><strong>${l.conc}</strong><span class="m">${curtoDe(l)} · ${dataCurta(l.quando)}</span></span>
    <span class="tag ${l.alerta ? "bad" : "ok"}">${l.alerta ? "atenção" : "ok"}</span>
  </button>`;
}
function detalhe(){
  const l = S.detalhe;
  return `<div class="screen">
  <div class="top"><button class="icobtn ghost" type="button" data-aba="biblioteca" aria-label="Voltar">${I.voltar}</button><div class="t"><small>${curtoDe(l)} · ${dataCurta(l.quando)}</small><strong>Leitura salva</strong></div><span class="tag ${l.alerta ? "bad" : "ok"}">${l.alerta ? "atenção" : "ok"}</span></div>
  <div class="scroll stagger">
    ${l.thumb ? `<img src="${l.thumb}" alt="Miniatura do eletro" style="width:100%;border-radius:18px;border:1px solid var(--line-2)">` : `<div class="card grad ${l.alerta ? "pulso" : "vital"}" style="min-height:90px;justify-content:flex-end">${spark(l)}</div>`}
    <div class="laudo">${l.laudo}${assinatura() ? `<div class="sig">${assinatura().trim()}</div>` : ""}</div>
    <div class="row2"><button class="btn" type="button" data-copiar="1">${I.copiar}Copiar</button><button class="btn danger" type="button" data-apagar="${l.id}">${I.lixo}Apagar</button></div>
  </div></div>`;
}

/* ---------- guia (a esfera) ---------- */
function guia(){
  const aba = S.guiaAba, t = (k, l) => `<button class="chip" type="button" data-guia="${k}" aria-pressed="${aba === k}">${l}</button>`;
  let corpo = "";
  if (aba === "calc"){
    const c = S.calc;
    corpo = `<div class="card"><h3>Frequência cardíaca</h3>
      <div class="calc"><label for="g-cq">Quadradinhos entre dois QRS · 1500 ÷ n</label><div class="linha"><input type="number" id="g-cq" inputmode="decimal" step="0.5" min="0" value="${c.cq || ""}" data-gcalc="div" data-fator="1500"><span class="res" id="g-cq-res">—</span></div></div>
      <div class="calc"><label for="g-cg">Quadrados grandes entre dois QRS · 300 ÷ n</label><div class="linha"><input type="number" id="g-cg" inputmode="decimal" step="0.5" min="0" value="${c.cg || ""}" data-gcalc="div" data-fator="300"><span class="res" id="g-cg-res">—</span></div></div>
      <div class="calc"><label for="g-c10">QRS em 10 segundos · n × 6</label><div class="linha"><input type="number" id="g-c10" inputmode="numeric" min="0" value="${c.c10 || ""}" data-gcalc="mul" data-fator="6"><span class="res" id="g-c10-res">—</span></div></div>
    </div>
    <div class="card"><h3>QT corrigido (Bazett)</h3><p class="tiny mute">QTc = QT ÷ √RR, com RR em segundos.</p>
      <div class="row2"><div class="field"><label for="g-qt">QT (ms)</label><input type="number" id="g-qt" inputmode="numeric" value="${c.qt || ""}"></div><div class="field"><label for="g-fc">FC (bpm)</label><input type="number" id="g-fc" inputmode="numeric" value="${c.fc || ""}"></div></div>
      <div class="readout"><span class="num" id="g-qtc">—<span class="u">ms</span></span></div>
      <p class="tiny mute">Os cortes de referência ficam por conta do Dr. Vitor, na etapa de QT.</p></div>`;
  } else if (aba === "uso"){
    corpo = `<div class="card"><h3>A sequência</h3><p class="small ink2">Motivo do exame → técnica → ritmo → regularidade e frequência → eixo → descarte de arritmias → descarte de isquemia → QRS, QT e alto risco. O Copiloto guarda cada resposta e usa nas etapas seguintes, sem perguntar de novo.</p></div>
      <div class="card"><h3>A foto é opcional</h3><p class="small ink2">Você pode ler direto no papel. Com a foto, o eletro fica à mão durante a leitura (o olho no topo da etapa) e dá para medir com a régua na tela. <b>Câmera</b> fotografa na hora; <b>Galeria</b> usa uma foto já tirada.</p></div>
      <div class="card"><h3>A régua na foto</h3><p class="small ink2">Antes de medir, arraste as duas bolinhas sobre cinco quadradões (1 segundo de papel). O app aprende a escala daquela foto e passa a medir em milissegundos.</p></div>
      <div class="card"><h3>O laudo</h3><p class="small ink2">O texto final é montado com as suas respostas e pode sair assinado com o seu nome (Configurações). Confira antes de copiar.</p></div>
      <div class="card"><h3>Privacidade</h3><p class="small ink2">A foto e as respostas ficam neste aparelho. O app não envia nada para servidor nenhum.</p></div>`;
  } else {
    const g = [["Ritmo sinusal","P positiva em DI, DII e aVF, negativa em aVR, precedendo cada QRS com a mesma morfologia."],["Regular / irregular","Compare os intervalos R-R ao longo do traçado."],["QRS largo","120 ms ou mais: três quadradinhos ou mais."],["Derivações contíguas","Inferior: DII, DIII, aVF · Lateral: DI, aVL, V5, V6 · Anterior/septal: V1 a V4."],["Calibração padrão","25 mm/s e 10 mm/mV, impressos no próprio ECG."],["Eixo por DI e aVF","Os dois positivos: normal. DI positivo e aVF negativo: DII desempata. DI negativo e aVF positivo: direita. Os dois negativos: extremo."]];
    corpo = `<div class="card"><h3>Termos usados no app</h3><div class="gloss">${g.map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("")}</div><p class="tiny mute">Definições como aparecem no roteiro do Dr. Vitor.</p></div>`;
  }
  return `<div class="screen">
  <div class="top"><div class="t"><small>Copiloto</small><strong>Guia</strong></div>${I.guia.replace("<svg", '<svg style="width:22px;height:22px;color:var(--mute)"')}</div>
  <div class="scroll stagger com-nav">
    <div class="hscroll">${t("calc","Calculadoras")}${t("uso","Como usar")}${t("gloss","Termos")}</div>
    ${corpo}
  </div>${nav()}</div>`;
}

/* ---------- configurações ---------- */
function config(){
  const p = S.prefs, n = S.leituras.length;
  return `<div class="screen">
  <div class="top"><button class="icobtn ghost" type="button" data-aba="inicio" aria-label="Voltar">${I.voltar}</button><div class="t"><small>Este aparelho</small><strong>Configurações</strong></div></div>
  <div class="scroll stagger">
    <div class="card"><div class="field"><label for="p-nome">Como o Copiloto deve chamar você</label><input type="text" id="p-nome" value="${(p.nome || "").replace(/"/g, "&quot;")}" placeholder="Dr. Vitor" autocomplete="off"></div>
      <p class="tiny mute">Aparece na saudação e, se quiser, no fim do laudo.</p></div>
    <div class="card">
      <div class="toggle"><div class="l"><strong>Assinar o laudo</strong><span>Acrescenta seu nome e a data ao copiar</span></div><button class="switch" type="button" role="switch" aria-checked="${!!p.assinatura}" data-pref="assinatura"></button></div>
      <div class="toggle"><div class="l"><strong>Tema claro</strong><span>Para ambientes muito iluminados</span></div><button class="switch" type="button" role="switch" aria-checked="${p.tema === "claro"}" data-pref="tema"></button></div>
    </div>
    <div class="card"><h3>Dados</h3><p class="small mute">${n} leitura${n === 1 ? "" : "s"} guardada${n === 1 ? "" : "s"} neste aparelho. Nada é enviado a servidor.</p>
      <button class="btn danger" type="button" data-apagar-tudo="1" ${n ? "" : "disabled"}>${I.lixo}Apagar todas as leituras</button>
      ${S.confirmaApagar ? `${ins("bad", "Tem certeza?", `Isso apaga as ${n} leituras e as fotos. Não dá para desfazer.`)}<div class="row2"><button class="btn" type="button" data-cancela-apagar="1">Cancelar</button><button class="btn danger" type="button" data-confirma-apagar="1">Apagar tudo</button></div>` : ""}</div>
    <p class="tiny mute" style="text-align:center">Copiloto de ECG · versão 4 · roteiro clínico do Dr. Vitor Coutinho</p>
  </div></div>`;
}
function assinatura(){
  const n = (S.prefs.nome || "").trim();
  if (!S.prefs.assinatura || !n) return "";
  return `\n\n— ${n} · ${new Date().toLocaleDateString("pt-BR")}`;
}

/* ---------- etapa 1: o paciente ---------- */
function telaMotivo(){
  const m = motivo();
  return `<div class="screen">
  <div class="top"><span class="ghostnum" aria-hidden="true">01</span><button class="icobtn ghost" type="button" data-aba="inicio" aria-label="Voltar">${I.voltar}</button><span class="step-num">01</span><div class="t"><small>Etapa 1 de ${ULTIMO}</small><strong>Olhe para o paciente</strong></div></div>
  ${progresso(1)}
  <div class="scroll stagger" id="seq-scroll">
    <p class="q">O que motivou este ECG?</p>
    <div class="tiles">${MOTIVOS.map((x, i) => `<button type="button" class="tile" data-motivo="${x.k}" aria-pressed="${S.cur.motivo === x.k}"><span class="ix">${dois(i + 1)}</span><strong>${x.nome}</strong></button>`).join("")}</div>
    ${m ? `<div class="orient" id="orient"><span class="eyebrow">Antes de olhar o traçado</span>${m.texto.map(t => `<p>${t}</p>`).join("")}</div>` : `<p class="tiny mute">A depender do motivo, o Copiloto mostra o que não pode passar naquele contexto.</p>`}
  </div>
  <div class="foot"><button class="btn primary" type="button" data-ir="foto" ${m ? "" : "disabled"}>Iniciar leitura ${I.seta}</button></div></div>`;
}

/* ---------- foto (opcional) ---------- */
function telaFoto(){
  const c = S.cur;
  if (!c.tela){
    return `<div class="screen">
    <div class="top"><button class="icobtn ghost" type="button" data-ir="motivo" aria-label="Voltar">${I.voltar}</button><div class="t"><small>Opcional</small><strong>Quer usar a foto do eletro?</strong></div></div>
    <div class="scroll stagger">
      <p class="small mute">Com a foto, o traçado fica à mão durante toda a leitura e dá para medir com a régua na tela. Sem ela, você lê direto no papel.</p>
      <button class="dropzone" type="button" data-fonte="camera">${I.camera}<strong>Fotografar o eletro</strong><span class="mute tiny">Abre a câmera</span></button>
      <button class="btn wide" type="button" data-fonte="galeria">${I.galeria}Escolher uma foto já tirada</button>
      <div class="card tight"><h3>Para a foto sair boa</h3><p class="small mute">Papel esticado numa superfície plana · luz de lado, sem flash · celular paralelo ao papel · enquadre só o eletro, o mais perto que der.</p></div>
      <p class="tiny mute">A foto fica neste aparelho. O app não envia imagem para lugar nenhum.</p>
    </div>
    <div class="foot"><button class="btn primary" type="button" data-ir="seq">Seguir sem foto ${I.seta}</button></div></div>`;
  }
  const q = c.foto, avisos = avisosFoto(q), ruim = avisos.some(a => a.n === "bad");
  return `<div class="screen">
  <div class="top"><button class="icobtn ghost" type="button" data-ir="motivo" aria-label="Voltar">${I.voltar}</button><div class="t"><small>Opcional</small><strong>A foto ficou boa?</strong></div></div>
  ${visorHTML("full", "Arraste para mover, pince para aproximar.")}
  <div class="scroll stagger" style="padding-top:12px">
    ${avisos.length ? avisos.map(a => ins(a.n, a.t, a.d)).join("") : ins("ok", "Foto boa", "Nitidez, luz e tamanho estão dentro do esperado.")}
    <p class="tiny mute">O conferidor é automático, não um veredito. Se essa é a única foto possível agora, dá para seguir.</p>
  </div>
  <div class="foot">
    <button class="btn" type="button" data-fonte="camera" aria-label="Câmera">${I.camera}</button>
    <button class="btn" type="button" data-fonte="galeria" aria-label="Galeria">${I.galeria}</button>
    <button class="btn primary" type="button" data-ir="seq">${ruim ? "Usar assim mesmo" : "Usar esta foto"}</button>
  </div></div>`;
}

/* ---------- régua na foto ---------- */
function telaMedir(){
  const m = S.medir, c = S.cur;
  if (!c.escala){
    const quad = c.calQuadrados || 5;
    return `<div class="screen">
    <div class="top"><button class="icobtn ghost" type="button" data-sair-medir="1" aria-label="Voltar">${I.voltar}</button><div class="t"><small>Régua na foto</small><strong>Primeiro, calibre</strong></div></div>
    ${visorHTML("full", "Ponha cada bolinha em uma linha grossa, contando " + quad + " quadradão" + (quad > 1 ? "es" : "") + ".")}
    <div class="scroll" style="padding-top:12px">
      <p class="q sm">Diga ao app quanto vale um quadradinho nesta foto.</p>
      <div class="hscroll">
        <button class="chip" type="button" data-quad="5" aria-pressed="${quad===5}">5 quadradões · 1 s</button>
        <button class="chip" type="button" data-quad="3" aria-pressed="${quad===3}">3 quadradões</button>
        <button class="chip" type="button" data-quad="1" aria-pressed="${quad===1}">1 quadradão · 0,2 s</button>
      </div>
      <div class="card" id="cal-out"></div>
      <div id="cal-aviso"></div>
    </div>
    <div class="foot"><button class="btn primary" type="button" id="usar-cal">Calibrar</button></div></div>`;
  }
  const titulo = m.alvo === "fc" ? "Medir o RR" : "Medir o QRS";
  const dica = m.alvo === "fc" ? "Uma bolinha em cada pico de QRS, em dois batimentos seguidos." : "Do começo ao fim do QRS.";
  return `<div class="screen">
  <div class="top"><button class="icobtn ghost" type="button" data-sair-medir="1" aria-label="Voltar">${I.voltar}</button><div class="t"><small>Régua na foto</small><strong>${titulo}</strong></div><button class="textbtn" type="button" data-recalibrar="1">Recalibrar</button></div>
  ${visorHTML("full", dica)}
  <div class="scroll" style="padding-top:12px"><div class="card" id="medir-out"></div></div>
  <div class="foot"><button class="btn primary" type="button" id="usar-medida">Usar esta medida</button></div></div>`;
}
function telaVer(){
  return `<div class="screen">
  <div class="top"><button class="icobtn ghost" type="button" data-fechar-ver="1" aria-label="Voltar">${I.voltar}</button><div class="t"><small>Etapa ${S.cur.passo} de ${ULTIMO}</small><strong>O eletro</strong></div><button class="icobtn" type="button" data-fechar-ver="1" aria-label="Fechar">${I.fechar}</button></div>
  ${visorHTML("tudo", "Arraste para mover, pince para aproximar.")}</div>`;
}

/* ---------- etapas 2 a 8 ---------- */
const ETAPAS = {
  2: () => {
    const r = R(), cal = r.vel && r.amp, calOk = calibPadrao();
    let h = `<p class="small mute">Vamos confirmar rapidamente se o traçado é adequado para interpretação.</p>
    <div class="sec"><h3>2.1 — Calibração</h3></div><p class="small ink2">Confira a calibração impressa no ECG.</p>
    <span class="eyebrow">Velocidade</span><div class="opts">${opt("vel","25","25 mm/s")}${opt("vel","outra","Outra / não sei")}</div>
    <span class="eyebrow">Amplitude</span><div class="opts">${opt("amp","10","10 mm/mV")}${opt("amp","outra","Outra / não sei")}</div>
    ${ajuda("ondecal", "Onde encontro isso?")}
    ${S.aberto.ondecal ? `<div class="helpbox">${pendente("Foto padrão de um ECG mostrando onde ficam a velocidade e a amplitude impressas")}</div>` : ""}`;
    if (cal){
      h += calOk ? ins("ok", "Calibração padrão", "")
        : ins("warn", "Atenção à calibração", "Este ECG não foi confirmado em 25 mm/s e 10 mm/mV. Isso modifica a relação entre os quadrados do papel e o tempo. Sugiro repetir o ECG.") + `<div class="opts">${opt("calSeguir","sim","Continuar mesmo assim")}</div>`;
    }
    if (cal && (calOk || r.calSeguir)){
      h += `<div class="sec"><h3>2.2 — Eletrodos dos membros</h3></div>
      <div class="crit"><p>DI com onda P positiva e/ou QRS predominantemente positivo</p><p>aVR com onda P negativa e/ou QRS predominantemente negativo</p></div>
      <p class="q sm">O traçado está assim?</p>
      <div class="opts">${opt("elet","sim","Sim")}${opt("elet","nao","Não")}</div>`;
      if (r.elet === "sim") h += ins("ok", "Padrão habitual das derivações dos membros", "");
      if (r.elet === "nao"){
        h += ins("warn", "Antes de interpretar, considere possível troca de eletrodos", "Quando onda P e QRS estão negativos em DI e positivos em aVR, suspeite especialmente de inversão dos eletrodos dos braços. Entretanto, alterações isoladas da polaridade do QRS podem representar o próprio padrão do paciente.");
        h += ajuda("eletajuda", "Me ajude a conferir os eletrodos");
        if (S.aberto.eletajuda) h += `<div class="helpbox"><p>Confira a posição dos eletrodos dos membros e, se houver suspeita de inversão, corrija a posição e repita o ECG antes de interpretar, sempre que possível.</p>${pendente("Imagem com a colocação correta dos eletrodos dos membros")}</div>`;
        h += `<div class="opts">${opt("eletSeguir","sim","Seguir mesmo assim")}</div>`;
      }
    }
    return {html:h, ok:() => !!(R().vel && R().amp && (calibPadrao() || R().calSeguir) && (R().elet === "sim" || (R().elet === "nao" && R().eletSeguir)))};
  },
  3: () => {
    const r = R();
    let h = `<p class="q">O ritmo é sinusal?</p>
    <div class="crit"><p>P positiva em DI, DII e aVF</p><p>P negativa em aVR</p><p>Ondas P precedem os QRS do ritmo de base</p><p>Ondas P com a mesma morfologia em uma mesma derivação</p></div>
    <div class="opts">${opt("ritmo","sim","Sim")}${opt("ritmo","nao","Não")}${opt("ritmo","duvida","Não tenho certeza")}</div>`;
    if (r.ritmo === "sim") h += ins("ok", "Ritmo sinusal", "");
    if (r.ritmo === "nao") h += ins("warn", "O ritmo não apresenta todos os critérios de ritmo sinusal", "Continue a sequência. Na etapa Descarte de arritmias, vamos caracterizá-lo melhor.");
    if (r.ritmo === "duvida"){
      h += `<div class="card"><span class="eyebrow">Como identificar o ritmo sinusal</span>
        <h3>1. Primeiro, encontre a onda P</h3><p class="small ink2">DII costuma ser uma boa derivação para começar.</p>${pendente("Imagem de um ECG sinusal destacando apenas a P em DII")}
        <div class="opts">${opt("wiz1","sim","Encontrei a onda P")}${opt("wiz1","nao","Não encontrei")}</div>`;
      if (r.wiz1 === "nao") h += ins("warn", "Sem uma onda P claramente identificável, o ritmo não é sinusal", "Continue a sequência. Vamos caracterizar melhor o ritmo em Descarte de arritmias.");
      if (r.wiz1 === "sim"){
        h += `<h3>2. Agora confira a polaridade da P</h3><p class="small ink2">Para uma onda P de origem sinusal, procure: positiva em DI, positiva em DII, positiva em aVF, negativa em aVR. Observe apenas se a onda P está predominantemente acima ou abaixo da linha de base.</p>${pendente("Imagem pequena com DI, DII, aVF e aVR mostrando a polaridade esperada da P")}
          <div class="opts">${opt("wiz2","sim","Tem característica sinusal")}${opt("wiz2","nao","Não tem característica sinusal")}</div>`;
        if (r.wiz2 === "nao") h += ins("warn", "Os critérios de ritmo sinusal não estão todos presentes", "Não precisamos definir a arritmia agora. Continue a sequência: vamos caracterizar melhor o ritmo em Descarte de arritmias.");
        if (r.wiz2 === "sim"){
          h += `<h3>3. Olhe o ritmo de base</h3><p class="small ink2">As ondas P apresentam morfologia semelhante em uma mesma derivação e precedem os QRS do ritmo de base?</p><p class="tiny mute">Importante: um batimento diferente isolado, como uma extrassístole, não exclui necessariamente um ritmo de base sinusal.</p>
            <div class="opts">${opt("wiz3","sim","Sim")}${opt("wiz3","nao","Não")}</div>`;
          if (r.wiz3 === "sim") h += ins("ok", "Os achados são compatíveis com ritmo sinusal", "");
          if (r.wiz3 === "nao") h += ins("warn", "Os critérios de ritmo sinusal não estão todos presentes", "Não precisamos definir a arritmia agora. Continue a sequência: vamos caracterizar melhor o ritmo em Descarte de arritmias.");
        }
      }
      h += `</div>`;
    }
    return {html:h, ok:() => sinusal() !== null};
  },
  4: () => {
    const r = R();
    let h = `<div class="sec"><h3>4.1 — Regularidade</h3></div><p class="q sm">O ritmo é regular?</p><p class="tiny mute">Compare os intervalos R-R ao longo do traçado.</p>
    <div class="opts">${opt("reg","regular","Regular")}${opt("reg","irregular","Irregular")}</div>`;
    if (r.reg){
      h += `<div class="sec"><h3>4.2 — Frequência cardíaca</h3></div>
      <div class="field"><label for="fc">Qual a frequência cardíaca?</label><div class="linha"><input type="number" id="fc" inputmode="numeric" min="10" max="350" value="${r.fc || ""}" placeholder="—"><span class="u">bpm</span></div></div>
      ${ajuda("calcfc", "Me ajude a calcular a FC")}`;
      if (S.aberto.calcfc){
        const calc = (id, rot, fator, tipo) => `<div class="calc"><label for="${id}">${rot}</label><div class="linha"><input type="number" id="${id}" inputmode="decimal" min="0" step="0.5" value="${r[id] || ""}" data-calc="${tipo}" data-fator="${fator}"><span class="res" id="${id}-res">—</span><button class="btn small" type="button" data-usar-calc="${id}">Usar</button></div></div>`;
        h += `<div class="helpbox">`;
        if (r.reg === "regular"){
          h += `<p><b>1. Quadradinhos pequenos.</b> Conte quantos quadradinhos pequenos existem entre dois QRS consecutivos. FC = 1500 ÷ quadradinhos.</p>${calc("cq","Quadradinhos entre dois QRS",1500,"div")}
            <p><b>2. Quadrados grandes.</b> Conte quantos quadrados grandes existem entre dois QRS consecutivos. FC = 300 ÷ quadrados grandes.</p>${calc("cg","Quadrados grandes entre dois QRS",300,"div")}`;
        }
        h += `<p><b>${r.reg === "regular" ? "3. " : ""}Contagem em 10 segundos.</b> Em um trecho contínuo de 10 segundos, como o DII longo, conte o número de QRS. FC ${r.reg === "irregular" ? "média " : ""}= QRS × 6.</p>${calc("c10","QRS em 10 segundos",6,"mul")}`;
        if (r.reg === "regular" && S.cur.tela) h += `<p><b>4. Régua na foto.</b> Meça a distância entre dois QRS na própria foto.</p><button class="btn small" type="button" data-medir="fc">${I.regua}Medir na foto</button>`;
        h += `</div>`;
      }
      if (r.fc) h += ins("ok", "FC registrada: " + r.fc + " bpm", r.reg === "irregular" ? "Frequência média estimada." : "");
    }
    return {html:h, ok:() => !!(R().reg && R().fc)};
  },
  5: () => {
    const r = R(), e = eixo();
    let h = `<div class="sec"><h3>5.1 — Como é o QRS em DI?</h3></div><div class="opts">${opt("di","pos","Predominantemente positivo")}${opt("di","neg","Predominantemente negativo")}</div>
    <div class="sec"><h3>5.2 — Como é o QRS em aVF?</h3></div><div class="opts">${opt("avf","pos","Predominantemente positivo")}${opt("avf","neg","Predominantemente negativo")}</div>
    ${ajuda("polqrs", "Me ajude a saber se o QRS é positivo ou negativo")}`;
    if (S.aberto.polqrs){
      h += `<div class="helpbox"><p>Observe o QRS em relação à linha de base.</p><p><b>Predominantemente positivo</b> → a maior parte do QRS está acima da linha de base.</p><p><b>Predominantemente negativo</b> → a maior parte do QRS está abaixo da linha de base.</p>
        <div class="figs"><figure>${qrsFig("ralto")}<figcaption>R alto</figcaption></figure><figure>${qrsFig("qr")}<figcaption>qR</figcaption></figure><figure>${qrsFig("qs")}<figcaption>QS</figcaption></figure><figure>${qrsFig("rs")}<figcaption>rS</figcaption></figure></div>
        <p class="tiny mute">Os dois primeiros são positivos; os dois últimos, negativos. Desenho esquemático, a validar pelo Dr. Vitor.</p></div>`;
    }
    if (r.di === "pos" && r.avf === "neg"){
      h += `<div class="sec"><h3>Agora observe DII</h3></div><p class="q sm">Como é o QRS em DII?</p><div class="opts">${opt("dii","pos","Predominantemente positivo")}${opt("dii","neg","Predominantemente negativo")}</div>`;
    }
    if (e) h += ins(e.k, e.t, "");
    return {html:h, ok:() => !!eixo()};
  },
  6: () => {
    const a = arritmia();
    return {html:`<p class="small mute">O Copiloto já sabe o ritmo, a regularidade e a frequência. Ele parte daí e só pergunta o que falta.</p>` + a.html, ok:() => arritmia().pronto};
  },
  7: () => {
    const r = R(), m = r.isq || [];
    let h = `<div class="sec"><h3>Antes de procurar alterações, pense em territórios</h3></div>
    <p class="small ink2">Não analise uma derivação isoladamente. Procure alterações em derivações anatomicamente contíguas.</p>
    <div class="terr">${TERR.map(([, b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("")}</div>
    <p class="q sm">Você identifica alguma destas alterações em pelo menos duas derivações contíguas?</p>
    <div class="opts">${opt("isq","supra","Supradesnivelamento do segmento ST",true)}${opt("isq","infra","Infradesnivelamento do segmento ST",true)}${opt("isq","tinv","Inversão simétrica da onda T",true)}${opt("isq","nenhuma","Nenhuma dessas alterações",true)}</div>
    ${ajuda("critsupra", "Me ajude a revisar os critérios de supra")}
    ${S.aberto.critsupra ? `<div class="helpbox">${pendente("Critérios de supra de ST por derivação, sexo e idade")}</div>` : ""}`;
    if (m.includes("supra")) h += ins("bad", "Supradesnivelamento de ST", "Em quais derivações?") + `<div class="opts">${TERR.map(([k, b, s]) => opt("terr", k, b + " · " + s, true)).join("")}</div>`;
    if (m.includes("infra")){
      h += ins("warn", "Infradesnivelamento de ST em derivações contíguas", "") + `<p class="q sm">Infra predominante em V1–V3?</p><div class="opts">${opt("infraV1","sim","Sim")}${opt("infraV1","nao","Não")}</div>`;
      if (r.infraV1 === "sim") h += ins("bad", "Lembre-se de considerar infarto com supra posterior", "Avalie as derivações posteriores (V7–V9).");
      if (r.infraV1 === "nao") h += ins("warn", "Pode representar isquemia subendocárdica", "Dependendo da morfologia e do contexto clínico.");
    }
    if (m.includes("tinv")) h += ins("warn", "Ondas T invertidas e simétricas em derivações contíguas", "Avalie distribuição, profundidade, comparação com ECG prévio e contexto clínico.");
    if (m.includes("nenhuma")){
      h += `<div class="sec"><h3>Antes de seguir, procure padrões de alto risco</h3></div><p class="small ink2">Faça uma última checagem:</p>
        <div class="opts">${PADROES.map(([k,l]) => opt("padroes", k, l, true)).join("")}${opt("padroes","nenhum","Nenhum desses padrões",true)}</div>
        ${ajuda("padraoajuda", "Não sei identificar")}
        ${S.aberto.padraoajuda ? `<div class="helpbox">${PADROES.map(([,l]) => pendente(l + ": imagem validada e 2 ou 3 características")).join("")}</div>` : ""}`;
      const p = r.padroes || [];
      if (p.includes("nenhum")) h += ins("ok", "Nenhum padrão isquêmico evidente identificado nesta etapa", "");
      else if (p.length) h += ins("bad", "Padrão de alto risco marcado", p.map(x => PADROES.find(y => y[0] === x)[1]).join(" · "));
    }
    return {html:h, ok:() => isquemia().pronto};
  },
  8: () => ({html:`${ins("info", "Etapa em construção", "O Dr. Vitor está escrevendo esta parte: QRS, intervalo QT e padrões de alto risco. Assim que ela chegar, entra aqui.")}
    <p class="small mute">Por enquanto, siga para o resumo. O laudo avisa que esta etapa ainda não foi feita.</p>`, ok:() => true})
};

function telaSeq(){
  const i = S.cur.passo, v = ETAPAS[i]();
  const dir = S.dir || ""; S.dir = "";
  return `<div class="screen ${dir}">
  ${topo(i, PASSOS[i], `${S.cur.tela ? `<button class="icobtn" type="button" data-ver="1" aria-label="Ver o eletro">${I.olho}</button>` : ""}<button class="icobtn ghost" type="button" data-aba="inicio" aria-label="Sair">${I.fechar}</button>`)}
  ${progresso(i)}
  <div class="scroll stagger" id="seq-scroll">${v.html}</div>
  <div class="foot"><button class="btn primary" type="button" id="proxima" ${v.ok() ? "" : "disabled"}>${i === ULTIMO ? "Ver resumo e laudo" : "Próxima etapa"} ${I.seta}</button></div></div>`;
}

/* ---------- laudo ---------- */
const minuscula = s => s.charAt(0).toLowerCase() + s.slice(1);
function resumo(){
  const r = R(), m = motivo(), e = eixo(), a = arritmia(), isq = isquemia();
  const linhas = [], conc = [], atencao = [], blocos = [];
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
    conc.push(a.res.t); blocos.push({t:"Ritmo", v:a.res.t, k:a.res.k, d:`${r.reg}, FC ${r.fc} bpm`});
    if (a.res.k !== "ok") atencao.push(a.res.t);
    if (a.extra){ linhas.push(a.extra + "."); conc.push(minuscula(a.extra)); atencao.push(a.extra); blocos.push({t:"Batimentos diferentes", v:a.extra, k:"warn"}); }
  }
  if (e){
    linhas.push(e.t + ".");
    blocos.push({t:"Eixo", v:e.t, k:e.k, d:`DI ${r.di === "pos" ? "+" : "−"} · aVF ${r.avf === "pos" ? "+" : "−"}${r.dii ? " · DII " + (r.dii === "pos" ? "+" : "−") : ""}`});
    if (e.k !== "ok"){ conc.push(minuscula(e.t)); atencao.push(e.t); }
  }
  if (isq.pronto){
    if (isq.achados.length){ isq.achados.forEach(x => { linhas.push(x + "."); conc.push(minuscula(x)); atencao.push(x); blocos.push({t:"Isquemia", v:x, k:"bad"}); }); }
    else { linhas.push("Nenhum padrão isquêmico evidente identificado."); blocos.push({t:"Isquemia", v:"Nenhum padrão isquêmico evidente", k:"ok"}); }
  }
  linhas.push("Etapa de QRS, QT e padrões de alto risco ainda não disponível nesta versão.");
  linhas.push("");
  const semAtencao = !atencao.length && conc.length;
  linhas.push("Conclusão: " + (conc.length ? conc.join("; ") + (semAtencao ? ", sem alterações nas demais etapas avaliadas" : "") : "sem alterações nas etapas avaliadas") + ".");
  const titulo = conc.length ? conc[0].charAt(0).toUpperCase() + conc[0].slice(1) + (conc.length > 1 ? " + " + (conc.length - 1) : "") : "Sem alterações nas etapas avaliadas";
  return {texto:linhas.join("\n"), titulo, atencao, blocos};
}
function telaLaudo(){
  const s = resumo(), m = motivo();
  return `<div class="screen">
  <div class="top"><button class="icobtn ghost" type="button" data-voltar="1" aria-label="Voltar">${I.voltar}</button><div class="t"><small>Leitura concluída${m ? " · " + m.curto : ""}</small><strong>Resumo e laudo</strong></div><button class="icobtn ghost" type="button" data-aba="inicio" aria-label="Fechar">${I.fechar}</button></div>
  <div class="scroll stagger">
    ${s.atencao.length ? ins("bad", s.atencao.length === 1 ? "1 ponto de atenção" : s.atencao.length + " pontos de atenção", s.atencao.join(" · ")) : ins("ok", "Nenhum ponto de atenção nas etapas avaliadas", "")}
    <div class="sec"><h3>O que o Copiloto mapeou</h3></div>
    ${s.blocos.map((b, i) => `<div class="ins ${b.k}"><span class="ix">${dois(i + 1)} · ${b.t.toUpperCase()}</span><strong>${b.v}</strong>${b.d ? `<p>${b.d}</p>` : ""}</div>`).join("")}
    ${m ? `<div class="orient"><span class="eyebrow">Volte ao paciente · ${m.curto}</span><p>${m.texto[0]}</p></div>` : ""}
    <div class="sec"><h3>Laudo</h3><span class="tiny mute">montado com as suas respostas</span></div>
    <div class="laudo" id="laudo">${s.texto}${assinatura() ? `<div class="sig">${assinatura().trim()}</div>` : ""}</div>
    <div class="row2"><button class="btn" type="button" data-copiar="1">${I.copiar}Copiar</button><button class="btn" type="button" id="salvar">${S.cur.salva ? I.check + "Salvo" : I.salvar + "Salvar"}</button></div>
    <div class="card tight"><h3>Ficou com dúvida?</h3><p class="small mute">Copie o laudo e leve para o PreceptorIA, ou para discutir o caso no Clube do Plantonista.</p></div>
    <p class="tiny mute" style="text-align:center">Quem leu foi você. O Copiloto garantiu que nenhuma etapa ficou para trás e fez as contas.</p>
  </div>
  <div class="foot"><button class="btn primary" type="button" data-ir="motivo">Nova leitura ${I.seta}</button></div></div>`;
}

/* ---------- desenhar e ligar ---------- */
function aviso(msg){
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  app.appendChild(t);
  setTimeout(() => t.remove(), 1700);
}
function manterRolagem(fn){
  const sc = document.getElementById("seq-scroll"), topoR = sc ? sc.scrollTop : 0;
  fn();
  const sc2 = document.getElementById("seq-scroll");
  if (sc2){ sc2.classList.remove("stagger"); sc2.scrollTop = topoR; }
}
const RAMO6 = ["extra","extraQrs","qrs","tq","pind","temP","rel","bav","pns"];
const DEPENDE = {
  vel:["calSeguir"], amp:["calSeguir"], elet:["eletSeguir"],
  ritmo:["wiz1"].concat(RAMO6), wiz1:["wiz2"].concat(RAMO6), wiz2:["wiz3"].concat(RAMO6), wiz3:RAMO6,
  reg:RAMO6.concat(["cq","cg","c10","fc"]), fc:RAMO6, extra:["extraQrs"], qrs:["tq","pind"], temP:["rel","bav","qrs"], rel:["bav"], pns:["qrs"],
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
    const novo = app.querySelector(`[data-ans="${k}"][data-val="${v}"]`); if (novo) novo.classList.add("pop");
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
  const s = resumo(), r = R();
  const reg = { id:S.cur.id, quando:S.cur.quando, motivo:S.cur.motivo, queixa:motivo() ? motivo().nome : "Leitura",
    conc:s.titulo, alerta:s.atencao.length > 0, laudo:s.texto, thumb:miniatura(),
    fc:r.fc || null, qrsLargo:r.qrs === "largo", irregular:r.reg === "irregular" };
  S.leituras = [reg].concat(S.leituras.filter(l => l.id !== reg.id));
  gravarJSON(CHAVE, S.leituras);
  if (S.cur.blob) guardarFoto(S.cur.id, S.cur.blob);
  S.cur.salva = true;
  aviso("Salvo neste aparelho");
  manterRolagem(desenhar);
}
function soltarVisor(){ if (S.visor){ S.visor.destruir(); S.visor = null; } }
function irPara(t){
  if (t === "motivo" && S.tela !== "foto" && S.tela !== "seq"){ S.cur = nova(); S.vista = null; S.aberto = {}; }
  soltarVisor();
  S.tela = t;
  desenhar();
  const sc = document.getElementById("seq-scroll"); if (sc) sc.scrollTop = 0;
}
function irAba(a){
  soltarVisor();
  S.tela = "inicio"; S.aba = a; S.confirmaApagar = false;
  desenhar();
}
function escalonar(){
  app.querySelectorAll(".stagger").forEach(st => [...st.children].forEach((el, i) => el.style.setProperty("--i", Math.min(i, 12))));
}
function desenhar(){
  const telas = { inicio:() => ({inicio, biblioteca, guia, config}[S.aba] || inicio)(),
    motivo:telaMotivo, foto:telaFoto, seq:telaSeq, medir:telaMedir, ver:telaVer, detalhe, laudo:telaLaudo };
  app.innerHTML = (telas[S.tela] || telas.inicio)();
  escalonar(); animarNumeros(); montarMonitor();

  app.querySelectorAll("[data-aba]").forEach(b => b.onclick = () => irAba(b.dataset.aba));
  app.querySelectorAll("[data-ir]").forEach(b => b.onclick = () => irPara(b.dataset.ir));
  app.querySelectorAll("[data-motivo]").forEach(b => b.onclick = () => {
    S.cur.motivo = b.dataset.motivo; manterRolagem(desenhar);
    const o = document.getElementById("orient"); if (o) o.scrollIntoView({block:"nearest", behavior:"smooth"});
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
    else if (S.cur.passo > 2){ S.cur.passo--; S.dir = "back"; }
    else S.tela = "foto";
    soltarVisor(); desenhar();
  });
  app.querySelectorAll("[data-abrir]").forEach(b => b.onclick = () => {
    S.detalhe = S.leituras.find(l => l.id === b.dataset.abrir);
    if (S.detalhe){ S.tela = "detalhe"; desenhar(); }
  });
  app.querySelectorAll("[data-copiar]").forEach(b => b.onclick = () => {
    const txt = (S.tela === "detalhe" ? S.detalhe.laudo : resumo().texto) + assinatura();
    try { navigator.clipboard.writeText(txt).then(() => aviso("Laudo copiado"), () => aviso("Não deu para copiar aqui")); }
    catch(_){ aviso("Não deu para copiar aqui"); }
  });
  app.querySelectorAll("[data-apagar]").forEach(b => b.onclick = () => {
    const id = b.dataset.apagar;
    S.leituras = S.leituras.filter(l => l.id !== id);
    gravarJSON(CHAVE, S.leituras);
    apagarFoto(id);
    aviso("Leitura apagada");
    irAba("biblioteca");
  });
  app.querySelectorAll("[data-fmotivo]").forEach(b => b.onclick = () => { S.filtro.motivo = b.dataset.fmotivo; desenhar(); });
  app.querySelectorAll("[data-fatencao]").forEach(b => b.onclick = () => { S.filtro.atencao = !S.filtro.atencao; desenhar(); });
  app.querySelectorAll("[data-guia]").forEach(b => b.onclick = () => { S.guiaAba = b.dataset.guia; desenhar(); });
  app.querySelectorAll("[data-pref]").forEach(b => b.onclick = () => {
    const k = b.dataset.pref;
    if (k === "tema") S.prefs.tema = S.prefs.tema === "claro" ? "escuro" : "claro"; else S.prefs[k] = !S.prefs[k];
    gravarJSON(CHAVE_PREFS, S.prefs); aplicarTema(); desenhar();
  });
  const nome = document.getElementById("p-nome");
  if (nome) nome.oninput = () => { S.prefs.nome = nome.value; gravarJSON(CHAVE_PREFS, S.prefs); };
  app.querySelectorAll("[data-apagar-tudo]").forEach(b => b.onclick = () => { S.confirmaApagar = true; desenhar(); });
  app.querySelectorAll("[data-cancela-apagar]").forEach(b => b.onclick = () => { S.confirmaApagar = false; desenhar(); });
  app.querySelectorAll("[data-confirma-apagar]").forEach(b => b.onclick = () => {
    S.leituras.forEach(l => apagarFoto(l.id)); S.leituras = []; gravarJSON(CHAVE, []); S.confirmaApagar = false;
    aviso("Tudo apagado"); desenhar();
  });
  const busca = document.getElementById("busca");
  if (busca) busca.oninput = () => {
    S.filtro.busca = busca.value; const pos = busca.selectionStart;
    desenhar();
    const b2 = document.getElementById("busca"); if (b2){ b2.focus(); try { b2.setSelectionRange(pos, pos); } catch(_){} }
  };
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
  const contaCalc = inp => { const n = +inp.value, f = +inp.dataset.fator; return !n ? null : (inp.dataset.calc || inp.dataset.gcalc) === "div" ? Math.round(f / n) : Math.round(n * f); };
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
  // guia: calculadoras soltas
  app.querySelectorAll("[data-gcalc]").forEach(inp => {
    const res = document.getElementById(inp.id + "-res");
    const mostrar = () => { S.calc[inp.id.slice(2)] = inp.value; const fc = contaCalc(inp); res.textContent = fc ? fc + " bpm" : "—"; };
    inp.oninput = mostrar; mostrar();
  });
  const gqt = document.getElementById("g-qt"), gfc = document.getElementById("g-fc");
  if (gqt && gfc){
    const qtc = () => {
      S.calc.qt = gqt.value; S.calc.fc = gfc.value;
      const qt = +gqt.value, fc = +gfc.value;
      document.getElementById("g-qtc").innerHTML = (qt > 0 && fc > 0 ? Math.round(qt / Math.sqrt(60 / fc)) : "—") + `<span class="u">ms</span>`;
    };
    gqt.oninput = qtc; gfc.oninput = qtc; qtc();
  }

  if (S.tela === "foto" && S.cur.tela) montarVisor("#visor", {modo:"livre"});
  if (S.tela === "ver") montarVisor("#visor", {modo:"livre"});
  if (S.tela === "medir") ligarMedir();
  if (S.tela === "seq"){
    const b = document.getElementById("proxima");
    if (b) b.onclick = () => {
      if (S.cur.passo < ULTIMO){ S.cur.passo++; S.dir = "fwd"; desenhar(); const sc = document.getElementById("seq-scroll"); if (sc) sc.scrollTop = 0; }
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
      document.getElementById("cal-out").innerHTML = `<div class="readout"><span class="num">${pxmm.toFixed(1)}<span class="u">px/mm</span></span><span class="tag ${bom ? "ok" : aceitavel ? "warn" : "bad"}">${bom ? "boa" : aceitavel ? "no limite" : "insuficiente"}</span></div>
        <div class="kv"><span>Precisão da medida</span><span>± ${Math.max(1, Math.round(prec))} ms por pixel</span></div>
        <div class="kv"><span>Inclinação do papel</span><span>${(ang*180/Math.PI).toFixed(1)}°</span></div>`;
      document.getElementById("cal-aviso").innerHTML =
        (!aceitavel ? ins("bad", "A foto não dá resolução para medir", "Cada pixel vale " + Math.round(prec) + " ms: o erro de um dedo na tela já muda a medida. Tire outra foto mais perto do papel.") : "")
        + (aceitavel && !bom ? ins("warn", "Resolução no limite", "Dá para medir, mas chegando mais perto na próxima foto a medida fica bem mais firme.") : "")
        + (inclinado ? ins("info", "Papel torto na foto", "O app corrige a conta, mas endireitar a foto facilita a sua leitura.") : "");
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
      el.innerHTML = `<div class="readout"><span class="num">${f || "—"}<span class="u">bpm</span></span></div><div class="kv"><span>RR medido</span><span>${ms} ms · ${quadr(ms)} quadradinhos</span></div>`;
    } else {
      el.innerHTML = `<div class="readout"><span class="num">${ms}<span class="u">ms</span></span><span class="tag ${ms >= 120 ? "bad" : "ok"}">${ms >= 120 ? "largo" : "estreito"}</span></div><div class="kv"><span>Quadradinhos</span><span>${quadr(ms)}</span></div>`;
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
