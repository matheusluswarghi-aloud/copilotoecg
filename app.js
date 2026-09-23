"use strict";
/* Copiloto de ECG — versão 6
   Roteiro clínico: documento do Dr. Vitor ("Ferramenta ECG - Protótipo atualizado", 19/09/2026):
   11 etapas, da queixa ao próximo passo clínico.
   Tudo roda no aparelho: a foto do eletro nunca sai do celular.
   Fotos no IndexedDB; leituras e preferências no localStorage. As leituras (sem a miniatura) também
   sobem para a conta pelo sync.js. */
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
async function lerFoto(id){
  try { const b = await db(); return await new Promise(ok => { const q = b.transaction(LOJA).objectStore(LOJA).get(id); q.onsuccess = () => ok(q.result); q.onerror = () => ok(undefined); }); }
  catch(_){ return undefined; }
}
const lerJSON = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) || padrao; } catch(_){ return padrao; } };
// devolve se gravou: aparelho cheio ou modo privado não podem passar por leitura salva
const gravarJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(_){ return false; } };

/* ---------- estado ---------- */
function nova(){
  return { id:"L" + Date.now(), quando:Date.now(), motivo:null,
    tela:null, foto:null, blob:null, thumb:null, escala:null, calQuadrados:5,
    pontos:{cal:null, fc:null, qrs:null, qt:null},
    passo:2, r:{}, conf:{} };
}
const S = {
  tela:"inicio", aba:"inicio", cur:nova(), leituras:lerJSON(CHAVE, []), editando:null,
  prefs:Object.assign({nome:"", assinatura:true, tema:"escuro", revisao:false}, lerJSON(CHAVE_PREFS, {})),
  visor:null, vista:null, detalhe:null, aberto:{}, medir:null, calc:{},
  dock:"aberto", fotoOrigem:null, verVolta:"seq",
  filtro:{busca:"", motivo:"todas", atencao:false}, guiaAba:"calc", guiaFoco:null,
  conta:contaVazia()
};
/* porta de entrada (T07): e-mail digitado, resposta do último pedido, erros de código, relógio do reenviar */
function contaVazia(){ return {email:"", msg:null, enviando:false, verificando:false, erros:0, reenviarEm:0, excluindo:false, saindo:null}; }
function aplicarTema(){ document.documentElement.setAttribute("data-theme", S.prefs.tema === "claro" ? "light" : "dark"); }
aplicarTema();

/* ---------- leitura em andamento: o plantão interrompe, o celular mata a aba ----------
   O que dá para serializar vai no localStorage; a foto (blob) vai para o IndexedDB na chave "andamento".
   O canvas e a miniatura são refeitos a partir do blob, não guardados. */
const CHAVE_AND = "copiloto.andamento", FOTO_AND = "andamento", VALIDADE_AND = 48 * 36e5;
function gravarAndamento(){
  const c = S.cur; if (!c.motivo) return;
  // a chave é única: a leitura nova enterra a anterior só agora, quando grava a dela. Se esta não tem
  // foto, a foto da anterior ficaria órfã no banco.
  const a = lerJSON(CHAVE_AND, null);
  if (a && a.id !== c.id && !c.tela) apagarFoto(FOTO_AND);
  gravarJSON(CHAVE_AND, {id:c.id, quando:c.quando, motivo:c.motivo, passo:c.passo, r:c.r, conf:c.conf, escala:c.escala, calQuadrados:c.calQuadrados, pontos:c.pontos, foto:c.foto, temFoto:!!c.tela, dock:S.dock, salvoEm:Date.now()});
}
function lerAndamento(){
  const a = lerJSON(CHAVE_AND, null); if (!a) return null;
  if (!a.motivo || Date.now() - (a.salvoEm || 0) > VALIDADE_AND){ descartarAndamento(); return null; }
  return a;
}
function descartarAndamento(){ try { localStorage.removeItem(CHAVE_AND); } catch(_){} apagarFoto(FOTO_AND); }
async function continuarLeitura(){
  const a = lerAndamento(); if (!a) return;
  if (!(S.cur.id === a.id && S.cur.motivo)){                 // ainda na memória: é só voltar para a etapa
    const c = nova();
    Object.assign(c, {id:a.id, quando:a.quando, motivo:a.motivo, passo:a.passo, r:a.r || {}, conf:a.conf || {}, escala:a.escala || null, calQuadrados:a.calQuadrados || 5, pontos:a.pontos || c.pontos, foto:a.foto || null});
    if (a.temFoto){
      const blob = await lerFoto(FOTO_AND) || await lerFoto(a.id);
      if (blob){ try { c.tela = await prepararFoto(blob); c.blob = blob; if (!c.foto) c.foto = analisarQualidade(c.tela); } catch(_){} }
      if (!c.tela){ c.escala = null; c.foto = null; c.pontos = nova().pontos; }  // sem a foto, nem a calibração nem as bolinhas de outra imagem valem
    }
    S.cur = c; S.dock = a.dock || "aberto"; S.vista = null; S.aberto = {};
  }
  S.editando = null; S.tela = "seq"; desenhar(true);
}
/* a tela não pode apagar no meio da leitura; fora dela, o aparelho volta ao normal */
const emLeitura = () => ["motivo", "foto", "seq", "medir", "ver", "laudo"].includes(S.tela);
async function travarTela(ligar){ await Plataforma.telaAcesa(ligar); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && emLeitura()) travarTela(true); });
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); S.instalar = e; });

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
const PASSOS = {2:"Técnica de realização", 3:"Ritmo", 4:"Regularidade e frequência", 5:"Eixo", 6:"Descarte de arritmias", 7:"Descarte de isquemia", 8:"QRS", 9:"Intervalo QT", 10:"Padrões especiais", 11:"Volte ao paciente"};
const ULTIMA_PERGUNTA = 10, ULTIMO = 11;

/* ---------- raciocínio ---------- */
const R = () => S.cur.r;
function calibPadrao(){ return R().cal === "padrao"; }
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

/* Etapa 6: parte do que o médico já respondeu e só pergunta o que falta. Sem construtor, só calcula. */
function arritmia(B){
  B = B || NULO;
  const r = R(), fc = r.fc, reg = r.reg, sin = sinusal(), faixa = faixaFC();
  const fim = (res, extra) => ({pronto:true, res, extra});
  const falta = () => ({pronto:false});
  const SN = [["nao","Não"],["sim","Sim"]]; // Não antes de Sim: é a ordem dos botões do roteiro nesta etapa, ao contrário de SIMNAO
  if (sin === null || !fc || !reg) return falta();

  if (sin){
    const res = faixa === "alta" ? {t:"Taquicardia sinusal", d:`Ritmo sinusal com FC de ${fc} bpm.`, k:"warn"}
      : faixa === "baixa" ? {t:"Bradicardia sinusal", d:`Ritmo sinusal com FC de ${fc} bpm.`, k:"warn"}
      : {t:"Ritmo sinusal", d:`FC de ${fc} bpm.`, k:"ok"};
    B.res(res.k, res.t, res.d);
    B.escolha("extra", {curto:"Batimentos diferentes", titulo:"Há batimentos diferentes do ritmo habitual?", opcoes:SN});
    if (!r.extra) return falta();
    if (r.extra === "nao") return fim(res, null);
    B.escolha("extraQrs", {curto:"QRS do batimento diferente", titulo:"Vamos avaliar esses batimentos. O QRS desse batimento diferente é:", opcoes:[["estreito","Estreito"],["largo","Largo"]]});
    if (!r.extraQrs) return falta();
    const ex = r.extraQrs === "estreito" ? "Provável extrassístole supraventricular" : "Provável extrassístole ventricular";
    B.res("warn", ex, "");
    return fim(res, ex);
  }

  B.texto(`<div class="chips"><span class="chip info">ritmo <b>não sinusal</b></span><span class="chip info"><b>${reg}</b></span><span class="chip info">FC <b>${fc}</b> bpm</span></div>`);
  const resultado = res => { B.res(res.k, res.t, res.d); return fim(res); };

  const perguntaQRS = () => {
    B.escolha("qrs", {curto:"Largura do QRS", titulo:"O QRS é estreito ou largo?", opcoes:[["estreito","Estreito — menor que 120 ms","Estreito"],["largo","Largo — 120 ms ou mais","Largo"]],
      depois:ajuda("medirqrs", "Não sei medir o QRS") + (S.aberto.medirqrs ? `<div class="helpbox">
        ${S.cur.tela ? `<p>Meça o QRS com a régua na foto, do começo ao fim do complexo. O app diz se passa de 120 ms (3 quadradinhos).</p><button class="btn small" type="button" data-medir="qrs">${I.regua}Medir o QRS na foto</button>`
          : `<p>Conte os quadradinhos do começo ao fim do QRS: a partir de 3 quadradinhos (120 ms), ele é largo.</p>`}
        ${pendente("Orientação do Dr. Vitor sobre como medir o QRS")}</div>` : "")});
    return !!r.qrs;
  };

  if (faixa === "alta"){
    B.res("info", "Vamos caracterizar a taquiarritmia", "");
    if (!perguntaQRS()) return falta();
    if (r.qrs === "estreito" && reg === "regular"){
      B.escolha("tq", {curto:"Atividade atrial", titulo:"Você identifica:", opcoes:[["flutter","Ondas F de flutter"],["patrial","Ondas P não sinusais"],["nenhum","Nenhum dos dois"]]});
      if (!r.tq) return falta();
      const res = {flutter:{t:"Flutter atrial"}, patrial:{t:"Taquicardia atrial"}, nenhum:{t:"Taquicardia supraventricular"}}[r.tq];
      res.d = `FC ${fc} bpm.`; res.k = "warn";
      return resultado(res);
    }
    if (r.qrs === "estreito"){
      B.escolha("pind", {curto:"Ondas P individualizadas", titulo:"Você identifica ondas P individualizadas?", opcoes:SN});
      if (!r.pind) return falta();
      return resultado(r.pind === "nao" ? {t:"Fibrilação atrial de alta resposta ventricular", d:`FC ${fc} bpm.`, k:"warn"}
        : {t:"Taquicardia irregular com ondas P individualizadas", d:"Considere taquicardia atrial multifocal ou extrassístoles atriais frequentes como causa de irregularidade.", k:"warn"});
    }
    if (reg === "regular") return resultado({t:"Taquicardia regular de QRS largo", d:"Considere taquicardia ventricular até que se prove o contrário.", k:"bad"});
    return resultado({t:"Taquicardia irregular de QRS largo", d:"Pense principalmente em: fibrilação atrial com aberrância ou bloqueio de ramo · fibrilação atrial pré-excitada · taquicardia ventricular polimórfica.", k:"bad"});
  }

  if (faixa === "baixa"){
    B.res("info", "Vamos caracterizar a bradiarritmia", "");
    B.escolha("temP", {curto:"Onda P", titulo:"Tem onda P?", opcoes:SN});
    if (!r.temP) return falta();
    if (r.temP === "nao"){
      if (reg === "irregular") return resultado({t:"Considerar fibrilação atrial com baixa resposta ventricular", d:"Ritmo irregular, sem ondas P individualizadas.", k:"warn"});
      if (!perguntaQRS()) return falta();
      return resultado(r.qrs === "estreito" ? {t:"Considerar escape juncional", d:`Ritmo regular, sem onda P, QRS estreito, FC ${fc} bpm.`, k:"warn"}
        : {t:"Considerar escape ventricular", d:`Ritmo regular, sem onda P, QRS largo, FC ${fc} bpm.`, k:"bad"});
    }
    B.escolha("rel", {curto:"Relação P–QRS", titulo:"P e QRS têm relação?", opcoes:[["nao","Não"],["algumas","Sim, mas algumas P não conduzem","Algumas P não conduzem"],["todas","Todas conduzem 1:1"]]});
    if (!r.rel) return falta();
    if (r.rel === "nao") return resultado({t:"BAV total", d:"P e QRS sem relação entre si.", k:"bad"});
    if (r.rel === "todas") return resultado({t:"Considerar ritmo atrial ectópico", d:"P não sinusal com bradicardia, todas conduzindo 1:1.", k:"warn"});
    B.escolha("bav", {curto:"Como as P bloqueiam", titulo:"Como as P deixam de conduzir?", opcoes:[["m1","PR aumenta progressivamente até uma P bloquear","PR aumenta até bloquear"],["m2","PR constante, até que uma P bloqueia","PR constante, P bloqueia"],["21","Condução 2:1"],["avancado","Duas ou mais P consecutivas não conduzidas","2 ou mais P bloqueadas"]]});
    if (!r.bav) return falta();
    const res = {m1:{t:"BAV de 2º grau Mobitz I", k:"warn"}, m2:{t:"BAV de 2º grau Mobitz II", k:"bad"}, "21":{t:"BAV 2:1", k:"bad"}, avancado:{t:"BAV avançado", k:"bad"}}[r.bav];
    res.d = `FC ${fc} bpm.`;
    return resultado(res);
  }

  if (reg === "irregular"){
    B.escolha("pind", {curto:"Ondas P individualizadas", titulo:"Você identifica ondas P individualizadas?", opcoes:SN});
    if (!r.pind) return falta();
    return resultado(r.pind === "nao" ? {t:"Padrão compatível com fibrilação atrial", d:`Ritmo irregular, sem ondas P individualizadas, FC ${fc} bpm.`, k:"warn"}
      : {t:"Ritmo irregular com atividade atrial identificável", d:"Considere extrassístoles atriais frequentes ou atividade atrial multifocal.", k:"warn"});
  }
  B.escolha("pns", {curto:"Ondas P não sinusais", titulo:"Você identifica ondas P não sinusais?", opcoes:[["sim","Sim"],["nao","Não"]]});
  if (!r.pns) return falta();
  if (r.pns === "sim") return resultado({t:"Considerar ritmo atrial ectópico", d:`FC ${fc} bpm.`, k:"warn"});
  if (!perguntaQRS()) return falta();
  return resultado(r.qrs === "estreito" ? {t:"Considerar ritmo juncional", d:`QRS estreito, FC ${fc} bpm.`, k:"warn"}
    : {t:"Considerar ritmo idioventricular", d:`QRS largo, FC ${fc} bpm.`, k:"warn"});
}

