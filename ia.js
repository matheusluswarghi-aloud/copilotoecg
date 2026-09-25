"use strict";
/* Copiloto de ECG — aba "Copiloto IA" (24/09/2026)
   A tela da IA: conversa, cartões, streaming da função copiloto-ia, teclado e sem sinal.
   Design: docs/plans/2026-09-24-copiloto-ia/design-aba.md · protocolo: supabase/functions/copiloto-ia/README.md.
   Este arquivo não conhece o raciocínio clínico: quem monta o resumo da leitura, leva medidas para a
   etapa e desenha as imagens de referência é o app.js, que entrega essas funções em configurar(api).
   A foto do eletro nunca entra aqui, nem no pedido. A conversa fica só na memória e no sessionStorage
   desta aba do navegador; quem guarda para a revisão do Dr. Vitor é a função. */
(function(){

const CHAVE = "copiloto.ia";
const MAX_HIST = 8, MAX_PERGUNTA = 1500;
const local = location.protocol === "http:" && (location.hostname === "localhost" || location.hostname === "127.0.0.1");

/* ---------- MODO SIMULADO ----------
   Para testar a aba sem a chave da API. Só existe no desenvolvimento local (http em localhost ou
   127.0.0.1, a mesma trava da conta-falsa.js): liga com ?ia=simulado, ou sozinho quando a função
   responde 503 ia_nao_configurada. Em produção (Pages, app instalado) nunca liga: a aba sempre chama
   a função de verdade. As respostas falsas estão no fim deste arquivo (respostaSimulada). */
let simulado = local && new URLSearchParams(location.search).get("ia") === "simulado";

let A = null;         // o que o app.js entrega (configurar)
let I = {};           // ícones do app
// dono: a leitura (o paciente) de que a conversa trata. Paciente novo = conversa nova (Rafael P1-6, 25/09)
const E = {turnos:[], ctxFora:null, restantes:null, limite:null, texto:"", abertos:{}, dono:null};
let corrente = null;  // resposta em andamento: {tu, ctl, fila, rodando}
let teclado = false, alturaCheia = 0;

const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;"}[c]));
const reduzido = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const online = () => !A || A.online();
const $ = id => document.getElementById(id);
const hoje = () => new Date().toLocaleDateString("pt-BR", {timeZone:"America/Sao_Paulo"});

/* ---------- guardar na aba do navegador ---------- */
function carregar(){
  try {
    const g = JSON.parse(sessionStorage.getItem(CHAVE));
    if (!g) return;
    E.turnos = (g.turnos || []).map(t => {
      // recarregou no meio de uma resposta: o que chegou fica, marcado como interrompido
      if (t.estado === "pensando" || t.estado === "vindo") t.estado = "interrompida";
      return t;
    });
    E.ctxFora = g.ctxFora || null; E.restantes = g.restantes ?? null; E.limite = g.limite || null; E.dono = g.dono || null;
  } catch(_){}
}
function gravar(){
  try { sessionStorage.setItem(CHAVE, JSON.stringify({turnos:E.turnos, ctxFora:E.ctxFora, restantes:E.restantes, limite:E.limite, dono:E.dono})); } catch(_){}
}
/* durante o streaming: grava no máximo uma vez por segundo, para recarregar no meio não perder o que já está na tela */
let ultimaGravacao = 0, gravarDepois = null;
function gravarAos(){
  const agora = Date.now(), falta = 1000 - (agora - ultimaGravacao);
  if (falta <= 0){ ultimaGravacao = agora; gravar(); return; }
  if (!gravarDepois) gravarDepois = setTimeout(() => { gravarDepois = null; ultimaGravacao = Date.now(); gravar(); }, falta);
}
function esquecer(){
  clearTimeout(gravarDepois); gravarDepois = null;
  if (corrente) try { corrente.ctl.abort(); } catch(_){}
  corrente = null; E.turnos = []; E.ctxFora = null; E.restantes = null; E.limite = null; E.texto = ""; E.abertos = {}; E.dono = null;
  try { sessionStorage.removeItem(CHAVE); } catch(_){}
}
/* conversa nova (o limite do dia fica): o lápis "Nova conversa", o paciente descartado ou outro paciente aberto */
function novaConversa(){
  clearTimeout(gravarDepois); gravarDepois = null;
  if (corrente) try { corrente.ctl.abort(); } catch(_){}
  corrente = null; E.turnos = []; E.abertos = {}; E.ctxFora = null; E.texto = ""; E.dono = null; gravar();
}
/* a conversa é do paciente, não do aparelho: se ela foi feita com outra leitura, começa outra */
function conferirDono(){
  if (!E.dono || !E.turnos.length) return;
  const L = A.leitura();
  if (L && L.id !== E.dono) novaConversa();
}
const limiteAtivo = () => !!E.limite && E.limite.dia === hoje();

/* ---------- textos por etapa ---------- */
const NO = {2:"na técnica", 3:"no ritmo", 4:"na regularidade e frequência", 5:"no eixo", 6:"no descarte de arritmias",
  7:"no descarte de isquemia", 8:"no QRS", 9:"no intervalo QT", 10:"nos padrões especiais"};
const O_QUE = {2:"a técnica de realização importa", 3:"o ritmo importa", 4:"a regularidade e a frequência importam", 5:"o eixo importa",
  6:"o descarte de arritmias importa", 7:"o descarte de isquemia importa", 8:"o QRS importa", 9:"o intervalo QT importa", 10:"os padrões especiais importam"};
const perguntaPorque = p => `Aprofunde: por que ${O_QUE[p] || "esta etapa importa"} nesta leitura?`;
const SUG = {
  2:["Como sei se o eletrodo foi trocado?", "O que conferir na calibração?", "Tremor pode parecer arritmia?"],
  3:["Como confirmo que o ritmo é sinusal?", "A P negativa em DII muda o quê?", "Não acho a onda P. E agora?"],
  4:["Como calculo a FC num ritmo irregular?", "Quando usar 300, 1500 ou QRS × 6?"],
  5:["DI positivo e aVF negativo: e agora?", "Para que serve o eixo no plantão?"],
  6:["Taquicardia de QRS largo: por onde começo?", "Como separo TV de TSV com aberrância?", "O que é o Vereckei?"],
  7:["O supra é territorial ou difuso?", "Quais são os padrões de alto risco?", "Infra de ST difuso com supra em aVR?"],
  8:["O supra em V1–V3 é do BRE ou é oclusão?", "Como aplico o Sgarbossa modificado?", "BRE ou BRD: como separo em V1?"],
  9:["O QTc vale quando o QRS é largo?", "Quando o QT curto importa?"],
  10:["T alta e apiculada: hiperaguda ou potássio?", "Quando pensar em TEP no ECG?"],
  geral:["T alta e apiculada em V2–V4. Hiperaguda ou potássio?", "Como calculo a FC num ritmo irregular?", "O QTc vale quando o QRS é largo?"]
};
const SUG_MOTIVO = {sincope:"Na síncope, o que eu não posso deixar passar?", dor:"Na dor torácica, o que eu não posso deixar passar?", palp:"Na palpitação, o que eu não posso deixar passar?"};
function sugestoes(L){
  if (!L) return SUG.geral;
  const s = (SUG[L.passo] || SUG.geral).slice(0, 3);
  return SUG_MOTIVO[L.motivo] ? [SUG_MOTIVO[L.motivo]].concat(s.slice(0, 2)) : s;
}

/* ---------- a tela ---------- */
function leituraCtx(){
  const L = A.leitura();
  return L && E.ctxFora !== L.id ? L : null;
}
const daPlantao = () => A && A.daPlantao ? A.daPlantao() : null;
function topoHTML(){
  const d = A.daEtapa(), pl = daPlantao();
  const nova = E.turnos.length ? `<button class="icobtn" type="button" data-ia-nova="1" aria-label="Nova conversa">${I.nova}</button>` : "";
  const sim = simulado ? `<span class="tag ia-sim" title="Respostas falsas, só no teste local">simulado</span>` : "";
  // vindo da etapa: só "Etapa 8 · QRS" (o "leitura continua aberta" cortava em 390/430 px); o voltar já diz o resto
  if (pl) return `<div class="top"><button class="icobtn ghost" type="button" data-ia-voltar="1" aria-label="Voltar ao modo plantão">${I.voltar}</button><div class="t"><small>Modo plantão · ${esc(pl.rotulo)}</small><strong>Copiloto IA</strong></div>${sim}${nova}</div>`;
  return d
    ? `<div class="top"><button class="icobtn ghost" type="button" data-ia-voltar="1" aria-label="Voltar à etapa ${d}, a leitura continua aberta">${I.voltar}</button><div class="t"><small>Etapa ${d} · ${esc(A.PASSOS[d])}</small><strong>Copiloto IA</strong></div>${sim}${nova}</div>`
    : `<div class="top"><div class="t"><strong>Copiloto IA</strong></div>${sim}${nova}</div>`;
}
function tela(){
  conferirDono();
  const d = A.daEtapa() || daPlantao(), cls = ["screen", "ia"];
  if (d) cls.push("sem-nav");
  if (teclado) cls.push("teclado");
  return `<div class="${cls.join(" ")}">${topoHTML()}<div class="scroll ia-rolo" id="ia-rolo">${roloHTML()}</div><div class="ia-pe" id="ia-pe">${peHTML()}</div>${d ? "" : A.nav()}</div>`;
}
/* o lápis "Nova conversa" aparece e some com a conversa, sem redesenhar a tela inteira */
function atualizarTopo(){
  const top = document.querySelector(".screen.ia > .top"); if (!top) return;
  const tmp = document.createElement("div"); tmp.innerHTML = topoHTML();
  const novo = tmp.firstElementChild;
  top.replaceWith(novo); montar(novo);
}
function avisoSemSinal(){
  const pl = daPlantao();
  return `<div class="ia-aviso" id="ia-offline">${I.semSinal}<div><strong>A IA precisa de sinal.</strong><p>O resto do app segue funcionando: ${pl ? "o modo plantão, " : ""}a leitura, as calculadoras e o “Por que isso importa?” de cada etapa não dependem de internet.</p>${A.leitura() ? `<button class="btn small" type="button" data-ia-leitura="1">${pl ? "Voltar ao modo plantão" : "Voltar à leitura"} ${I.seta}</button>` : ""}</div></div>`;
}
function roloHTML(){
  const off = !online(), L = leituraCtx();
  let h = off ? avisoSemSinal() : "";
  const pl = daPlantao();
  if (!E.turnos.length && pl){
    h += `<div class="ia-intro"><span class="eyebrow">Modo plantão · ${esc(pl.rotulo)}</span><h2>O que ficou em dúvida?</h2><p class="ink2">A IA vê o que você marcou. A resposta vem das aulas do ECG Descomplicado e diz de qual aula saiu.</p></div>`;
    h += `<div class="ia-sugs">${pl.sugestoes.map(s => `<button class="ia-sug" type="button" data-ia-sug="${esc(s)}" ${off || limiteAtivo() ? "disabled" : ""}><span>${esc(s)}</span>${I.seta}</button>`).join("")}</div>`;
  } else if (!E.turnos.length){
    h += L
      ? `<div class="ia-intro"><span class="eyebrow">Etapa ${L.passo} de 11 · ${esc(A.PASSOS[L.passo])}</span><h2>O que ficou em dúvida ${NO[L.passo] || "nesta etapa"}?</h2><p class="ink2">A resposta vem das aulas do ECG Descomplicado e diz de qual aula saiu.</p></div>`
      : `<div class="ia-intro"><h2>O que ficou em dúvida?</h2><p class="ink2">A resposta vem das aulas do ECG Descomplicado e diz de qual aula saiu. Quem lê o eletro é você: a IA não olha a foto e não dá laudo.</p></div>`;
    // vinda da etapa pela faixa "acompanhando": a pergunta em aberto vira a primeira sugestão (nada é enviado sozinho)
    const d = A.daEtapa(), pa = d && L ? A.perguntaAtiva() : null;
    const daEtapa = pa ? `<button class="ia-sug da-etapa" type="button" data-ia-sug="${esc(`Estou na etapa ${d} (${A.PASSOS[d]}), na pergunta "${pa.titulo}". Como eu confiro isso no traçado?`)}" ${off || limiteAtivo() ? "disabled" : ""}><span><small>Pergunta em aberto</small>Me ajude com esta: “${esc(pa.titulo)}”</span>${I.seta}</button>` : "";
    const lista = pa ? (SUG[L.passo] || SUG.geral).slice(0, 2) : sugestoes(L);
    h += `<div class="ia-sugs">${daEtapa}${lista.map(s => `<button class="ia-sug" type="button" data-ia-sug="${esc(s)}" ${off || limiteAtivo() ? "disabled" : ""}><span>${esc(s)}</span>${I.seta}</button>`).join("")}</div>`;
    if (!A.leitura()) h += `<div class="card tight ia-convite"><p class="small ink2">Com uma leitura aberta, a IA vê as suas respostas e responde sobre aquele eletro.</p><button class="btn wide" type="button" data-ia-ler="1">${I.ecg}Ler um eletro agora</button></div>`;
  }
  h += E.turnos.map(turnoHTML).join("");
  return h;
}
function ctxHTML(){
  const L = A.leitura(); if (!L) return "";
  if (E.ctxFora === L.id) return `<div class="ia-ctx fora"><span>Sem a leitura em andamento.</span><button class="textbtn" type="button" data-ia-ctx="usar">Usar a leitura</button></div>`;
  const pl = daPlantao();
  if (pl) return `<div class="ia-ctx">${I.ecg}<div class="t"><small><i class="ia-ctx-l">Estou vendo o </i>modo plantão</small><span>${esc(pl.itens.join(" · "))}</span></div><button class="icobtn ghost" type="button" data-ia-ctx="tirar" aria-label="Tirar o modo plantão desta conversa">${I.fechar}</button></div>`;
  const c = A.contexto();
  return `<div class="ia-ctx">${I.ecg}<div class="t"><small><i class="ia-ctx-l">Estou vendo sua </i>leitura · etapa ${L.passo}</small><span>${esc(c.itens.join(" · ") || A.PASSOS[L.passo])}</span></div><button class="icobtn ghost" type="button" data-ia-ctx="tirar" aria-label="Tirar a leitura desta conversa">${I.fechar}</button></div>`;
}
function peHTML(){
  // uma coisa só: a frase da função ("Você chegou ao limite…") repetia o título
  if (limiteAtivo()) return `<div class="ia-aviso ia-limite">${I.relogio}<div><strong>Você usou as perguntas de hoje.</strong><p>A contagem volta à meia-noite. A leitura, as calculadoras e o “Por que isso importa?” seguem liberados.</p></div></div>`;
  const off = !online(), rodando = !!corrente, L = leituraCtx();
  const ph = off ? "Sem sinal agora" : L && daPlantao() ? "Pergunte sobre este caso" : L ? "Pergunte sobre esta leitura" : "Pergunte sobre ECG";
  const n = E.restantes;
  return `${n != null && n <= 5 ? `<p class="ia-restam" id="ia-restam">${n === 1 ? "Resta 1 pergunta hoje" : `Restam ${n} perguntas hoje`}</p>` : ""}${ctxHTML()}
    <form class="ia-campo" id="ia-campo"><textarea id="ia-txt" rows="1" maxlength="${MAX_PERGUNTA}" placeholder="${ph}" aria-label="Sua pergunta" enterkeyhint="send" ${off ? "disabled" : ""}>${esc(E.texto)}</textarea>
    <button class="ia-enviar" type="submit" id="ia-enviar" aria-label="${rodando ? "Parar a resposta" : "Enviar"}" ${!rodando && (off || !E.texto.trim()) ? "disabled" : ""}>${rodando ? I.parar : I.enviar}</button></form>`;
}

/* ---------- um turno: a pergunta em balão, a resposta como nota de preceptor ---------- */
const PENSANDO = `<div class="ia-pensando" role="status"><svg viewBox="0 0 64 18" aria-hidden="true"><path d="M0 9h20l3-6 4 12 3-9 2 3h32"/></svg>Buscando nas aulas…</div>`;
function turnoHTML(tu, i){
  let h = "";
  if (tu.estado === "pensando") h = PENSANDO;
  else h = tu.blocos.map((b, k) => blocoHTML(tu, i, k)).join("") + rodapeTurno(tu);
  return `<div class="ia-turno" data-t="${i}"><div class="ia-eu">${esc(tu.eu)}</div>
    <div class="ia-resp" aria-live="polite"><div class="ia-quem">${A.marca()}<span class="eyebrow">Copiloto · das aulas do Dr. Vitor</span></div>${h}</div></div>`;
}
function rodapeTurno(tu){
  if (tu.estado === "interrompida") return `<p class="ia-nota">${tu.blocos.length ? "Resposta interrompida aqui." : "Resposta interrompida."}</p>`;
  if (tu.estado === "erro" || tu.estado === "incompleta"){
    const e = tu.erro || {};
    const titulo = e.titulo || (tu.estado === "incompleta" ? "A resposta parou no meio." : "Não consegui responder agora.");
    const texto = e.texto || "A pergunta não se perdeu, e tentar de novo não conta no seu limite do dia.";
    const botao = e.acao === "entrar" ? `<button class="btn small" type="button" data-ia-entrar="1">Entrar de novo</button>`
      : e.acao === "nenhuma" ? "" : `<button class="btn small" type="button" data-ia-tentar="1">Tentar de novo</button>`;
    return `<div class="ia-aviso ia-bloco">${I.erro}<div><strong>${esc(titulo)}</strong><p>${esc(texto)}</p>${botao}</div></div>`;
  }
  return "";
}
/* texto da função: parágrafos com \n\n e listas com "- ". Sem HTML vindo de fora: tudo passa pelo esc.
   O modelo às vezes escreve markdown: **negrito** vira <strong> (sobre o texto já escapado, como a citação);
   título com # vira uma linha em negrito; asterisco solto some. */
const ITEM = /^\s*[-•*]\s+/;
function marcas(t){
  return t.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*{2,}/g, "")                                    // ** que ficou sem par (inclusive no meio do streaming)
    .replace(/(?<=\p{L})\*|\*(?=\p{L})/gu, "");                // *itálico*; "10 * 6" fica
}
function formatar(s){
  s = String(s).replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t#]*$/gm, "\n\n**$1**\n\n");
  const cita = t => marcas(t).replace(/\((Aula \d+[^()]*|Documento do Dr\. Vitor)\)/g, '<span class="ia-cita">($1)</span>');
  return s.trim().split(/\n{2,}/).map(par => {
    const linhas = par.split("\n"), itens = linhas.filter(l => ITEM.test(l));
    if (itens.length && itens.length === linhas.length) return `<ul>${itens.map(l => `<li>${cita(esc(l.replace(ITEM, "")))}</li>`).join("")}</ul>`;
    if (itens.length){
      const antes = linhas.filter(l => !ITEM.test(l));
      return `<p>${cita(esc(antes.join(" ")))}</p><ul>${itens.map(l => `<li>${cita(esc(l.replace(ITEM, "")))}</li>`).join("")}</ul>`;
    }
    return `<p>${cita(esc(par.replace(/\n/g, " ")))}</p>`;
  }).join("");
}
function blocoHTML(tu, i, k){
  const b = tu.blocos[k], id = i + "-" + k;
  if (b.t === "txt"){
    const vivo = corrente && corrente.tu === tu && k === tu.blocos.length - 1;
    return `<div class="ia-txt ia-bloco" data-b="${k}">${formatar(b.s)}${vivo ? '<span class="ia-cursor"></span>' : ""}</div>`;
  }
  const c = b.c;
  if (c.tipo === "aula") return fonteHTML(c, id, k);
  if (c.tipo === "referencia") return refBlocoHTML(c, k);
  if (c.tipo === "calculadora") return calcHTML(c, id, k);
  if (c.tipo === "clube") return `<div class="card ia-clube ia-bloco" data-b="${k}"><span class="eyebrow">Clube do Plantonista</span><p>${esc(maiuscula(c.tema))}: a condução no plantão, além da leitura do traçado, é conversa do Clube do Plantonista.</p><button class="textbtn" type="button" data-ia-clube="1">${I.grupo} Levar a dúvida para o Clube ${I.seta}</button></div>`;
  if (c.tipo === "agora") return `<div class="ia-agora ia-bloco" role="alert" data-b="${k}"><span class="ix">Agora</span><strong>${esc(c.texto)}</strong></div>`;
  if (c.tipo === "etapa") return etapaHTML(k);
  return "";
}
const maiuscula = s => { s = String(s || "").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

// a) citação da aula: toca e abre o trecho usado
function fonteHTML(c, id, k){
  const ab = !!E.abertos[id], doc = c.aula == null;
  const n = doc ? "Dr. Vitor" : "Aula " + c.aula;
  const m = doc ? (c.modulo || "Documento do Dr. Vitor") : c.modulo;
  let corpo = "";
  if (ab){
    const t = c.texto;
    corpo = `<p class="ia-trecho">${t ? esc(t) : t === false ? "Não consegui abrir o trecho agora." : "Abrindo o trecho…"}<small>Trecho usado na resposta</small></p>`;
  }
  return `<div class="ia-fonte ia-bloco" data-b="${k}"><button type="button" data-ia-fonte="${id}" aria-expanded="${ab}"><span class="n">${esc(n)}</span><span class="t"><strong>${esc(c.titulo)}</strong><span>${esc(m)}</span></span>${I.seta}</button>${corpo}</div>`;
}
// b) referência: uma imagem igual à da etapa, ou duas lado a lado ("parece, mas não é")
function refBlocoHTML(c, k){
  const ids = (c.ids || [c.id]).filter(A.refVisivel);
  if (!ids.length) return "";
  if (ids.length === 1) return `<div class="ia-ref ia-bloco" data-b="${k}">${A.refHTML(ids[0])}</div>`;
  const R = A.refs || {};
  return `<div class="ia-ref ia-bloco" data-b="${k}"><span class="ia-lado">Parece, mas não é · toque para ampliar</span><div class="ia-par">${ids.map(id => { const f = R[id];
    return `<figure class="ref"><button type="button" class="ref-img" data-ampliar="${esc(id)}" aria-label="Ampliar: ${esc(f.alt)}"><img src="${f.arquivo}" alt="${esc(f.alt)}" loading="lazy" decoding="async"></button><figcaption><b>${esc(f.curto || id)}</b>${f.legenda} <span class="cred">${f.credito}</span></figcaption></figure>`; }).join("")}</div></div>`;
}
// f) pedido proibido: devolve a pergunta da etapa em que ele está
function etapaHTML(k){
  const L = A.leitura();
  if (!L) return `<div class="card ia-etapa ia-bloco" data-b="${k}"><span class="eyebrow">Sem leitura aberta</span><p class="q">Comece pelo paciente: o que motivou este ECG?</p><button class="btn small" type="button" data-ia-ler="1" style="align-self:flex-start">Ler um eletro agora ${I.seta}</button></div>`;
  const p = A.perguntaAtiva();
  return `<div class="card ia-etapa ia-bloco" data-b="${k}"><span class="eyebrow">Etapa ${L.passo} · ${esc(A.PASSOS[L.passo])}</span><p class="q">${p ? p.titulo : "Siga a pergunta em aberto nesta etapa."}</p>${p && p.dica ? `<p class="tiny mute">${p.dica}</p>` : ""}<button class="btn small" type="button" data-ia-leitura="1" style="align-self:flex-start">Responder na etapa ${L.passo} ${I.seta}</button></div>`;
}

/* ---------- c) calculadoras: a conta é do app ----------
   O estado de cada uma mora no próprio cartão (c.estado), para sobreviver a um redesenho da tela. */
const numBR = (v, casas) => v == null ? "—" : Number(v).toLocaleString("pt-BR", {minimumFractionDigits:casas || 0, maximumFractionDigits:casas == null ? 1 : casas});
function estadoCalc(c){
  if (c.estado) return c.estado;
  const v = c.valores || {}, L = A.medidasLeitura();
  if (c.calculadora === "sgarbossa") c.estado = {supra:v.supra_st_mm ?? L.sgST ?? null, s:v.onda_s_mm ?? L.sgS ?? null, sg1:v.supra_concordante ?? (L.sg1 ? L.sg1 === "sim" : null), sg2:v.infra_v1_v3 ?? (L.sg2 ? L.sg2 === "sim" : null)};
  if (c.calculadora === "qtc") c.estado = {qt:v.qt_quadradinhos ?? (v.qt_ms ? Math.round(v.qt_ms / 40 * 2) / 2 : null) ?? L.qtQuad ?? null, fc:v.fc ?? L.fc ?? null,
    sexo:v.sexo === "masculino" ? "m" : v.sexo === "feminino" ? "f" : L.sexo || null};
  if (c.calculadora === "fc") c.estado = {rr:v.quadradinhos ?? (v.quadradoes ? v.quadradoes * 5 : null), c10:v.qrs_em_10s || 0, ult:v.qrs_em_10s ? "c10" : "rr"};
  return c.estado;
}
function calcHTML(c, id, k){
  const e = estadoCalc(c), cab = t => `<span class="eyebrow">Calculadora · a conta é do app</span><h3>${t}</h3>`;
  const levar = A.podeLevar(c.calculadora);
  const botaoLevar = levar ? `<button class="btn small" type="button" data-ia-levar="1">Levar para a etapa ${levar} ${I.seta}</button>` : "";
  if (c.calculadora === "sgarbossa"){
    const passo = (k2, rot, d) => `<div class="linha"><label>${rot}</label><div class="ia-passos"><button type="button" data-ia-passo="${k2}" data-d="-${d}" aria-label="Diminuir ${rot.toLowerCase()}">−</button><button type="button" class="ia-val" data-ia-val="${k2}" aria-label="Digitar ${rot.toLowerCase()}"><span class="n"></span><small>mm</small></button><button type="button" data-ia-passo="${k2}" data-d="${d}" aria-label="Aumentar ${rot.toLowerCase()}">+</button></div></div>`;
    const sim = x => x == null ? "" : x ? "sim" : "não";
    return `<div class="card ia-calc ia-bloco" data-b="${k}" data-calc="sgarbossa">${cab("Sgarbossa modificado · razão supra ÷ S")}
      ${e.sg1 != null || e.sg2 != null ? `<div class="kv"><span>Supra concordante ≥ 1 mm</span><span>${sim(e.sg1) || "—"}</span></div><div class="kv"><span>Infra ≥ 1 mm em V1–V3</span><span>${sim(e.sg2) || "—"}</span></div>` : ""}
      ${passo("supra", "Supra de ST", .5)}${passo("s", "Onda S", .5)}
      <div class="res"><span class="num" data-ia-res="1">—</span><span class="tag" data-ia-tag="1"></span></div>${botaoLevar}</div>`;
  }
  if (c.calculadora === "qtc"){
    return `<div class="card ia-calc ia-bloco" data-b="${k}" data-calc="qtc">${cab("QT corrigido (Bazett)")}<p class="tiny mute">QTc = QT ÷ √RR, com RR em segundos.</p>
      <div data-ctl="ia-qt"></div><div data-ctl="ia-fc"></div>
      <div class="linha"><label>Sexo</label><div class="ia-sexo"><button class="chip" type="button" data-ia-sexo="m" aria-pressed="${e.sexo === "m"}">Masculino</button><button class="chip" type="button" data-ia-sexo="f" aria-pressed="${e.sexo === "f"}">Feminino</button></div></div>
      <div class="res"><span class="num" data-ia-res="1">—</span><span class="tag" data-ia-tag="1"></span></div>
      ${A.qrsLargo() ? `<div class="ins warn"><strong>QRS largo</strong><p>O alargamento do QRS pode prolongar o intervalo QT devido ao aumento da duração da despolarização ventricular. Interprete o QTc com cautela nesse cenário.</p></div>` : ""}
      <p class="tiny mute">Prolongado: > 450 ms no masculino, ≥ 460 ms no feminino. Curto: < 350 ms.</p>${botaoLevar}</div>`;
  }
  if (c.calculadora === "fc"){
    return `<div class="card ia-calc ia-bloco" data-b="${k}" data-calc="fc">${cab("Frequência cardíaca")}
      <p class="tiny mute">Quadradinhos entre dois QRS · 1500 ÷ n. Ritmo irregular: QRS em 10 segundos × 6.</p>
      <div data-ctl="ia-rr"></div><div data-ctl="ia-c10"></div>${botaoLevar}</div>`;
  }
  return ""; // Vereckei e o que o app não tiver: só o texto da resposta (design-aba.md, 5c)
}
function pintarCalc(el, c){
  const e = estadoCalc(c);
  const res = el.querySelector("[data-ia-res]"), tag = el.querySelector("[data-ia-tag]");
  if (c.calculadora === "sgarbossa"){
    el.querySelectorAll("[data-ia-val]").forEach(b => { const n = b.querySelector(".n") || b.__n; if (n) n.textContent = numBR(e[b.dataset.iaVal]); });
    const razao = e.supra != null && e.s ? e.supra / e.s : null, pos = razao != null && razao >= .25;
    res.textContent = razao == null ? "—" : numBR(razao, 2);
    tag.className = "tag" + (pos ? " bad" : razao != null ? " ok" : "");
    tag.textContent = razao == null ? "meça o supra e a S" : pos ? "≥ 0,25 · critério presente" : "abaixo de 0,25";
  }
  if (c.calculadora === "qtc"){
    const q = A.qtDe(e.qt, e.fc, e.sexo);
    res.innerHTML = q ? `${q.qtc}<span class="u">ms</span>` : "—";
    tag.className = "tag" + (!q || !e.sexo ? "" : q.longo ? " bad" : q.curto ? " warn" : " ok");
    tag.textContent = !e.qt || !e.fc ? "falta QT ou FC" : !e.sexo ? "escolha o sexo" : q.longo ? "prolongado" : q.curto ? "curto" : "normal";
  }
}
function montarCalc(el, c){
  const C = window.Controles; if (!C) return;
  const e = estadoCalc(c);
  if (c.calculadora === "sgarbossa"){
    const LIM = {supra:[0, 15], s:[0, 40]};
    el.querySelectorAll("[data-ia-val]").forEach(b => {
      b.__n = b.querySelector(".n");
      const k = b.dataset.iaVal;
      if (C._base && C._base.numeroTocavel) C._base.numeroTocavel(b, {ler:() => e[k], gravar:n => { e[k] = n; pintarCalc(el, c); gravar(); }, min:LIM[k][0], max:LIM[k][1], passo:.5});
    });
    el.querySelectorAll("[data-ia-passo]").forEach(b => b.onclick = () => {
      const k = b.dataset.iaPasso, d = +b.dataset.d;
      e[k] = Math.max(LIM[k][0], Math.min(LIM[k][1], (e[k] == null ? (k === "s" ? 10 : 1) - d : e[k]) + d));
      pintarCalc(el, c); gravar();
    });
  }
  if (c.calculadora === "qtc"){
    const hq = el.querySelector('[data-ctl="ia-qt"]'), hf = el.querySelector('[data-ctl="ia-fc"]');
    const rq = C.reguaQT(hq, {valor:e.qt, fc:e.fc, largo:A.qrsLargo(), aoMudar:v => { e.qt = v; pintarCalc(el, c); }, aoSoltar:() => gravar()});
    C.fita(hf, {compacta:true, min:20, max:300, passo:1, valor:e.fc, inicial:75, unidade:"bpm", rotulo:"FC", medio:5, maior:10, digitar:{min:10, max:350},
      aoMudar:v => { e.fc = v; rq.definirFC(v); pintarCalc(el, c); }, aoSoltar:() => gravar()});
    el.querySelectorAll("[data-ia-sexo]").forEach(b => b.onclick = () => {
      e.sexo = b.dataset.iaSexo; el.querySelectorAll("[data-ia-sexo]").forEach(x => x.setAttribute("aria-pressed", x === b)); pintarCalc(el, c); gravar();
    });
  }
  if (c.calculadora === "fc"){
    C.reguaRR(el.querySelector('[data-ctl="ia-rr"]'), {valor:e.rr, aoMudar:v => { e.rr = v; e.ult = "rr"; gravar(); }});
    C.contador(el.querySelector('[data-ctl="ia-c10"]'), {valor:e.c10 || 0, fator:6, rotulo:"QRS em 10 segundos", aoMudar:n => { e.c10 = n; e.ult = "c10"; gravar(); }});
  }
  const lv = el.querySelector("[data-ia-levar]");
  if (lv) lv.onclick = () => { const msg = A.levar(c.calculadora, e); if (msg) avisar(msg); };
  pintarCalc(el, c);
}

/* ---------- montar: liga os eventos de uma raiz (a tela inteira, um turno ou um bloco) ---------- */
function montar(raiz){
  raiz = raiz || document;
  const q = s => raiz.querySelectorAll(s);
  q("[data-ia-sug]").forEach(b => b.onclick = () => enviar(b.dataset.iaSug));
  q("[data-ia-nova]").forEach(b => b.onclick = () => { if (corrente) parar(); E.turnos = []; E.abertos = {}; gravar(); A.redesenhar(); });
  q("[data-ia-voltar], [data-ia-leitura]").forEach(b => b.onclick = () => A.voltarLeitura());
  q("[data-ia-ler]").forEach(b => b.onclick = () => A.novaLeitura());
  q("[data-ia-entrar]").forEach(b => b.onclick = () => A.entrar());
  q("[data-ia-tentar]").forEach(b => b.onclick = () => tentarDeNovo(+b.closest(".ia-turno").dataset.t));
  q("[data-ia-clube]").forEach(b => b.onclick = () => {
    const tu = E.turnos[+b.closest(".ia-turno").dataset.t];
    A.copiar(tu ? tu.eu : "").then(ok => avisar(ok ? "Dúvida copiada. Cole no grupo do Clube." : "Não deu para copiar aqui"));
  });
  q("[data-ampliar]").forEach(b => b.onclick = () => A.ampliar(b.dataset.ampliar));
  q("[data-ia-fonte]").forEach(b => b.onclick = () => abrirFonte(b));
  q(".ia-calc[data-calc]").forEach(el => {
    const t = el.closest(".ia-turno"); if (!t) return;
    const tu = E.turnos[+t.dataset.t], bl = tu && tu.blocos[+el.dataset.b];
    if (bl && !el.__montada){ el.__montada = true; montarCalc(el, bl.c); }
  });
  if (raiz === document || raiz.querySelector && raiz.querySelector("#ia-campo")) ligarPe();
  q("[data-ia-ctx]").forEach(b => b.onclick = () => {
    const L = A.leitura(); if (!L) return;
    E.ctxFora = b.dataset.iaCtx === "tirar" ? L.id : null; gravar(); atualizarPe();
  });
}
function abrirFonte(b){
  const id = b.dataset.iaFonte, [i, k] = id.split("-").map(Number), tu = E.turnos[i], bl = tu && tu.blocos[k];
  if (!bl) return;
  E.abertos[id] = !E.abertos[id];
  const c = bl.c;
  const repintar = () => { const el = document.querySelector(`.ia-turno[data-t="${i}"] [data-b="${k}"]`); if (!el) return; const r = $("ia-rolo"), y = r ? r.scrollTop : 0; el.outerHTML = fonteHTML(c, id, k); const novo = document.querySelector(`.ia-turno[data-t="${i}"] [data-b="${k}"]`); if (novo){ novo.style.animation = "none"; montar(novo); } if (r) r.scrollTop = y; };
  repintar();
  if (E.abertos[id] && c.texto === undefined && c.trecho){
    A.lerTrecho(c.trecho).then(t => { c.texto = t || false; gravar(); repintar(); });
  }
}

/* o aviso do app fica a 96 px do chão, em cima do campo: aqui ele sobe para logo acima do pé */
function avisar(msg){
  A.aviso(msg);
  const t = [...document.querySelectorAll(".toast")].pop(), pe = $("ia-pe"), base = t && t.offsetParent;
  if (!t || !pe || !base) return;
  t.style.bottom = Math.round(base.getBoundingClientRect().bottom - pe.getBoundingClientRect().top + 10) + "px";
}

/* ---------- campo ---------- */
function autoAltura(t){ t.style.height = "auto"; t.style.height = Math.min(124, t.scrollHeight) + "px"; }
function ligarPe(){
  const f = $("ia-campo"), t = $("ia-txt"), b = $("ia-enviar");
  if (!f) return;
  autoAltura(t);
  t.oninput = () => { E.texto = t.value; autoAltura(t); if (!corrente) b.disabled = !t.value.trim() || !online(); };
  t.onkeydown = ev => { if (ev.key === "Enter" && !ev.shiftKey && matchMedia("(pointer:fine)").matches){ ev.preventDefault(); f.requestSubmit ? f.requestSubmit() : f.onsubmit(ev); } };
  t.onfocus = () => setTimeout(aoViewport, 60);
  t.onblur = () => setTimeout(aoViewport, 60);
  f.onsubmit = ev => {
    ev.preventDefault();
    if (corrente){ parar(); return; }
    enviar(t.value, {manterFoco:teclado});
  };
}
/* redesenha só o pé, sem perder o que está sendo digitado nem o foco */
function atualizarPe(){
  const pe = $("ia-pe"); if (!pe) return;
  const t = $("ia-txt"), foco = t && document.activeElement === t, sel = t ? [t.selectionStart, t.selectionEnd] : null;
  pe.innerHTML = peHTML(); montar(pe);
  const t2 = $("ia-txt");
  if (foco && t2 && !t2.disabled){ t2.focus({preventScroll:true}); try { t2.setSelectionRange(sel[0], sel[1]); } catch(_){} }
}
function atualizarBotao(){
  const b = $("ia-enviar"); if (!b) return atualizarPe();
  const rodando = !!corrente;
  b.innerHTML = rodando ? I.parar : I.enviar;
  b.setAttribute("aria-label", rodando ? "Parar a resposta" : "Enviar");
  b.disabled = !rodando && (!online() || !E.texto.trim());
}
/* controles de arrastar seguram laços e observadores: destruir antes de trocar o HTML por cima */
function soltar(el){ if (el) el.querySelectorAll("[data-ctl]").forEach(h => { if (h.__ctl) try { h.__ctl.destruir(); } catch(_){} }); }
function redesenharRolo(){
  const r = $("ia-rolo"); if (!r) return;
  soltar(r);
  r.innerHTML = roloHTML(); montar(r);
  // o redesenho não pode reanimar o que já estava na tela
  r.querySelectorAll(".ia-bloco,.ia-eu").forEach(x => { x.style.animation = "none"; });
}

/* ---------- rolagem: a pergunta sobe até o topo, a resposta cresce para baixo ---------- */
function subirPergunta(){
  const r = $("ia-rolo"), ult = r && r.querySelector(".ia-turno:last-child"); if (!ult) return;
  r.querySelectorAll(".ia-turno").forEach(x => { if (x !== ult) x.style.minHeight = ""; });
  ult.style.minHeight = Math.max(0, r.clientHeight - 30) + "px";
  const top = r.scrollTop + ult.getBoundingClientRect().top - r.getBoundingClientRect().top - 8;
  r.scrollTo({top, behavior:reduzido() ? "auto" : "smooth"});
}

/* ---------- enviar e ler o streaming ---------- */
function historicoAte(n){
  const h = [];
  E.turnos.slice(0, n).forEach(t => {
    const txt = t.blocos.filter(b => b.t === "txt").map(b => b.s).join("\n\n").trim();
    if (!txt) return;  // erro ou interrompida sem texto: não entra no histórico
    h.push({autor:"medico", texto:t.eu.slice(0, 4000)}, {autor:"copiloto", texto:txt.slice(0, 4000)});
  });
  return h.slice(-MAX_HIST);
}
async function enviar(texto, op){
  const pergunta = String(texto || "").trim().slice(0, MAX_PERGUNTA);
  if (!pergunta || corrente || limiteAtivo()) return;
  if (!online()){ avisar("A IA precisa de sinal"); return; }
  const L = leituraCtx(), ctx = L ? A.contexto() : null;
  const tu = {eu:pergunta, blocos:[], estado:"pensando", ctx:ctx ? ctx.objeto : null};
  if (L && !E.turnos.length) E.dono = L.id;       // a conversa passa a ser deste paciente
  const historico = historicoAte(E.turnos.length);
  E.turnos.push(tu); E.texto = "";
  const st = corrente = {tu, ctl:new AbortController(), fila:[], rodando:false};
  gravar();
  if (!$("ia-rolo")) A.redesenhar(); else { redesenharRolo(); if (E.turnos.length === 1) atualizarTopo(); }
  const t = $("ia-txt");
  if (t){ t.value = ""; autoAltura(t); if (!(op && op.manterFoco)) t.blur(); }
  atualizarBotao();
  requestAnimationFrame(subirPergunta);

  const corpo = {pergunta, historico};
  if (tu.ctx) corpo.contexto = tu.ctx;
  try {
    const resp = await pedir(corpo, st.ctl.signal);
    if (corrente !== st) return;
    const tipo = resp.headers.get("content-type") || "";
    if (!resp.ok || tipo.startsWith("application/json")){
      let j = {}; try { j = await resp.json(); } catch(_){}
      if (resp.status === 503 && j.erro === "ia_nao_configurada" && local && !simulado){
        simulado = true; // desenvolvimento local sem a chave: segue com as respostas falsas
        return reenviar(st, corpo);
      }
      return falhou(st, resp.status, j);
    }
    await lerStream(st, resp);
  } catch(x){
    if (corrente !== st) return;
    if (x && x.name === "AbortError") return;
    quebrou(st);
  }
}
async function reenviar(st, corpo){
  try { const resp = await pedir(corpo, st.ctl.signal); if (corrente === st) await lerStream(st, resp); }
  catch(x){ if (corrente === st && !(x && x.name === "AbortError")) quebrou(st); }
}
/* a rede caiu: antes de chegar qualquer coisa é "Não consegui responder"; com texto na tela (ou na fila,
   ainda não revelado) é "A resposta parou no meio", e o que chegou entra inteiro */
function quebrou(st){
  if (!st.tu.blocos.length && !st.fila.some(it => it.t === "txt" || it.t === "cartao")) return falhou(st, 0, {});
  despejar(st);
  st.tu.erro = {titulo:"A resposta parou no meio.", texto:online() ? "A conexão caiu no meio da resposta. Tentar de novo não conta no seu limite do dia." : "O sinal caiu no meio da resposta. Tente de novo quando ele voltar."};
  concluir(st, "incompleta");
}
async function pedir(corpo, sinal){
  if (simulado) return respostaSimulada(corpo, sinal);
  const cfg = window.COPILOTO_CONFIG || {};
  const token = await A.token();
  const h = {"Content-Type":"application/json"};
  if (cfg.supabaseAnon) h.apikey = cfg.supabaseAnon;
  if (token) h.Authorization = "Bearer " + token;
  // a função mora no mesmo projeto Supabase do login; o service worker não põe nada disso no cache
  return fetch(String(cfg.supabaseUrl || "").replace(/\/$/, "") + "/functions/v1/copiloto-ia", {method:"POST", headers:h, body:JSON.stringify(corpo), signal:sinal, cache:"no-store"});
}
async function lerStream(st, resp){
  if (!resp.body || !window.TextDecoderStream){ // navegador sem stream: lê tudo de uma vez
    const txt = await resp.text(); txt.split(/\n\n/).forEach(b => evento(st, b)); return fimDoStream(st);
  }
  const leitor = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;){
    const {value, done} = await leitor.read();
    if (done) break;
    if (corrente !== st){ try { leitor.cancel(); } catch(_){} return; }
    buf += value.replace(/\r\n/g, "\n");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0){ const bloco = buf.slice(0, i); buf = buf.slice(i + 2); evento(st, bloco); }
  }
  if (buf.trim()) evento(st, buf);
  fimDoStream(st);
}
function evento(st, bloco){
  if (!bloco.trim()) return;
  const nome = (bloco.match(/^event: ?(.+)$/m) || [])[1];
  const dados = bloco.split("\n").filter(l => l.startsWith("data:")).map(l => l.replace(/^data: ?/, "")).join("\n");
  let d = null; try { d = JSON.parse(dados); } catch(_){ return; }
  if (nome === "texto" && d && typeof d.t === "string") st.fila.push({t:"txt", s:d.t});
  else if (nome === "cartao" && d && d.tipo) st.fila.push({t:"cartao", c:d});
  else if (nome === "fim") { st.fila.push({t:"fim", d:d || {}}); st.fechado = true; }
  else if (nome === "erro") { st.fila.push({t:"erro", d:d || {}}); st.fechado = true; }
  else if (nome === "status") st.tu.status = d;
  // rascunho de uma rodada que terminou pedindo ferramenta: o que ainda não apareceu nem chega a
  // aparecer, e o que já apareceu sai quando a fila chegar aqui (os cartões ficam)
  else if (nome === "limpar"){ st.fila = st.fila.filter(it => it.t !== "txt"); st.fila.push({t:"limpar"}); }
  bombear(st);
}
// o stream acabou sem fim nem erro (conexão caiu no meio)
function fimDoStream(st){
  if (corrente !== st || st.fechado) return;
  st.fila.push({t:"erro", d:{mensagem:"A conexão caiu no meio da resposta."}}); st.fechado = true;
  bombear(st);
}
function falhou(st, status, j){
  const tu = st.tu;
  if (status === 429){
    // limite do dia: a pergunta volta para o campo e o aviso toma o lugar dele
    E.limite = {dia:hoje(), msg:j.mensagem || ""};
    E.turnos.splice(E.turnos.indexOf(tu), 1); E.texto = tu.eu; corrente = null; gravar();
    redesenharRolo(); atualizarPe(); atualizarTopo(); return;
  }
  if (status === 401) tu.erro = {titulo:"Sua sessão expirou.", texto:"Entre de novo para usar a IA. A leitura em andamento continua salva neste aparelho.", acao:"entrar"};
  else if (status === 403){ tu.erro = {titulo:"Seu acesso não está ativo.", texto:"A IA é só para quem tem acesso ao Copiloto.", acao:"nenhuma"}; A.semAcesso(); }
  // 409: já há perguntas desta conta em andamento (outra aba ou aparelho). Não é o limite do dia: nada fica
  // travado, a pergunta fica no turno com "Tentar de novo"
  else if (status === 409) tu.erro = {titulo:"Você já tem perguntas em andamento.", texto:j.mensagem || "Espere a resposta que já está vindo e tente de novo."};
  else if (status === 503) tu.erro = {titulo:"A IA ainda não está no ar.", texto:"O resto do app segue funcionando: a leitura, as calculadoras e o “Por que isso importa?”."};
  else if (status === 400) tu.erro = {titulo:"Não consegui enviar essa pergunta.", texto:j.erro === "pergunta_longa" ? "A pergunta passou do tamanho máximo. Tente resumir." : "Tente escrever de outro jeito."};
  else if (status === 0 && !online()) tu.erro = {titulo:"A IA precisa de sinal.", texto:"A pergunta não se perdeu: tente de novo quando o sinal voltar."};
  concluir(st, "erro");
}
/* revela a resposta aos poucos, na ordem em que chegou: texto palavra a palavra, cartão inteiro */
function bombear(st){
  if (st.rodando) return;
  st.rodando = true;
  const passo = () => {
    if (corrente !== st){ st.rodando = false; return; }
    const tu = st.tu, it = st.fila[0];
    if (!it){ st.rodando = false; return; }
    if (tu.estado === "pensando"){ tu.estado = "vindo"; repintarResp(tu); }
    if (it.t === "txt"){
      let k = tu.blocos.length - 1;
      if (k < 0 || tu.blocos[k].t !== "txt"){ tu.blocos.push({t:"txt", s:""}); k++; }
      if (reduzido()){ tu.blocos[k].s += it.s; st.fila.shift(); }
      else {
        const m = it.s.match(/^\s*\S+(\s+\S+){0,2}\s*/), pedaco = m ? m[0] : it.s;
        tu.blocos[k].s += pedaco; it.s = it.s.slice(pedaco.length);
        if (!it.s) st.fila.shift();
      }
      pintarBloco(tu, k); gravarAos();
      return setTimeout(passo, reduzido() ? 0 : 28);
    }
    st.fila.shift();
    if (it.t === "limpar"){
      tu.blocos = tu.blocos.filter(b => b.t !== "txt");
      if (!tu.blocos.length) tu.estado = "pensando";
      repintarResp(tu); gravarAos();
      return setTimeout(passo, 0);
    }
    if (it.t === "cartao"){
      // um cartão que não dá para desenhar não pode travar o resto da resposta
      try { adicionarCartao(tu, it.c); } catch(e){ console.error("cartão da IA", e); }
      gravarAos();
      return setTimeout(passo, reduzido() ? 0 : 200);
    }
    if (it.t === "fim"){
      if (typeof it.d.restantes === "number"){
        E.restantes = it.d.restantes;
        if (it.d.restantes <= 0) E.limite = {dia:hoje(), msg:"A contagem volta à meia-noite."};  // a próxima já seria recusada
      }
      tu.aulas = it.d.aulas || []; concluir(st, "ok");
    }
    if (it.t === "erro"){ tu.erro = {texto:it.d.mensagem || "", titulo:tu.blocos.length ? "A resposta parou no meio." : "Não consegui responder agora."}; concluir(st, tu.blocos.length ? "incompleta" : "erro"); }
    st.rodando = false;
  };
  passo();
}
function adicionarCartao(tu, c){
  const ult = tu.blocos[tu.blocos.length - 1];
  if (c.tipo === "referencia"){
    if (!A.refVisivel(c.id)) return;
    const R = A.refs || {};
    // duas referências seguidas viram o par "parece, mas não é"
    if (ult && ult.t === "cartao" && ult.c.tipo === "referencia" && (ult.c.ids || [ult.c.id]).length === 1 && R[c.id].tipo !== "texto" && R[ult.c.ids ? ult.c.ids[0] : ult.c.id].tipo !== "texto"){
      ult.c.ids = [ult.c.ids ? ult.c.ids[0] : ult.c.id, c.id];
      return pintarBloco(tu, tu.blocos.length - 1, true);
    }
  }
  if (c.tipo === "calculadora" && !["sgarbossa", "qtc", "fc"].includes(c.calculadora)) return;  // Vereckei: só texto
  if (c.tipo === "clube" && tu.blocos.some(b => b.t === "cartao" && b.c.tipo === "clube")) return; // no máximo um por resposta
  if (c.tipo === "aula" && tu.blocos.some(b => b.t === "cartao" && b.c.tipo === "aula" && b.c.trecho === c.trecho)) return;
  tu.blocos.push({t:"cartao", c});
  pintarBloco(tu, tu.blocos.length - 1);
}
function elTurno(tu){ return document.querySelector(`.ia-turno[data-t="${E.turnos.indexOf(tu)}"]`); }
function repintarResp(tu){
  const el = elTurno(tu); if (!el) return;
  const r = el.querySelector(".ia-resp");
  const i = E.turnos.indexOf(tu);
  soltar(r);
  r.innerHTML = `<div class="ia-quem">${A.marca()}<span class="eyebrow">Copiloto · das aulas do Dr. Vitor</span></div>` + (tu.estado === "pensando" ? PENSANDO : tu.blocos.map((b, k) => blocoHTML(tu, i, k)).join("") + rodapeTurno(tu));
  r.querySelectorAll(".ia-bloco").forEach(x => { x.style.animation = "none"; });
  montar(r);
}
function pintarBloco(tu, k, trocar){
  const el = elTurno(tu); if (!el) return;
  const r = el.querySelector(".ia-resp"), i = E.turnos.indexOf(tu);
  let b = r.querySelector(`[data-b="${k}"]`);
  // o cursor mora só no último bloco de texto
  r.querySelectorAll(".ia-cursor").forEach(x => { if (!b || !b.contains(x)) x.remove(); });
  const html = blocoHTML(tu, i, k);
  if (b && tu.blocos[k].t === "txt" && !trocar){ b.innerHTML = html.replace(/^<div[^>]*>|<\/div>$/g, ""); return; }
  const tmp = document.createElement("div"); tmp.innerHTML = html;
  const novo = tmp.firstElementChild; if (!novo) return;
  if (b){ soltar(b); novo.style.animation = "none"; b.replaceWith(novo); } else r.appendChild(novo);
  montar(wrap(novo));
}
// montar() procura nos filhos: embrulha o bloco para ele mesmo entrar na busca
function wrap(el){ return {querySelectorAll:s => [el].filter(x => x.matches(s)).concat([...el.querySelectorAll(s)]), querySelector:s => el.matches(s) ? el : el.querySelector(s)}; }
function concluir(st, estado){
  const tu = st.tu;
  if (corrente === st) corrente = null;
  tu.estado = estado;
  clearTimeout(gravarDepois); gravarDepois = null;
  gravar();
  repintarResp(tu);
  atualizarPe();
}
// o que já chegou fica: texto e cartões que estavam na fila entram inteiros
function despejar(st){
  st.fila.forEach(it => {
    if (it.t === "txt"){ const u = st.tu.blocos[st.tu.blocos.length - 1]; if (u && u.t === "txt") u.s += it.s; else st.tu.blocos.push({t:"txt", s:it.s}); }
    if (it.t === "cartao") try { adicionarCartao(st.tu, it.c); } catch(e){ console.error("cartão da IA", e); }
    if (it.t === "limpar") st.tu.blocos = st.tu.blocos.filter(b => b.t !== "txt");
  });
  st.fila = [];
}
function parar(){
  const st = corrente; if (!st) return;
  try { st.ctl.abort(); } catch(_){}
  despejar(st);
  concluir(st, "interrompida");
}
function tentarDeNovo(i){
  const tu = E.turnos[i]; if (!tu || corrente) return;
  E.turnos.splice(i, 1);
  enviar(tu.eu);
}

