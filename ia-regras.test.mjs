// Testes da tutora que discorda e do "por que isso importa?" (app/ia-regras.js).
// Rodar: node --test app/ia-regras.test.mjs
// As leituras seguem o formato real do app: {motivo, passo, r}, com as mesmas chaves de R() (ver teste/casos-ouro.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const aqui = dirname(fileURLToPath(import.meta.url));
const IA = require("./ia-regras.js");

/* eletro normal respondido até a etapa 10, no formato da v6 (cal/elet) */
const BASE = {cal:"padrao", elet:"sim", ritmo:"sim", reg:"regular", fc:72, di:"pos", avf:"pos", extra:"nao",
  isq:["nenhuma"], padroes:["nenhum"], qrs8:"estreito", amp8:"nao", qtQuad:"9", sexo:"m", esp:["nenhuma"]};
const leitura = (motivo, mud, tirar, passo) => {
  const r = JSON.parse(JSON.stringify(Object.assign({}, BASE, mud)));
  (tirar || []).forEach(k => delete r[k]);
  return {motivo, passo:passo || 11, r};
};
const NS = {ritmo:"nao"};
const ids = l => IA.avaliar(l).map(a => a.id);
const dispara = (id, l) => assert.ok(ids(l).includes(id), `${id} devia disparar; disparou: ${ids(l).join(", ") || "nada"}`);
const naoDispara = (id, l) => assert.ok(!ids(l).includes(id), `${id} não devia disparar`);

/* ---------- formato ---------- */
test("todo alerta tem os campos combinados", () => {
  const l = leitura("sincope", {fc:44, isq:["supra"], supraDist:"sim", terr:["inf"], qtQuad:"14"}, ["padroes"]);
  const as = IA.avaliar(l);
  assert.ok(as.length >= 3);
  for (const a of as){
    assert.deepEqual(Object.keys(a).sort(), ["aula", "etapa", "id", "nivel", "pergunta_para_ia", "texto", "titulo"]);
    assert.ok(["atencao", "info"].includes(a.nivel));
    assert.ok(a.etapa >= 1 && a.etapa <= 11);
    for (const k of ["titulo", "texto", "pergunta_para_ia", "aula"]) assert.ok(typeof a[k] === "string" && a[k].length > 5, k);
  }
});
test("eletro normal de rotina não levanta a mão", () => {
  assert.deepEqual(ids(leitura("rotina", {})), []);
});
test("leitura vazia ou incompleta não quebra", () => {
  assert.deepEqual(IA.avaliar({}), []);
  assert.deepEqual(IA.avaliar({motivo:"dor", r:{}}), []);
  assert.deepEqual(IA.avaliar(null), []);
});
test("com passo, só volta o que já foi alcançado", () => {
  const r = {motivo:"sincope", r:Object.assign({}, BASE, {qtQuad:"14"})};
  assert.ok(!IA.avaliar(Object.assign({}, r, {passo:6})).some(a => a.id === "qt-longo-risco"));
  assert.ok(IA.avaliar(Object.assign({}, r, {passo:9})).some(a => a.id === "qt-longo-risco"));
  assert.deepEqual(IA.alertasDaEtapa(r, 9).map(a => a.id), ["qt-longo-risco"]);
});
test("ordem: por etapa, atenção antes de info", () => {
  const as = IA.avaliar(leitura("sincope", {fc:44, qtQuad:"14"}));
  const et = as.map(a => a.etapa);
  assert.deepEqual(et, [...et].sort((a, b) => a - b));
});

/* ---------- espelho do app.js: arritmia e QT iguais ao arquivo-ouro (58 casos da v5) ---------- */
test("espelho de arritmia() e qt() bate com o arquivo-ouro do app", () => {
  const casos = require("../teste/casos-ouro.js"), ouro = require("../teste/ouro-v5.json");
  for (const c of casos){
    const o = ouro[c.nome];
    assert.equal(IA._apoio.arritmia(c.r), o.arritmia ? o.arritmia.t : null, "arritmia: " + c.nome);
    const q = IA._apoio.qt(c.r);
    assert.equal(q ? q.qtc : null, o.qt ? o.qt.qtc : null, "qtc: " + c.nome);
    if (q) assert.equal(q.longo, o.qt.longo, "longo: " + c.nome);
  }
});