const PADROES = [["wellens","Padrão de Wellens"],["dewinter","Padrão de de Winter"],["aslanger","Padrão de Aslanger"],["avr","Infra difuso de ST + supra em aVR"],["hiper","Ondas T hiperagudas"]];
const TERR = [["inf","Inferior","DII · DIII · aVF"],["lat","Lateral","DI · aVL · V5 · V6"],["ant","Anterior/Septal","V1 · V2 · V3 · V4"]];
const PAREDE = {inf:"inferior", lat:"lateral", ant:"anterior/septal"};
function isquemia(){
  const r = R(), m = r.isq || [];
  if (!m.length) return {pronto:false};
  const achados = [];
  if (m.includes("supra")){
    if (r.supraDist === "sim"){
      if (!(r.terr || []).length) return {pronto:false};
      achados.push("Supradesnivelamento de ST em parede " + r.terr.map(t => PAREDE[t]).join(", "));
    } else if (r.supraDist === "difuso") achados.push("Supradesnivelamento difuso de ST, sem distribuição territorial coronariana (considerar pericardite aguda entre os diagnósticos diferenciais)");
    else return {pronto:false};
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

/* Etapa 8: QRS. A largura pode já ter vindo da etapa 6; o eixo, da etapa 5. O app não pergunta de novo. */
const larguraQRS = () => R().qrs || R().qrs8 || null;
const num = k => { const v = parseFloat(String(R()[k] ?? "").replace(",", ".")); return isFinite(v) ? v : null; };
const abreSgarbossa = () => larguraQRS() === "largo" && R().v1 === "bre" && (S.cur.motivo === "dor" || (R().isq || []).includes("supra"));
function sgarbossa(){
  if (!abreSgarbossa()) return null;
  const r = R(), st = num("sgST"), s = num("sgS");
  const razao = st !== null && s ? st / s : null;
  const c3 = razao !== null && razao >= .25;
  return { pronto:!!(r.sg1 && r.sg2 && st !== null && s !== null), razao, c3, positivo:r.sg1 === "sim" || r.sg2 === "sim" || c3 };
}
const eixoDireita = () => { const e = eixo(); return !!e && e.t === "Desvio do eixo para a direita"; };
/* Sobrecarga de VD: checklist de 3 itens; o eixo entra sozinho. "Conjunto compatível" = 2 ou mais (a confirmar com o Dr. Vitor). */
function svd(){
  const itens = new Set((R().svd || []).filter(x => x !== "eixo"));
  if (eixoDireita()) itens.add("eixo");
  const nomes = {v1pos:"QRS predominantemente positivo em V1", eixo:"desvio do eixo para a direita", strainVD:"ondas T invertidas em V1–V3 (strain de VD)"};
  return {itens:[...itens].map(k => nomes[k]), sugere:itens.size >= 2};
}
function sokolow(){
  const a = num("sV1"), b = num("rV56");
  if (a === null || b === null) return null;
  return {soma:Math.round((a + b) * 10) / 10, presente:a + b > 35};
}
const avaliouSobrecarga = () => !!(R().amp8 && R().amp8 !== "nao");
function qrsInfo(){
  const r = R(), largura = larguraQRS();
  if (!largura) return null;
  const conducao = largura === "largo" ? (r.v1 === "brd" ? "Padrão compatível com BRD" : r.v1 === "bre" ? "Padrão compatível com BRE" : "Sem padrão típico de bloqueio de ramo definido") : null;
  const sg = sgarbossa();
  return { largura, ms:r.qrsMs || null, conducao, sg:sg && sg.pronto ? sg : null,
    sobrecarga:avaliouSobrecarga(), svd:avaliouSobrecarga() ? svd() : null, sk:avaliouSobrecarga() ? sokolow() : null, strain:avaliouSobrecarga() && r.strainVE === "sim" };
}
function etapa8Pronta(){
  const r = R(), largura = larguraQRS();
  if (!largura) return false;
  if (largura === "largo"){
    if (!r.v1) return false;
    const sg = sgarbossa(); if (sg && !sg.pronto) return false;
  }
  if (!r.amp8) return false;
  if (r.amp8 !== "nao" && (!sokolow() || !r.strainVE)) return false;
  return true;
}

/* Etapa 9: QT medido em quadradinhos; QTc por Bazett com a FC da etapa 4. */
function qt(){
  const r = R(), q = num("qtQuad"), fc = r.fc;
  if (q === null || q <= 0 || !fc || !r.sexo) return null;
  const qtMs = Math.round(q * MS_POR_MM), qtc = Math.round(qtMs / Math.sqrt(60 / fc));
  const longo = r.sexo === "m" ? qtc > 450 : qtc >= 460, curto = qtc < 350;
  return {qtMs, qtc, longo, curto, classe:longo ? "prolongado" : curto ? "curto" : "normal"};
}

/* Etapa 10: padrões especiais. O app recupera o que já respondeu e só pergunta o que falta. */
const ESPECIAIS = [["tep","TEP"],["hiperk","Hipercalemia"],["hipok","Hipocalemia"],["hiperca","Hipercalcemia"],["hipoca","Hipocalcemia"]];
const simNao = k => R()[k] === "sim" || R()[k] === "nao";
function tepAchados(){
  const r = R(), a = arritmia();
  return [
    ["Taquicardia sinusal", a.pronto && a.res.t === "Taquicardia sinusal"],
    ["Desvio do eixo para a direita", eixoDireita()],
    ["BRD", larguraQRS() === "largo" && r.v1 === "brd"],
    ["Achados sugestivos de SVD/strain de VD", avaliouSobrecarga() && svd().sugere],
    ["Padrão S1Q3T3", r.s1q3t3 === "sim"]
  ];
}
function especiais(){
  const r = R(), m = r.esp || [], q = qt();
  if (!m.length) return {pronto:false, itens:[]};
  const itens = []; let pronto = true;
  if (m.includes("tep")){
    if (!simNao("s1q3t3")) pronto = false;
    else itens.push({k:"tep", t:"TEP", presentes:tepAchados().filter(x => x[1]).map(x => x[0])});
  }
  if (m.includes("hiperk")){
    if (!simNao("hk1") || !simNao("hk2")) pronto = false;
    else itens.push({k:"hiperk", t:"Hipercalemia", positivo:r.hk1 === "sim" || r.hk2 === "sim"});
  }
  if (m.includes("hipok")){
    if (!simNao("hpk1") || !simNao("hpk2")) pronto = false;
    else itens.push({k:"hipok", t:"Hipocalemia", positivo:r.hpk1 === "sim" || r.hpk2 === "sim"});
  }
  if (m.includes("hiperca") && q) itens.push({k:"hiperca", t:"Hipercalcemia", positivo:q.curto});
  if (m.includes("hipoca") && q) itens.push({k:"hipoca", t:"Hipocalcemia", positivo:q.longo});
  return {pronto, itens};
}

/* Etapa 11: próximo passo clínico. Só os 7 cenários do Dr. Vitor têm orientação; o resto sai com a mensagem padrão. */
function proximoPasso(){
  const r = R(), a = arritmia(), isq = isquemia(), sg = sgarbossa(), esp = especiais(), out = [];
  const t = a.pronto ? a.res.t : "";
  if (faixaFC() === "alta" && (t === "Flutter atrial" || /^Fibrilação atrial de alta resposta/.test(t))) out.push({t:"FA / flutter com resposta ventricular rápida", p:[
    "Foi identificado um padrão de " + (t === "Flutter atrial" ? "flutter atrial" : "FA") + " de alta resposta.",
    "Primeiro, avalie se existe instabilidade hemodinâmica atribuível à arritmia.",
    "Se instável: considere cardioversão elétrica sincronizada imediata.",
    "Se estável: avalie estratégia de controle da frequência ou do ritmo, considerando o contexto clínico.",
    "Não se esqueça de avaliar tempo de início/duração da FA e risco tromboembólico/necessidade de anticoagulação."]});
  if (t === "Taquicardia supraventricular") out.push({t:"TSV regular de QRS estreito", p:[
    "Avalie estabilidade clínica.",
    "Se instável pela taquicardia: considere cardioversão elétrica sincronizada.",
    "Se estável: considere manobras vagais e, se apropriado, adenosina.",
    "Reavalie o ritmo após cada intervenção."]});
  if (t === "Taquicardia sinusal") out.push({t:"Taquicardia sinusal", p:[
    "Na maioria das vezes, a taquicardia sinusal é uma resposta a uma condição subjacente.",
    "Procure a causa: dor, febre, hipovolemia, hipóxia, anemia, infecção, ansiedade, drogas/estimulantes, entre outras.",
    "Trate a causa, não apenas a frequência cardíaca."]});
  if (faixaFC() === "baixa") out.push({t:"Bradicardias", p:[
    "Primeiro, determine se existem sintomas ou comprometimento hemodinâmico atribuíveis à bradicardia.",
    "Se bradicardia sinusal e paciente estável: considere causas fisiológicas, como condicionamento físico, e revise medicamentos que possam reduzir a frequência cardíaca, além de outras causas reversíveis.",
    "Se bradicardia sintomática ou com comprometimento hemodinâmico: considere atropina e siga o manejo específico de bradicardia.",
    "Na presença de BAV Mobitz II, BAV avançado ou BAV total, mantenha monitorizado e atenção para a possibilidade de necessidade de estimulação cardíaca."]});
  if (t === "Taquicardia regular de QRS largo") out.push({t:"Taquicardia regular de QRS largo", p:[
    "Considere taquicardia ventricular até que se prove o contrário.",
    "Avalie imediatamente: o paciente tem pulso? Está hemodinamicamente estável?",
    "Se instável e com pulso: considere cardioversão elétrica sincronizada.",
    "Se sem pulso: siga o protocolo de parada cardiorrespiratória.",
    "Se estável: mantenha monitorização e siga o manejo específico da taquicardia de QRS largo."]});
  // No BRE o supra pode ser só a alteração secundária do bloqueio: ali quem abre a conduta de oclusão é o Sgarbossa modificado,
  // não o supra marcado na etapa 7 (orientação do Dr. Vitor, 21/09/2026). Sem BRE, vale o supra territorial.
  const bre = larguraQRS() === "largo" && r.v1 === "bre";
  const supraTerritorial = isq.pronto && (r.isq || []).includes("supra") && r.supraDist === "sim";
  if (bre ? !!(sg && sg.pronto && sg.positivo) : supraTerritorial) out.push({t:"Alterações compatíveis com isquemia aguda com supradesnivelamento de ST", p:[
    "Na presença de quadro clínico compatível, priorize estratégia de reperfusão sem atraso.",
    "Avalie imediatamente a possibilidade de intervenção coronária percutânea e, quando ela não puder ser realizada em tempo adequado, a elegibilidade para fibrinólise, conforme protocolo assistencial.",
    "Não retarde a estratégia de reperfusão aguardando exames que não sejam necessários para a decisão inicial."]});
  else if (S.cur.motivo === "dor") out.push({t:"Dor torácica sem supra / padrão de oclusão identificado", p:[
    "O ECG inicial sem supradesnivelamento de ST não exclui síndrome coronariana aguda.",
    "Se a história clínica mantiver suspeita de SCA, considere ECGs seriados, dosagem seriada de troponina e estratificação de risco, conforme o contexto clínico.",
    "Reavalie imediatamente se houver recorrência ou mudança dos sintomas."]});
  if (esp.itens.some(x => x.k === "hiperk" && x.positivo)) out.push({t:"Achados sugestivos de hipercalemia", p:[
    "Na presença de hipercalemia com alterações eletrocardiográficas, considere cálcio intravenoso para estabilização da membrana miocárdica e inicie medidas para redução do potássio sérico, conforme o contexto clínico.",
    "Mantenha monitorização cardíaca e reavalie o ECG."]});
  return out;
}

/* ---------- foto ---------- */
function pedirFoto(fonte){
  // foto pedida pelo dock volta para a etapa, não para o começo. Refazer a foto dentro do conferidor
  // (S.tela === "foto") não pode apagar de onde ela veio.
  if (S.tela !== "foto") S.fotoOrigem = S.tela === "seq" ? "seq" : null;
  Plataforma.escolherFoto(fonte);
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
    // o enquadramento guardado tem o centro em coordenadas da imagem: vale em visores de tamanhos diferentes
    if (S.vista){
      this.v.escala = S.vista.escala; this.v.giro = S.vista.giro;
      const p = this.paraTela({x:S.vista.cx, y:S.vista.cy});          // onde o centro guardado cairia agora
      this.v.tx += this.larg / 2 - p.x; this.v.ty += this.alt / 2 - p.y;
    }
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
    const m = this.paraImagem({x:this.larg / 2, y:this.alt / 2});
    S.vista = {escala:this.v.escala, giro:this.v.giro, cx:m.x, cy:m.y};
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
    <div class="tools"><button type="button" data-zoom="1.6" aria-label="Aproximar">+</button><button type="button" data-zoom="0.65" aria-label="Afastar">−</button><button type="button" data-fit="1" aria-label="Ajustar à tela">ajustar</button></div>
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
  baixo:svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  maisPeq:svg('<path d="M12 6v12M6 12h12"/>'),
  camera:svg('<rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="12" cy="13.5" r="3.4"/><path d="M8 7l1.4-2h5.2L16 7"/>'),
  galeria:svg('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>'),
  copiar:svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
  lixo:svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  regua:svg('<path d="M3 17 17 3l4 4L7 21z"/><path d="M8 12l2 2M11 9l2 2M14 6l2 2"/>'),
  check:svg('<path d="M5 12l5 5L20 7"/>'),
  ecg:svg('<path d="M3 12h4l2-6 3 12 3-8 2 2h4"/>'),
  expandir:svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  recolher:svg('<path d="M6 15l6-6 6 6"/>'),
  guia:svg('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/><path d="M9 8h7M9 11.5h5"/>'),
  vazio:svg('<path d="M3 12h3l2-5 3 10 3-8 2 3h5"/><path d="M4 19h16" stroke-dasharray="2 3"/>')
};
const marca = () => `<span class="mark"><svg viewBox="0 0 24 24"><path d="M4 13h4l2-6 3 11 2.5-7 1.5 2H20"/></svg></span>`;
function opt(chave, valor, rotulo, multi){
  const atual = R()[chave];
  const on = multi ? (atual || []).includes(valor) : atual === valor;
  return `<button type="button" class="opt${multi ? " multi" : ""}" data-ans="${chave}" data-val="${valor}" data-multi="${multi ? 1 : 0}" aria-pressed="${on}"><span>${rotulo}</span></button>`;
}
function ins(k, t, d, id){ return `<div class="ins ${k}${k === "ok" && !d ? " mini" : ""}"${id ? ` id="${id}"` : ""}><strong>${t}</strong>${d ? `<p>${d}</p>` : ""}</div>`; }
const terrHTML = () => `<div class="terr">${TERR.map(([, b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("")}</div>`;
const revisao = () => !!S.prefs.revisao;
function pendente(o){ return revisao() ? `<div class="pendente"><span class="tag">a enviar</span> ${o}</div>` : ""; }
// link de ajuda cujo único conteúdo seria a imagem pendente: existe apenas em modo revisão
function ajudaRev(chave, rotulo, conteudo){ return revisao() ? ajuda(chave, rotulo) + (S.aberto[chave] ? `<div class="helpbox">${conteudo}</div>` : "") : ""; }
/* "↓ continua" mora no rodapé, em fluxo: linha própria acima do botão, nunca por cima do conteúdo.
   O botão ocupa a linha inteira (44 px de alvo de toque); o desenho da pílula fica centrado dentro. */
function pilula(){ return `<button class="continua" id="continua" type="button" hidden><span>${I.baixo}continua</span></button>`; }
function ajuda(chave, rotulo){ return `<button class="help" type="button" data-toggle="${chave}" aria-expanded="${!!S.aberto[chave]}">${I.maisPeq}${rotulo}</button>`; }
function qrsFig(tipo){
  const base = tipo === "qs" || tipo === "rs" ? 40 : 60;
  const d = { ralto:"M4 60 L24 60 L36 8 L46 66 L52 60 L76 60", qr:"M4 60 L22 60 L26 70 L36 10 L46 60 L76 60",
    qs:"M4 40 L22 40 L36 92 L50 40 L76 40", rs:"M4 40 L22 40 L27 30 L38 92 L50 40 L76 40" }[tipo];
  return `<svg viewBox="0 0 80 100" class="fig" aria-hidden="true"><line x1="0" y1="${base}" x2="80" y2="${base}" stroke="var(--line-3)" stroke-dasharray="3 3"/><path d="${d}" fill="none" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round"/></svg>`;
}
function progresso(i){ return `<div class="prog" style="grid-template-columns:repeat(${ULTIMO},1fr)">${Array.from({length:ULTIMO}, (_, k) => `<i class="${k+1 < i ? "done" : k+1 === i ? "now" : ""}"></i>`).join("")}</div>`; }
/* a foto acompanha a leitura: mora na casca da etapa, entre o progresso e o miolo, e sobrevive a cada resposta */
function dockHTML(modo){
  const c = S.cur;
  if (!c.tela) return modo === "laudo" ? "" : `<div class="dock vazio"><span class="rot">${I.camera}Adicionar foto do eletro</span><span class="acoes"><button class="chip" type="button" data-fonte="camera">Câmera</button><button class="chip" type="button" data-fonte="galeria">Galeria</button></span></div>`;
  if (!c.thumb) c.thumb = miniatura();
  const mini = c.thumb ? `<img src="${c.thumb}" alt="">` : ""; // sem miniatura, a pílula sai só com o rótulo
  if (modo === "laudo") return `<button class="dock pilula" type="button" data-ver="1">${mini}<span>Eletro</span>${I.expandir}</button>`;
  if (S.dock === "pilula") return `<button class="dock pilula" type="button" data-dock="abrir">${mini}<span>Eletro</span>${I.expandir}</button>`;
  return `<div class="dock aberto"><div class="visor" id="visor">
    <div class="tools"><button type="button" data-zoom="1.6" aria-label="Aproximar">+</button><button type="button" data-zoom="0.65" aria-label="Afastar">−</button><button type="button" data-fit="1" aria-label="Ajustar à tela">ajustar</button></div>
    <div class="tools dir"><button type="button" data-ver="1" aria-label="Tela cheia">${I.expandir}</button><button type="button" data-dock="recolher" aria-label="Recolher a foto">${I.recolher}</button></div>
    <div class="zoomtag">100%</div></div></div>`;
}
const dois = n => String(n).padStart(2, "0");
/* sem número grande à esquerda: ele repetia o "Etapa N de 11" e o número-fantasma do fundo,
   e roubava a largura do título, que saía cortado no celular */
function topo(passo, titulo, extra){
  return `<div class="top"><span class="ghostnum" aria-hidden="true">${dois(passo)}</span><button class="icobtn ghost" type="button" data-voltar="1" aria-label="Voltar">${I.voltar}</button>
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
/* na ordem de quem acabou de receber um eletro na mão: ler agora e os dois atalhos antes de qualquer número */
function inicio(){
  const ult = S.leituras.slice(0, 2), n = S.leituras.length, at = S.leituras.filter(l => l.alerta).length;
  const top = contagemMotivos()[0];
  const nomeTop = top ? (MOTIVOS.find(m => m.k === top[0]) || {curto:"—"}).curto : "—";
  const and = lerAndamento(), mAnd = and && MOTIVOS.find(m => m.k === and.motivo);
  const haQuanto = ms => { const min = Math.max(1, Math.round((Date.now() - ms) / 6e4)); return min < 60 ? `há ${min} min` : `há ${Math.round(min / 60)} h`; };
  return `<div class="screen">
  <div class="top"><div class="brand">${marca()}<strong>Copiloto</strong></div><div class="t"></div>
    <button class="icobtn" type="button" data-aba="config" aria-label="Configurações">${I.config}</button></div>
  <div class="scroll stagger com-nav">
    <div><h1>${saudacao()}</h1><p class="mute" style="margin-top:4px">Vamos interpretar um ECG?</p></div>
    ${and ? `<div class="card grad glow cont"><span class="eyebrow">Leitura em andamento</span><strong>${mAnd ? mAnd.nome : "Leitura"}</strong>
      <p class="tiny">Etapa ${and.passo} de ${ULTIMO} · ${PASSOS[and.passo]} · ${haQuanto(and.salvoEm)}</p>
      <div class="row2"><button class="btn" type="button" data-descartar="1">Descartar</button><button class="btn primary" type="button" data-continuar="1">Continuar</button></div></div>` : ""}
    <button class="btn ${and ? "" : "primary "}big wide" type="button" data-ir="motivo">${I.ecg}Ler um eletro agora</button>
    <div class="row2"><button class="btn" type="button" data-atalho="fc">Calcular FC</button><button class="btn" type="button" data-atalho="qtc">Calcular QTc</button></div>
    ${monitorHTML()}
    <div class="sec"><h3>Suas leituras</h3>${n ? `<button class="textbtn" type="button" data-aba="biblioteca">Ver todas ${I.seta}</button>` : ""}</div>
    ${n ? `<div class="rgrid">${ult.map(cardLeitura).join("")}</div>`
      : `<div class="card"><div class="empty" style="padding:14px 6px"><p class="ink2">Nenhuma leitura guardada.</p><p class="tiny">A primeira fica aqui, com o laudo e a foto. A foto não sai deste aparelho.</p></div></div>`}
    <div class="stats">
      <div class="stat"><span class="n" data-count="${n}">0</span><span class="l">leitura${n === 1 ? "" : "s"}</span></div>
      <div class="stat"><span class="n" data-count="${at}">0</span><span class="l">com atenção</span></div>
      <div class="stat"><span class="n" data-count="${semana()}">0</span><span class="l">esta semana</span></div>
    </div>
    <div class="card"><div class="sec" style="margin:0"><h3>Últimos 7 dias</h3><span class="tiny mute">${top ? "mais comum: " + nomeTop : "por dia"}</span></div>${barrasSemana()}</div>
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
    <div id="mon" class="mon" aria-hidden="true"></div>
    <div class="mon-foot"><span class="num" data-count="${fc}">0<span class="u">bpm</span></span><span class="pill">${u ? (u.qrsLargo ? "QRS largo" : "QRS estreito") : "25 mm/s"}</span></div>
  </div>`;
}
/* monitor: traçado varrendo como num monitor de beira de leito, derivado da última leitura */
function montarMonitor(){
  const h = document.getElementById("mon"); if (!h || !window.Controles) return;
  const u = S.leituras[0];
  window.Controles.tracado(h, {fc:u && u.fc ? u.fc : 72, largo:!!(u && u.qrsLargo), irregular:!!(u && u.irregular), altura:118, segundos:3.2, grade:true});
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
      : `<div class="empty">${I.vazio}<p class="ink2">${S.leituras.length ? "Nada com esse filtro." : "Ainda não há leituras salvas."}</p><p class="tiny">${S.leituras.length ? "Tente outra busca ou limpe os filtros." : "Cada leitura guarda o laudo e a foto. A foto fica só neste celular."}</p></div>`}
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
    corpo = `<div class="card" id="calc-fc"><h3>Frequência cardíaca</h3>
      <p class="tiny mute">Quadradinhos entre dois QRS · 1500 ÷ n. Quadrados grandes entre dois QRS · 300 ÷ n.</p>
      <div data-ctl="g-rr"></div>
      <div data-ctl="g-c10"></div>
    </div>
    <div class="card" id="calc-qtc"><h3>QT corrigido (Bazett)</h3><p class="tiny mute">QTc = QT ÷ √RR, com RR em segundos.</p>
      <div data-ctl="g-qt"></div>
      <div data-ctl="g-fc"></div>
      <p class="tiny mute">Prolongado: > 450 ms no masculino, ≥ 460 ms no feminino. Curto: < 350 ms.</p></div>`;
  } else if (aba === "uso"){
    corpo = `<div class="card"><h3>Instalar na tela inicial</h3>
      <p class="small ink2">No iPhone: abra no Safari, toque em Compartilhar e em Adicionar à Tela de Início.</p>
      <p class="small ink2">No Android: no Chrome, toque no menu ⋮ e em Instalar app.</p>
      <p class="small ink2">Instalado, o Copiloto abre em tela cheia e funciona sem internet.</p>
      ${S.instalar ? `<button class="btn wide" type="button" data-instalar="1">Instalar agora</button>` : ""}</div>
      <div class="card"><h3>A sequência</h3><p class="small ink2">Motivo do exame → técnica → ritmo → regularidade e frequência → eixo → descarte de arritmias → descarte de isquemia → QRS → intervalo QT → padrões especiais → volte ao paciente. O Copiloto guarda cada resposta e usa nas etapas seguintes, sem perguntar de novo: a largura do QRS, o eixo, a FC e o QTc são reaproveitados.</p></div>
      <div class="card"><h3>A foto é opcional</h3><p class="small ink2">Você pode ler direto no papel. Com a foto, o eletro fica no topo de todas as etapas — dá para dar zoom, recolher e abrir em tela cheia — e dá para medir com a régua na tela. <b>Câmera</b> fotografa na hora; <b>Galeria</b> usa uma foto já tirada.</p></div>
      <div class="card"><h3>A régua na foto</h3><p class="small ink2">Antes de medir, arraste as duas bolinhas sobre cinco quadradões (1 segundo de papel). O app aprende a escala daquela foto e passa a medir em milissegundos.</p></div>
      <div class="card"><h3>O laudo</h3><p class="small ink2">O texto final é montado com as suas respostas e pode sair assinado com o seu nome (Configurações). Confira antes de copiar.</p></div>
      <div class="card"><h3>Privacidade</h3><p class="small ink2">A foto do eletro fica só neste aparelho. O laudo de cada leitura salva fica guardado também na sua conta, para não se perder se você trocar de celular.</p><p class="small ink2">A leitura em andamento também fica só aqui, para você continuar se for interrompido.</p></div>`;
  } else {
    const g = [["Ritmo sinusal","P positiva em DI, DII e aVF, negativa em aVR, precedendo cada QRS com a mesma morfologia."],["Regular / irregular","Compare os intervalos R-R ao longo do traçado."],["QRS largo","120 ms ou mais: três quadradinhos ou mais."],["Derivações contíguas","Inferior: DII, DIII, aVF · Lateral: DI, aVL, V5, V6 · Anterior/septal: V1 a V4."],["Calibração padrão","25 mm/s e 10 mm/mV, impressos no próprio ECG."],["Eixo por DI e aVF","Os dois positivos: normal. DI positivo e aVF negativo: DII desempata. DI negativo e aVF positivo: direita. Os dois negativos: extremo."],["Sgarbossa modificado","No BRE com suspeita de isquemia: supra ≥ 1 mm concordante, infra ≥ 1 mm em V1–V3 ou supra ÷ onda S ≥ 0,25 em V1–V3."],["Sokolow-Lyon","S em V1 + maior R em V5/V6 > 35 mm: critério de voltagem para aumento ventricular esquerdo."],["QTc (Bazett)","QT ÷ √RR. Prolongado: > 450 ms (M), ≥ 460 ms (F). Curto: < 350 ms."]];
    corpo = `<div class="card"><h3>Termos usados no app</h3><div class="gloss">${g.map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("")}</div><p class="tiny mute">Definições como aparecem no roteiro do Dr. Vitor.</p></div>`;
  }
  return `<div class="screen">
  <div class="top"><div class="t"><small>Copiloto</small><strong>Guia</strong></div>${I.guia.replace("<svg", '<svg style="width:22px;height:22px;color:var(--mute)"')}</div>
  <div class="scroll stagger com-nav${S.guiaFoco ? " foco" : ""}">
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
    ${cartaoConta()}
    <div class="card"><div class="field"><label for="p-nome">Como o Copiloto deve chamar você</label><input type="text" id="p-nome" value="${(p.nome || "").replace(/"/g, "&quot;")}" placeholder="Dr. Vitor" autocomplete="off"></div>
      <p class="tiny mute">Aparece na saudação e, se quiser, no fim do laudo.</p></div>
    <div class="card">
      <div class="toggle"><div class="l"><strong>Assinar o laudo</strong><span>Acrescenta seu nome e a data ao copiar</span></div><button class="switch" type="button" role="switch" aria-checked="${!!p.assinatura}" data-pref="assinatura"></button></div>
      <div class="toggle"><div class="l"><strong>Tema claro</strong><span>Para ambientes muito iluminados</span></div><button class="switch" type="button" role="switch" aria-checked="${p.tema === "claro"}" data-pref="tema"></button></div>
      <div class="toggle"><div class="l"><strong>Modo revisão</strong><span>Mostra os lembretes das imagens que o Dr. Vitor ainda vai enviar</span></div><button class="switch" type="button" role="switch" aria-checked="${!!p.revisao}" data-pref="revisao"></button></div>
    </div>
    <div class="card"><h3>Dados</h3><p class="small mute">${n} leitura${n === 1 ? "" : "s"} neste aparelho. Os laudos ficam guardados também na sua conta; as fotos, só aqui.</p>
      <button class="btn danger" type="button" data-apagar-tudo="1" ${n ? "" : "disabled"}>${I.lixo}Apagar todas as leituras</button>
      ${S.confirmaApagar ? `${ins("bad", "Tem certeza?", `Isso apaga as ${n} leituras, deste aparelho e da sua conta, e as fotos. Não dá para desfazer.`)}<div class="row2"><button class="btn" type="button" data-cancela-apagar="1">Cancelar</button><button class="btn danger" type="button" data-confirma-apagar="1">Apagar tudo</button></div>` : ""}</div>
    <p class="tiny mute" style="text-align:center">Copiloto de ECG · versão 6.2 · roteiro clínico do Dr. Vitor Coutinho (19/09)</p>
  </div></div>`;
}
function assinatura(){
  const n = (S.prefs.nome || "").trim();
  if (!S.prefs.assinatura || !n) return "";
  return `\n\n— ${n} · ${new Date().toLocaleDateString("pt-BR")}`;
}

/* ---------- conta: entrar, código, acesso encerrado ----------
   Tom de plantão: frase curta, sem vender nada. Nenhuma tela daqui mostra preço, compra ou link de venda
   (regra 3.1.1 da Apple): quem não tem acesso é mandado ao suporte, nunca a um checkout. */
const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;"}[c]));
const suporte = () => (window.COPILOTO_CONFIG || {}).suporte || "";
const linkSuporte = () => `<button type="button" class="link" data-suporte="1">${esc(suporte())}</button>`;
const TELAS_CONTA = ["entrar", "codigo", "encerrado"];
const MSG_ENTRAR = {
  sem_acesso:() => ins("warn", `Não encontramos uma compra com este <span class="nw">e-mail.</span>`, `Use o mesmo e-mail da compra na Hotmart. Se precisar, fale com o suporte: ${linkSuporte()}`),
  muitos_pedidos:() => ins("warn", "Muitos pedidos seguidos. Espere alguns minutos."),
  sem_rede:() => ins("info", "Sem internet agora.", "Para entrar pela primeira vez o Copiloto precisa de conexão."),
  email_invalido:() => ins("bad", "Confira o e-mail."),
  falha:() => ins("bad", "Não deu certo. Tente de novo.")
};
const MSG_CODIGO = {
  codigo_errado:"Código incorreto",
  codigo_expirado:"Código expirado. Peça um código novo.",
  sem_rede:"Sem internet agora. Tente de novo quando o sinal voltar.",
  falha:"Não deu certo. Tente de novo."
};
function telaEntrar(){
  const c = S.conta, m = c.msg && MSG_ENTRAR[c.msg];
  return `<div class="screen porta">
  <div class="top"><div class="brand">${marca()}<strong>Copiloto</strong></div><div class="t"></div></div>
  <div class="scroll stagger">
    <div class="porta-cab"><h1>Entre com o <span class="nw">e-mail</span> da sua compra</h1><p class="ink2">Você recebe um código de 6 dígitos. Sem senha.</p></div>
    <form class="card" id="c-form" novalidate>
      <div class="field"><label for="c-email">E-mail</label><input type="email" id="c-email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" placeholder="nome@exemplo.com" value="${esc(c.email)}"></div>
      <button class="btn primary wide" type="submit" id="c-enviar" ${c.enviando ? "disabled" : ""}>${c.enviando ? "Enviando…" : "Receber código"}</button>
    </form>
    <div class="c-msg" id="c-msg" aria-live="polite">${m ? m() : ""}</div>
    <p class="tiny mute porta-pe">Depois de entrar, o Copiloto abre mesmo sem sinal.</p>
  </div></div>`;
}
const bloqueado = () => S.conta.erros >= 5;
function statusCodigo(){
  const c = S.conta;
  if (c.verificando) return `<span class="mute">Conferindo…</span>`;
  if (bloqueado()) return `<span class="erro">Peça um código novo.</span>`;
  return c.msg && MSG_CODIGO[c.msg] ? `<span class="erro">${MSG_CODIGO[c.msg]}</span>` : "";
}
const faltaReenviar = () => Math.max(0, Math.ceil((S.conta.reenviarEm - Date.now()) / 1000));
const textoReenviar = () => faltaReenviar() ? `Reenviar código em ${faltaReenviar()} s` : "Reenviar código";
function telaCodigo(){
  const c = S.conta;
  return `<div class="screen porta">
  <div class="top"><button class="icobtn ghost" type="button" data-trocar-email="1" aria-label="Trocar e-mail">${I.voltar}</button><div class="brand">${marca()}<strong>Copiloto</strong></div><div class="t"></div></div>
  <div class="scroll stagger">
    <div class="porta-cab"><h1>Digite o código</h1><p class="ink2">Enviamos um código de 6 dígitos para <b class="quebra">${esc(c.email)}</b></p></div>
    <div class="codigo" id="c-codigo">
      <input id="c-otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" aria-label="Código de 6 dígitos" ${bloqueado() || c.verificando ? "disabled" : ""}>
      ${Array.from({length:6}, () => `<span class="cx" aria-hidden="true"></span>`).join("")}
    </div>
    <p class="c-status" id="c-status" aria-live="polite">${statusCodigo()}</p>
    <div class="c-acoes"><button class="textbtn" type="button" id="c-reenviar" ${faltaReenviar() ? "disabled" : ""}>${textoReenviar()}</button><button class="textbtn" type="button" data-trocar-email="1">Trocar e-mail</button></div>
    <p class="tiny mute porta-pe">Não chegou? Confira a caixa de spam. O código vale por 10 minutos.</p>
  </div></div>`;
}
function telaEncerrado(){
  const e = Conta.email();
  return `<div class="screen porta">
  <div class="top"><div class="brand">${marca()}<strong>Copiloto</strong></div><div class="t"></div></div>
  <div class="scroll stagger">
    <div class="porta-cab"><span class="tag bad">Acesso encerrado</span><h1>Seu acesso ao Copiloto foi encerrado.</h1>
      <p class="ink2">Se acha que é um engano, fale com o suporte: ${linkSuporte()}</p></div>
    ${botaoSair()}
    ${e ? `<p class="tiny mute porta-pe">Conta: ${esc(e)}</p>` : ""}
  </div></div>`;
}
/* Sair (T08): primeiro tenta subir a fila. Sobrou pendente (sem rede): não sai, avisa e deixa escolher.
   Sem pendente: confirma, porque as fotos só existem neste aparelho. */
function botaoSair(){
  const s = S.conta.saindo;
  if (!s) return `<button class="btn wide" type="button" data-sair-conta="1">Sair</button>`;
  const n = s.pendentes, um = n === 1;
  if (n) return `${ins("bad", "Leituras não enviadas", `Há ${n} leitura${um ? "" : "s"} ainda não enviada${um ? "" : "s"}. Conecte-se à internet para sair sem perdê-${um ? "la" : "las"}.`)}
    <div class="row2"><button class="btn" type="button" data-sair-cancela="1">Cancelar</button><button class="btn danger" type="button" data-sair-mesmo="1">Sair mesmo assim</button></div>`;
  return `${ins("warn", "Sair da conta?", "As fotos dos eletros ficam só neste aparelho e serão apagadas.")}
    <div class="row2"><button class="btn" type="button" data-sair-cancela="1">Cancelar</button><button class="btn danger" type="button" data-sair-confirma="1">Sair</button></div>`;
}
/* Configurações: a conta vem primeiro. Excluir pede a palavra digitada, não um toque só. */
function cartaoConta(){
  const e = Conta.email(), c = S.conta;
  return `<div class="card conta">
    <div class="sec" style="margin:0"><h3>Conta</h3><span class="tag ok">conectada</span></div>
    <p class="conta-email quebra">${esc(e || "—")}</p>
    ${botaoSair()}
    ${c.excluindo ? `${ins("bad", "Excluir sua conta?", "Apaga sua conta e as leituras guardadas nela. Seu acesso de compra continua válido: você pode entrar de novo depois.")}
      <div class="field"><label for="c-excluir">Digite EXCLUIR para confirmar</label><input type="text" id="c-excluir" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>
      <div class="row2"><button class="btn" type="button" data-excluir-cancela="1">Cancelar</button><button class="btn danger" type="button" id="c-excluir-ok" disabled>Excluir conta</button></div>`
    : `<button class="textbtn perigo" type="button" data-excluir-conta="1">Excluir minha conta</button>`}
  </div>`;
}

/* ---------- etapa 1: o paciente ---------- */
function telaMotivo(){
  const m = motivo();
  return `<div class="screen">
  <div class="top"><span class="ghostnum" aria-hidden="true">01</span><button class="icobtn ghost" type="button" data-aba="inicio" aria-label="Voltar">${I.voltar}</button><div class="t"><small>Etapa 1 de ${ULTIMO}</small><strong>Olhe para o paciente</strong></div></div>
  ${progresso(1)}
  <div class="scroll seq stagger" id="seq-scroll">
    <p class="q">O que motivou este ECG?</p>
    <div class="tiles">${MOTIVOS.map((x, i) => `<button type="button" class="tile" data-motivo="${x.k}" aria-pressed="${S.cur.motivo === x.k}"><span class="ix">${dois(i + 1)}</span><strong>${x.nome}</strong></button>`).join("")}</div>
    ${m ? `<div class="orient" id="orient"><span class="eyebrow">Antes de olhar o traçado</span>${m.texto.map(t => `<p>${t}</p>`).join("")}</div>` : `<p class="tiny mute">A depender do motivo, o Copiloto mostra o que não pode passar naquele contexto.</p>`}
  </div>
  <div class="foot">${pilula()}<button class="btn primary" type="button" data-ir="foto" ${m ? "" : "disabled"}>Iniciar leitura ${I.seta}</button></div></div>`;
}

/* ---------- foto (opcional) ---------- */
function telaFoto(){
  const c = S.cur;
  if (!c.tela){
    return `<div class="screen">
    <div class="top"><button class="icobtn ghost" type="button" data-ir="${S.fotoOrigem === "seq" ? "seq" : "motivo"}" aria-label="Voltar">${I.voltar}</button><div class="t"><small>Opcional</small><strong>Quer usar a foto do eletro?</strong></div></div>
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
  <div class="top"><button class="icobtn ghost" type="button" data-ir="${S.fotoOrigem === "seq" ? "seq" : "motivo"}" aria-label="Voltar">${I.voltar}</button><div class="t"><small>Opcional</small><strong>A foto ficou boa?</strong></div></div>
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
  const titulo = {fc:"Medir o RR", qrs:"Medir o QRS", qt:"Medir o QT"}[m.alvo];
  const dica = {fc:"Uma bolinha em cada pico de QRS, em dois batimentos seguidos.", qrs:"Do começo ao fim do QRS.", qt:"Do início do QRS ao fim da onda T."}[m.alvo];
  return `<div class="screen">
  <div class="top"><button class="icobtn ghost" type="button" data-sair-medir="1" aria-label="Voltar">${I.voltar}</button><div class="t"><small>Régua na foto</small><strong>${titulo}</strong></div><button class="textbtn" type="button" data-recalibrar="1">Recalibrar</button></div>
  ${visorHTML("full", dica)}
  <div class="scroll" style="padding-top:12px"><div class="card" id="medir-out"></div></div>
  <div class="foot"><button class="btn primary" type="button" id="usar-medida">Usar esta medida</button></div></div>`;
}
function telaVer(){
  const passo = S.verVolta === "laudo" ? ULTIMO : S.cur.passo;   // aberta do laudo, a leitura está na etapa 11
  return `<div class="screen">
  <div class="top"><button class="icobtn ghost" type="button" data-fechar-ver="1" aria-label="Voltar">${I.voltar}</button><div class="t"><small>Etapa ${passo} de ${ULTIMO}</small><strong>O eletro</strong></div><button class="icobtn" type="button" data-fechar-ver="1" aria-label="Fechar">${I.fechar}</button></div>
  ${visorHTML("tudo", "Arraste para mover, pince para aproximar.")}</div>`;
}