/* ---------- teclado: no iPhone o 100dvh não encolhe; o visualViewport diz quanto sobrou ---------- */
function aoViewport(){
  const vv = window.visualViewport, frame = document.querySelector(".frame"), scr = document.querySelector(".screen.ia");
  alturaCheia = Math.max(alturaCheia, window.innerHeight);
  if (!vv || !frame) return;
  const t = $("ia-txt"), focado = !!t && document.activeElement === t;
  const aberto = !!scr && focado && vv.height < alturaCheia - 120;
  const r = $("ia-rolo"), noFim = r && estavaNoFim(r);
  if (aberto){
    frame.style.height = Math.round(vv.height) + "px";
    window.scrollTo(0, 0);
  } else if (frame.style.height) frame.style.height = "";
  if (aberto !== teclado){
    teclado = aberto;
    if (scr) scr.classList.toggle("teclado", aberto);
  }
  if (r && noFim) r.scrollTop = r.scrollHeight;
  if (r) r.__alt = r.clientHeight;
}
/* Quando o resize do teclado chega aqui, o rolo já encolheu: medir "no fim" com a altura nova dá falso.
   Por isso a conta usa a altura que o rolo tinha da última vez (guardada em __alt). */
function estavaNoFim(r){
  const alt = r.__alt || r.clientHeight;
  return r.scrollHeight - r.scrollTop - alt < 24;
}
// qualquer mudança de altura do rolo (teclado, pé compacto, contexto que entra e sai): quem estava no fim continua no fim
const observaRolo = window.ResizeObserver ? new ResizeObserver(ents => ents.forEach(({target:r}) => {
  if (!r.isConnected){ observaRolo.unobserve(r); return; }
  if (r.__alt && r.clientHeight < r.__alt && estavaNoFim(r)) r.scrollTop = r.scrollHeight;
  r.__alt = r.clientHeight;
})) : null;
function vigiarRolo(){
  const r = $("ia-rolo"); if (!r || r.__vigiado) return;
  r.__vigiado = true; r.__alt = r.clientHeight;
  if (observaRolo) observaRolo.observe(r);
  r.addEventListener("scroll", () => { r.__alt = r.clientHeight; }, {passive:true});
}
if (window.visualViewport) window.visualViewport.addEventListener("resize", aoViewport);
// fechar ou recarregar a aba no meio da resposta: grava o que está na tela agora, sem esperar o próximo segundo
window.addEventListener("pagehide", () => { if (corrente) gravar(); });
window.addEventListener("orientationchange", () => { alturaCheia = 0; setTimeout(aoViewport, 300); });

