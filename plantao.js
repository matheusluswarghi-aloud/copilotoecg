"use strict";
/* Copiloto de ECG — Modo plantão (25/09/2026)
   Spec: docs/plans/2026-09-25-modo-plantao/design.md (v2). Protótipo: prototipo/modo-plantao.html.

   O Modo plantão NÃO tem lógica clínica própria: é um atalho sobre a lógica do app.
   - As perguntas são as das etapas, com as mesmas opções, e gravam nas MESMAS chaves de R()
     (S.cur.r). Só muda a ordem (a da queixa) e o desenho (uma tela, itens que recolhem).
     Por isso a leitura completa continua de onde o plantão parou.
   - A conduta sai de proximoPasso() e das regras da tutora (IARegras.avaliar), as mesmas da etapa 11.
     O plantão só antecipa o que já está DECIDIDO: nenhuma resposta que ainda falta tira o cartão
     da saída do app (spec 2.4). As funções clínicas (arritmia, isquemia, sgarbossa, especiais,
     proximoPasso...) são as do app.js, entregues em configurar(api): nada é copiado aqui.
   - A única chave nova é fcFaixa (FC em faixa, spec 2.2), lida pelo faixaFC() do app.
   - Os textos clínicos na tela vêm do documento do Dr. Vitor (etapas e próximo passo), das regras
     da tutora, do "Por que isso importa?" e das imagens validadas. teste/t-modo-plantao.js confere
     frase a frase que cada uma existe em app.js, ia-regras.js, referencias.js ou acoes.ts.
   O estado do plantão mora em S.cur.plantao e vai junto no andamento (voltar ao Início não descarta). */