/* ---------- blocos de etapa: pergunta em foco ----------
   Cada etapa devolve uma lista de blocos em ordem. Pergunta respondida recolhe para uma linha,
   a primeira sem resposta fica aberta, as seguintes esperam a vez. */
function Blocos(){
  const L = [], p = (t, chave, o) => L.push(Object.assign({t, chave}, o));
  return { L,
    texto:html => L.push({t:"texto", html}),          // sempre visível
    html:html => L.push({t:"html", html}),            // visível quando nenhuma pergunta antes dele está pendente
    res:(k, titulo, d) => L.push({t:"res", k, titulo, d}),
    escolha:(chave, o) => p("escolha", chave, o), multi:(chave, o) => p("multi", chave, o), medida:(chave, o) => p("medida", chave, o) };
}
const NULO = {L:[], texto(){}, html(){}, res(){}, escolha(){}, multi(){}, medida(){}};
const ehPergunta = b => b.t === "escolha" || b.t === "multi" || b.t === "medida";
function feita(b){
  if (S.editando === b.chave) return false;
  const v = R()[b.chave], conf = !!S.cur.conf[b.chave];
  if (b.t === "escolha") return v != null && (!(b.pendentes || []).includes(v) || conf);
  if (b.t === "multi") return conf && (!!b.permiteVazio || (v || []).length > 0);
  return conf;
}
function valorCurto(b){
  if (b.t === "medida") return b.resumo();
  const nome = x => { const o = b.opcoes.find(o => o[0] === x); return o ? (o[2] || o[1]) : x; };
  const v = R()[b.chave];
  if (b.t === "multi") return (v || []).length ? v.map(nome).join(" · ") : (b.vazio || "nenhum");
  return nome(v);
}
function blocoAtivo(b){
  let corpo = "";
  if (b.t === "escolha") corpo = `<div class="opts">${b.opcoes.map(([v, l]) => opt(b.chave, v, l)).join("")}</div>`;
  if (b.t === "multi") corpo = `<div class="opts">${b.opcoesHtml || b.opcoes.map(([v, l]) => opt(b.chave, v, l, true)).join("")}</div>
    <button class="btn small conf" type="button" data-conf="${b.chave}" ${(R()[b.chave] || []).length || b.permiteVazio ? "" : "disabled"}>Continuar ${I.seta}</button>`;
  if (b.t === "medida") corpo = b.corpo() + `<button class="btn small conf" type="button" data-conf="${b.chave}" ${b.pronta() ? "" : "disabled"}><span data-conf-rot>${b.rotuloConf()}</span> ${I.check}</button>`;
  return `<section class="qb ativa" data-q="${b.chave}">
    ${b.sec ? `<div class="sec"><h3>${b.sec}</h3></div>` : ""}${b.antes || ""}
    ${b.titulo ? `<p class="q${b.grande ? "" : " sm"}">${b.titulo}</p>` : ""}${b.dica ? `<p class="tiny mute">${b.dica}</p>` : ""}${b.meio || ""}
    ${corpo}${b.depois || ""}</section>`;
}
function renderBlocos(L){
  let ativa = null, h = "";
  L.forEach(b => {
    if (b.t === "texto"){ h += b.html; return; }
    if (!ehPergunta(b)){ if (!ativa) h += b.t === "res" ? ins(b.k, b.titulo, b.d) : b.html; return; }
    if (feita(b)){ h += `<button type="button" class="qb feita" data-editar="${b.chave}"><span class="ck">${I.check}</span><span class="rot">${b.curto}</span><b>${valorCurto(b)}</b></button>`; return; }
    if (ativa){ h += `<div class="qb futura"><span class="ck"></span><span class="rot">${b.curto}</span></div>`; return; }
    ativa = b; h += blocoAtivo(b);
  });
  S._ativa = ativa;
  return {html:h, temAtiva:!!ativa};
}
function atualizarConf(){
  const b = S._ativa; if (!b || b.t !== "medida") return;
  const btn = app.querySelector(`[data-conf="${b.chave}"]`); if (!btn) return;
  btn.disabled = !b.pronta(); btn.querySelector("[data-conf-rot]").textContent = b.rotuloConf();
}