/* ---------- sinal: o aviso entra e sai sozinho ---------- */
function aoMudarRede(){
  if (!document.querySelector(".screen.ia")) return;
  const r = $("ia-rolo"), aviso = $("ia-offline");
  if (!online() && !aviso && r){ r.insertAdjacentHTML("afterbegin", avisoSemSinal()); montar(r.firstElementChild ? wrap(r.firstElementChild) : r); }
  if (online() && aviso) aviso.remove();
  if (r) r.querySelectorAll("[data-ia-sug]").forEach(b => { b.disabled = !online() || limiteAtivo(); });
  atualizarPe();
}
window.addEventListener("online", aoMudarRede);
window.addEventListener("offline", aoMudarRede);

/* ---------- API para o app.js ---------- */
function configurar(api){
  A = api; I = api.I; carregar();
  if (E.limite && E.limite.dia !== hoje()) E.limite = null;
}
window.CopilotoIA = {
  configurar, tela, esquecer, perguntaPorque, enviar,
  // o paciente foi descartado: a conversa que era dele não passa para o próximo
  leituraAcabou(id){ if (E.dono && E.dono === id) novaConversa(); },
  // depois que o app pôs a tela no DOM
  montar(raiz){ montar(raiz || document); teclado = false; setTimeout(aoViewport, 0); const r = $("ia-rolo"); if (r && E.turnos.length && !corrente) r.scrollTop = r.scrollHeight; vigiarRolo(); },
  rodando: () => !!corrente,
  simulado: () => simulado,
  _estado: E
};