/* ---------- regra por regra: dispara quando deve, cala quando não deve ---------- */
test("eletrodos-trocados", () => {
  dispara("eletrodos-trocados", leitura("rotina", {elet:"nao", eletSeguir:"sim", di:"neg", avf:"pos"}));
  const r = IA.avaliar(leitura("rotina", Object.assign({}, NS, {elet:"nao", eletSeguir:"sim", fc:70, pns:"sim"}), ["extra"])).find(a => a.id === "eletrodos-trocados");
  assert.equal(r.etapa, 3);
  naoDispara("eletrodos-trocados", leitura("rotina", {elet:"nao", eletSeguir:"sim"}));           // eixo normal, sinusal
  naoDispara("eletrodos-trocados", leitura("rotina", {di:"neg", avf:"pos"}));                     // eletrodos ok
});
test("bradicardia-sinusal-p-conduz", () => {
  const a = IA.avaliar(leitura("bradi", {fc:44})).find(x => x.id === "bradicardia-sinusal-p-conduz");
  assert.equal(a.nivel, "atencao");
  assert.equal(IA.avaliar(leitura("rotina", {fc:46})).find(x => x.id === "bradicardia-sinusal-p-conduz").nivel, "info");
  naoDispara("bradicardia-sinusal-p-conduz", leitura("bradi", {fc:55}));
  naoDispara("bradicardia-sinusal-p-conduz", leitura("bradi", Object.assign({}, NS, {fc:40, temP:"sim", rel:"algumas", bav:"21"}), ["extra"]));
});
test("fa-com-bavt", () => {
  dispara("fa-com-bavt", leitura("bradi", Object.assign({}, NS, {fc:32, temP:"nao", qrs:"estreito"}), ["extra", "qrs8"]));
  naoDispara("fa-com-bavt", leitura("bradi", Object.assign({}, NS, {fc:44, temP:"nao", qrs:"estreito"}), ["extra", "qrs8"]));   // 40–60: juncional
  naoDispara("fa-com-bavt", leitura("bradi", Object.assign({}, NS, {reg:"irregular", fc:36, temP:"nao"}), ["extra"]));           // irregular: FA baixa resposta
});
test("taquicardia-sinusal-qrs-largo", () => {
  dispara("taquicardia-sinusal-qrs-largo", leitura("palp", {fc:130, qrs8:"largo", v1:"brd"}));
  naoDispara("taquicardia-sinusal-qrs-largo", leitura("palp", {fc:130}));                          // QRS estreito
  naoDispara("taquicardia-sinusal-qrs-largo", leitura("palp", {fc:90, qrs8:"largo", v1:"brd"}));   // sem taquicardia
  naoDispara("taquicardia-sinusal-qrs-largo", leitura("palp", Object.assign({}, NS, {fc:170, qrs:"largo", v1:"duvida"}), ["extra", "qrs8"])); // o app já diz TV
});
test("fc-150-flutter", () => {
  dispara("fc-150-flutter", leitura("palp", Object.assign({}, NS, {fc:150, qrs:"estreito", tq:"nenhum"}), ["extra", "qrs8"]));
  dispara("fc-150-flutter", leitura("palp", {fc:148}));
  naoDispara("fc-150-flutter", leitura("palp", Object.assign({}, NS, {fc:150, qrs:"estreito", tq:"flutter"}), ["extra", "qrs8"])); // já é flutter
  naoDispara("fc-150-flutter", leitura("palp", Object.assign({}, NS, {fc:180, qrs:"estreito", tq:"nenhum"}), ["extra", "qrs8"]));
  naoDispara("fc-150-flutter", leitura("palp", Object.assign({}, NS, {reg:"irregular", fc:150, qrs:"estreito", pind:"nao"}), ["extra", "qrs8"]));
  // aula 48: as ondas F são mais bem vistas na parede inferior; V1 só às vezes
  const a = IA.avaliar(leitura("palp", {fc:148})).find(x => x.id === "fc-150-flutter");
  assert.match(a.texto, /parede inferior \(DII, DIII e aVF\)/); assert.doesNotMatch(a.texto, /DII, DIII, aVF e V1/);
});
test("fa-pre-excitada", () => {
  dispara("fa-pre-excitada", leitura("palp", Object.assign({}, NS, {reg:"irregular", fc:190, qrs:"largo", v1:"duvida"}), ["extra", "qrs8"]));
  naoDispara("fa-pre-excitada", leitura("palp", Object.assign({}, NS, {fc:190, qrs:"largo", v1:"duvida"}), ["extra", "qrs8"]));    // regular
  naoDispara("fa-pre-excitada", leitura("palp", Object.assign({}, NS, {reg:"irregular", fc:150, qrs:"estreito", pind:"nao"}), ["extra", "qrs8"]));
});
test("sincope-conducao", () => {
  dispara("sincope-conducao", leitura("sincope", {}));
  naoDispara("sincope-conducao", leitura("rotina", {}));
  naoDispara("sincope-conducao", leitura("sincope", Object.assign({}, NS, {fc:38, temP:"sim", rel:"nao"}), ["extra"]));  // não sinusal: o app já caracteriza
});
test("sincope-supra-brugada", () => {
  dispara("sincope-supra-brugada", leitura("sincope", {isq:["supra"], supraDist:"sim", terr:["ant"]}, ["padroes"]));
  dispara("sincope-supra-brugada", leitura("palp", {isq:["supra"], supraDist:"difuso"}, ["padroes"]));
  naoDispara("sincope-supra-brugada", leitura("dor", {isq:["supra"], supraDist:"sim", terr:["ant"]}, ["padroes"]));
  naoDispara("sincope-supra-brugada", leitura("sincope", {}));
  // o texto segue a queixa: palpitação não fala em "quem desmaiou"
  const s = IA.avaliar(leitura("sincope", {isq:["supra"], supraDist:"sim", terr:["ant"]}, ["padroes"])).find(x => x.id === "sincope-supra-brugada");
  assert.match(s.titulo, /desmaiou/); assert.match(s.pergunta_para_ia, /^Síncope/); assert.match(s.texto, /Pergunte se a síncope foi noturna/);
  const p = IA.avaliar(leitura("palp", {isq:["supra"], supraDist:"difuso"}, ["padroes"])).find(x => x.id === "sincope-supra-brugada");
  assert.match(p.titulo, /palpitação/); assert.doesNotMatch(p.titulo + p.texto, /desmaiou/);
  assert.match(p.pergunta_para_ia, /^Palpitação/); assert.match(p.texto, /Pergunte se já houve síncope/);
});
test("palpitacao-pre-excitacao", () => {
  dispara("palpitacao-pre-excitacao", leitura("palp", {}));
  naoDispara("palpitacao-pre-excitacao", leitura("rotina", {}));
  naoDispara("palpitacao-pre-excitacao", leitura("palp", Object.assign({}, NS, {reg:"irregular", fc:142, qrs:"estreito", pind:"nao"}), ["extra", "qrs8"]));
});
test("supra-inferior-vd", () => {
  dispara("supra-inferior-vd", leitura("dor", {isq:["supra"], supraDist:"sim", terr:["inf", "lat"]}, ["padroes"]));
  naoDispara("supra-inferior-vd", leitura("dor", {isq:["supra"], supraDist:"sim", terr:["ant"]}, ["padroes"]));
  naoDispara("supra-inferior-vd", leitura("dor", {isq:["supra"], supraDist:"difuso"}, ["padroes"]));
  naoDispara("supra-inferior-vd", leitura("dor", {isq:["supra"], supraDist:"sim"}, ["padroes"], 7));   // território ainda não marcado
  // aula 76: "maior chance de fazer bradiarritmias", não "esperada"
  const a = IA.avaliar(leitura("dor", {isq:["supra"], supraDist:"sim", terr:["inf"]}, ["padroes"])).find(x => x.id === "supra-inferior-vd");
  assert.match(a.texto, /bradiarritmia é mais frequente \(aula 76\)/); assert.doesNotMatch(a.texto, /esperada/);
});
test("alto-risco-oclusao", () => {
  const a = IA.avaliar(leitura("dor", {padroes:["dewinter", "hiper"]})).find(x => x.id === "alto-risco-oclusao");
  assert.match(a.texto, /de Winter/); assert.match(a.texto, /hiperaguda/);
  dispara("alto-risco-oclusao", leitura("dor", {padroes:["aslanger"]}));
  naoDispara("alto-risco-oclusao", leitura("dor", {padroes:["wellens"]}));
  naoDispara("alto-risco-oclusao", leitura("dor", {}));
  // a pergunta para a IA usa a queixa real
  const q = m => IA.avaliar(leitura(m, {padroes:["dewinter"]})).find(x => x.id === "alto-risco-oclusao").pergunta_para_ia;
  assert.match(q("dor"), /num paciente com dor torácica\./);
  assert.match(q("sincope"), /num paciente com síncope\./); assert.doesNotMatch(q("sincope"), /dor torácica/);
  assert.match(q("rotina"), /assintomático/);
  assert.match(q("outro"), /de Winter neste paciente\./);
});
test("wellens-nao-liberar", () => {
  dispara("wellens-nao-liberar", leitura("dor", {padroes:["wellens", "dewinter"]}));
  naoDispara("wellens-nao-liberar", leitura("dor", {padroes:["avr"]}));
});
test("infra-difuso-avr", () => {
  dispara("infra-difuso-avr", leitura("dor", {padroes:["avr"]}));
  naoDispara("infra-difuso-avr", leitura("dor", {padroes:["nenhum"]}));
});
test("bre-infra-v1v3-sgarbossa", () => {
  dispara("bre-infra-v1v3-sgarbossa", leitura("disp", {isq:["infra"], infraV1:"sim", qrs8:"largo", v1:"bre"}, ["padroes"]));
  naoDispara("bre-infra-v1v3-sgarbossa", leitura("dor", {isq:["infra"], infraV1:"sim", qrs8:"largo", v1:"bre", sg1:"nao", sg2:"sim", sgST:"1", sgS:"9"}, ["padroes"])); // Sgarbossa já abriu
  naoDispara("bre-infra-v1v3-sgarbossa", leitura("disp", {isq:["infra"], infraV1:"nao", qrs8:"largo", v1:"bre"}, ["padroes"]));
  naoDispara("bre-infra-v1v3-sgarbossa", leitura("disp", {isq:["infra"], infraV1:"sim", qrs8:"largo", v1:"brd"}, ["padroes"]));
});
test("bloqueio-alteracao-secundaria", () => {
  const brd = IA.avaliar(leitura("disp", {isq:["tinv"], qrs8:"largo", v1:"brd"}, ["padroes"])).find(x => x.id === "bloqueio-alteracao-secundaria");
  assert.match(brd.titulo, /BRD/);
  const bre = IA.avaliar(leitura("rotina", {isq:["infra"], infraV1:"nao", qrs8:"largo", v1:"bre"}, ["padroes"])).find(x => x.id === "bloqueio-alteracao-secundaria");
  assert.match(bre.titulo, /BRE/);
  naoDispara("bloqueio-alteracao-secundaria", leitura("dor", {isq:["tinv"], qrs8:"largo", v1:"brd"}, ["padroes"]));          // dor: não acalmar
  naoDispara("bloqueio-alteracao-secundaria", leitura("disp", {isq:["tinv"]}, ["padroes"]));                                 // QRS estreito
  naoDispara("bloqueio-alteracao-secundaria", leitura("disp", {isq:["infra"], infraV1:"sim", qrs8:"largo", v1:"bre"}, ["padroes"])); // vai para a regra do Sgarbossa
});
test("qt-longo-risco", () => {
  dispara("qt-longo-risco", leitura("sincope", {fc:75, qtQuad:"12"}));                 // QTc 537, síncope
  dispara("qt-longo-risco", leitura("rotina", {fc:75, qtQuad:"12"}));                  // > 500 em qualquer queixa
  const a = IA.avaliar(leitura("palp", {fc:72, qtQuad:"11.5", sexo:"m"})).find(x => x.id === "qt-longo-risco"); // 505? confere
  assert.ok(a);
  naoDispara("qt-longo-risco", leitura("rotina", {fc:72, qtQuad:"11", sexo:"m"}));      // longo (491), rotina, abaixo de 500
  naoDispara("qt-longo-risco", leitura("sincope", {}));                                 // QTc normal
  // QRS estreito: atenção, sem ressalva
  const e = IA.avaliar(leitura("rotina", {fc:75, qtQuad:"12"})).find(x => x.id === "qt-longo-risco");
  assert.equal(e.nivel, "atencao"); assert.equal(e.titulo, "QTc acima de 500 ms"); assert.doesNotMatch(e.texto, /cautela/);
  // QRS largo (documento do Dr. Vitor, etapa 9): desce para info e abre com a ressalva
  const l = IA.avaliar(leitura("rotina", {fc:75, qtQuad:"12", qrs8:"largo", v1:"brd"})).find(x => x.id === "qt-longo-risco");
  assert.equal(l.nivel, "info"); assert.match(l.titulo, /QRS largo/);
  assert.match(l.texto, /^O QRS é largo.*interprete o QTc com cautela\./); assert.match(l.pergunta_para_ia, /com QRS largo/);
  const ls = IA.avaliar(leitura("sincope", {fc:75, qtQuad:"12", qrs8:"largo", v1:"bre"})).find(x => x.id === "qt-longo-risco");
  assert.equal(ls.nivel, "info"); assert.match(ls.texto, /Na síncope/);
});
test("hipercalemia-qrs-largo", () => {
  dispara("hipercalemia-qrs-largo", leitura("metab", {qrs8:"largo", v1:"duvida", esp:["hiperk"], hk1:"nao", hk2:"nao"}));
  dispara("hipercalemia-qrs-largo", leitura("metab", Object.assign({}, NS, {fc:40, temP:"nao", qrs:"estreito", esp:["hiperk"], hk1:"nao", hk2:"nao"}), ["extra", "qrs8"]));
  naoDispara("hipercalemia-qrs-largo", leitura("metab", {qrs8:"largo", v1:"duvida", esp:["hiperk"], hk1:"sim", hk2:"nao"})); // o app já mostra compatível
  naoDispara("hipercalemia-qrs-largo", leitura("metab", {esp:["hiperk"], hk1:"nao", hk2:"nao"}));                            // QRS estreito, com P
  naoDispara("hipercalemia-qrs-largo", leitura("metab", {qrs8:"largo", v1:"duvida", esp:["hiperk"], hk1:"naosei", hk2:"nao"})); // ainda não respondeu
});
test("hipocalemia-qt-onda-u", () => {
  dispara("hipocalemia-qt-onda-u", leitura("metab", {fc:75, qtQuad:"12", esp:["hipok"], hpk1:"sim", hpk2:"sim"}));
  naoDispara("hipocalemia-qt-onda-u", leitura("metab", {esp:["hipok"], hpk1:"sim", hpk2:"sim"}));
  naoDispara("hipocalemia-qt-onda-u", leitura("metab", {fc:75, qtQuad:"12", esp:["hipoca"]}));
});
test("t-apiculada-contexto", () => {
  const a = IA.avaliar(leitura("metab", {padroes:["hiper"]})).find(x => x.id === "t-apiculada-contexto");
  assert.equal(a.etapa, 7); assert.match(a.titulo, /potássio/);
  const b = IA.avaliar(leitura("dor", {esp:["hiperk"], hk1:"sim", hk2:"nao"})).find(x => x.id === "t-apiculada-contexto");
  assert.equal(b.etapa, 10); assert.match(b.titulo, /oclusão/);
  naoDispara("t-apiculada-contexto", leitura("dor", {padroes:["hiper"]}));
  naoDispara("t-apiculada-contexto", leitura("metab", {esp:["hiperk"], hk1:"sim", hk2:"nao"}));
});
test("dispneia-achados-tep", () => {
  const a = IA.avaliar(leitura("disp", {fc:112, di:"neg", avf:"pos", qrs8:"largo", v1:"brd"})).find(x => x.id === "dispneia-achados-tep");
  assert.match(a.texto, /taquicardia sinusal/); assert.match(a.texto, /BRD/);
  naoDispara("dispneia-achados-tep", leitura("disp", {fc:112, esp:["tep"], s1q3t3:"nao"}));     // TEP já marcado
  naoDispara("dispneia-achados-tep", leitura("disp", {}));                                       // sem achado
  naoDispara("dispneia-achados-tep", leitura("rotina", {fc:112}));
  naoDispara("dispneia-achados-tep", leitura("disp", {fc:112}, ["esp"], 10));                    // etapa 10 ainda sem resposta
});