/* ---------- controles de arrastar no lugar de digitar ----------
   Regra: aoMudar nunca redesenha (o redesenho destruiria o controle no meio do arrasto). Ele grava
   em R() e atualiza leituras soltas; quem redesenha é Confirmar, "Usar" e a troca de aba da ajuda. */
const ZONAS_FC = [{ate:49, rotulo:"bradicardia", classe:"warn"}, {ate:100, rotulo:"normal", classe:"ok"}, {ate:Infinity, rotulo:"taquicardia", classe:"warn"}];
const MM = {sgST:[0, 15, "Supra do ST no ponto J"], sgS:[0, 40, "Profundidade da onda S"], sV1:[0, 50, "Onda S em V1"], rV56:[0, 50, "Maior onda R entre V5 e V6"]};
const grava = (k, v) => { const r = R(); if (v == null) delete r[k]; else r[k] = v; };
/* enquanto a fita anda, Confirmar fica travado: o rótulo dele ainda é do valor antigo e um toque
   registraria uma medida que o médico não viu. Quem reabre é o aoSoltar, já com o valor final. */
function travarConf(){
  const b = S._ativa && S._ativa.t === "medida" ? app.querySelector(`[data-conf="${S._ativa.chave}"]`) : null;
  if (b) b.disabled = true;
}
function montarControles(raiz){
  const C = window.Controles; if (!C) return;
  raiz.querySelectorAll("[data-ctl]").forEach(host => {
    const k = host.dataset.ctl, r = R();
    // um controle que exploda não pode deixar o resto da etapa (e o botão Próxima) pela metade
    try {
    if (k === "tracado-fc") C.tracado(host, {fc:r.fc || 75, irregular:r.reg === "irregular", altura:64, segundos:2.6, grade:false});
    else if (k === "fc") C.fita(host, {min:20, max:300, passo:1, valor:r.fc || null, inicial:75, unidade:"bpm", medio:5, maior:10, pxPorPasso:5, digitar:{min:10, max:350}, zonas:ZONAS_FC,
      aoMudar:v => { const tr = raiz.querySelector('[data-ctl="tracado-fc"]'); if (tr && tr.__ctl) tr.__ctl.definir({fc:v || 75});
        const d = document.getElementById("fc-dica"); if (d) d.hidden = v != null;
        travarConf(); },
      aoSoltar:v => { definirFC(v == null ? null : Math.round(v)); atualizarConf(); }});
    else if (k === "rr") C.reguaRR(host, {valor:num("cq"), aoMudar:v => grava("cq", v), aoUsar:fc => usarFC(fc)});
    else if (k === "c10") C.contador(host, {valor:num("c10") || 0, fator:6, rotulo:"QRS em 10 segundos", aoMudar:n => grava("c10", n), aoUsar:fc => usarFC(fc)});
    else if (k === "qtQuad"){
      const gravaQT = v => { grava("qtQuad", v); atualizarConf(); };
      const c = C.reguaQT(host, {valor:num("qtQuad"), fc:r.fc || null, largo:larguraQRS() === "largo", aoMudar:gravaQT, aoSoltar:gravaQT});
      // a régua anda de meio em meio quadradinho: 9,3 medidos na foto nascem 9,5, e régua, botão e R() têm de dizer o mesmo
      if (c.valor() !== num("qtQuad")) gravaQT(c.valor());
    }
    else if (MM[k]) C.fita(host, {compacta:true, min:MM[k][0], max:MM[k][1], passo:.5, valor:num(k), inicial:0, unidade:"mm", rotulo:MM[k][2], medio:2, maior:10,
      aoMudar:v => { grava(k, v); atualizarSaidas(); travarConf(); },
      aoSoltar:v => { grava(k, v); atualizarSaidas(); atualizarConf(); }});
    else montarControleGuia(host, k, raiz);
    } catch(e){ console.error("controle " + k, e); }
  });
}
/* "Usar" vale por Confirmar: grava, fecha a ajuda e encerra a edição (senão pedia um Confirmar a mais) */
function usarFC(fc){
  if (!(fc >= 10 && fc <= 350)) return aviso("Confira a medida");
  definirFC(fc); S.cur.conf.fc = true; S.editando = null; S.aberto.calcfc = false; aviso("FC " + fc + " bpm"); manterRolagem(desenhar);
}
/* calculadoras do Guia: os mesmos controles, sem "Usar" e sem tocar em R() — os valores vivem em S.calc */
function montarControleGuia(host, k, raiz){
  const C = window.Controles, c = S.calc, onde = raiz || document;
  if (k === "g-rr") C.reguaRR(host, {valor:c.rr || null, aoMudar:v => { c.rr = v; }});
  else if (k === "g-c10") C.contador(host, {valor:c.c10 || 0, fator:6, rotulo:"QRS em 10 segundos", aoMudar:n => { c.c10 = n; }});
  else if (k === "g-qt") C.reguaQT(host, {valor:c.qt || null, fc:c.fc || null, largo:false, aoMudar:v => { c.qt = v; }});
  else if (k === "g-fc") C.fita(host, {compacta:true, min:20, max:300, passo:1, valor:c.fc || null, inicial:75, unidade:"bpm", rotulo:"FC", medio:5, maior:10, digitar:{min:10, max:350},
    aoMudar:v => { c.fc = v; const q = onde.querySelector('[data-ctl="g-qt"]'); if (q && q.__ctl) q.__ctl.definirFC(v); }});
}