(function(){

let A = null;                         // o que o app.js entrega (configurar)
const P = () => A.S.cur.plantao;      // o plantão em andamento
const R = () => A.R();                // as mesmas respostas da leitura

/* ---------- queixas e a ordem de cada uma (spec 3.2) ---------- */
const MOT = [["dor","Dor torácica"],["palp","Palpitação"],["bradi","Bradicardia"],["sincope","Síncope"],
  ["disp","Dispneia"],["metab","Potássio / metabólica"],["rotina","Rotina"],["outro","Outro"]];
const CURTO = {dor:"Dor torácica", palp:"Palpitação", bradi:"Bradicardia", sincope:"Síncope", disp:"Dispneia", metab:"Metabólica", rotina:"Rotina", outro:"Outro"};
const LISTA = {
  dor:["qrs","sup","inf","tinv","pad","fc"],
  palp:["fc","ritmo","reg","qrs","arr"],
  bradi:["fc","ritmo","reg","qrs","arr"],
  sincope:["fc","ritmo","reg","qrs","arr","sup"],
  disp:["fc","ritmo","reg","qrs","arr","sup","eixo","tep"],
  metab:["hk1","hk2","qrs","hpk1","hpk2"]
};
const semLista = q => !LISTA[q];      // rotina e outro: o documento pede a sequência inteira
const ROT = {qrs:"QRS", sup:"Supra de ST", inf:"Infra de ST", tinv:"T invertida simétrica", pad:"Padrões de alto risco", fc:"Frequência cardíaca", ritmo:"Ritmo", reg:"Regularidade",
  arr:"Arritmias", eixo:"Eixo", tep:"Suspeita de TEP · S1Q3T3", hk1:"T alta, estreita e apiculada", hk2:"Fusão QRS–T, aspecto sinusoidal", hpk1:"T achatada", hpk2:"Onda U proeminente"};

/* ---------- ajuda de cada "não sei" (spec 3.3): texto do documento / tutora / "por que importa" + imagem validada ---------- */
function AJUDA(k){
  const PORQUE = (window.IARegras && IARegras.PORQUE) || {};
  const p7 = PORQUE[7] ? PORQUE[7].texto.split(". ")[0] + "." : "";
  return ({
    qrs:{p:["Meça do início da primeira deflexão do QRS até o final da última deflexão.", "Em velocidade de 25 mm/s, cada quadradinho corresponde a 40 ms. Portanto, <b>3 quadradinhos = 120 ms</b>."], refs:["qrs-inicio-fim"], de:"Dr. Vitor · etapa 8"},
    v1:{p:["Compare V1: no <b>BRD</b> o QRS termina positivo (rSR' ou R' terminal); no <b>BRE</b> o QRS em V1 é predominantemente negativo."], refs:["v1-brd-bre"], de:"Dr. Vitor · etapa 8"},
    sup:{p:["Não analise uma derivação isoladamente. Procure alterações em derivações anatomicamente contíguas."], terr:true, p2:["Quando o supra não apresenta distribuição territorial coronariana, considere pericardite aguda entre os diagnósticos diferenciais."], refs:["supra"], de:"Dr. Vitor · etapa 7"},
    inf:{p:[p7, "Dor típica com infra predominante em V1–V3 (às vezes até V4): até que se prove o contrário, é supra de parede posterior."], terr:true, de:"Por que isso importa · etapa 7 · aulas 40 e 43"},
    tinv:{p:[p7, "Ondas T invertidas e simétricas em derivações contíguas.", "Avalie distribuição, profundidade, comparação com ECG prévio e contexto clínico."], terr:true, semImagem:true, de:"Dr. Vitor · etapa 7 · aula 43"},
    pad:{padroes:true, refs:A.PADROES.map(x => x[0]), de:"Imagens validadas pelo Dr. Vitor (23 e 24/09)"},
    fc:{p:["Em um trecho contínuo de 10 segundos, como o DII longo, conte o número de QRS. FC = QRS × 6."], de:"Dr. Vitor · etapa 4"},
    temP:{p:["DII costuma ser uma boa derivação para começar."], refs:["p-dii"], de:"Dr. Vitor · etapa 3"},
    rel:{p:["Confira no DII longo se toda onda P gera um QRS.", "Na aula 68, a P bloqueada estava escondida dentro da onda T (a T que parecia diferente das outras, mais apiculada) e o ritmo era um BAV total.", "No BAV 2:1, uma P conduz e a seguinte bloqueia (aula 54)."], de:"Copiloto · aulas 54 e 68"},
    bav:{p:["No BAV 2:1, uma P conduz e a seguinte bloqueia (aula 54).", "Confira no DII longo se toda onda P gera um QRS."], de:"Copiloto · aulas 54 e 68"},
    tq:{p:["Na aula 48, taquiarritmia regular batendo a 150 \"cravado\" faz pensar em flutter atrial 2:1.", "Na prática as ondas F nem sempre ficam claras: procure o dente de serrote, mais bem visto na parede inferior (DII, DIII e aVF) e às vezes também em V1."], de:"Copiloto · aula 48"},
    pind:{p:[(PORQUE[6] || {}).texto || ""], de:"Por que isso importa · etapa 6"},
    pns:{p:[(PORQUE[3] || {}).texto || ""], refs:["p-polaridade"], de:"Por que isso importa · etapa 3"},
    hk1:{refs:["hk1"], de:"Imagem validada pelo Dr. Vitor"}, hk2:{refs:["hk2"], de:"Imagem validada pelo Dr. Vitor"},
    hpk1:{refs:["hpk1"], de:"Imagem validada pelo Dr. Vitor"}, hpk2:{refs:["hpk2"], de:"Imagem validada pelo Dr. Vitor"},
    tep:{refs:["s1q3t3"], de:"Imagem validada pelo Dr. Vitor"},
    eixo:{p:["Observe o QRS em relação à linha de base.", "<b>Predominantemente positivo</b> → a maior parte do QRS está acima da linha de base.", "<b>Predominantemente negativo</b> → a maior parte do QRS está abaixo da linha de base."], de:"Dr. Vitor · etapa 5"}
  })[k] || null;
}
const nomePadrao = id => (A.PADROES.find(x => x[0] === id) || [id, id])[1];
const TERR_HTML = () => `<div class="terr">${A.TERR.map(([, b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("")}</div>`;
const refOK = id => A.refVisivel(id);
const ref = id => refOK(id) ? A.refHTML(id) : "";
const soTexto = h => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
function ajudaHTML(k, fechavel, jaNaTela){
  const a = AJUDA(k); if (!a) return "";
  const repete = t => !!jaNaTela && soTexto(jaNaTela).includes(soTexto(t));   // o resultado do item já diz isso (T invertida)
  let h = (a.p || []).filter(Boolean).filter(t => !repete(t)).map(t => `<p>${t}</p>`).join("") + (a.terr ? TERR_HTML() : "") + (a.p2 || []).map(t => `<p>${t}</p>`).join("");
  if (a.padroes){
    // os 5 padrões em miniatura (Júlia P1: a ajuda inteira tinha ~3.000 px); um toque abre um de cada vez, com "É este: marcar"
    const ids = a.refs.filter(refOK), ver = ids.includes(P().padVer) ? P().padVer : null, marc = R().padroes || [];
    h += `<div class="pl-pads">${ids.map(id => `<button type="button" class="pl-pad" data-pl-pad-ver="${id}" aria-expanded="${ver === id}"><img src="${(A.REFS[id] || {}).arquivo}" alt="" width="120" height="80" loading="lazy" decoding="async"><span>${nomePadrao(id).replace("Padrão de ", "")}${marc.includes(id) ? " · marcado" : ""}</span></button>`).join("")}</div>`;
    if (ver){ const on = marc.includes(ver), nome = nomePadrao(ver);
      h += `<div class="pl-pad-aberto" data-pad-aberto="${ver}"><h4>${nome}</h4>${ref(ver)}<button type="button" class="btn small" data-pa="pad" data-pv="${ver}" aria-pressed="${on}">${on ? "Marcado: " : "É este: marcar "}${nome.replace("Padrão de ", "")}</button></div>`; }
  }
  else h += (a.refs || []).map(ref).join("");
  if (a.semImagem && A.revisao()) h += `<p class="pend">Imagem de T invertida simétrica: ainda não existe (precisa do Vitor).</p>`;
  return `<div class="pl-ajuda" data-ajuda="${k}">${h}<span class="de">${a.de}</span>${fechavel ? `<button type="button" class="pl-link fecha" data-pl-fecha-ajuda="${k}">Fechar ajuda</button>` : ""}</div>`;
}

/* ---------- estado ---------- */
function novoPlantao(q){ return {queixas:[q], ns:{}, ajuda:{}, isqA:{}, sint:null, anc:{}, aberto:{}, ultimo:null, somar:false, chaves:{}, tela:"plantao", faixaRef:null, em:Date.now()}; }
// que ajudas moram abaixo de cada item (fc e eixo abrem pelo link, dentro do próprio item)
const AJUDA_DE = {qrs:["qrs","v1"], arr:["temP","rel","bav","tq","pind","pns"], tep:["s1q3t3"], fc:[], eixo:[], ritmo:[]};
const itens = () => [...new Set(P().queixas.flatMap(q => LISTA[q] || []))];
const temItem = id => itens().includes(id);
const marcar = (...ks) => ks.forEach(k => { P().chaves[k] = 1; });

/* supra / infra / T invertida: a etapa 7 pergunta um multi ("isq") mais as perguntas de cada um.
   O plantão pergunta cada um em separado e compõe o MESMO isq; infra só entra com o V1–V3 respondido. */
function comporIsq(){
  const r = R(), a = P().isqA, m = [], conf = A.S.cur.conf;
  if ((r.terr || []).length || r.supraDist === "difuso") m.push("supra");
  if (a.inf === "tem" && r.infraV1) m.push("infra");
  if (a.tinv === "tem") m.push("tinv");
  if (!m.length && a.sup === "nao" && a.inf === "nao" && a.tinv === "nao") m.push("nenhuma");
  // padrões saem da lista: o "não sei" deles sai junto (senão o 6B fica preso a um item que nem aparece, B1)
  if (!m.includes("nenhuma")){ delete r.padroes; delete conf.padroes; delete P().ns.pad; delete P().ajuda.pad; }
  if (!m.includes("supra")){ delete r.supraDist; delete r.terr; delete conf.terr; }
  if (m.length){ r.isq = m; marcar("isq"); } else delete r.isq;
  // a etapa 7 só mostra "Alterações" feita com os três respondidos no plantão. Pulado ou "não sei" não vira "não tem":
  // a leitura completa pergunta de novo, com o que já foi marcado, e a "Próxima etapa" espera (Rafael P1-5)
  if (m.length && ["sup","inf","tinv"].every(k => temItem(k) && respondido(k))) conf.isq = true; else delete conf.isq;
  if ((r.terr || []).length){ conf.terr = true; marcar("supraDist", "terr"); } else delete conf.terr;
  if (r.supraDist === "difuso") marcar("supraDist");
}
function addEsp(x){ const r = R(); r.esp = [...new Set((r.esp || []).filter(k => k !== "nenhuma").concat(x))]; A.S.cur.conf.esp = true; marcar("esp"); }
/* o que continua valendo quando o médico corrige uma resposta (I1): a largura do QRS (com V1 e o Sgarbossa) não depende
   da FC, do ritmo nem da regularidade; a faixa da FC não depende da regularidade. O resto da etapa 6 é refeito. */
const QRS_FAM = ["qrs","qrsMs","qrs8","v1","sg1","sg2","sgST","sgS","sg3"];
const POUPA = {fcFaixa:QRS_FAM, fc:QRS_FAM, ritmo:QRS_FAM, wiz1:QRS_FAM, wiz2:QRS_FAM, wiz3:QRS_FAM, reg:QRS_FAM.concat("fcFaixa")};
const poupaDe = k => (POUPA[k] || []).reduce((o, x) => (o[x] = 1, o), {});
function limparAoResponder(k, v){
  const r = R();
  if (r[k] === v) return;
  if (!(k in r)) A.limpar(k, P().chaves);          // primeira resposta: poupa o que o plantão já marcou fora da ordem (spec 2.3)
  else A.limpar(k, poupaDe(k));                    // correção: só apaga o que a nova resposta invalida
}
function responder(k, v){
  const r = R(), conf = A.S.cur.conf;
  limparAoResponder(k, v);
  r[k] = v; delete P().ns[k]; delete conf[k]; marcar(k);
  if (/^wiz/.test(k) || k === "ritmo") A.atualizarWiz();
  if (k === "hk1" || k === "hk2") addEsp("hiperk");
  if (k === "hpk1" || k === "hpk2") addEsp("hipok");
  if (k === "s1q3t3") addEsp("tep");
  if (k === "v1" && v === "duvida"){ conf.v1 = true; P().ajuda.v1 = true; }   // no app, "seguir sem padrão definido"
  // as perguntas que o app tem com "não sei identificar" guardam o naosei do app: seguem em aberto
  if (v === "naosei"){ P().ns[k] = true; P().ajuda[k] = true; }
}
function naoSei(k){ P().ns[k] = true; P().ajuda[k] = true; }
/* "não sei" (e a ajuda) de uma pergunta que deixou de ser feita não pode sobrar (B1, M1): padrões fora da lista, a
   pergunta da etapa 6 que o novo caminho não faz (o B coletor de arritmia(B) diz quais são), V1 sem QRS largo. */
function podarNs(){
  const p = P(), r = R();
  if (!padVisivel()){ delete p.ns.pad; delete p.ajuda.pad; delete p.padVer; }
  const feitas = new Set();
  if (arrVisivel()){ const B = coletor(); A.arritmia(B); B.qs.forEach(q => feitas.add(q.k)); }
  AJUDA_DE.arr.forEach(k => { if (!feitas.has(k)){ delete p.ns[k]; delete p.ajuda[k]; } });
  if (!(r.qrs === "largo" && precisaV1())) delete p.ajuda.v1;
}
const coletor = () => ({qs:[], escolha(k, o){ this.qs.push(Object.assign({k}, o)); }, res(){}, texto(){}, html(){}, multi(){}, medida(){}});

/* ---------- o que cada item já respondeu ---------- */
const precisaV1 = () => R().qrs === "largo" && (P().queixas.some(q => ["dor","disp","sincope"].includes(q)) || (R().isq || []).includes("supra"));
function sgPronto(){ const sg = A.sgarbossa(); return !sg || sg.pronto || sg.positivo; }
function respondido(id){
  const r = R(), p = P();
  switch (id){
    case "qrs": return !!r.qrs && !p.ns.qrs && (r.qrs === "estreito" || !precisaV1() || (!!r.v1 && sgPronto()));
    case "sup": return !p.ns.sup && (p.isqA.sup === "nao" || r.supraDist === "difuso" || (r.terr || []).length > 0);
    case "inf": return !p.ns.inf && (p.isqA.inf === "nao" || (p.isqA.inf === "tem" && !!r.infraV1));
    case "tinv": return !p.ns.tinv && !!p.isqA.tinv;
    case "pad": return !p.ns.pad && (r.padroes || []).length > 0;
    case "fc": return !!A.faixaFC();
    case "ritmo": return A.sinusal() !== null;
    case "reg": return !!r.reg;
    case "arr": return A.arritmia().pronto;
    case "eixo": return !!A.eixo();
    case "tep": return A.simNao("s1q3t3");
    default: return A.simNao(id);   // hk1, hk2, hpk1, hpk2
  }
}
const padVisivel = () => (R().isq || []).includes("nenhuma");
const arrVisivel = () => !!A.faixaFC() && !!R().reg && A.sinusal() !== null;
const visivel = id => id === "pad" ? padVisivel() : true;
const nsDoItem = id => (AJUDA_DE[id] || [id]).concat(id).some(k => P().ns[k]);
const nsAberto = () => itens().filter(visivel).some(nsDoItem);   // a mesma régua do fechamento

/* ---------- a conduta: proximoPasso() + tutora, com a regra de parada "decidido" (spec 2.4) ---------- */
const PASSO = {"FA / flutter com resposta ventricular rápida":["fa",1,true], "TSV regular de QRS estreito":["tsv",2,true], "Taquicardia sinusal":["tsin",3,false],
  "Bradicardias":["bradi",4,true], "Taquicardia regular de QRS largo":["tv",5,true], "Alterações compatíveis com isquemia aguda com supradesnivelamento de ST":["6A","6A",true],
  "Dor torácica sem supra / padrão de oclusão identificado":["6B","6B",false], "Achados sugestivos de hipercalemia":["hiperk",7,true]};
const qrsDecidido = () => { const r = R(); if (!r.qrs || P().ns.qrs) return false; if (r.qrs === "estreito") return true; return !!r.v1; };
const isqItens = () => ["sup","inf","tinv"].concat(padVisivel() ? ["pad"] : []).filter(temItem);
/* roda fn com respostas hipotéticas por cima de R() e devolve R() como estava */
function comHipotese(extra, fn){
  const r = R(), antes = JSON.stringify(r);
  Object.assign(r, extra);
  try { return fn(); } finally { Object.keys(r).forEach(k => delete r[k]); Object.assign(r, JSON.parse(antes)); }
}
const cartao = (c, extra) => { const [id, passo, grave] = PASSO[c.t]; return Object.assign({id, passo, grave, t:c.t, p:c.p}, extra || {}); };
function condutas(){
  const r = R(), pp = A.proximoPasso(), out = [];
  const bre = A.larguraQRS() === "largo" && r.v1 === "bre", sg = A.sgarbossa();
  pp.forEach(c => {
    if (!PASSO[c.t]) return;
    const id = PASSO[c.t][0];
    if (id === "6A" && !qrsDecidido()) return;                    // trava: QRS/BRE antes do supra (regra de 21/09)
    if (id === "6B"){
      const isq = isqItens();
      // 6B é o fechamento da isquemia: tudo respondido, QRS decidido, Sgarbossa completo com BRE, nenhum "não sei"
      if (!isq.length || !isq.every(respondido) || !qrsDecidido() || (bre && !(sg && sg.pronto)) || nsAberto()) return;
    }
    out.push(cartao(c));
  });
  // decidido antes de a etapa fechar: um "sim" já torna o Sgarbossa (ou a hipercalemia) positivo, e nada que falta desfaz.
  // O cartão sai do próprio proximoPasso(), completando o que falta com respostas hipotéticas.
  if (bre && sg && !sg.pronto && sg.positivo && !out.some(c => c.id === "6A")){
    const c = comHipotese({sg1:r.sg1 || "nao", sg2:r.sg2 || "nao", sgST:r.sgST ?? 0, sgS:r.sgS ?? 1}, () => A.proximoPasso()).find(x => PASSO[x.t] && PASSO[x.t][0] === "6A");
    if (c) out.push(cartao(c, {sgAntes:true}));
  }
  if ((r.esp || []).includes("hiperk") && (r.hk1 === "sim" || r.hk2 === "sim") && !out.some(c => c.id === "hiperk")){
    const f = k => r[k] === "sim" || r[k] === "nao" ? r[k] : "nao";
    const c = comHipotese({hk1:f("hk1"), hk2:f("hk2")}, () => A.proximoPasso()).find(x => PASSO[x.t] && PASSO[x.t][0] === "hiperk");
    if (c) out.push(cartao(c));
  }
  return out;
}
/* tutora: as regras de verdade (ia-regras.js), com a primeira queixa como motivo, como a leitura */
const alertas = () => window.IARegras ? IARegras.avaliar({motivo:A.S.cur.motivo, queixas:P().queixas, r:R()}) : [];
/* alerta da tutora que muda a leitura do supra: vem antes do cartão de reperfusão (texto igual; só ordem e peso) */
const MUDA_SUPRA = ["sincope-supra-brugada"];
const aulasCurtas = s => { const n = [...String(s).matchAll(/Aula (\d+)/g)].map(m => m[1]); const doc = /documento/.test(s);
  return (n.length ? (n.length === 1 ? "aula " + n[0] : "aulas " + n.slice(0, -1).join(", ") + " e " + n[n.length - 1]) : "") + (doc ? (n.length ? " · documento" : "documento do Dr. Vitor") : ""); };

/* ---------- travas: onde o app espera uma resposta antes de abrir a conduta (spec 2.5) ---------- */
function respondidoAlemDoQrs(){ const l = itens(), i = l.indexOf("qrs"); return i >= 0 && l.slice(i + 1).some(id => id !== "arr" && respondido(id)); }
function travas(){
  const r = R(), out = [], p = P();
  const supraTerr = r.supraDist === "sim" && (r.terr || []).length;
  if (supraTerr && !qrsDecidido()) out.push({anc:"sup", tit:"Falta uma resposta", forte:!r.qrs || p.ns.qrs ? "O QRS é estreito ou largo?" : "Observe V1: qual padrão predomina?",
    p:"Com BRE, o supra pode ser do próprio bloqueio, e a conduta depende do Sgarbossa modificado. Responda no item QRS.", de:"Regra do Dr. Vitor, 21/09"});
  if (supraTerr && qrsDecidido() && r.v1 === "bre" && A.larguraQRS() === "largo") out.push({anc:"sup", tit:"Com BRE", p:"O supra pode ser do próprio bloqueio: quem decide é o Sgarbossa modificado, no item QRS.", de:"Regra do Dr. Vitor, 21/09"});
  // taquicardia não sinusal sem a largura do QRS: nunca mostra FA/TSV; mostra o que pode ser se for largo
  if (A.faixaFC() === "alta" && A.sinusal() === false && r.reg && !r.qrs && (p.ns.qrs || (p.ultimo !== "qrs" && respondidoAlemDoQrs()))){
    const fa = window.IARegras ? IARegras.avaliar({motivo:"palp", r:{ritmo:"nao", reg:"irregular", fcFaixa:"alta", qrs:"largo"}}).find(a => a.id === "fa-pre-excitada") : null;
    out.push({anc:"qrs", tit:"Falta uma resposta", forte:"O QRS é estreito ou largo?",
      p:r.reg === "irregular" ? "Irregular e rápido, sem a largura do QRS, o Copiloto não fecha como FA. Se o QRS for largo: " + (fa ? fa.texto.charAt(0).toLowerCase() + fa.texto.slice(1) : "")
        : "Regular e rápido, sem a largura do QRS, o Copiloto não fecha como TSV. Se o QRS for largo: considere taquicardia ventricular até que se prove o contrário.",
      de:r.reg === "irregular" ? "Copiloto · aulas 47 e 60 · Dr. Vitor · etapa 6" : "Dr. Vitor · etapa 6"});
  }
  return out;
}

/* ---------- desenho ---------- */
const esc = v => A.esc(v);
function seg(k, atual, opcoes, o){
  o = o || {};
  const all = opcoes.concat(o.ns ? [["__ns","Não sei","","ns"]] : []);
  const c = o.cols || (all.length === 4 ? 2 : all.length > 4 ? 3 : all.length);
  const on = v => v === "__ns" ? !!P().ns[k] : Array.isArray(atual) ? atual.includes(v) : atual === v;
  return `<div class="pl-seg" role="group" style="--c:${c}">${all.map(([v, rot, sub, tipo]) => `<button type="button" data-pa="${k}" data-pv="${v}"${tipo ? ` data-tipo="${tipo}"` : ""} aria-pressed="${on(v)}">${rot}${sub ? `<small>${sub}</small>` : ""}</button>`).join("")}</div>`;
}
const TN = [["tem","Tem"],["nao","Não tem","","nao"]];
const SIMNAO_P = [["sim","Tem"],["nao","Não tem","","nao"]];
function valorCurto(id){
  const r = R();
  switch (id){
    case "qrs": { if (r.qrs === "estreito") return ["Estreito"]; const v = {bre:"BRE", brd:"BRD", duvida:"sem padrão definido"}[r.v1]; const sg = A.sgarbossa();
      return ["Largo" + (v ? " · " + v : "") + (sg && (sg.pronto || sg.positivo) ? (sg.positivo ? " · Sgarbossa presente" : " · Sgarbossa ausente") : "")]; }
    case "sup": return P().isqA.sup === "nao" ? ["Não tem", "nao"] : r.supraDist === "difuso" ? ["Difuso"] : [(r.terr || []).map(t => A.TERR.find(x => x[0] === t)[1]).join(" + ")];
    case "inf": return P().isqA.inf === "nao" ? ["Não tem", "nao"] : [r.infraV1 === "sim" ? "Tem · predominante em V1–V3" : "Tem · fora de V1–V3"];
    case "tinv": return P().isqA.tinv === "nao" ? ["Não tem", "nao"] : ["Tem"];
    case "pad": return (r.padroes || []).includes("nenhum") ? ["Nenhum", "nao"] : [(r.padroes || []).map(x => nomePadrao(x).replace("Padrão de ", "")).join(" + ")];
    case "fc": return [r.fc ? r.fc + " bpm" : {baixa:"Abaixo de 50", normal:"50 a 100", alta:"Acima de 100"}[r.fcFaixa]];
    case "ritmo": return [A.sinusal() ? "Sinusal" : "Não sinusal"];
    case "reg": return [r.reg === "regular" ? "Regular" : "Irregular"];
    case "arr": return [A.arritmia().res.t];
    case "eixo": return [A.eixo().t];
    case "tep": return [r.s1q3t3 === "sim" ? "S1Q3T3 tem" : "S1Q3T3 não tem", r.s1q3t3 === "nao" ? "nao" : ""];
    default: return [r[id] === "sim" ? "Tem" : "Não tem", r[id] === "nao" ? "nao" : ""];
  }
}
function feitoHTML(id){
  const [v, cls] = valorCurto(id);
  return `<button type="button" class="pl-feito" data-pl-reabre="${id}" aria-label="${ROT[id]}: ${esc(v)}. Tocar para mudar"><span class="ck">${A.I.check}</span><span>${ROT[id]}</span><b class="${cls || ""}">${esc(v)}</b></button>`;
}
function resHTML(k, t, d, de){ return `<div class="pl-res ${k}"><i></i><div><strong>${t}</strong>${d ? `<p>${d}</p>` : ""}${de ? `<span class="de">${de}</span>` : ""}</div></div>`; }
function itemAberto(id, corpo){ return `<section class="pl-item${nsDoItem(id) ? " naosei" : ""}" data-item="${id}">${corpo}</section>`; }

/* cada pergunta, como a etapa do app pergunta */
function perguntaHTML(id){
  const r = R(), p = P();
  switch (id){
    case "qrs": {
      let h = `<h3>O QRS é estreito ou largo?</h3>${p.queixas.includes("dor") ? `<p class="pl-crit">Vem primeiro: com BRE, o supra pode ser do próprio bloqueio.</p>` : ""}
        ${seg("qrs", r.qrs, [["estreito","Estreito","< 120 ms"],["largo","Largo","≥ 120 ms"]], {ns:true})}`;
      if (r.qrs === "largo" && precisaV1()){
        h += `<div class="pl-sub"><p class="q">Observe V1. Qual padrão predomina?</p>${seg("v1", r.v1, [["brd","R' terminal positivo","BRD"],["bre","QRS negativo","BRE"],["duvida","Não tenho certeza"]])}</div>`;
        const sg = A.sgarbossa();
        if (sg) h += `<div class="pl-sub"><p class="q">BRE + suspeita de isquemia</p>
          <p class="d">O bloqueio de ramo esquerdo produz alterações secundárias do segmento ST e da onda T, que podem dificultar a identificação de isquemia. Vamos avaliar se existem critérios de Sgarbossa modificado.</p>
          <p class="q">1. Existe supra de ST ≥ 1 mm concordante com o QRS?</p>${seg("sg1", r.sg1, SIMNAO_P)}
          <p class="q">2. Existe infra de ST ≥ 1 mm em V1–V3?</p>${seg("sg2", r.sg2, SIMNAO_P)}
          <p class="q">3. Existe supra de ST excessivo em V1–V3?</p><p class="d">Meça na derivação, de V1 a V3, com o maior supra.</p>
          <div class="pl-num"><label>Supra do ST no ponto J (mm)<input inputmode="decimal" data-pl-n="sgST" value="${esc(r.sgST ?? "")}"></label><label>Profundidade da onda S (mm)<input inputmode="decimal" data-pl-n="sgS" value="${esc(r.sgS ?? "")}"></label></div>
          ${sg.razao !== null ? `<div class="pl-mini"><span>Supra ÷ S</span><b>${sg.razao.toFixed(2).replace(".", ",")}${sg.c3 ? " · 0,25 ou mais" : " · abaixo de 0,25"}</b></div>` : ""}</div>`;
      }
      return itemAberto("qrs", h);
    }
    case "sup": {
      const walls = r.supraDist === "sim" ? (r.terr || []) : [];
      const w = [["inf","Inferior","DII, DIII, aVF"],["lat","Lateral","DI, aVL, V5, V6"],["ant","Anterior/Septal","V1 a V4"]];
      const atual = walls.concat(r.supraDist === "difuso" ? ["difuso"] : []).concat(p.isqA.sup === "nao" ? ["nao"] : []);
      return itemAberto("sup", `<h3>Supra de ST em 2 ou mais derivações contíguas?</h3><p class="pl-crit">Com território, marque a parede (pode mais de uma). Basta o supra em pelo menos duas derivações contíguas da parede, não em todas. Sem território: difuso.</p>
        ${seg("sup", atual, w.concat([["difuso","Difuso","sem território"],["nao","Não tem","","nao"]]), {ns:true, cols:3})}`);
    }
    case "inf": {
      let h = `<h3>Infra de ST em 2 ou mais derivações contíguas?</h3>${seg("inf", p.isqA.inf, TN, {ns:true})}`;
      if (p.isqA.inf === "tem") h += `<div class="pl-sub"><p class="q">Infra predominante em V1–V3?</p><p class="d">Às vezes até V4 (aula 40).</p>${seg("infraV1", r.infraV1, [["sim","Sim"],["nao","Não"]])}</div>`;
      return itemAberto("inf", h);
    }
    case "tinv": return itemAberto("tinv", `<h3>Inversão simétrica da onda T em 2 ou mais contíguas?</h3>${seg("tinv", p.isqA.tinv, TN, {ns:true})}`);
    case "pad": return itemAberto("pad", `<h3>Antes de seguir, procure padrões de alto risco</h3><p class="pl-crit">Sem supra, sem infra e sem T invertida. Pode mais de um.</p>
      ${seg("pad", r.padroes || [], A.PADROES.map(([k, l]) => [k, l.replace("Padrão de ", "").replace("Infra difuso de ST + supra em aVR", "Infra difuso + supra aVR")]).concat([["nenhum","Nenhum","","nao"]]), {ns:true, cols:2})}`);
    case "fc": return itemAberto("fc", `<h3>Frequência cardíaca</h3><p class="pl-crit">Do monitor ou do traçado.</p>
      ${seg("fcFaixa", r.fc ? A.faixaFC() : r.fcFaixa, [["baixa","Abaixo de 50"],["normal","50 a 100"],["alta","Acima de 100"]])}
      <button type="button" class="pl-link" data-pl-ajuda-abre="fc" aria-expanded="${!!p.ajuda.fc}">Me ajude a calcular a FC</button>${p.ajuda.fc ? ajudaHTML("fc", true) : ""}`);
    case "ritmo": {
      let h = `<h3>O ritmo é sinusal?</h3><p class="pl-crit">P positiva em DI, DII e aVF · P negativa em aVR · Ondas P precedem os QRS do ritmo de base · Ondas P com a mesma morfologia em uma mesma derivação</p>
        ${seg("ritmo", r.ritmo, [["sim","Sim"],["nao","Não"],["duvida","Não sei","","ns"]])}`;
      if (r.ritmo === "duvida"){
        h += `<div class="pl-sub"><p class="q">1. Primeiro, encontre a onda P</p><p class="d">DII costuma ser uma boa derivação para começar.</p>${ref("p-dii")}${seg("wiz1", r.wiz1, [["sim","Encontrei a onda P"],["nao","Não encontrei"]])}</div>`;
        if (r.wiz1 === "sim") h += `<div class="pl-sub"><p class="q">2. Agora confira a polaridade da P</p><p class="d">Para uma onda P de origem sinusal, procure: positiva em DI, positiva em DII, positiva em aVF, negativa em aVR.</p>${ref("p-polaridade")}${seg("wiz2", r.wiz2, [["sim","Tem característica sinusal"],["nao","Não tem característica sinusal"]])}</div>`;
        if (r.wiz2 === "sim") h += `<div class="pl-sub"><p class="q">3. Olhe o ritmo de base</p><p class="d">As ondas P apresentam morfologia semelhante em uma mesma derivação e precedem os QRS do ritmo de base?</p><p class="d">Importante: um batimento diferente isolado, como uma extrassístole, não exclui necessariamente um ritmo de base sinusal.</p>${seg("wiz3", r.wiz3, [["sim","Sim"],["nao","Não"]])}</div>`;
      }
      return itemAberto("ritmo", h);
    }
    case "reg": return itemAberto("reg", `<h3>O ritmo é regular?</h3><p class="pl-crit">Compare os intervalos R-R ao longo do traçado.</p>${seg("reg", r.reg, [["regular","Regular"],["irregular","Irregular"]])}`);
    case "arr": {
      if (!arrVisivel()) return `<div class="pl-item futura" data-item="arr"><h3>Descarte de arritmias</h3><p class="pl-crit">Abre com a FC, o ritmo e a regularidade respondidos.</p></div>`;
      // a etapa 6 do app, como está: arritmia(B) com um B que só coleta a próxima pergunta
      const B = coletor();
      A.arritmia(B);
      let h = `<h3>Descarte de arritmias</h3><p class="pl-crit">O Copiloto parte do que você marcou e só pergunta o que falta.</p>`;
      B.qs.forEach(q => {
        if (q.k === "qrs"){ if (!r.qrs) h += `<p class="pl-crit">Falta a largura do QRS, no item QRS.</p>`; return; }
        const feita = !!r[q.k] && !p.ns[q.k];
        if (feita) h += `<div class="pl-mini"><span>${q.titulo}</span><b>${(q.opcoes.find(o => o[0] === r[q.k]) || []).slice(-1)[0] || ""}</b></div>`;
        else h += `<div class="pl-sub"><p class="q">${q.titulo}</p>${seg(q.k, r[q.k], q.opcoes.map(o => [o[0], o[2] || o[1]]), {ns:!!AJUDA(q.k), cols:q.opcoes.length > 3 ? 2 : undefined})}</div>`;
      });
      return itemAberto("arr", h);
    }
    case "eixo": {
      const POL = [["pos","Positivo"],["neg","Negativo"]];
      let h = `<h3>Eixo: como é o QRS?</h3><p class="q pl-eixo">Em DI</p>${seg("di", r.di, POL)}<p class="q pl-eixo">Em aVF</p>${seg("avf", r.avf, POL)}`;
      if (r.di === "pos" && r.avf === "neg") h += `<p class="q pl-eixo">Em DII</p>${seg("dii", r.dii, POL)}`;
      return itemAberto("eixo", h + `<button type="button" class="pl-link" data-pl-ajuda-abre="eixo" aria-expanded="${!!p.ajuda.eixo}">Me ajude a saber se o QRS é positivo ou negativo</button>${p.ajuda.eixo ? ajudaHTML("eixo", true) : ""}`);
    }
    case "tep": {
      const ach = A.tepAchados().slice(0, 3);
      return itemAberto("tep", `<h3>Suspeita de TEP: existe padrão S1Q3T3?</h3>
        ${ach.map(([t, ok]) => `<div class="pl-mini"><span>${t}</span><b>${ok ? "SIM" : "NÃO"}</b></div>`).join("")}<div class="pl-mini"><span>Strain de VD</span><b>na leitura completa</b></div>
        ${seg("s1q3t3", r.s1q3t3, SIMNAO_P.concat([["naosei","Não sei","","ns"]]))}`);
    }
    default: {
      const T = {hk1:"As ondas T estão altas, estreitas e apiculadas?", hk2:"Há fusão progressiva entre QRS e T, produzindo aspecto sinusoidal?", hpk1:"Há redução/achatamento da onda T?", hpk2:"Existe onda U proeminente?"};
      const sub = {hk1:"Hipercalemia · 1 de 2", hk2:"Hipercalemia · 2 de 2", hpk1:"Hipocalemia · 1 de 2", hpk2:"Hipocalemia · 2 de 2"};
      return itemAberto(id, `<h3>${T[id]}</h3><p class="pl-crit">${sub[id]}</p>${seg(id, r[id], SIMNAO_P.concat([["naosei","Não sei","","ns"]]))}`);
    }
  }
}
/* resultados da etapa (os B.res do app) de cada item */
function resultados(id){
  const r = R(), out = [];
  if (id === "qrs" && r.qrs === "largo"){
    if (r.v1 === "bre") out.push(resHTML("warn", "Padrão compatível com BRE", ""));
    if (r.v1 === "brd") out.push(resHTML("warn", "Padrão compatível com BRD", ""));
    if (r.v1 === "duvida") out.push(resHTML("info", "QRS largo, sem padrão típico de bloqueio de ramo definido", ""));
    const sg = A.sgarbossa();
    if (sg && (sg.pronto || sg.positivo)) out.push(resHTML(sg.positivo ? "bad" : "info", sg.positivo ? "Critério de Sgarbossa modificado presente" : "Critérios de Sgarbossa modificado não identificados",
      sg.positivo ? "Em um paciente com quadro clínico compatível, este achado aumenta a suspeita de oclusão coronariana aguda." : "A ausência desses critérios não exclui síndrome coronariana aguda, mas reduz a probabilidade de oclusão coronariana aguda.", "Dr. Vitor · etapa 8"));
  }
  if (id === "sup" && r.supraDist === "difuso") out.push(resHTML("warn", "Supradesnivelamento difuso de ST", "Quando o supra não apresenta distribuição territorial coronariana, considere pericardite aguda entre os diagnósticos diferenciais.", "Dr. Vitor · etapa 7"));
  // infra predominante em V1–V3: o texto da etapa 7, com o peso de um cartão Agora (não pode ficar menor que o 6B que fecha a lista)
  if (id === "inf" && P().isqA.inf === "tem" && r.infraV1 === "sim") out.push(`<div class="ia-agora pl-agora" role="alert" data-card="posterior"><span class="ix">Agora · infra em V1–V3</span><strong>Lembre-se de considerar infarto com supra posterior</strong><p>Avalie as derivações posteriores (V7–V9).</p><span class="pl-de">Dr. Vitor · etapa 7</span></div>`);
  if (id === "inf" && P().isqA.inf === "tem" && r.infraV1 === "nao") out.push(resHTML("warn", "Pode representar isquemia subendocárdica", "Dependendo da morfologia e do contexto clínico.", "Dr. Vitor · etapa 7"));
  if (id === "tinv" && P().isqA.tinv === "tem") out.push(resHTML("warn", "Ondas T invertidas e simétricas em derivações contíguas", "Avalie distribuição, profundidade, comparação com ECG prévio e contexto clínico.", "Dr. Vitor · etapa 7"));
  if (id === "pad" && !P().ns.pad && padVisivel()){ const pd = r.padroes || [];
    if (pd.includes("nenhum")) out.push(resHTML("ok", "Nenhum padrão isquêmico evidente identificado nesta etapa", ""));
    else if (pd.length) out.push(resHTML("bad", "Padrão de alto risco marcado", pd.map(nomePadrao).join(" · "), "Dr. Vitor · etapa 7")); }
  if (id === "arr" && A.arritmia().pronto){ const a = A.arritmia(); out.push(resHTML(a.res.k, a.res.t, a.res.d, "Dr. Vitor · etapa 6")); if (a.extra) out.push(resHTML("warn", a.extra, "")); }
  if (id === "eixo" && A.eixo() && A.eixo().k !== "ok") out.push(resHTML(A.eixo().k, A.eixo().t, ""));
  if (id === "tep" && A.simNao("s1q3t3")){ const pr = A.tepAchados().filter(x => x[1]).map(x => x[0]);
    out.push(resHTML(pr.length ? "warn" : "info", pr.length ? "Achados eletrocardiográficos que podem ocorrer no TEP" : "Nenhum dos achados pesquisados para TEP está presente",
      (pr.length ? pr.join(" · ") + ". Quando presentes, esses achados podem aumentar a suspeita de TEP no contexto clínico adequado, mas não são específicos. " : "") + "A ausência desses achados não exclui TEP. Interprete o ECG em conjunto com o quadro clínico e a probabilidade pré-teste.", "Dr. Vitor · etapa 10")); }
  if (id === "hk2" && r.hk1 === "nao" && r.hk2 === "nao") out.push(resHTML("ok", "Sem achados eletrocardiográficos sugestivos de hipercalemia", ""));
  if (id === "hpk2" && A.simNao("hpk1") && A.simNao("hpk2")){ const pos = r.hpk1 === "sim" || r.hpk2 === "sim";
    out.push(resHTML(pos ? "warn" : "ok", pos ? "Achados eletrocardiográficos que podem ser compatíveis com hipocalemia" : "Sem achados eletrocardiográficos sugestivos de hipocalemia", pos ? "Correlacione com o potássio sérico e o contexto clínico." : "", "Dr. Vitor · etapa 10")); }
  return out.join("");
}
/* cartões de conduta: o texto inteiro do próximo passo do documento */
function agoraHTML(c){
  if (c.id === "bradi") return bradiHTML(c);
  if (!c.grave) return `<div class="pl-passo" data-card="${c.id}"><span class="ix">Próximo passo · ${c.t}</span>${c.p.map(x => `<p>${x}</p>`).join("")}<span class="de">Dr. Vitor · próximo passo ${c.passo}</span></div>`;
  const pre = c.sgAntes ? `<p>Critério de Sgarbossa modificado presente. Em um paciente com quadro clínico compatível, este achado aumenta a suspeita de oclusão coronariana aguda.</p>` : "";
  return `<div class="ia-agora pl-agora" role="alert" data-card="${c.id}"><span class="ix">Agora · ${c.t}</span>${pre}<strong>${c.p[0]}</strong>${c.p.slice(1).map(x => `<p>${x}</p>`).join("")}<span class="pl-de">Dr. Vitor · próximo passo ${c.passo}${c.sgAntes ? " · etapa 8" : ""}</span></div>`;
}
/* próximo passo 4: um cartão só, igual em qualquer queixa. Os sintomas (pergunta do paciente, não chave do app)
   só destacam a linha do mesmo texto que casa com o que foi marcado. */
function bradiOn(){
  const a = A.arritmia(), t = a.pronto ? a.res.t : "", on = new Set(), s = P().sint;
  if (s === "tem") on.add(2);
  if (s === "nao" && t === "Bradicardia sinusal") on.add(1);
  if (["BAV total", "BAV de 2º grau Mobitz II", "BAV avançado"].includes(t)) on.add(3);
  return on;
}
function bradiHTML(c){
  const a = A.arritmia(), t = a.pronto ? a.res.t : "", on = bradiOn(), s = P().sint;
  const cls = i => on.size ? (on.has(i) ? "on" : "fora") : "";
  const semDoc = t === "BAV de 2º grau Mobitz I" || t === "BAV 2:1";
  return `<div class="ia-agora pl-agora" role="alert" data-card="bradi"><span class="ix">Agora · ${c.t}</span>
    <p class="${on.size ? "" : "on"}" data-l="0">${c.p[0]}</p>
    <p class="q">Sintomas ou instabilidade pela bradicardia?</p>
    <div class="pl-seg" role="group" style="--c:2"><button type="button" data-pl-sint="tem" aria-pressed="${s === "tem"}">Tem</button><button type="button" data-pl-sint="nao" aria-pressed="${s === "nao"}">Não tem</button></div>
    ${c.p.slice(1).map((x, i) => `<p class="${cls(i + 1)}" data-l="${i + 1}">${x}</p>`).join("")}
    ${semDoc ? `<p class="semdoc">Ainda sem orientação do Dr. Vitor para ${t === "BAV 2:1" ? "o BAV 2:1" : "o Mobitz I"}: o documento não diz a conduta específica. O cartão acima vale como está.</p>` : ""}
    <span class="pl-de">Dr. Vitor · próximo passo ${c.passo}</span></div>`;
}
function tutoraHTML(a){
  return `<div class="pl-atencao${a.nivel === "info" ? " info" : ""}${MUDA_SUPRA.includes(a.id) ? " forte" : ""}" role="status" data-card="t-${a.id}"><span class="ix">Alerta do Copiloto · ${aulasCurtas(a.aula)}</span><strong>${a.titulo}</strong><p>${a.texto}</p></div>`;
}
function travaHTML(t){ return `<div class="pl-atencao pl-trava" role="status" data-card="trava-${t.anc}"><span class="ix">${t.tit}</span>${t.forte ? `<strong>${t.forte}</strong>` : ""}<p>${t.p}</p><span class="de">${t.de}</span></div>`; }

/* ancora cada cartão no item que o decidiu (o último tocado quando ele apareceu); se deixa de valer, sai */
function ancorar(ids){
  const p = P();
  Object.keys(p.anc).forEach(k => { if (!ids.includes(k)) delete p.anc[k]; });
  ids.forEach(k => { if (!p.anc[k]) p.anc[k] = p.ultimo || itens()[0]; });
}
/* algo grave na tela: resultado com fio magenta, cartão Agora de resultado, alerta de atenção da tutora ou trava */
function achadoGrave(){
  return itens().filter(visivel).some(id => /pl-res bad|data-card="posterior"/.test(resultados(id))) || alertas().some(a => a.nivel !== "info") || travas().length > 0;
}
function fechamento(cards){
  const vis = itens().filter(visivel), ns = vis.filter(nsDoItem);
  const todos = vis.every(id => respondido(id) || ns.includes(id));
  if (!todos) return "";
  if (ns.length) return `<div class="pl-fim falta" role="status"><span class="ix">Falta confirmar</span><strong>${ns.map(id => ROT[id]).join(" · ")}</strong>
      <p>Sem essa resposta o Copiloto não fecha a queixa, e nenhum cartão de "nada presente" aparece. A leitura completa continua daqui, com o que você já marcou e com as imagens.</p></div>`;
  if (cards.some(c => c.id === "6B")) return "";
  if (cards.length) return `<p class="pl-nota">Respondido o que a queixa prioriza. A conduta está junto de cada item acima.</p>`;
  return `<div class="pl-fim fecha${achadoGrave() ? " neutro" : ""}" data-card="fecha"><span class="ix">Nenhum dos 7 próximos passos se aplica</span><strong>Agora volte ao paciente</strong>
    <p>Relacione os achados eletrocardiográficos ao quadro clínico, exame físico e demais informações disponíveis.</p><p>O ECG é uma parte do raciocínio clínico e não o raciocínio inteiro.</p>
    <span class="de">Dr. Vitor · saída padrão</span></div>`;
}
const tudoRespondido = () => itens().filter(visivel).every(id => respondido(id) || nsDoItem(id));

function topoHTML(){
  const p = P(), q = p.queixas[0];
  return `<div class="top"><button class="icobtn ghost" type="button" data-pl-inicio="1" aria-label="Voltar ao início">${A.I.voltar}</button>
    <div class="t"><small>Modo plantão</small><strong>${p.queixas.map(x => CURTO[x]).join(" + ")}</strong></div>
    ${semLista(q) ? "" : `<button type="button" class="pl-mais" data-pl-somar="1" aria-expanded="${!!p.somar}" aria-label="Somar outra queixa">+ queixa</button>`}</div>`;
}
function miolo(){
  const p = P(), q = p.queixas[0];
  if (semLista(q)){
    const m = A.MOTIVOS.find(x => x.k === q);
    return {prog:"", corpo:`<div class="pl-fim"><span class="ix">Nesta queixa, a sequência inteira</span>${m.texto.map(t => `<p>${t}</p>`).join("")}<span class="de">Dr. Vitor · etapa 1</span></div>
      <p class="pl-nota">Sem uma queixa que aponte o que procurar, não existe lista curta: o Dr. Vitor pede a leitura completa.</p>`,
      pe:`<button class="btn primary" type="button" data-pl-completa="1">Fazer a leitura completa ${A.I.seta}</button>`};
  }
  const vis0 = itens().filter(visivel), cards = condutas(), tut = alertas(), trv = travas();
  ancorar(cards.filter(c => c.id !== "6B").map(c => c.id).concat(tut.map(a => "t-" + a.id)));
  const vis = ordemItens(vis0, cards);
  const prog = `<div class="prog" style="grid-template-columns:repeat(${vis.length},1fr)">${vis.map(id => `<i class="${respondido(id) ? "done" : ""}"></i>`).join("")}</div>`;
  let corpo = "";
  if (p.somar) corpo += somarHTML();
  const soltos = [];
  // o alerta que muda a leitura do supra (Brugada na síncope/palpitação) vai junto do 6A, antes dele
  const antesDo6A = cards.some(c => c.id === "6A") ? tut.filter(a => MUDA_SUPRA.includes(a.id)) : [];
  const cartaoHTML = c => (c.id === "6A" ? antesDo6A.map(tutoraHTML).join("") : "") + agoraHTML(c);
  const tutLivre = tut.filter(a => !antesDo6A.includes(a));
  vis.forEach(id => {
    const aberto = p.aberto[id] || !respondido(id) || (p.ultimo === id && (id === "sup" || id === "pad"));
    corpo += aberto ? perguntaHTML(id) : feitoHTML(id);
    const resH = resultados(id);
    const aj = (AJUDA_DE[id] || [id]).filter(k => p.ajuda[k] && AJUDA(k === "s1q3t3" ? "tep" : k)).map(k => k === "s1q3t3" ? "tep" : k);
    const emAberto = aj.some(k => p.ns[k] || (k === "tep" && p.ns.s1q3t3));
    const ajH = aj.map(k => ajudaHTML(k, !p.ns[k] && !(k === "tep" && p.ns.s1q3t3), resH)).join("");
    trv.filter(t => t.anc === id).forEach(t => { corpo += travaHTML(t); });   // a trava vem antes da ajuda (FA pré-excitada)
    if (emAberto) corpo += ajH;              // "não sei" aberto: a ajuda logo abaixo do item (e da trava)
    corpo += resH;
    cards.filter(c => c.id !== "6B" && p.anc[c.id] === id).forEach(c => { corpo += cartaoHTML(c); });
    tutLivre.filter(a => p.anc["t-" + a.id] === id).forEach(a => { corpo += tutoraHTML(a); });
    if (!emAberto) corpo += ajH;             // respondida, a ajuda fica, mas desce para depois dos cartões
  });
  // âncora num item que saiu da lista (ex.: padrões depois de mudar o supra): o cartão não some
  cards.filter(c => c.id !== "6B" && !vis.includes(p.anc[c.id])).forEach(c => { soltos.push(cartaoHTML(c)); });
  tutLivre.filter(a => !vis.includes(p.anc["t-" + a.id])).forEach(a => { soltos.push(tutoraHTML(a)); });
  corpo += soltos.join("");
  const seisB = cards.find(c => c.id === "6B");
  if (seisB) corpo += agoraHTML(seisB);
  corpo += fechamento(cards);
  if (!p.somar) corpo += `<button type="button" class="pl-link pl-somar-fim" data-pl-somar="1">+ Somar outra queixa sem perder as marcas</button>`;
  corpo += `<p class="pl-nota">O Copiloto não lê o traçado: quem marca é você. A conduta é a do material do Dr. Vitor, a mesma da leitura completa.</p>`;
  const principal = cards.some(c => c.grave) || Object.keys(p.ns).length || tudoRespondido();
  const pe = `<button class="btn pl-ia" type="button" data-pl-ia="1" aria-label="Perguntar ao Copiloto IA">${A.I.ia}<span><span class="l">Copiloto </span>IA</span></button><button class="btn${principal ? " primary" : ""}" type="button" data-pl-completa="1" aria-label="Continuar na leitura completa">Leitura completa ${A.I.seta}</button>`;
  return {prog, corpo, pe};
}
/* dor com o 6A na tela: o item FC sobe para logo abaixo dos cartões (Rafael P1-4). Infra e T invertida não mudam o 6A;
   a FC traz o próximo passo 4, a segunda conduta do infarto inferior (aula 76). Só reordena. */
function ordemItens(vis, cards){
  const a = P().anc["6A"], i = vis.indexOf(a), f = vis.indexOf("fc");
  if (!P().queixas.includes("dor") || !cards.some(c => c.id === "6A") || i < 0 || f <= i + 1) return vis;
  const o = vis.filter(x => x !== "fc"); o.splice(o.indexOf(a) + 1, 0, "fc"); return o;
}
function somarHTML(){
  return `<div class="pl-somar"><p class="tiny ink2">Somar outra queixa: as perguntas dela entram abaixo, e o que você marcou fica.</p>
    <div class="pl-qs">${MOT.filter(([k]) => LISTA[k] && !P().queixas.includes(k)).map(([k, l]) => `<button class="pl-q" type="button" data-pl-soma="${k}">${l}</button>`).join("")}</div></div>`;
}
function tela(){
  const m = miolo(), dir = A.S.dir || ""; A.S.dir = "";
  return `<div class="screen pl ${dir}">${topoHTML()}${m.prog}<div class="scroll" id="pl-rolo">${m.corpo}</div><div class="foot pl-foot">${m.pe}</div></div>`;
}

/* ---------- Início: o cartão com as 8 queixas ---------- */
function cartaoInicio(){
  const qs = MOT.map(([k, l]) => `<button class="pl-q" type="button" data-pl-q="${k}">${l}${semLista(k) ? `<small>leitura completa</small>` : ""}</button>`).join("");
  return `<section class="card pl-card" aria-labelledby="pl-h">
      <div class="pl-cab"><span class="eyebrow">Modo plantão</span><span class="tag">sem foto</span></div>
      <h2 id="pl-h">Qual é a queixa?</h2>
      <p class="tiny ink2 pl-sub-h">As perguntas da leitura, na ordem da queixa. A conduta aparece assim que fica decidida. Funciona sem sinal.</p>
      <div class="pl-qs">${qs}</div>
    </section>`;
}

/* ---------- tocar: responde, redesenha só a tela do plantão e mostra o que o toque abriu ---------- */
const ITEM_DE = k => ({v1:"qrs", sg1:"qrs", sg2:"qrs", sgST:"qrs", sgS:"qrs", infraV1:"inf", wiz1:"ritmo", wiz2:"ritmo", wiz3:"ritmo", fcFaixa:"fc", di:"eixo", avf:"eixo", dii:"eixo", s1q3t3:"tep",
  extra:"arr", extraQrs:"arr", tq:"arr", pind:"arr", temP:"arr", rel:"arr", bav:"arr", pns:"arr"})[k] || k;
function responderDoToque(k, v){ responderDoToque0(k, v); podarNs(); }
function responderDoToque0(k, v){
  const r = R(), p = P(), conf = A.S.cur.conf;
  if (k === "sup"){
    delete p.ns.sup;
    if (v === "__ns"){ naoSei("sup"); delete p.isqA.sup; delete r.supraDist; delete r.terr; }
    else if (v === "nao"){ p.isqA.sup = "nao"; delete r.supraDist; delete r.terr; }
    else if (v === "difuso"){ p.isqA.sup = "tem"; r.supraDist = "difuso"; delete r.terr; }
    else {
      p.isqA.sup = "tem";
      if (r.supraDist !== "sim"){ r.supraDist = "sim"; r.terr = []; }
      r.terr = r.terr.includes(v) ? r.terr.filter(x => x !== v) : r.terr.concat(v);
      if (!r.terr.length){ delete r.terr; delete r.supraDist; delete p.isqA.sup; }
    }
    comporIsq(); return;
  }
  if (k === "inf" || k === "tinv"){
    if (v === "__ns"){ naoSei(k); delete p.isqA[k]; if (k === "inf") delete r.infraV1; comporIsq(); return; }
    delete p.ns[k]; p.isqA[k] = v; if (k === "inf" && v === "nao") delete r.infraV1; comporIsq(); return;
  }
  if (k === "infraV1"){ r.infraV1 = v; marcar("infraV1"); comporIsq(); return; }
  if (k === "pad"){
    if (v === "__ns"){ naoSei("pad"); delete r.padroes; delete conf.padroes; return; }
    delete p.ns.pad; let a = (r.padroes || []).slice();
    if (v === "nenhum") a = a.includes("nenhum") ? [] : ["nenhum"]; else { a = a.filter(x => x !== "nenhum"); a = a.includes(v) ? a.filter(x => x !== v) : a.concat(v); }
    if (a.length){ r.padroes = a; conf.padroes = true; marcar("padroes"); } else { delete r.padroes; delete conf.padroes; }
    return;
  }
  if (v === "__ns"){ naoSei(k); if (k === "qrs" && "qrs" in r){ A.limpar("qrs"); delete r.qrs; } return; }
  if (k === "fcFaixa"){
    if (r.fc && A.faixaDe(r.fc) !== v) A.limpar("fc", poupaDe("fc"));    // trocou um número de outra faixa pela faixa
    delete r.fc; p.faixaRef = v;
  }
  responder(k, v);
}
function numero(k, txt){
  const r = R(), v = parseFloat(String(txt).replace(",", "."));
  if (String(txt).trim() === "" || !isFinite(v)) delete r[k]; else r[k] = Math.max(0, v);
  marcar(k);
  if (A.num("sgST") !== null && A.num("sgS") !== null){ A.S.cur.conf.sg3 = true; marcar("sg3"); } else delete A.S.cur.conf.sg3;
}
function rolo(){ return document.getElementById("pl-rolo"); }
const cardsNaTela = () => new Set([...document.querySelectorAll("#pl-rolo [data-card]")].map(e => e.dataset.card));
const reduzido = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/* redesenha a tela do plantão no lugar (a moldura .screen fica: não reanima), guarda e devolve a rolagem */
function redesenhar(){
  const scr = document.querySelector(".screen.pl");
  if (!scr){ A.desenhar(true); return; }
  const rl = rolo(), topo = rl ? rl.scrollTop : 0, antes = cardsNaTela();
  soltarAmpliadas();
  const tmp = document.createElement("div"); tmp.innerHTML = tela();
  const novo = tmp.firstElementChild;
  scr.innerHTML = novo.innerHTML;
  const rl2 = rolo(); if (rl2) rl2.scrollTop = topo;
  // só o que acabou de aparecer anima; o resto já estava na tela
  scr.querySelectorAll(".pl-item,.pl-feito,.pl-res,.pl-ajuda,.pl-atencao,.pl-passo,.pl-fim,.pl-agora").forEach(el => {
    if (!(el.dataset.card && !antes.has(el.dataset.card))) el.style.animation = "none";
  });
  montar(scr);
  A.gravarAndamento();
  return antes;
}
function soltarAmpliadas(){ /* nada a soltar: as imagens ampliadas vivem no body e fecham sozinhas */ }
// depois de responder: o item e o que ele abriu (cartão, trava, ajuda) ficam à vista
function focar(id, antes){
  const rl = rolo(); if (!rl) return;
  const it = rl.querySelector(`[data-item="${id}"],[data-pl-reabre="${id}"]`); if (!it) return;
  let alvo = it, n = it.nextElementSibling;
  while (n && !n.matches("[data-item],.pl-feito,.pl-nota,.pl-link")){
    if (!antes.has(n.dataset.card || "") || n.matches(".pl-ajuda,.pl-trava")) alvo = n;
    n = n.nextElementSibling;
  }
  const a = alvo.getBoundingClientRect(), s = rl.getBoundingClientRect(), i = it.getBoundingClientRect();
  if (a.bottom <= s.bottom && i.top >= s.top) return;
  let quer = Math.min(i.top - s.top - 8, a.bottom - s.bottom + 12);
  // o cartão que o toque acabou de abrir ganha a vez: o topo dele (e um bom pedaço) fica à vista, mesmo que o item suba
  let novo = it.nextElementSibling;
  while (novo && !(novo.dataset.card && !antes.has(novo.dataset.card)) && !novo.matches("[data-item],.pl-feito,.pl-nota,.pl-link")) novo = novo.nextElementSibling;
  if (novo && novo.dataset.card && !antes.has(novo.dataset.card)){
    const n = novo.getBoundingClientRect();
    // a trava inteira (o aviso dela vem no fim: "nenhuma medicação que bloqueie o nó AV"), mesmo que o item suba
    const precisa = novo.matches(".pl-trava") ? Math.min(n.bottom - s.bottom + 12, n.top - s.top - 8) : n.top - (s.bottom - Math.min(n.height, s.height * .55));
    if (precisa > quer) quer = precisa;
  }
  rl.scrollTo({top:rl.scrollTop + quer, behavior:reduzido() ? "auto" : "smooth"});
}
/* cartão 4: quando a linha em destaque muda (sintomas, BAV total/Mobitz II/avançado), a tela vai até ela (Rafael P1-3) */
const bradiSig = () => condutas().some(c => c.id === "bradi") ? [...bradiOn()].sort().join(",") : "";
function mostrarDestaque(antesSig){
  const agora = bradiSig(); if (!agora || agora === antesSig) return;
  const novas = agora.split(",").filter(i => !antesSig.split(",").includes(i));
  const rl = rolo(), el = rl && (rl.querySelector(`[data-card="bradi"] p.on[data-l="${novas[0]}"]`) || rl.querySelector('[data-card="bradi"] p.on'));
  if (!el) return;
  const a = el.getBoundingClientRect(), sc = rl.getBoundingClientRect();
  if (a.top >= sc.top + 4 && a.bottom <= sc.bottom - 4) return;
  rl.scrollTo({top:rl.scrollTop + (a.top - sc.top) - Math.max(12, (sc.height - a.height) / 3), behavior:reduzido() ? "auto" : "smooth"});
}
function tocar(item, fn){
  const p = P(); p.ultimo = item; const sig = bradiSig(); fn();
  const antes = redesenhar() || new Set();
  focar(item, antes);
  mostrarDestaque(sig);
}

/* ---------- ligar ---------- */
function montar(raiz){
  const q = s => raiz.querySelectorAll(s);
  q("[data-pa]").forEach(b => b.onclick = () => {
    const k = b.dataset.pa, v = b.dataset.pv, it = ITEM_DE(k);
    tocar(it, () => { responderDoToque(k, v); if (!["sup","pad"].includes(k)) delete P().aberto[it]; });
  });
  q("[data-pl-n]").forEach(inp => inp.onchange = () => tocar("qrs", () => numero(inp.dataset.plN, inp.value)));
  q("[data-pl-reabre]").forEach(b => b.onclick = () => { const id = b.dataset.plReabre; P().aberto[id] = true; tocar(id, () => {}); });
  q("[data-pl-sint]").forEach(b => b.onclick = () => { const p = P(), sig = bradiSig(); p.sint = p.sint === b.dataset.plSint ? null : b.dataset.plSint; redesenhar(); mostrarDestaque(sig); });
  q("[data-pl-pad-ver]").forEach(b => b.onclick = () => {
    const p = P(), id = b.dataset.plPadVer; p.padVer = p.padVer === id ? null : id; redesenhar();
    const el = document.querySelector(".pl-pad-aberto"), rl = rolo();
    if (el && rl){ const a = el.getBoundingClientRect(), sc = rl.getBoundingClientRect(); if (a.bottom > sc.bottom || a.top < sc.top) rl.scrollTo({top:rl.scrollTop + a.top - sc.top - 70, behavior:reduzido() ? "auto" : "smooth"}); }
  });
  q("[data-pl-fecha-ajuda]").forEach(b => b.onclick = () => { const k = b.dataset.plFechaAjuda, p = P(); delete p.ajuda[k]; if (k === "tep") delete p.ajuda.s1q3t3; redesenhar(); });
  q("[data-pl-ajuda-abre]").forEach(b => b.onclick = () => { const k = b.dataset.plAjudaAbre, p = P(); p.ajuda[k] = !p.ajuda[k]; tocar(k, () => {}); });
  q("[data-pl-somar]").forEach(b => b.onclick = () => { const p = P(); p.somar = !p.somar; redesenhar(); const rl = rolo(); if (p.somar && rl) rl.scrollTo({top:0}); });
  q("[data-pl-soma]").forEach(b => b.onclick = () => { const p = P(); p.queixas.push(b.dataset.plSoma); p.somar = false; redesenhar(); });
  q("[data-pl-ia]").forEach(b => b.onclick = () => A.abrirIAPlantao());
  q("[data-pl-completa]").forEach(b => b.onclick = () => A.leituraCompleta());
  q("[data-pl-inicio]").forEach(b => b.onclick = () => A.irInicio());
  q("[data-ampliar]").forEach(b => b.onclick = () => A.ampliar(b.dataset.ampliar));
}
/* os botões do cartão do Início (o app chama no ligar da tela inicial) */
function ligarInicio(raiz){
  raiz.querySelectorAll("[data-pl-q]").forEach(b => b.onclick = () => A.comecar(b.dataset.plQ));
}

/* ---------- Copiloto IA vinda do plantão (spec 6) ---------- */
const SUG_PL = {
  dor:["Supra em DII, DIII e aVF: o que mais eu confiro?", "Como separo supra territorial de difuso?", "Quando repetir o ECG na dor torácica?"],
  palp:["Como separo TV de TSV com aberrância?", "Perto de 150 bpm: como procuro flutter 2:1?", "Como reconheço PR curto e onda delta?"],
  bradi:["Como diferencio Mobitz I de Mobitz II?", "Como acho P escondida na onda T?", "Escape juncional ou FA com BAV total?"],
  sincope:["Na síncope, o que eu não posso deixar passar?", "Como meço uma pausa no DII longo?", "Como diferencio Brugada de isquemia?"],
  disp:["Quais achados do TEP eu procuro no ECG?", "BRD novo na dispneia muda o quê?", "Como vejo strain de VD?"],
  metab:["T alta e apiculada: hiperaguda ou potássio?", "Como separo o fim da T da onda U?", "O QTc vale quando o QRS é largo?"]
};
const SUG_NS = {qrs:"Como eu meço se o QRS é largo?", sup:"Como separo supra territorial de difuso?", pad:"Como reconheço Wellens, de Winter e Aslanger?",
  inf:"Infra em V2 a V4: quando penso em posterior?", tinv:"T invertida simétrica: quando é isquemia?", ritmo:"Como confirmo que o ritmo é sinusal?",
  tq:"Perto de 150 bpm: como procuro flutter 2:1?", temP:"Não acho a onda P. E agora?", rel:"Como acho P escondida na onda T?", bav:"Como diferencio Mobitz I de Mobitz II?",
  hk1:"T alta e apiculada: hiperaguda ou potássio?", hk2:"T alta e apiculada: hiperaguda ou potássio?", s1q3t3:"Quais achados do TEP eu procuro no ECG?"};
function sugestoes(){
  const p = P();
  const ns = Object.keys(p.ns).map(k => SUG_NS[k]).filter(Boolean);
  const tut = alertas().map(a => a.pergunta_para_ia).filter(Boolean);
  return [...new Set(ns.concat(tut).concat(SUG_PL[p.queixas[0]] || []))].slice(0, 3);
}
/* o que foi marcado, para o chip "Estou vendo o modo plantão": "não sei" primeiro, depois o que tem, o "não tem" por último */
function marcasCurtas(){
  const ids = itens().filter(visivel), ns = ids.filter(nsDoItem).map(id => ROT[id] + ": não sei");
  const feitos = ids.filter(id => respondido(id)).map(id => { const [v, c] = valorCurto(id); return {t:ROT[id] + ": " + String(v).toLowerCase(), nao:c === "nao"}; });
  return ns.concat(feitos.filter(x => !x.nao).map(x => x.t)).concat(feitos.filter(x => x.nao).map(x => x.t));
}
function iaInfo(){
  const p = P(); if (!p) return null;
  return {rotulo:p.queixas.map(x => CURTO[x]).join(" + "), itens:[p.queixas.map(x => CURTO[x].toLowerCase()).join(" + ")].concat(marcasCurtas()), sugestoes:sugestoes()};
}
/* o que o plantão acrescenta ao contexto mandado à função */
function contexto(){
  const p = P(); if (!p) return null;
  return {modo:"plantao", queixas:p.queixas.map(x => (A.MOTIVOS.find(m => m.k === x) || {nome:x}).nome), nao_sei:Object.keys(p.ns)};
}
/* chaves de ajuda do app que abrem sozinhas na leitura completa, para o que ficou em "não sei" */
const AJUDA_APP = {qrs:["medirqrs","medirqrs8"], sup:["critsupra"], pad:["padraoajuda"], v1:[], temP:[], eixo:["polqrs"]};
function ajudasAbertas(){ const p = P(); return p ? [...new Set(Object.keys(p.ns).flatMap(k => AJUDA_APP[k] || []))] : []; }

window.ModoPlantao = {
  configurar(api){ A = api; },
  novo:novoPlantao, tela, montar, cartaoInicio, ligarInicio, iaInfo, contexto, ajudasAbertas, semLista, CURTO,
  // para os testes (teste/t-modo-plantao.js): a mesma função que a tela usa
  _teste:{condutas, travas, fechamento:() => fechamento(condutas()), respondido, itens, visivel, responderDoToque, numero, sugestoes, marcasCurtas, alertas, LISTA, qrsDecidido,
    tocar(k, v){ const it = ITEM_DE(k); P().ultimo = it; responderDoToque(k, v); delete P().aberto[it]; }, achadoGrave, bradiOn}
};
})();