/* ---------- conteúdo: fonte e frases proibidas ---------- */
const TITULOS = Object.fromEntries(readFileSync(join(aqui, "../aulas/aulas.tsv"), "utf8").trim().split("\n").slice(1)
  .map(l => l.split("\t")).map(c => [Number(c[0]), c[4].replace(/^"|"$/g, "")]));
const aulasDe = s => [...s.matchAll(/Aula (\d+) · ([^;]+)/g)].map(m => [Number(m[1]), m[2].trim()]);
test("toda regra e todo texto por etapa citam aula que existe, com o título certo", () => {
  const fontes = IA.REGRAS.map(g => g.aula).concat(Object.values(IA.PORQUE).map(p => p.aula));
  for (const f of fontes){
    const as = aulasDe(f);
    assert.ok(as.length, "sem aula: " + f);
    for (const [n, t] of as) assert.equal(t, TITULOS[n], `aula ${n}`);
  }
});
test("\"por que isso importa?\" da etapa 2: área inativa lateral alta (aula 37)", () => {
  assert.match(IA.PORQUE[2].texto, /área inativa lateral alta/);
});
test("entre 10 e 20 regras, ids únicos", () => {
  const n = IA.REGRAS.length;
  assert.ok(n >= 10 && n <= 20, "regras: " + n);
  assert.equal(new Set(IA.REGRAS.map(g => g.id)).size, n);
});
test("\"por que isso importa?\" cobre as 11 etapas com 2 a 4 frases", () => {
  for (let e = 1; e <= 11; e++){
    const p = IA.PORQUE[e];
    assert.ok(p && p.titulo && p.texto && p.aula, "etapa " + e);
    const frases = p.texto.split(/(?<=[.!?])\s+/).length;
    assert.ok(frases >= 2 && frases <= 4, `etapa ${e}: ${frases} frases`);
  }
});
test("nenhum texto usa frase listada em aulas/duvidas-vitor.md", () => {
  const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const duvidas = [...readFileSync(join(aqui, "../aulas/duvidas-vitor.md"), "utf8").matchAll(/^> "(.+)"\s*$/gm)].map(m => norm(m[1]));
  assert.ok(duvidas.length >= 50, "leu " + duvidas.length + " frases");
  const leituras = [leitura("sincope", {fc:44, isq:["supra"], supraDist:"sim", terr:["inf"], qtQuad:"14"}, ["padroes"]),
    leitura("dor", {padroes:["wellens", "dewinter", "aslanger", "avr", "hiper"], esp:["hiperk"], hk1:"sim", hk2:"nao"}),
    leitura("palp", Object.assign({}, NS, {reg:"irregular", fc:190, qrs:"largo", v1:"duvida"}), ["extra", "qrs8"]),
    leitura("disp", {fc:112, di:"neg", avf:"pos", qrs8:"largo", v1:"brd", isq:["tinv"]}, ["padroes"]),
    leitura("palp", {fc:75, qtQuad:"12", qrs8:"largo", v1:"brd", isq:["supra"], supraDist:"difuso"}, ["padroes"]),
    leitura("palp", {fc:148})];
  const textos = Object.values(IA.PORQUE).map(p => p.texto).concat(leituras.flatMap(l => IA.avaliar(l).map(a => a.texto + " " + a.titulo)));
  for (const t of textos){
    const n = norm(t);
    for (const d of duvidas) assert.ok(!n.includes(d), `usa frase em dúvida: "${d}"`);
  }
});