/* ---------- etapas 2 a 8 ---------- */
const SIMNAO = [["sim","Sim"],["nao","Não"]];
const POL = [["pos","Predominantemente positivo","Positivo"],["neg","Predominantemente negativo","Negativo"]];
const numBR = v => String(v).replace(".", ",");
const ETAPAS = {
  2: () => {
    const r = R(), B = Blocos();
    B.texto(`<p class="small mute">Vamos confirmar rapidamente se o traçado é adequado para interpretação.</p>`);
    B.escolha("cal", {sec:"2.1 — Calibração", curto:"Calibração", antes:`<p class="small ink2">Confira a calibração impressa no ECG.</p>`,
      titulo:"O ECG está em 25 mm/s e 10 mm/mV?", opcoes:[["padrao","Sim — 25 mm/s e 10 mm/mV","25 mm/s · 10 mm/mV"],["outra","Outra / não sei"]],
      depois:ajudaRev("ondecal", "Onde encontro isso?", pendente("Foto padrão de um ECG mostrando onde ficam a velocidade e a amplitude impressas"))});
    if (r.cal === "padrao") B.res("ok", "Calibração padrão", "");
    if (r.cal === "outra"){
      B.res("warn", "Atenção à calibração", "Este ECG não foi confirmado em 25 mm/s e 10 mm/mV. Isso modifica a relação entre os quadrados do papel e o tempo. Sugiro repetir o ECG.");
      B.escolha("calSeguir", {curto:"Calibração fora do padrão", opcoes:[["sim","Continuar mesmo assim"]]});
    }
    if (calibPadrao() || r.calSeguir){
      B.escolha("elet", {sec:"2.2 — Eletrodos dos membros", curto:"Eletrodos dos membros",
        antes:`<div class="crit"><p>DI com onda P positiva e/ou QRS predominantemente positivo</p><p>aVR com onda P negativa e/ou QRS predominantemente negativo</p></div>`,
        titulo:"O traçado está assim?", opcoes:SIMNAO});
      if (r.elet === "sim") B.res("ok", "Padrão habitual das derivações dos membros", "");
      if (r.elet === "nao"){
        B.res("warn", "Antes de interpretar, considere possível troca de eletrodos", "Quando onda P e QRS estão negativos em DI e positivos em aVR, suspeite especialmente de inversão dos eletrodos dos braços. Entretanto, alterações isoladas da polaridade do QRS podem representar o próprio padrão do paciente.");
        B.escolha("eletSeguir", {curto:"Possível troca de eletrodos", opcoes:[["sim","Seguir mesmo assim"]],
          antes:ajuda("eletajuda", "Me ajude a conferir os eletrodos") + (S.aberto.eletajuda ? `<div class="helpbox"><p>Confira a posição dos eletrodos dos membros e, se houver suspeita de inversão, corrija a posição e repita o ECG antes de interpretar, sempre que possível.</p>${pendente("Imagem com a colocação correta dos eletrodos dos membros")}</div>` : "")});
      }
    }
    return {blocos:B.L, ok:() => !!(R().cal && (calibPadrao() || R().calSeguir) && (R().elet === "sim" || (R().elet === "nao" && R().eletSeguir)))};
  },
  3: () => {
    const r = R(), B = Blocos();
    B.escolha("ritmo", {grande:true, curto:"Ritmo sinusal?", titulo:"O ritmo é sinusal?",
      meio:`<div class="crit"><p>P positiva em DI, DII e aVF</p><p>P negativa em aVR</p><p>Ondas P precedem os QRS do ritmo de base</p><p>Ondas P com a mesma morfologia em uma mesma derivação</p></div>`,
      opcoes:[["sim","Sim"],["nao","Não"],["duvida","Não tenho certeza"]]});
    if (r.ritmo === "sim") B.res("ok", "Ritmo sinusal", "");
    if (r.ritmo === "nao") B.res("warn", "O ritmo não apresenta todos os critérios de ritmo sinusal", "Continue a sequência. Na etapa Descarte de arritmias, vamos caracterizá-lo melhor.");
    if (r.ritmo === "duvida"){
      const NAO_CONFERE = ["warn", "Os critérios de ritmo sinusal não estão todos presentes", "Não precisamos definir a arritmia agora. Continue a sequência: vamos caracterizar melhor o ritmo em Descarte de arritmias."];
      B.escolha("wiz1", {curto:"Onda P", antes:`<span class="eyebrow">Como identificar o ritmo sinusal</span><h3>1. Primeiro, encontre a onda P</h3><p class="small ink2">DII costuma ser uma boa derivação para começar.</p>${pendente("Imagem de um ECG sinusal destacando apenas a P em DII")}`,
        opcoes:[["sim","Encontrei a onda P","Encontrada"],["nao","Não encontrei","Não encontrada"]]});
      if (r.wiz1 === "nao") B.res("warn", "Sem uma onda P claramente identificável, o ritmo não é sinusal", "Continue a sequência. Vamos caracterizar melhor o ritmo em Descarte de arritmias.");
      if (r.wiz1 === "sim"){
        B.escolha("wiz2", {curto:"Polaridade da P", antes:`<h3>2. Agora confira a polaridade da P</h3><p class="small ink2">Para uma onda P de origem sinusal, procure: positiva em DI, positiva em DII, positiva em aVF, negativa em aVR. Observe apenas se a onda P está predominantemente acima ou abaixo da linha de base.</p>${pendente("Imagem pequena com DI, DII, aVF e aVR mostrando a polaridade esperada da P")}`,
          opcoes:[["sim","Tem característica sinusal","Sinusal"],["nao","Não tem característica sinusal","Não sinusal"]]});
        if (r.wiz2 === "nao") B.res(...NAO_CONFERE);
        if (r.wiz2 === "sim"){
          B.escolha("wiz3", {curto:"Ritmo de base", antes:`<h3>3. Olhe o ritmo de base</h3><p class="small ink2">As ondas P apresentam morfologia semelhante em uma mesma derivação e precedem os QRS do ritmo de base?</p><p class="tiny mute">Importante: um batimento diferente isolado, como uma extrassístole, não exclui necessariamente um ritmo de base sinusal.</p>`, opcoes:SIMNAO});
          if (r.wiz3 === "sim") B.res("ok", "Os achados são compatíveis com ritmo sinusal", "");
          if (r.wiz3 === "nao") B.res(...NAO_CONFERE);
        }
      }
    }
    return {blocos:B.L, ok:() => sinusal() !== null};
  },
  4: () => {
    const r = R(), B = Blocos();
    B.escolha("reg", {sec:"4.1 — Regularidade", curto:"Regularidade", titulo:"O ritmo é regular?", dica:"Compare os intervalos R-R ao longo do traçado.", opcoes:[["regular","Regular"],["irregular","Irregular"]]});
    if (r.reg) B.medida("fc", {sec:"4.2 — Frequência cardíaca", curto:"Frequência cardíaca",
      pronta:() => !!R().fc, rotuloConf:() => R().fc ? `Confirmar · ${R().fc} bpm` : "Confirmar",
      resumo:() => `${R().fc} bpm${R().reg === "irregular" ? " · média" : ""}`,
      corpo:() => {
        const irregular = r.reg === "irregular", aba = irregular ? "c10" : (S.aberto.calcfcAba || "rr");
        let h = `<p class="q sm">Qual a frequência cardíaca?${irregular ? ` <span class="tiny mute">frequência média</span>` : ""}</p>
          <div class="fc-tracado" data-ctl="tracado-fc"></div><div data-ctl="fc"></div>
          <p class="tiny mute" id="fc-dica"${r.fc ? " hidden" : ""}>Arraste a fita, ou toque no número para digitar.</p>
          ${ajuda("calcfc", "Me ajude a calcular a FC")}`;
        if (S.aberto.calcfc){
          h += `<div class="helpbox">`;
          if (!irregular) h += `<div class="hscroll abas"><button class="chip" type="button" data-fcaba="rr" aria-pressed="${aba === "rr"}">Régua no papel</button><button class="chip" type="button" data-fcaba="c10" aria-pressed="${aba === "c10"}">Contar em 10 s</button>${S.cur.tela ? `<button class="chip" type="button" data-fcaba="foto" aria-pressed="${aba === "foto"}">Medir na foto</button>` : ""}</div>`;
          if (aba === "rr") h += `<p><b>Quadradinhos pequenos.</b> Conte quantos quadradinhos pequenos existem entre dois QRS consecutivos. FC = 1500 ÷ quadradinhos.</p><p><b>Quadrados grandes.</b> Conte quantos quadrados grandes existem entre dois QRS consecutivos. FC = 300 ÷ quadrados grandes.</p><p class="tiny mute">Toque ou arraste até onde cai o segundo QRS no seu traçado. A régua faz as duas contas.</p><div data-ctl="rr"></div>`;
          if (aba === "c10") h += `<p><b>Contagem em 10 segundos.</b> Em um trecho contínuo de 10 segundos, como o DII longo, conte o número de QRS. FC ${irregular ? "média " : ""}= QRS × 6.</p><div data-ctl="c10"></div>`;
          if (aba === "foto") h += `<p><b>Régua na foto.</b> Meça a distância entre dois QRS na própria foto.</p><button class="btn small" type="button" data-medir="fc">${I.regua}Medir na foto</button>`;
          h += `</div>`;
        }
        return h;
      }});
    if (r.fc) B.res("ok", "FC registrada: " + r.fc + " bpm", r.reg === "irregular" ? "Frequência média estimada." : "");
    return {blocos:B.L, ok:() => !!(R().reg && R().fc)};
  },
  5: () => {
    const r = R(), e = eixo(), B = Blocos();
    const ajudaPol = ajuda("polqrs", "Me ajude a saber se o QRS é positivo ou negativo") + (S.aberto.polqrs ? `<div class="helpbox"><p>Observe o QRS em relação à linha de base.</p><p><b>Predominantemente positivo</b> → a maior parte do QRS está acima da linha de base.</p><p><b>Predominantemente negativo</b> → a maior parte do QRS está abaixo da linha de base.</p>
        <div class="figs"><figure>${qrsFig("ralto")}<figcaption>R alto</figcaption></figure><figure>${qrsFig("qr")}<figcaption>qR</figcaption></figure><figure>${qrsFig("qs")}<figcaption>QS</figcaption></figure><figure>${qrsFig("rs")}<figcaption>rS</figcaption></figure></div>
        <p class="tiny mute">Os dois primeiros são positivos; os dois últimos, negativos.${revisao() ? " Desenho esquemático, a validar pelo Dr. Vitor." : ""}</p></div>` : "");
    B.escolha("di", {sec:"5.1 — Como é o QRS em DI?", curto:"QRS em DI", opcoes:POL, depois:ajudaPol});
    B.escolha("avf", {sec:"5.2 — Como é o QRS em aVF?", curto:"QRS em aVF", opcoes:POL, depois:ajudaPol});
    if (r.di === "pos" && r.avf === "neg") B.escolha("dii", {sec:"Agora observe DII", curto:"QRS em DII", titulo:"Como é o QRS em DII?", opcoes:POL, depois:ajudaPol});
    if (e) B.res(e.k, e.t, "");
    return {blocos:B.L, ok:() => !!eixo()};
  },
  6: () => {
    const B = Blocos();
    B.texto(`<p class="small mute">O Copiloto já sabe o ritmo, a regularidade e a frequência. Ele parte daí e só pergunta o que falta.</p>`);
    arritmia(B);
    return {blocos:B.L, ok:() => arritmia().pronto};
  },
  7: () => {
    const r = R(), m = r.isq || [], B = Blocos();
    B.multi("isq", {curto:"Alterações em derivações contíguas",
      antes:`<div class="sec"><h3>Antes de procurar alterações, pense em territórios</h3></div><p class="small ink2">Não analise uma derivação isoladamente. Procure alterações em derivações anatomicamente contíguas.</p>${terrHTML()}`,
      titulo:"Você identifica alguma destas alterações em pelo menos duas derivações contíguas?",
      opcoes:[["supra","Supradesnivelamento do segmento ST","Supra de ST"],["infra","Infradesnivelamento do segmento ST","Infra de ST"],["tinv","Inversão simétrica da onda T","T invertida simétrica"],["nenhuma","Nenhuma dessas alterações","Nenhuma"]],
      depois:ajudaRev("critsupra", "Me ajude a revisar os critérios de supra", pendente("Critérios de supra de ST por derivação, sexo e idade"))});
    if (m.includes("supra")){
      B.escolha("supraDist", {curto:"Distribuição do supra", titulo:"O supradesnivelamento de ST apresenta distribuição em derivações anatomicamente contíguas compatível com um território coronariano?",
        opcoes:[["sim","Sim","Territorial"],["difuso","Não — o supra parece difuso","Difuso"],["naosei","Não sei"]], pendentes:["naosei"],
        depois:r.supraDist === "naosei" ? `<div class="helpbox"><p>Não analise uma derivação isoladamente. Procure alterações em derivações anatomicamente contíguas.</p>${terrHTML()}<p class="tiny mute">Depois de conferir, responda de novo acima.</p></div>` : ""});
      if (r.supraDist === "sim") B.multi("terr", {curto:"Território do supra", antes:ins("bad", "Supradesnivelamento de ST em quais derivações?", ""), opcoes:TERR.map(([k, b, s]) => [k, b + " · " + s, b])});
      if (r.supraDist === "difuso") B.res("warn", "Supradesnivelamento difuso de ST", "Quando o supra não apresenta distribuição territorial coronariana, considere pericardite aguda entre os diagnósticos diferenciais.");
    }
    if (m.includes("infra")){
      B.res("warn", "Infradesnivelamento de ST em derivações contíguas", "");
      B.escolha("infraV1", {curto:"Infra em V1–V3", titulo:"Infra predominante em V1–V3?", opcoes:SIMNAO});
      if (r.infraV1 === "sim") B.res("bad", "Lembre-se de considerar infarto com supra posterior", "Avalie as derivações posteriores (V7–V9).");
      if (r.infraV1 === "nao") B.res("warn", "Pode representar isquemia subendocárdica", "Dependendo da morfologia e do contexto clínico.");
    }
    if (m.includes("tinv")) B.res("warn", "Ondas T invertidas e simétricas em derivações contíguas", "Avalie distribuição, profundidade, comparação com ECG prévio e contexto clínico.");
    if (m.includes("nenhuma")){
      B.multi("padroes", {sec:"Antes de seguir, procure padrões de alto risco", curto:"Padrões de alto risco", antes:`<p class="small ink2">Faça uma última checagem:</p>`,
        opcoes:PADROES.map(([k, l]) => [k, l]).concat([["nenhum","Nenhum desses padrões","Nenhum"]]),
        depois:ajudaRev("padraoajuda", "Não sei identificar", PADROES.map(([, l]) => pendente(l + ": imagem validada e 2 ou 3 características")).join(""))});
      const p = r.padroes || [];
      if (p.includes("nenhum")) B.res("ok", "Nenhum padrão isquêmico evidente identificado nesta etapa", "");
      else if (p.length) B.res("bad", "Padrão de alto risco marcado", p.map(x => PADROES.find(y => y[0] === x)[1]).join(" · "));
    }
    return {blocos:B.L, ok:() => isquemia().pronto};
  },
  8: () => {
    const r = R(), largura = larguraQRS(), B = Blocos();
    const LARG = [["estreito","Estreito — menor que 120 ms","Estreito"],["largo","Largo — 120 ms ou mais","Largo"]];
    if (r.qrs){
      B.texto(`<div class="sec"><h3>8.1 — Duração do QRS</h3></div>`);
      B.res("info", `QRS ${r.qrs} — já registrado na etapa de arritmias`, "O Copiloto usa a informação já armazenada e não pergunta de novo." + (r.qrsMs ? ` Medido na foto: ${r.qrsMs} ms.` : ""));
    } else {
      B.escolha("qrs8", {sec:"8.1 — Duração do QRS", curto:"Duração do QRS", titulo:"O QRS é estreito ou largo?", opcoes:LARG,
        depois:ajuda("medirqrs8", "Não sei medir o QRS") + (S.aberto.medirqrs8 ? `<div class="helpbox"><p>Meça do início da primeira deflexão do QRS até o final da última deflexão.</p><p>Em velocidade de 25 mm/s, cada quadradinho corresponde a 40 ms. Portanto, <b>3 quadradinhos = 120 ms</b>.</p>${S.cur.tela ? `<button class="btn small" type="button" data-medir="qrs" data-chave="qrs8">${I.regua}Medir o QRS na foto</button>` : ""}${pendente("Imagem mostrando início e final do QRS")}</div>` : "")});
      if (r.qrs8) B.res(r.qrs8 === "largo" ? "warn" : "ok", `QRS ${r.qrs8}`, r.qrsMs ? `${r.qrsMs} ms medidos na foto.` : "");
    }
    if (largura === "largo"){
      B.escolha("v1", {sec:"8.2 — Avalie bloqueio de ramo", curto:"Padrão em V1", titulo:"Observe V1. Qual padrão predomina?",
        opcoes:[["brd","rSR' / R' terminal positivo","R' terminal positivo"],["bre","QRS predominantemente negativo","QRS negativo"],["duvida","Não tenho certeza","Sem certeza"]], pendentes:["duvida"],
        depois:r.v1 === "duvida" ? `<div class="helpbox"><p>Compare V1: no <b>BRD</b> o QRS termina positivo (rSR' ou R' terminal); no <b>BRE</b> o QRS em V1 é predominantemente negativo.</p>${pendente("Imagem comparativa de V1 no BRD × V1 no BRE")}<p class="tiny mute">Se a dúvida continuar, o Copiloto registra "QRS largo, sem padrão típico de bloqueio de ramo definido" e segue.</p></div>
          <button class="btn small conf" type="button" data-conf="v1">Seguir sem padrão definido ${I.seta}</button>` : ""});
      if (r.v1 === "brd") B.res("warn", "Padrão compatível com BRD", "");
      if (r.v1 === "bre") B.res("warn", "Padrão compatível com BRE", "");
      if (r.v1 === "duvida") B.res("info", "QRS largo, sem padrão típico de bloqueio de ramo definido", "");
      const sg = sgarbossa();
      if (sg){
        B.html(`<div class="sec"><h3>8.3 — BRE + suspeita de isquemia</h3></div>` + ins("bad", "BRE + suspeita de isquemia", "O bloqueio de ramo esquerdo produz alterações secundárias do segmento ST e da onda T, que podem dificultar a identificação de isquemia. Vamos avaliar se existem critérios de Sgarbossa modificado."));
        B.escolha("sg1", {curto:"Supra concordante ≥ 1 mm", titulo:"1. Existe supra de ST ≥ 1 mm concordante com o QRS?", dica:"Procure supradesnivelamento de ST em uma derivação cujo QRS seja predominantemente positivo.", opcoes:SIMNAO});
        B.escolha("sg2", {curto:"Infra ≥ 1 mm em V1–V3", titulo:"2. Existe infra de ST ≥ 1 mm em V1–V3?", opcoes:SIMNAO});
        B.medida("sg3", {curto:"Supra ÷ onda S", titulo:"3. Existe supra de ST excessivo em V1–V3?", dica:"Meça na derivação, de V1 a V3, com o maior supra.",
          pronta:() => num("sgST") !== null && num("sgS") !== null,
          rotuloConf:() => { const s = sgarbossa(); return s && s.razao !== null ? `Confirmar · razão ${s.razao.toFixed(2).replace(".", ",")}` : "Confirmar"; },
          resumo:() => { const s = sgarbossa(); return `${numBR(num("sgST"))} ÷ ${numBR(num("sgS"))} mm${s && s.razao !== null ? " = " + s.razao.toFixed(2).replace(".", ",") : ""}`; },
          corpo:() => `<div data-ctl="sgST"></div><div data-ctl="sgS"></div>
            <div class="kv"><span>Supra de ST ÷ profundidade da onda S</span><span id="sg-res">${sg.razao !== null ? sg.razao.toFixed(2).replace(".", ",") : "—"}</span></div>`});
        if (sg.razao !== null) B.res(sg.c3 ? "bad" : "ok", sg.c3 ? "Critério de discordância excessiva presente" : "Sem discordância excessiva", sg.c3 ? "Razão de 0,25 ou mais." : "Razão abaixo de 0,25.");
        if (sg.pronto) B.res(sg.positivo ? "bad" : "info", sg.positivo ? "Critério de Sgarbossa modificado presente" : "Critérios de Sgarbossa modificado não identificados",
          sg.positivo ? "Em um paciente com quadro clínico compatível, este achado aumenta a suspeita de oclusão coronariana aguda." : "A ausência desses critérios não exclui síndrome coronariana aguda, mas reduz a probabilidade de oclusão coronariana aguda.");
      }
    }
    if (largura){
      B.escolha("amp8", {sec:"8.4 — Amplitude do QRS", curto:"Amplitude do QRS", titulo:"Você identifica aumento significativo da amplitude do QRS?",
        opcoes:[["nao","Não identifico aumento significativo da amplitude","Sem aumento significativo"],["susp","Suspeito de aumento da amplitude","Suspeito de aumento"],["naosei","Não sei avaliar"]]});
      if (avaliouSobrecarga()){
        const v = svd(), sk = sokolow(), dir = eixoDireita();
        B.multi("svd", {curto:"Sobrecarga de VD", permiteVazio:true, vazio:"nenhum item marcado",
          antes:`<span class="eyebrow">Vamos avaliar sobrecarga ventricular</span><h3>Sobrecarga ventricular direita</h3><p class="small ink2">Confira:</p>`,
          opcoes:[["v1pos","O QRS predomina positivo em V1","QRS positivo em V1"],["strainVD","Ondas T invertidas em V1–V3 (padrão de strain de VD)","T invertidas em V1–V3"]],
          opcoesHtml:`${opt("svd","v1pos","O QRS predomina positivo em V1",true)}<button type="button" class="opt multi fixo" aria-pressed="${dir}" disabled><span>Desvio do eixo para a direita <small class="mute">· ${dir ? "identificado" : "não identificado"} na etapa 5</small></span></button>${opt("svd","strainVD","Ondas T invertidas em V1–V3 (padrão de strain de VD)",true)}`});
        if (v.sugere) B.res("warn", "Achados que podem sugerir sobrecarga ventricular direita", v.itens.join(" · ") + ".");
        B.medida("sk", {curto:"Sokolow-Lyon", antes:`<h3>Sobrecarga ventricular esquerda</h3><p class="small ink2">Vamos avaliar a voltagem. Meça:</p>`,
          pronta:() => !!sokolow(), rotuloConf:() => { const s = sokolow(); return s ? `Confirmar · ${numBR(s.soma)} mm` : "Confirmar"; },
          resumo:() => { const s = sokolow(); return s ? `${numBR(s.soma)} mm` : "—"; },
          corpo:() => `<div data-ctl="sV1"></div><div data-ctl="rV56"></div>
            <div class="kv"><span>S em V1 + R em V5/V6</span><span id="sk-res">${sk ? numBR(sk.soma) + " mm" : "—"}</span></div>`});
        if (sk){
          B.res(sk.presente ? "warn" : "ok", sk.presente ? "Critério de Sokolow-Lyon presente" : "Critério de Sokolow-Lyon ausente", sk.presente ? "Aumento da voltagem ventricular esquerda: soma maior que 35 mm." : "Soma de 35 mm ou menos.");
          B.escolha("strainVE", {curto:"Strain de VE", titulo:"Há alteração secundária da repolarização nas derivações laterais?", opcoes:[["sim","Sim — infra de ST associado a onda T negativa/assimétrica em V5–V6","Sim"],["nao","Não"]]});
          if (r.strainVE === "sim") B.res("warn", "Padrão compatível com strain ventricular esquerdo", "");
        }
      }
    }
    return {blocos:B.L, ok:etapa8Pronta};
  },
  9: () => {
    const r = R(), q = qt(), largura = larguraQRS(), B = Blocos();
    const quad = () => num("qtQuad");
    B.medida("qtQuad", {grande:true, curto:"Intervalo QT", titulo:"Meça o intervalo QT", dica:"Escolha uma derivação em que o final da onda T esteja bem definido.",
      pronta:() => quad() > 0, rotuloConf:() => quad() > 0 ? `Confirmar · ${numBR(quad())} quadradinhos (${Math.round(quad() * MS_POR_MM)} ms)` : "Confirmar",
      resumo:() => `${numBR(quad())} quadradinhos · ${Math.round(quad() * MS_POR_MM)} ms`,
      corpo:() => `<p class="small ink2">Quantos quadradinhos pequenos existem entre o início do QRS e o final da onda T?</p>
        <div data-ctl="qtQuad"></div>
        ${ajuda("medirqt", "Não sei medir o QT")}${S.aberto.medirqt ? `<div class="helpbox"><p>Meça do início do complexo QRS até o final da onda T.</p>${S.cur.tela ? `<button class="btn small" type="button" data-medir="qt">${I.regua}Medir o QT na foto</button>` : ""}</div>` : ""}`});
    B.escolha("sexo", {sec:"9.1 — Sexo", curto:"Sexo", dica:"Para interpretar o QT corrigido.", opcoes:[["m","Masculino"],["f","Feminino"]]});
    B.html(`<div class="sec"><h3>9.2 — Cálculo automático</h3></div>
      <div class="card"><div class="kv" style="border-top:0;padding-top:0"><span>FC (etapa 4)</span><span>${r.fc} bpm${r.reg === "irregular" ? " · média" : ""}</span></div><div class="kv"><span>QT medido</span><span id="qt-ms">${q ? q.qtMs + " ms" : "—"}</span></div>
      <div class="readout" style="margin-top:8px"><span class="num"><span id="qt-res">${q ? q.qtc : "—"}</span><span class="u">ms · QTc (Bazett)</span></span>${q ? `<span class="tag ${q.classe === "normal" ? "ok" : "bad"}">${q.classe}</span>` : ""}</div>
      <p class="tiny mute">Prolongado: > 450 ms no masculino, ≥ 460 ms no feminino. Curto: < 350 ms. O app converte os quadradinhos em milissegundos e corrige pela FC.</p></div>`);
    if (q) B.res(q.longo ? "bad" : q.curto ? "warn" : "ok", q.longo ? "QTc prolongado" : q.curto ? "QTc curto" : "QTc dentro dos limites de referência", q.curto && !q.longo ? `${q.qtc} ms, abaixo de 350 ms.` : `${q.qtc} ms para o sexo informado.`);
    if (largura === "largo") B.res("warn", "QRS largo", "O alargamento do QRS pode prolongar o intervalo QT devido ao aumento da duração da despolarização ventricular. Interprete o QTc com cautela nesse cenário.");
    return {blocos:B.L, ok:() => !!qt()};
  },
  10: () => {
    const r = R(), m = r.esp || [], q = qt(), B = Blocos();
    const TRI = [["sim","Sim"],["nao","Não"],["naosei","Não sei identificar"]];
    const foto = (k, legenda) => r[k] !== "naosei" ? "" : revisao()
      ? `<div class="helpbox">${pendente(legenda)}<p class="tiny mute">Depois de comparar, responda sim ou não.</p></div>`
      : `<div class="helpbox"><p>A imagem de referência desta alteração está em preparação. Compare com o seu material do curso e responda sim ou não.</p></div>`;
    B.multi("esp", {curto:"Suspeita clínica", antes:`<p class="small mute">Antes de terminar:</p>`, titulo:"Existe suspeita clínica de alguma destas condições?",
      opcoes:ESPECIAIS.map(([k, l]) => [k, l]).concat([["nenhuma","Nenhuma dessas","Nenhuma"]])});
    if (m.includes("tep")){
      const ach = tepAchados();
      B.html(`<div class="sec"><h3>TEP</h3></div><p class="small ink2">Vamos revisar o que já encontramos no seu ECG:</p><div class="crit">${ach.slice(0, 4).map(([t, ok]) => `<p>${t}: <b>${ok ? "SIM" : "NÃO"}</b></p>`).join("")}</div>`);
      B.escolha("s1q3t3", {curto:"Padrão S1Q3T3", titulo:"E então a única informação que falta: existe padrão S1Q3T3?", opcoes:TRI, pendentes:["naosei"], depois:foto("s1q3t3", "Imagem única mostrando DI e DIII com o padrão S1Q3T3")});
      if (simNao("s1q3t3")){
        const p = ach.filter(x => x[1]).map(x => x[0]);
        B.res(p.length ? "warn" : "info", p.length ? "Achados eletrocardiográficos que podem ocorrer no TEP" : "Nenhum dos achados pesquisados para TEP está presente",
          (p.length ? p.join(" · ") + ". Quando presentes, esses achados podem aumentar a suspeita de TEP no contexto clínico adequado, mas não são específicos. " : "") + "A ausência desses achados não exclui TEP. Interprete o ECG em conjunto com o quadro clínico e a probabilidade pré-teste.");
      }
    }
    if (m.includes("hiperca")){
      B.html(`<div class="sec"><h3>Hipercalcemia</h3></div><p class="small ink2">O Copiloto já sabe: QTc = ${q ? q.qtc + " ms" : "—"}. Não precisa perguntar nada novo.</p>`);
      if (q) B.res(q.curto ? "warn" : "info", q.curto ? "QTc encurtado identificado" : "O QTc calculado não está encurtado", q.curto ? "O encurtamento do QT é um achado eletrocardiográfico associado à hipercalcemia." : "A ausência desse achado eletrocardiográfico não exclui hipercalcemia.");
    }
    if (m.includes("hipoca")){
      B.html(`<div class="sec"><h3>Hipocalcemia</h3></div><p class="small ink2">O Copiloto já sabe: QTc = ${q ? q.qtc + " ms" : "—"}.</p>`);
      if (q) B.res(q.longo ? "warn" : "info", q.longo ? "QTc prolongado identificado" : "O QTc calculado não está prolongado", q.longo ? "O prolongamento do QT pode ocorrer na hipocalcemia." : "A ausência desse achado não exclui hipocalcemia.");
    }
    if (m.includes("hiperk")){
      B.html(`<div class="sec"><h3>Hipercalemia</h3></div><p class="small ink2">Procure as seguintes alterações:</p>`);
      B.escolha("hk1", {curto:"T altas e apiculadas", titulo:"1. As ondas T estão altas, estreitas e apiculadas?", opcoes:TRI, pendentes:["naosei"], depois:foto("hk1", "Foto de ondas T altas, estreitas e apiculadas")});
      B.escolha("hk2", {curto:"Aspecto sinusoidal", titulo:"2. Há fusão progressiva entre QRS e T, produzindo aspecto sinusoidal?", opcoes:TRI, pendentes:["naosei"], depois:foto("hk2", "Foto do padrão sinusoidal")});
      if (simNao("hk1") && simNao("hk2")) B.res(...((r.hk1 === "sim" || r.hk2 === "sim") ? ["bad", "Achados eletrocardiográficos que podem ser compatíveis com hipercalemia", "Correlacione com o potássio sérico e o contexto clínico."] : ["ok", "Sem achados eletrocardiográficos sugestivos de hipercalemia", ""]));
    }
    if (m.includes("hipok")){
      B.html(`<div class="sec"><h3>Hipocalemia</h3></div><p class="small ink2">Procure:</p>`);
      B.escolha("hpk1", {curto:"T achatada", titulo:"1. Há redução/achatamento da onda T?", opcoes:TRI, pendentes:["naosei"], depois:foto("hpk1", "Foto de onda T achatada")});
      B.escolha("hpk2", {curto:"Onda U proeminente", titulo:"2. Existe onda U proeminente?", opcoes:TRI, pendentes:["naosei"], depois:foto("hpk2", "Foto de onda U proeminente")});
      if (simNao("hpk1") && simNao("hpk2")) B.res(...((r.hpk1 === "sim" || r.hpk2 === "sim") ? ["warn", "Achados eletrocardiográficos que podem ser compatíveis com hipocalemia", "Correlacione com o potássio sérico e o contexto clínico."] : ["ok", "Sem achados eletrocardiográficos sugestivos de hipocalemia", ""]));
    }
    if (m.includes("nenhuma")) B.res("ok", "Sem suspeita clínica de padrões especiais", "Vamos voltar ao paciente.");
    return {blocos:B.L, ok:() => especiais().pronto};
  }
};