/* =====================================================================
   MODO SIMULADO (só localhost, ver o topo): respostas SSE falsas, no mesmo formato da função,
   que passam pelo mesmo leitor de stream. Textos tirados do protótipo aprovado e das aulas
   citadas; servem para testar a tela, não para ensinar ninguém.
   Palavras na pergunta que escolhem a resposta: "foto"/"lê"/"laudo" (pedido proibido),
   "potássio"/"hiperaguda"/"apiculada" (parece, mas não é), "sem pulso"/"parada" (gravidade),
   "QT" (calculadora de QTc), "FC"/"frequência"/"irregular" (calculadora de FC), "Vereckei",
   "#erro" (erro no meio), "#falha" (erro antes do texto), "#limite" (429), "#lento".
   ===================================================================== */
let simRestantes = 7;  // cai até 2 e para: mostra o "Restam N" sem travar o teste no limite (o limite tem o #limite)
const TRECHOS_SIM = {
  "a45-09":"“…hoje, no Sgarbossa modificado, através dos critérios de Smith, a gente vê que a relação entre a elevação do meu segmento ST com a minha onda S tem que ser pelo menos 1 quarto para cima da minha onda S. Se eu tenho 10 quadradinhos para baixo de onda S, eu tenho que ter pelo menos 25% para cima de supra de ST.”",
  "a45-12":"“Como que eu vou saber se é hipercalemia ou se é a primeira manifestação da oclusão coronariana? Lembra, pessoal, sempre através do contexto clínico. O contexto clínico é obrigatório…”",
  "a58-03":"“…quando a gente tem uma elevação leve, a principal alteração que a gente vai ter é uma onda T apiculada e simétrica, que a gente vai ver em quase todas as derivações, mas especialmente nas derivações anteriores, de V2 até V5.”",
  "doc-05":"“Considere taquicardia ventricular até que se prove o contrário. […] Se sem pulso: siga o protocolo de parada cardiorrespiratória.”",
  "a11-02":"“A forma mais prática de contar a FC é pegar o DII longo, que tem 10 segundos, contar os QRS e multiplicar por 6.”",
  "a51-04":"“[trecho simulado da aula 51 sobre o algoritmo de Vereckei]”"
};
function roteiroSimulado(p){
  const aula = (n, titulo, modulo, trecho) => ["cartao", {tipo:"aula", aula:n, titulo, modulo, trecho, texto:TRECHOS_SIM[trecho]}];
  const T = s => ["texto", {t:s}];
  if (/#limite/i.test(p)) return {status:429, json:{erro:"limite_diario", mensagem:"Você chegou ao limite de 40 perguntas por hoje. A cota renova à meia-noite."}};
  if (/#falha/i.test(p)) return {eventos:[["erro", {erro:"ocupado", mensagem:"A IA está sobrecarregada agora. Tente de novo em alguns instantes."}]]};
  if (/foto|\bl[eê]\b|laudo/i.test(p)) return {eventos:[
    T("Não leio a foto nem dou laudo: quem interpreta é você, e eu vou junto, etapa por etapa.\n\nA pergunta da etapa em que você está é esta:"),
    ["cartao", {tipo:"etapa"}],
    T("\n\nSe travar, me diga o que está vendo nas derivações e eu te ajudo a olhar.")]};
  if (/sem pulso|parada/i.test(p)) return {eventos:[
    ["cartao", {tipo:"agora", texto:"Sem pulso: siga o protocolo de parada cardiorrespiratória."}],
    T("O resto espera. Com o paciente estabilizado, a gente revê o traçado junto (Documento do Dr. Vitor)."),
    aula(null, "Próximo passo clínico", "Documento do Dr. Vitor · 19/09", "doc-05")]};
  if (/pot[aá]ss|hiperagud|apicul/i.test(p)) return {eventos:[
    T("O traçado sozinho engana aqui: as duas deixam a T alta nas anteriores. O Dr. Vitor separa pelo contexto clínico, e diz que ele é obrigatório (Aula 45 · Padrões de alto risco).\n\nDor típica que começou há poucos minutos: pense em T hiperaguda, a primeira manifestação da oclusão, antes do supra. Repita o ECG em 15 a 30 minutos."),
    T("\n\nSem dor, com potássio em jogo (quem faltou à hemodiálise, por exemplo): a T apiculada e simétrica de V2 a V5 é o clássico da hipercalemia (Aula 58 · Distúrbios eletrolíticos)."),
    ["cartao", {tipo:"referencia", id:"hiper", descricao:"T hiperaguda"}], ["cartao", {tipo:"referencia", id:"hk1", descricao:"Hipercalemia"}],
    T("No desenho: a hiperaguda tem a base larga e é desproporcional ao QRS; a da hipercalemia é alta, estreita e pontiaguda."),
    aula(45, "Padrões de alto risco", "ECG na prática clínica", "a45-12"), aula(58, "Distúrbios eletrolíticos", "ECG na prática clínica", "a58-03")]};
  if (/vereckei/i.test(p)) return {eventos:[
    T("O Vereckei olha só aVR para separar TV de TSV com aberrância. Esta é uma resposta simulada: no app de verdade, o texto vem da aula 51. A calculadora do Vereckei ainda não existe no app, então aqui só entra o texto."),
    ["cartao", {tipo:"calculadora", calculadora:"vereckei", valores:{}}],
    aula(51, "TV x taquicardia supraventricular com aberrância", "Arritmias", "a51-04")]};
  if (/\bQTc?\b/i.test(p)) return {eventos:[
    T("Com QRS largo, o QT alonga pela própria despolarização: o QTc que o app calcula vale, mas interprete com cautela nesse cenário.\n\nMeça do início do QRS ao fim da onda T, numa derivação em que o fim da T esteja bem definido (Aula 58 · Distúrbios eletrolíticos). A conta é do app:"),
    ["cartao", {tipo:"calculadora", calculadora:"qtc", valores:{qt_quadradinhos:11, fc:88}}],
    aula(58, "Distúrbios eletrolíticos", "ECG na prática clínica", "a58-03")]};
  if (/calcul|irregular/i.test(p) && /\bFC\b|frequ[eê]ncia/i.test(p)) return {eventos:[
    T("No ritmo irregular, dividir 1.500 ou 300 pelos quadradinhos dá um número diferente a cada intervalo: aí só a contagem em 10 segundos serve. Pegue o DII longo, conte os QRS e multiplique por 6 (Aula 11 · Como calcular a frequência cardíaca)."),
    ["cartao", {tipo:"calculadora", calculadora:"fc", valores:{qrs_em_10s:14}}],
    aula(11, "Como calcular a frequência cardíaca", "ECG do zero", "a11-02")]};
  const ev = [
    T("No BRE, supra em V1–V3 é esperado: é alteração secundária do próprio bloqueio. Então o supra que você marcou na etapa 7, sozinho, não separa BRE antigo de oclusão.\n\nQuem separa é o Sgarbossa modificado, que o app pergunta na etapa 8 (Aula 45 · Padrões de alto risco):\n- supra de ST ≥ 1 mm concordante com o QRS;\n- infra de ST ≥ 1 mm em V1–V3;\n- em V1–V3, supra discordante de pelo menos um quarto da onda S (razão ≥ 0,25)."),
    T("\n\nAntes, confira se é mesmo BRE: em V1 ele termina para baixo."),
    ["cartao", {tipo:"referencia", id:"v1-brd-bre", descricao:"V1 no BRD e no BRE"}],
    T("Para a razão, meça o supra e a S na mesma derivação. A conta é do app:"),
    ["cartao", {tipo:"calculadora", calculadora:"sgarbossa", valores:{supra_st_mm:2, onda_s_mm:12}}],
    T("Os achados que você marcou são compatíveis com BRE. Se há critério ou não, quem mede e decide é você.")];
  if (/#erro/i.test(p)) return {eventos:ev.slice(0, 2).concat([["erro", {erro:"indisponivel", mensagem:"A IA ficou indisponível no meio da resposta."}]])};
  return {eventos:ev.concat([["cartao", {tipo:"clube", tema:"troponina seriada, quem acionar e quando repetir o ECG com BRE e dor torácica"}], aula(45, "Padrões de alto risco", "ECG na prática clínica", "a45-09")])};
}
function respostaSimulada(corpo, sinal){
  const r = roteiroSimulado(corpo.pergunta), lento = /#lento/i.test(corpo.pergunta);
  if (r.status) return Promise.resolve(new Response(JSON.stringify(r.json), {status:r.status, headers:{"content-type":"application/json"}}));
  const enc = new TextEncoder(), espera = ms => new Promise(ok => setTimeout(ok, ms));
  const sse = (nome, d) => enc.encode(`event: ${nome}\ndata: ${JSON.stringify(d)}\n\n`);
  const corpoStream = new ReadableStream({
    async start(c){
      const parou = () => sinal && sinal.aborted;
      c.enqueue(sse("status", {fase:"buscando_aulas", consulta:corpo.pergunta.slice(0, 40)}));
      await espera(lento ? 4000 : 900);
      let erro = false;
      for (const [nome, d] of r.eventos){
        if (parou()) return c.close();
        if (nome === "texto"){
          // em pedaços pequenos, como chega do modelo
          for (const pedaco of d.t.match(/[\s\S]{1,18}/g) || []){ if (parou()) return c.close(); c.enqueue(sse("texto", {t:pedaco})); await espera(12); }
        } else { c.enqueue(sse(nome, d)); await espera(80); }
        if (nome === "erro") erro = true;
      }
      if (!erro){ simRestantes = Math.max(2, simRestantes - 1); c.enqueue(sse("fim", {aulas:[], restantes:simRestantes})); }
      c.close();
    }
  });
  return Promise.resolve(new Response(corpoStream, {status:200, headers:{"content-type":"text/event-stream"}}));
}

})();