/* casca: topo, progresso e rodapé, montados uma vez por etapa. O miolo (#seq-scroll) nasce vazio
   e é preenchido por desenharMiolo() — responder não pode destruir o que vive na casca. */
function telaSeq(){
  const i = S.cur.passo, dir = S.dir || ""; S.dir = "";
  return `<div class="screen ${dir}" data-passo="${i}">
  ${topo(i, PASSOS[i], `<button class="icobtn ghost" type="button" data-aba="inicio" aria-label="Sair">${I.fechar}</button>`)}
  ${progresso(i)}
  ${dockHTML()}
  <div class="scroll seq stagger" id="seq-scroll"></div>
  <div class="foot">${pilula()}<button class="btn primary" type="button" id="proxima" disabled>${i === ULTIMA_PERGUNTA ? "Volte ao paciente" : "Próxima etapa"} ${I.seta}</button></div></div>`;
}
/* os controles seguram laços (inércia da fita, repetição do +/−) que gravam medida.
   Trocar o innerHTML por cima deixaria esses laços vivos, gravando depois do Confirmar. */
function soltarControles(raiz){
  if (!raiz) return;
  raiz.querySelectorAll("[data-ctl]").forEach(h => { if (h.__ctl) try { h.__ctl.destruir(); } catch(_){} });
}
function desenharMiolo(){
  const sc = document.getElementById("seq-scroll"), v = ETAPAS[S.cur.passo](), rb = renderBlocos(v.blocos), completa = v.ok() && !rb.temAtiva;
  const topoR = sc.scrollTop;
  soltarControles(sc);
  sc.innerHTML = rb.html;
  sc.scrollTop = topoR; // o miolo é trocado no lugar: devolve a rolagem antes de o focar() ajustar
  ligar(sc);
  montarControles(sc);
  const b = document.getElementById("proxima"), estava = !b.disabled;
  b.disabled = !completa; b.classList.toggle("pronta", completa && !estava);
  // a pílula ocupa uma linha do rodapé: decide antes, senão o focar() mede uma área que vai encolher
  atualizarContinua(); focar(); setTimeout(atualizarContinua, 400);
  gravarAndamento(); // o miolo trocado no lugar não passa pelo fim do desenhar()
}
/* rola sozinho até a pergunta em foco: ela não pode nascer cortada lá embaixo */
function focar(){
  const sc = document.getElementById("seq-scroll"); if (!sc) return;
  const ativa = sc.querySelector(".qb.ativa"), alvo = ativa || sc.lastElementChild; if (!alvo) return;
  const a = alvo.getBoundingClientRect(), s = sc.getBoundingClientRect();
  const suave = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  if (ativa){
    if (a.top >= s.top && a.bottom <= s.bottom) return;
    // 56 px de recuo deixam uma linha feita de contexto; pergunta mais alta que a área vai para o alto
    const recuo = a.height + 56 <= s.height ? 56 : 12;
    sc.scrollTo({top:sc.scrollTop + (a.top - s.top) - recuo, behavior:suave});
  } else if (a.bottom > s.bottom) sc.scrollTo({top:sc.scrollHeight, behavior:suave});
}
/* a pílula é sobre conteúdo, não sobre curso de rolagem: o padding do fim da área não é conteúdo.
   Medir pelo último filho evita a pílula acesa numa etapa que já está inteira na tela. */
function atualizarContinua(){
  const sc = document.getElementById("seq-scroll"), c = document.getElementById("continua"); if (!sc || !c) return;
  const ult = sc.lastElementChild;
  c.hidden = !ult || ult.getBoundingClientRect().bottom - sc.getBoundingClientRect().bottom <= 24;
  sc.onscroll = atualizarContinua;
  c.onclick = () => sc.scrollBy({top:sc.clientHeight * .8, behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
}
window.addEventListener("resize", atualizarContinua);
/* a moldura não rola: quem rola é a área de conteúdo. O navegador ainda empurra a moldura quando
   traz um campo para perto do teclado (ou num scrollIntoView), e aí a barra do topo some. */
["frame", "app"].forEach(c => {
  const el = document.querySelector("." + c);
  if (el) el.addEventListener("scroll", () => { el.scrollTop = 0; el.scrollLeft = 0; });
});
document.addEventListener("focusout", e => {
  if (e.target && e.target.matches && e.target.matches(".ctl-inp, #p-nome, #busca")) window.scrollTo(0, 0);
});

/* ---------- etapa 11: volte ao paciente ---------- */
const minuscula = s => /^[A-ZÁÉÍÓÚ]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
const EIXO_FRASE = {"Eixo normal":"eixo elétrico normal", "Desvio do eixo para a esquerda":"desvio do eixo para a esquerda", "Desvio do eixo para a direita":"desvio do eixo para a direita", "Desvio extremo do eixo":"desvio extremo do eixo"};
function resumo(){
  const r = R(), m = motivo(), e = eixo(), a = arritmia(), isq = isquemia(), q8 = qrsInfo(), q = qt(), esp = especiais();
  const atencao = [], blocos = [], L = [], frases = [], conc = [];
  const bloco = (t, v, k, d) => blocos.push({t, v, k, d});
  const obs = [];
  if (r.cal === "outra"){ obs.push("Calibração fora do padrão ou não confirmada."); atencao.push("Calibração fora do padrão"); }
  if (r.elet === "nao"){ obs.push("Possível troca de eletrodos dos membros."); atencao.push("Possível troca de eletrodos"); }

  const sin = sinusal();
  L.push("Ritmo: " + (sin === true ? "sinusal" : sin === false ? "não sinusal" : "—"));
  bloco("Ritmo", sin === true ? "Sinusal" : sin === false ? "Não sinusal" : "—", sin === true ? "ok" : "warn");
  if (r.fc){
    const faixa = faixaFC();
    L.push(`Frequência cardíaca: ${r.fc} bpm${faixa === "alta" ? " — taquicardia" : faixa === "baixa" ? " — bradicardia" : ""}${r.reg === "irregular" ? " (média)" : ""}`);
    L.push("Regularidade: " + r.reg);
    bloco("Frequência", `${r.fc} bpm`, faixa === "normal" ? "ok" : "warn", r.reg + (faixa === "alta" ? " · taquicardia" : faixa === "baixa" ? " · bradicardia" : ""));
  }
  if (e){
    L.push("Eixo: " + (e.t === "Eixo normal" ? "normal" : minuscula(e.t)));
    bloco("Eixo", e.t, e.k, `DI ${r.di === "pos" ? "+" : "−"} · aVF ${r.avf === "pos" ? "+" : "−"}${r.dii ? " · DII " + (r.dii === "pos" ? "+" : "−") : ""}`);
    if (e.k !== "ok"){ conc.push(e.t); atencao.push(e.t); }
  }
  if (a.pronto){
    const semArritmia = a.res.k === "ok";
    L.push("Arritmias: " + (semArritmia ? "nenhuma das arritmias pesquisadas foi identificada na sequência de leitura" : minuscula(a.res.t)) + (a.extra ? "; " + minuscula(a.extra) : ""));
    bloco("Arritmias", semArritmia ? "Nenhuma identificada" : a.res.t, a.res.k, a.extra || "");
    if (!semArritmia){ conc.unshift(a.res.t); atencao.push(a.res.t); }
    if (a.extra){ conc.push(a.extra); atencao.push(a.extra); }
    frases.push(`${a.res.t}, ${r.reg}, com frequência cardíaca de ${r.fc} bpm${e ? " e " + EIXO_FRASE[e.t] : ""}.${a.extra ? " Presença de " + minuscula(a.extra) + "." : ""}`);
  }
  if (isq.pronto){
    if (isq.achados.length){
      L.push("Isquemia: " + isq.achados.map(minuscula).join("; "));
      isq.achados.forEach(x => { conc.push(x); atencao.push(x); bloco("Isquemia", x, "bad"); frases.push(x + "."); });
    } else {
      L.push("Isquemia: nenhum dos padrões isquêmicos pesquisados foi identificado na sequência de leitura");
      bloco("Isquemia", "Nenhum padrão isquêmico evidente", "ok"); frases.push("Sem alterações isquêmicas evidentes identificadas na sequência de leitura.");
    }
  }
  if (q8){
    L.push(`QRS: ${q8.ms ? q8.ms + " ms — " : ""}${q8.largura}${q8.ms ? "" : q8.largura === "largo" ? " (≥ 120 ms)" : " (< 120 ms)"}`);
    if (q8.conducao) L.push("Condução: " + minuscula(q8.conducao));
    bloco("QRS", q8.largura === "largo" ? "Largo" : "Estreito", q8.largura === "largo" ? "warn" : "ok", q8.conducao || (q8.ms ? q8.ms + " ms" : ""));
    if (q8.largura === "largo"){ conc.push("QRS largo" + (r.v1 === "brd" ? ", BRD" : r.v1 === "bre" ? ", BRE" : "")); atencao.push(r.v1 === "brd" ? "BRD" : r.v1 === "bre" ? "BRE" : "QRS largo sem padrão típico"); }
    frases.push(q8.largura === "largo" ? `QRS largo${q8.ms ? " (" + q8.ms + " ms)" : ""}, ${minuscula(q8.conducao)}.` : `QRS estreito${q8.ms ? " (" + q8.ms + " ms)" : ""}.`);
    if (q8.sg){
      L.push("Sgarbossa modificado: " + (q8.sg.positivo ? "critério presente" : "critérios não identificados"));
      bloco("Sgarbossa modificado", q8.sg.positivo ? "Critério presente" : "Não identificado", q8.sg.positivo ? "bad" : "ok");
      frases.push(q8.sg.positivo ? "Critério de Sgarbossa modificado presente, o que aumenta a suspeita de oclusão coronariana aguda em quadro clínico compatível." : "Critérios de Sgarbossa modificado não identificados.");
      if (q8.sg.positivo){ conc.push("Sgarbossa modificado presente"); atencao.push("Sgarbossa modificado presente"); }
    }
    if (!q8.sobrecarga){
      L.push("Sobrecargas: sem critérios identificados"); bloco("Sobrecargas", "Sem critérios identificados", "ok");
      frases.push("Sem critérios eletrocardiográficos pesquisados de sobrecarga ventricular.");
    } else {
      const partes = [];
      if (q8.svd && q8.svd.sugere) partes.push("achados que podem sugerir sobrecarga ventricular direita");
      if (q8.sk && q8.sk.presente) partes.push("critério de voltagem de Sokolow-Lyon presente para aumento da voltagem ventricular esquerda" + (q8.strain ? ", com padrão compatível com strain ventricular esquerdo" : ""));
      else if (q8.strain) partes.push("padrão compatível com strain ventricular esquerdo");
      L.push("Sobrecargas: " + (partes.length ? partes.join("; ") : "sem critérios identificados"));
      bloco("Sobrecargas", partes.length ? partes.map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(" · ") : "Sem critérios identificados", partes.length ? "warn" : "ok");
      frases.push(partes.length ? partes.map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(". ") + "." : "Sem critérios eletrocardiográficos de sobrecarga ventricular identificados.");
      const curtos = [];
      if (q8.svd && q8.svd.sugere) curtos.push("Achados sugestivos de SVD");
      if (q8.sk && q8.sk.presente) curtos.push("Sokolow-Lyon presente");
      if (q8.strain) curtos.push("Strain de VE");
      curtos.forEach(x => { conc.push(x); atencao.push(x); });
    }
  }
  if (q){
    const txt = q.classe === "normal" ? "dentro dos limites de referência" : q.classe === "prolongado" ? "prolongado" : "curto";
    L.push(`QTc (Bazett): ${q.qtc} ms — ${txt}${q8 && q8.largura === "largo" ? " (QRS largo: interpretar com cautela)" : ""}`);
    bloco("QTc (Bazett)", `${q.qtc} ms`, q.classe === "normal" ? "ok" : "bad", `QT ${q.qtMs} ms · ${txt}`);
    frases.push(`QTc de ${q.qtc} ms, ${txt}${q.classe === "curto" ? "" : " para o sexo informado"}${q8 && q8.largura === "largo" ? " (QRS largo, interpretar com cautela)" : ""}.`);
    if (q.classe !== "normal"){ conc.push("QTc " + txt); atencao.push("QTc " + txt); }
  }
  if (esp.pronto && esp.itens.length){
    esp.itens.forEach(it => {
      if (it.k === "tep"){
        const t = it.presentes.length ? "achados que podem ocorrer no TEP: " + it.presentes.map(minuscula).join(", ") + " (não são específicos)" : "sem os achados eletrocardiográficos pesquisados para TEP";
        L.push("TEP: " + t); bloco("TEP", it.presentes.length ? it.presentes.join(" · ") : "Sem os achados pesquisados", it.presentes.length ? "warn" : "info");
        frases.push((it.presentes.length ? "Achados eletrocardiográficos que podem ocorrer no TEP: " + it.presentes.map(minuscula).join(", ") + "; não são específicos e a ausência não exclui TEP." : "Sem os achados eletrocardiográficos pesquisados para TEP; a ausência não exclui TEP."));
        if (it.presentes.length){ conc.push("Achados compatíveis com TEP"); atencao.push("Achados que podem ocorrer no TEP"); }
      } else {
        const pos = it.positivo, nome = it.t.toLowerCase(), calcio = it.k === "hiperca" || it.k === "hipoca";
        if (calcio){
          const achado = it.k === "hiperca" ? "QTc encurtado" : "QTc prolongado";
          L.push(`${it.t}: ${pos ? achado + " identificado" : achado.replace("QTc ", "QTc não ")}`);
          bloco(it.t, pos ? achado + " identificado" : "Sem o achado pesquisado", pos ? "warn" : "info");
          frases.push(pos ? (it.k === "hiperca" ? "QTc encurtado, achado eletrocardiográfico associado à hipercalcemia." : "QTc prolongado, achado que pode ocorrer na hipocalcemia.") : `O QTc não está ${it.k === "hiperca" ? "encurtado" : "prolongado"}; a ausência desse achado não exclui ${nome}.`);
        } else {
          L.push(`${it.t}: ${pos ? "achados eletrocardiográficos que podem ser compatíveis" : "sem achados eletrocardiográficos sugestivos"}`);
          bloco(it.t, pos ? "Achados compatíveis" : "Sem achados sugestivos", pos ? "warn" : "info");
          frases.push(pos ? `Achados eletrocardiográficos que podem ser compatíveis com ${nome}; correlacionar com o potássio sérico e o contexto clínico.` : `Sem achados eletrocardiográficos sugestivos de ${nome}.`);
        }
        if (pos){ conc.push(calcio ? (it.k === "hiperca" ? "QTc encurtado (hipercalcemia?)" : "QTc prolongado (hipocalcemia?)") : "Achados compatíveis com " + nome); atencao.push(calcio ? it.t + ": achado presente" : "Achados compatíveis com " + nome); }
      }
    });
  }
  const texto = ["Motivo do exame: " + (m ? minuscula(m.nome) : "não informado") + "."].concat(obs).concat(["", "RESUMO DO ECG"]).concat(L).concat(["", "INTERPRETAÇÃO ESTRUTURADA", frases.join(" ")]).join("\n");
  const titulo = conc.length ? conc[0].charAt(0).toUpperCase() + conc[0].slice(1) + (conc.length > 1 ? " + " + (conc.length - 1) : "") : (a.pronto ? a.res.t + ", sem alterações" : "Sem alterações nas etapas avaliadas");
  return {texto, titulo, atencao, blocos, frases};
}
/* na ordem de quem está no plantão: o que não pode passar → o que fazer → o texto para o prontuário.
   Os blocos numerados viram consulta ("Ver etapa por etapa"); o próximo passo clínico nasce aberto. */
function telaLaudo(){
  const s = resumo(), m = motivo(), pp = proximoPasso();
  return `<div class="screen">
  ${topo(11, "Volte ao paciente", `<button class="icobtn ghost" type="button" data-aba="inicio" aria-label="Fechar">${I.fechar}</button>`)}
  ${progresso(11)}
  ${dockHTML("laudo")}
  <div class="scroll seq stagger" id="seq-scroll">
    ${m ? `<div class="orient"><span class="eyebrow">Contexto informado · ${m.curto}</span><p>${m.texto[0]}</p></div>` : ""}
    ${s.atencao.length ? ins("bad", s.atencao.length === 1 ? "1 ponto de atenção" : s.atencao.length + " pontos de atenção", s.atencao.join(" · "), "pontos") : ins("ok", "Nenhum ponto de atenção nas etapas avaliadas", "", "pontos")}
    <div class="sec"><h3>Próximo passo clínico</h3><span class="tiny mute">orientação inicial</span></div>
    <div class="passos" id="proximo-passo"><p class="tiny mute">A partir do que você identificou, lembre-se:</p>
    ${pp.length ? pp.map(c => `<div class="card conduta"><span class="eyebrow">${c.t}</span>${c.p.map(x => `<p class="small ink2">${x}</p>`).join("")}</div>`).join("")
      : `<div class="card conduta"><span class="eyebrow">Agora volte ao paciente</span><p class="small ink2">Relacione os achados eletrocardiográficos ao quadro clínico, exame físico e demais informações disponíveis.</p><p class="small ink2">O ECG é uma parte do raciocínio clínico e não o raciocínio inteiro.</p></div>`}</div>
    <div class="sec"><h3>11.1 — Sua interpretação do ECG</h3></div>
    <div class="laudo" id="laudo">${s.texto}${assinatura() ? `<div class="sig">${assinatura().trim()}</div>` : ""}</div>
    <div class="salvo">${S.salvou === false ? `<span class="tag bad salva">Não foi possível salvar neste aparelho</span>` : `<span class="tag ok salva">Salva neste aparelho</span>`}</div>
    <button class="btn wide" type="button" data-toggle="blocos" aria-expanded="${!!S.aberto.blocos}">${S.aberto.blocos ? I.recolher + "Ocultar etapa por etapa" : I.seta + "Ver etapa por etapa"}</button>
    ${S.aberto.blocos ? s.blocos.map((b, i) => `<div class="ins ${b.k}"><span class="ix">${dois(i + 1)} · ${b.t.toUpperCase()}</span><strong>${b.v}</strong>${b.d ? `<p>${b.d}</p>` : ""}</div>`).join("") : ""}
    <button class="btn wide" type="button" data-discutir="1">Discutir no grupo Plantão Descomplicado</button>
    ${pendente("Link do grupo Plantão Descomplicado (nome e destino a definir com o Dr. Vitor). Por ora, o botão copia a interpretação.")}
    <p class="tiny mute" style="text-align:center">Quem leu foi você. O Copiloto garantiu que nenhuma etapa ficou para trás e fez as contas.</p>
  </div>
  <div class="foot">${pilula()}<button class="btn" type="button" data-ir="motivo">Novo ECG</button><button class="btn primary" type="button" data-copiar="1">${I.copiar}Copiar interpretação</button></div></div>`;
}

/* ---------- desenhar e ligar ---------- */
function aviso(msg){
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  app.appendChild(t);
  setTimeout(() => t.remove(), 1700);
}
function atualizarSaidas(){
  const sg = sgarbossa(), sk = sokolow(), q = qt();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("sg-res", sg && sg.razao !== null ? sg.razao.toFixed(2).replace(".", ",") : "—");
  set("sk-res", sk ? String(sk.soma).replace(".", ",") + " mm" : "—");
  set("qt-res", q ? q.qtc : "—"); set("qt-ms", q ? q.qtMs + " ms" : "—");
}
/* Tela inteira refeita: devolve a rolagem na mão. Miolo trocado no lugar (tela de etapa):
   quem devolve é o desenharMiolo, e mexer aqui cancelaria a rolagem suave do focar(). */
function manterRolagem(fn){
  const sc = document.getElementById("seq-scroll"), topoR = sc ? sc.scrollTop : 0;
  fn();
  const sc2 = document.getElementById("seq-scroll");
  if (sc2 && sc2 !== sc){ sc2.classList.remove("stagger"); sc2.scrollTop = topoR; }
}
const RAMO6 = ["extra","extraQrs","qrs","tq","pind","temP","rel","bav","pns"];
const RAMO8 = ["v1","sg1","sg2","sgST","sgS","sg3"];
const DEPENDE = {
  cal:["calSeguir"], elet:["eletSeguir"],
  ritmo:["wiz1"].concat(RAMO6), wiz1:["wiz2"].concat(RAMO6), wiz2:["wiz3"].concat(RAMO6), wiz3:RAMO6,
  reg:RAMO6.concat(["cq","c10","fc"]), fc:RAMO6, extra:["extraQrs"], qrs:["tq","pind","qrs8","qrsMs"].concat(RAMO8), qrs8:["qrsMs"].concat(RAMO8), v1:["sg1","sg2","sgST","sgS","sg3"],
  temP:["rel","bav","qrs"], rel:["bav"], pns:["qrs"],
  di:["dii"], avf:["dii"], supraDist:["terr"], amp8:["svd","sV1","rV56","strainVE","sk"]
};
function limpar(k){ (DEPENDE[k] || []).forEach(x => { const tinha = x in R() || x in S.cur.conf; delete R()[x]; delete S.cur.conf[x]; if (tinha) limpar(x); }); }
// v null: a fita voltou a ficar sem valor (gesto cancelado). Apaga a chave em vez de gravar nulo.
function definirFC(v){ const a = R().fc == null ? null : R().fc; if (a !== v) limpar("fc"); if (v == null) delete R().fc; else R().fc = v; }
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
      const exclusiva = v === "nenhuma" || v === "nenhum";
      if (exclusiva) arr = arr.includes(v) ? [] : [v];
      else { arr = arr.filter(x => x !== "nenhuma" && x !== "nenhum"); arr = arr.includes(v) ? arr.filter(x => x !== v) : arr.concat(v); }
      r[k] = arr;
      // a opção exclusiva ("nenhuma") já confirma; qualquer outra mexida pede "Continuar" de novo
      if (exclusiva && arr.length){ S.cur.conf[k] = true; S.editando = null; } else delete S.cur.conf[k];
      if (k === "isq"){ if (!arr.includes("supra")){ delete r.terr; delete r.supraDist; delete S.cur.conf.terr; } if (!arr.includes("infra")) delete r.infraV1; if (!arr.includes("nenhuma")){ delete r.padroes; delete S.cur.conf.padroes; } }
      if (k === "esp"){ if (!arr.includes("tep")) delete r.s1q3t3; if (!arr.includes("hiperk")){ delete r.hk1; delete r.hk2; } if (!arr.includes("hipok")){ delete r.hpk1; delete r.hpk2; } }
    } else {
      if (r[k] !== v) limpar(k);
      r[k] = v; delete S.cur.conf[k]; S.editando = null;
    }
    atualizarWiz();
    manterRolagem(desenhar);
    const novo = app.querySelector(`[data-ans="${k}"][data-val="${v}"]`); if (novo) novo.classList.add("pop");
  });
  raiz.querySelectorAll("[data-editar]").forEach(b => b.onclick = () => { S.editando = b.dataset.editar; delete S.cur.conf[S.editando]; manterRolagem(desenhar); });
  raiz.querySelectorAll("[data-conf]").forEach(b => b.onclick = () => { S.cur.conf[b.dataset.conf] = true; S.editando = null; manterRolagem(desenhar); });
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
/* silencioso: a etapa 11 salva sozinha, sem aviso e sem redesenhar (quem desenha é quem chamou) */
function salvarLeitura(o){
  const s = resumo(), r = R();
  const reg = { id:S.cur.id, quando:S.cur.quando, motivo:S.cur.motivo, queixa:motivo() ? motivo().nome : "Leitura",
    conc:s.titulo, alerta:s.atencao.length > 0, laudo:s.texto, thumb:miniatura(),
    fc:r.fc || null, qrsLargo:larguraQRS() === "largo", irregular:r.reg === "irregular", qtc:qt() ? qt().qtc : null,
    atualizadaEm:Date.now() };
  S.leituras = [reg].concat(S.leituras.filter(l => l.id !== reg.id));
  S.salvou = gravarJSON(CHAVE, S.leituras);   // a marca da etapa 11 só pode dizer "salva" se gravou mesmo
  Sync.enfileirar({tipo:"salvar", id:reg.id, registro:reg}); Sync.enviar();  // sobe sem a miniatura; sem rede, espera na fila
  if (S.cur.blob) guardarFoto(S.cur.id, S.cur.blob);
  descartarAndamento();
  if (o && o.silencioso) return;
  aviso("Salvo neste aparelho");
  manterRolagem(desenhar);
}
function soltarVisor(){ if (S.visor){ S.visor.destruir(); S.visor = null; } }
function irPara(t){
  // tocar em "Nova leitura" não apaga nada: quem enterra a leitura anterior é a nova, quando grava
  // o andamento dela (a chave é única). Assim, tocar por engano e voltar mantém o "Continuar".
  if (t === "motivo" && S.tela !== "foto" && S.tela !== "seq"){ S.cur = nova(); S.vista = null; S.aberto = {}; S.dock = "aberto"; S.fotoOrigem = null; }
  if (t === "foto") S.fotoOrigem = null; // só se chega aqui pelo "Iniciar leitura": o voltar é para o motivo
  S.editando = null;
  soltarVisor();
  S.tela = t;
  desenhar(true);
  const sc = document.getElementById("seq-scroll"); if (sc) sc.scrollTop = 0;
}
function irAba(a){
  soltarVisor();
  S.tela = "inicio"; S.aba = a; S.confirmaApagar = false; S.conta.saindo = null; S.editando = null;
  desenhar(true);
}
function escalonar(){
  app.querySelectorAll(".stagger").forEach(st => [...st.children].forEach((el, i) => el.style.setProperty("--i", Math.min(i, 12))));
}
/* porta única: com a casca da mesma etapa no DOM, só o miolo é refeito; desenhar(true) força a tela inteira */
function desenhar(inteira){
  if (!inteira && S.tela === "seq" && app.querySelector('.screen[data-passo="' + S.cur.passo + '"]')){
    const sc = document.getElementById("seq-scroll");
    sc.classList.remove("stagger"); // a entrada escalonada é da casca, não de cada resposta
    desenharMiolo();
    return;
  }
  const telas = { inicio:() => ({inicio, biblioteca, guia, config}[S.aba] || inicio)(),
    motivo:telaMotivo, foto:telaFoto, seq:telaSeq, medir:telaMedir, ver:telaVer, detalhe, laudo:telaLaudo,
    entrar:telaEntrar, codigo:telaCodigo, encerrado:telaEncerrado };
  soltarVisor(); // a tela inteira é refeita: o visor que ficaria órfão levaria o S.vista junto no próximo resize
  soltarControles(app);
  app.innerHTML = (telas[S.tela] || telas.inicio)();
  animarNumeros(); montarMonitor();
  ligar(app);
  montarControles(app);

  if (S.tela === "foto" && S.cur.tela) montarVisor("#visor", {modo:"livre"});
  if (S.tela === "ver") montarVisor("#visor", {modo:"livre"});
  if (S.tela === "seq" && S.cur.tela && S.dock !== "pilula") montarVisor("#visor", {modo:"livre"});
  if (S.tela === "medir") ligarMedir();
  if (S.tela === "seq") desenharMiolo(); // o miolo nasce vazio na casca
  if (S.tela === "codigo") montarCodigo();
  // atalho do início: a calculadora pedida encosta no topo. A conta é de layout (offsetTop), porque a
  // entrada escalonada ainda está deslocando o cartão e o scrollIntoView pararia uns 12 px acima.
  if (S.guiaFoco){ const c = document.getElementById("calc-" + S.guiaFoco); if (c) c.parentNode.scrollTop = c.offsetTop - c.parentNode.offsetTop; S.guiaFoco = null; }
  escalonar();
  atualizarContinua(); setTimeout(atualizarContinua, 400);
  // a tela cheia aberta pelo laudo é leitura terminada: gravar andamento aqui a ressuscitaria no início
  if (["foto", "seq", "medir", "ver"].includes(S.tela) && !(S.tela === "ver" && S.verVolta === "laudo")) gravarAndamento();
  travarTela(emLeitura());
}
/* liga os eventos de uma raiz: a tela inteira (app) ou só o miolo redesenhado.
   Os getElementById ficam como estão — religar é só reatribuir onclick/oninput. */
function ligar(raiz){
  raiz.querySelectorAll("[data-aba]").forEach(b => b.onclick = () => irAba(b.dataset.aba));
  raiz.querySelectorAll("[data-ir]").forEach(b => b.onclick = () => irPara(b.dataset.ir));
  raiz.querySelectorAll("[data-motivo]").forEach(b => b.onclick = () => {
    S.cur.motivo = b.dataset.motivo; manterRolagem(desenhar);
    const o = document.getElementById("orient"); if (o) o.scrollIntoView({block:"nearest", behavior:"smooth"});
  });
  raiz.querySelectorAll("[data-fonte]").forEach(b => b.onclick = () => pedirFoto(b.dataset.fonte));
  raiz.querySelectorAll("[data-continuar]").forEach(b => b.onclick = () => continuarLeitura());
  raiz.querySelectorAll("[data-descartar]").forEach(b => b.onclick = () => { descartarAndamento(); S.cur = nova(); desenhar(true); });
  raiz.querySelectorAll("[data-instalar]").forEach(b => b.onclick = () => { const e = S.instalar; if (!e) return; S.instalar = null; try { e.prompt(); } catch(_){} });
  // atalho do início: abre o Guia já nas calculadoras, com a calculadora pedida no topo (quem rola é o desenhar)
  raiz.querySelectorAll("[data-atalho]").forEach(b => b.onclick = () => { S.guiaAba = "calc"; S.guiaFoco = b.dataset.atalho; irAba("guia"); });
  raiz.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => { const k = b.dataset.toggle; S.aberto[k] = !S.aberto[k]; manterRolagem(desenhar); });
  raiz.querySelectorAll("[data-quad]").forEach(b => b.onclick = () => { S.cur.calQuadrados = +b.dataset.quad; desenhar(); });
  // abrir/recolher muda a altura da área de rolagem: a casca é remontada, mas a leitura fica onde estava
  raiz.querySelectorAll("[data-dock]").forEach(b => b.onclick = () => { S.dock = b.dataset.dock === "recolher" ? "pilula" : "aberto"; soltarVisor(); manterRolagem(() => desenhar(true)); });
  raiz.querySelectorAll("[data-ver]").forEach(b => b.onclick = () => { S.verVolta = S.tela === "laudo" ? "laudo" : "seq"; soltarVisor(); S.tela = "ver"; desenhar(); });
  raiz.querySelectorAll("[data-fechar-ver]").forEach(b => b.onclick = () => { soltarVisor(); S.tela = S.verVolta; desenhar(true); });
  raiz.querySelectorAll("[data-medir]").forEach(b => b.onclick = () => { S.medir = {alvo:b.dataset.medir, chave:b.dataset.chave || null}; soltarVisor(); S.tela = "medir"; desenhar(); });
  raiz.querySelectorAll("[data-discutir]").forEach(b => b.onclick = () => {
    const txt = resumo().texto + assinatura();
    Plataforma.copiar(txt).then(ok => aviso(ok ? "Interpretação copiada. Cole no grupo." : "Não deu para copiar aqui"));
  });
  raiz.querySelectorAll("[data-sair-medir]").forEach(b => b.onclick = () => { soltarVisor(); S.tela = "seq"; desenhar(); });
  raiz.querySelectorAll("[data-recalibrar]").forEach(b => b.onclick = () => { S.cur.escala = null; S.cur.pontos.fc = null; S.cur.pontos.qrs = null; S.cur.pontos.qt = null; S.vista = null; soltarVisor(); desenhar(); });
  raiz.querySelectorAll("[data-voltar]").forEach(b => b.onclick = () => {
    if (S.tela === "laudo"){ S.tela = "seq"; S.cur.passo = ULTIMA_PERGUNTA; }
    else if (S.cur.passo > 2){ S.cur.passo--; S.dir = "back"; }
    else { S.fotoOrigem = null; S.tela = "foto"; }   // senão o voltar da tela de foto devolvia para a etapa, e a volta ficava presa
    S.editando = null; soltarVisor(); desenhar(true);
  });
  raiz.querySelectorAll("[data-abrir]").forEach(b => b.onclick = () => {
    S.detalhe = S.leituras.find(l => l.id === b.dataset.abrir);
    if (S.detalhe){ S.tela = "detalhe"; desenhar(); }
  });
  raiz.querySelectorAll("[data-copiar]").forEach(b => b.onclick = () => {
    const txt = (S.tela === "detalhe" ? S.detalhe.laudo : resumo().texto) + assinatura();
    Plataforma.copiar(txt).then(ok => aviso(ok ? "Laudo copiado" : "Não deu para copiar aqui"));
  });
  raiz.querySelectorAll("[data-apagar]").forEach(b => b.onclick = () => {
    const id = b.dataset.apagar;
    S.leituras = S.leituras.filter(l => l.id !== id);
    gravarJSON(CHAVE, S.leituras);
    apagarFoto(id);
    Sync.enfileirar({tipo:"apagar", id}); Sync.enviar();  // lápide até a fila subir: não volta na próxima junção
    aviso("Leitura apagada");
    irAba("biblioteca");
  });
  raiz.querySelectorAll("[data-fmotivo]").forEach(b => b.onclick = () => { S.filtro.motivo = b.dataset.fmotivo; desenhar(); });
  raiz.querySelectorAll("[data-fatencao]").forEach(b => b.onclick = () => { S.filtro.atencao = !S.filtro.atencao; desenhar(); });
  raiz.querySelectorAll("[data-guia]").forEach(b => b.onclick = () => { S.guiaAba = b.dataset.guia; desenhar(); });
  raiz.querySelectorAll("[data-pref]").forEach(b => b.onclick = () => {
    const k = b.dataset.pref;
    if (k === "tema") S.prefs.tema = S.prefs.tema === "claro" ? "escuro" : "claro"; else S.prefs[k] = !S.prefs[k];
    gravarJSON(CHAVE_PREFS, S.prefs); aplicarTema(); desenhar();
  });
  const nome = document.getElementById("p-nome");
  if (nome) nome.oninput = () => { S.prefs.nome = nome.value; gravarJSON(CHAVE_PREFS, S.prefs); };
  raiz.querySelectorAll("[data-apagar-tudo]").forEach(b => b.onclick = () => { S.confirmaApagar = true; desenhar(); });
  raiz.querySelectorAll("[data-cancela-apagar]").forEach(b => b.onclick = () => { S.confirmaApagar = false; desenhar(); });
  raiz.querySelectorAll("[data-confirma-apagar]").forEach(b => b.onclick = () => {
    S.leituras.forEach(l => { apagarFoto(l.id); Sync.enfileirar({tipo:"apagar", id:l.id}); }); Sync.enviar();
    S.leituras = []; gravarJSON(CHAVE, []); S.confirmaApagar = false;
    aviso("Tudo apagado"); desenhar();
  });
  const busca = document.getElementById("busca");
  if (busca) busca.oninput = () => {
    S.filtro.busca = busca.value; const pos = busca.selectionStart;
    desenhar();
    const b2 = document.getElementById("busca"); if (b2){ b2.focus(); try { b2.setSelectionRange(pos, pos); } catch(_){} }
  };
  ligarOpts(raiz);
  ligarConta(raiz);
  // etapa 4: trocar de método na ajuda da FC (régua no papel · contar em 10 s · medir na foto)
  raiz.querySelectorAll("[data-fcaba]").forEach(b => b.onclick = () => { S.aberto.calcfcAba = b.dataset.fcaba; manterRolagem(desenhar); });

  if (S.tela === "seq"){
    const b = document.getElementById("proxima");
    if (b) b.onclick = () => {
      S.editando = null;
      if (S.cur.passo < ULTIMA_PERGUNTA){ S.cur.passo++; S.dir = "fwd"; desenhar(true); const sc = document.getElementById("seq-scroll"); if (sc) sc.scrollTop = 0; }
      else { S.tela = "laudo"; salvarLeitura({silencioso:true}); desenhar(true); } // chegou ao fim: guarda sozinho
    };
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
  if (!c.pontos[alvo]) c.pontos[alvo] = pontosPadrao(alvo === "fc" ? 800 : alvo === "qt" ? 400 : 100);
  const quadr = ms => (ms / MS_POR_MM).toLocaleString("pt-BR", {maximumFractionDigits:1});
  const out = () => {
    const p = c.pontos[alvo], ms = msEntre(p[0], p[1]), el = document.getElementById("medir-out");
    if (alvo === "fc"){
      const f = ms ? Math.round(60000 / ms) : 0;
      el.innerHTML = `<div class="readout"><span class="num">${f || "—"}<span class="u">bpm</span></span></div><div class="kv"><span>RR medido</span><span>${ms} ms · ${quadr(ms)} quadradinhos</span></div>`;
    } else if (alvo === "qt"){
      el.innerHTML = `<div class="readout"><span class="num">${ms}<span class="u">ms</span></span></div><div class="kv"><span>Quadradinhos</span><span>${quadr(ms)}</span></div><div class="kv"><span>QTc (Bazett) com FC ${R().fc || "—"}</span><span>${ms && R().fc ? Math.round(ms / Math.sqrt(60 / R().fc)) + " ms" : "—"}</span></div>`;
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
      definirFC(f); S.cur.conf.fc = true; S.editando = null; aviso("FC " + f + " bpm");
    } else if (alvo === "qt"){
      R().qtQuad = Math.round(ms / MS_POR_MM * 10) / 10; S.cur.conf.qtQuad = true; S.editando = null; S.aberto.medirqt = false; aviso("QT " + ms + " ms");
    } else {
      const v = ms >= 120 ? "largo" : "estreito", chave = S.medir.chave || "qrs";
      if (R()[chave] !== v) limpar(chave);
      R()[chave] = v; R().qrsMs = ms; S.editando = null; S.aberto.medirqrs = false; S.aberto.medirqrs8 = false; aviso("QRS " + ms + " ms · " + v);
    }
    soltarVisor(); S.tela = "seq"; desenhar();
  };
}

/* ---------- conta: comportamento das telas ---------- */
function ligarConta(raiz){
  raiz.querySelectorAll("[data-suporte]").forEach(b => b.onclick = () => Plataforma.abrirExterno("mailto:" + suporte()));
  raiz.querySelectorAll("[data-trocar-email]").forEach(b => b.onclick = () => { S.conta.msg = null; S.conta.erros = 0; S.tela = "entrar"; desenhar(true); });
  raiz.querySelectorAll("[data-sair-conta]").forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = "Enviando leituras…";
    const {pendentes} = await Sync.enviar();
    if (!Conta.email()) return;
    S.conta.saindo = {pendentes}; desenhar();
  });
  raiz.querySelectorAll("[data-sair-cancela]").forEach(b => b.onclick = () => { S.conta.saindo = null; desenhar(); });
  raiz.querySelectorAll("[data-sair-mesmo], [data-sair-confirma]").forEach(b => b.onclick = async () => {
    raiz.querySelectorAll("[data-sair-mesmo], [data-sair-confirma], [data-sair-cancela]").forEach(x => { x.disabled = true; });
    await limparAparelho(); await Conta.sair(); paraEntrar();
  });
  raiz.querySelectorAll("[data-excluir-conta]").forEach(b => b.onclick = () => { S.conta.excluindo = true; desenhar(); const i = document.getElementById("c-excluir"); if (i) i.focus(); });
  raiz.querySelectorAll("[data-excluir-cancela]").forEach(b => b.onclick = () => { S.conta.excluindo = false; desenhar(); });
  const form = document.getElementById("c-form");
  if (form) form.onsubmit = e => { e.preventDefault(); enviarEmail(); };
  const conf = document.getElementById("c-excluir"), ok = document.getElementById("c-excluir-ok");
  if (conf && ok){
    const vale = () => conf.value.trim() === "EXCLUIR";
    conf.oninput = () => { ok.disabled = !vale(); };
    ok.onclick = async () => {
      if (!vale()) return;
      ok.disabled = true; ok.textContent = "Excluindo…";
      const r = await Conta.excluir();
      if (r === "ok"){ await limparAparelho(); paraEntrar(); aviso("Conta excluída"); return; }
      ok.disabled = false; ok.textContent = "Excluir conta";
      aviso(r === "sem_rede" ? "Sem internet agora. Tente com conexão." : "Não deu certo. Tente de novo.");
    };
  }
}
/* sair e excluir: o aparelho fica vazio (leituras, fotos, andamento, fila) e a memória também */
async function limparAparelho(){
  await Sync.limparLocal();
  soltarVisor(); travarTela(false);
  S.leituras = []; S.cur = nova(); S.detalhe = null; S.vista = null; S.aberto = {};
  S.prefs = Object.assign({nome:"", assinatura:true, tema:"escuro", revisao:false}, lerJSON(CHAVE_PREFS, {}));
}
/* sair e excluir terminam aqui */
function paraEntrar(){
  const email = S.conta.email;
  S.conta = contaVazia(); S.conta.email = email;
  soltarVisor(); S.tela = "entrar"; S.aba = "inicio"; S.confirmaApagar = false; S.editando = null;
  desenhar(true);
}
async function enviarEmail(){
  const c = S.conta, input = document.getElementById("c-email");
  if (c.enviando || !input) return;
  c.email = input.value.trim().toLowerCase();
  c.enviando = true; c.msg = null;
  const btn = document.getElementById("c-enviar"), msg = document.getElementById("c-msg");
  if (btn){ btn.disabled = true; btn.textContent = "Enviando…"; }
  if (msg) msg.innerHTML = "";
  const r = await Conta.pedirCodigo(c.email);
  c.enviando = false;
  if (r === "ok"){ c.msg = null; c.erros = 0; c.reenviarEm = Date.now() + 60000; S.tela = "codigo"; desenhar(true); return; }
  c.msg = r;
  if (S.tela !== "entrar") return;
  const btn2 = document.getElementById("c-enviar"), msg2 = document.getElementById("c-msg");
  if (btn2){ btn2.disabled = false; btn2.textContent = "Receber código"; }
  if (msg2){ msg2.innerHTML = (MSG_ENTRAR[r] || MSG_ENTRAR.falha)(); ligarConta(msg2); }
}
/* código: um input só, transparente por cima das 6 caixas — colar e o preenchimento automático do
   iPhone ("one-time-code") entregam os 6 dígitos de uma vez. As caixas só espelham o valor. */
let relogio = null;
function montarCodigo(){
  const otp = document.getElementById("c-otp"), caixa = document.getElementById("c-codigo");
  if (!otp) return;
  const cxs = [...caixa.querySelectorAll(".cx")];
  const pintar = () => {
    const v = otp.value, foco = document.activeElement === otp;
    cxs.forEach((cx, i) => { cx.textContent = v[i] || ""; cx.classList.toggle("cheia", i < v.length); cx.classList.toggle("ativa", foco && i === Math.min(v.length, 5)); });
  };
  otp.oninput = () => {
    const v = otp.value.replace(/\D/g, "").slice(0, 6);
    if (otp.value !== v) otp.value = v;
    caixa.classList.remove("erro");
    if (S.conta.msg){ S.conta.msg = null; document.getElementById("c-status").innerHTML = statusCodigo(); }
    pintar();
    if (v.length === 6) confirmarCodigo(v);
  };
  otp.onfocus = otp.onblur = otp.__pintar = pintar;
  otp.onkeyup = otp.onclick = () => { try { const n = otp.value.length; otp.setSelectionRange(n, n); } catch(_){} };  // o cursor fica sempre no fim
  pintar();
  if (!otp.disabled) setTimeout(() => { if (document.activeElement !== otp) otp.focus(); }, 80);
  const reenviar = document.getElementById("c-reenviar");
  reenviar.onclick = async () => {
    if (faltaReenviar() || S.conta.enviando) return;
    S.conta.enviando = true; reenviar.disabled = true; reenviar.textContent = "Enviando…";
    const r = await Conta.pedirCodigo(S.conta.email);
    S.conta.enviando = false;
    if (r === "ok"){ S.conta.reenviarEm = Date.now() + 60000; S.conta.erros = 0; S.conta.msg = null; if (S.tela === "codigo") desenhar(true); aviso("Código reenviado"); return; }
    reenviar.disabled = false; reenviar.textContent = textoReenviar();
    aviso(r === "sem_rede" ? "Sem internet agora" : r === "muitos_pedidos" ? "Muitos pedidos seguidos. Espere alguns minutos." : "Não deu certo. Tente de novo.");
  };
  clearInterval(relogio);
  relogio = setInterval(() => {
    const b = document.getElementById("c-reenviar");
    if (!b || S.tela !== "codigo"){ clearInterval(relogio); relogio = null; return; }
    if (S.conta.enviando) return;
    b.textContent = textoReenviar(); b.disabled = !!faltaReenviar();
  }, 1000);
}
async function confirmarCodigo(v){
  const c = S.conta;
  if (c.verificando || bloqueado()) return;
  const otp = document.getElementById("c-otp"), caixa = document.getElementById("c-codigo"), st = document.getElementById("c-status");
  c.verificando = true; c.msg = null; st.innerHTML = statusCodigo(); otp.disabled = true;
  const r = await Conta.confirmar(c.email, v);
  c.verificando = false;
  if (r === "ok"){ entrou(); return; }
  if (S.tela !== "codigo") return;
  if (r === "codigo_errado") c.erros++;
  c.msg = r;
  otp.value = ""; otp.disabled = bloqueado();
  st.innerHTML = statusCodigo();
  if (r === "codigo_errado"){ caixa.classList.remove("erro"); void caixa.offsetWidth; caixa.classList.add("erro"); }
  if (!otp.disabled) otp.focus();
  otp.__pintar();
}
function entrou(){
  S.conta = contaVazia();
  ultimaConferencia = Date.now();  // acabou de provar o acesso: o pedir-codigo só manda código a quem tem
  S.tela = "inicio"; S.aba = "inicio";
  desenhar(true);
  aviso("Pronto, você entrou");
  sincronizar();
}

/* ---------- sincronização (T08) ----------
   Ao entrar e ao abrir com sessão e rede: leituras sem dono entram na fila da primeira conta, a fila sobe,
   a conta desce e junta com o aparelho. Apagada em outro aparelho some daqui, com a foto. */
async function sincronizar(){
  const email = Conta.email(); if (!email) return;
  Sync.adotar(email, S.leituras);
  if (!Plataforma.online()) return;
  const lista = await Sync.sincronizar(S.leituras);   // a junção mantém a miniatura deste aparelho
  if (!lista || Conta.email() !== email) return;
  const ficam = new Set(lista.map(l => l.id)), marca = ls => ls.map(l => l.id + ":" + (l.atualizadaEm || l.quando)).join();
  S.leituras.forEach(l => { if (!ficam.has(l.id)) apagarFoto(l.id); });
  lista.sort((a, b) => (b.quando || 0) - (a.quando || 0));
  const mudou = marca(lista) !== marca(S.leituras);
  S.leituras = lista;
  gravarJSON(CHAVE, S.leituras);
  if (!mudou) return;
  if (S.tela === "detalhe" && S.detalhe && !ficam.has(S.detalhe.id)){ S.tela = "inicio"; S.aba = "biblioteca"; }
  if (S.tela !== "inicio" && S.tela !== "detalhe") return;   // no meio de uma leitura, a lista nova espera a próxima tela
  // redesenha sem perder a rolagem nem o aviso que estiver na tela ("Pronto, você entrou")
  const sc = app.querySelector(".scroll"), topo = sc ? sc.scrollTop : 0, avisos = [...app.querySelectorAll(".toast")];
  desenhar();
  const sc2 = app.querySelector(".scroll"); if (sc2) sc2.scrollTop = topo;
  avisos.forEach(t => app.appendChild(t));
}

/* ---------- porta ----------
   Sem sessão: Entrar. Com sessão: o app abre na hora, sem esperar rede, e o acesso é conferido por
   trás. Só um false do servidor leva a "acesso encerrado"; sem rede, erro ou demora (null), nada muda.
   Confere de novo quando a rede volta e quando o app volta para a frente (esta, no máximo a cada 10 min). */
let ultimaConferencia = 0;
async function conferir(sempre){
  if (!Conta.email() || TELAS_CONTA.includes(S.tela)) return;
  if (!sempre && Date.now() - ultimaConferencia < 10 * 6e4) return;
  ultimaConferencia = Date.now();
  const r = await Conta.conferirAcesso();
  if (r === null){ ultimaConferencia = 0; return; }  // não deu para saber: a próxima volta tenta de novo
  if (r === false && Conta.email() && !TELAS_CONTA.includes(S.tela)){ soltarVisor(); S.tela = "encerrado"; desenhar(true); }
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
    S.cur.escala = null; S.cur.pontos = {cal:null, fc:null, qrs:null, qt:null};
    S.cur.thumb = null; S.vista = null;
    // esperar o blob antes de desenhar: quem desenha grava o andamento com temFoto, e ele não pode
    // dizer que há foto antes de a foto estar no aparelho
    const blob = await new Promise(ok => tela.toBlob(ok, "image/jpeg", .88));
    S.cur.blob = blob;
    if (blob) await guardarFoto(FOTO_AND, blob);
    soltarVisor();
    S.tela = "foto";
    desenhar();
  } catch(_){ aviso("Não consegui abrir essa imagem"); }
});

window.__copiloto = {S, R, nova, arritmia, isquemia, qt, resumo, proximoPasso, desenhar};

// a primeira tela sai na hora, da sessão guardada no aparelho; a rede só confirma depois
const {sessao} = Conta.guardada();
if (!sessao) S.tela = "entrar";
desenhar();
window.__copiloto.primeiraTela = {tela:S.tela, em:performance.now()};
if (sessao){
  Conta.iniciar().then(r => { if (!r.sessao && !TELAS_CONTA.includes(S.tela)) paraEntrar(); });  // a sessão acabou de verdade
  conferir(true);
  sincronizar();
}
Plataforma.aoMudarRede(on => { if (on){ conferir(true); if (Conta.email()) Sync.enviar(); } });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") conferir(false); });
})();
