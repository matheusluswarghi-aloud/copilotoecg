"use strict";
/* Copiloto de ECG — tutora que discorda e "por que isso importa?" (Copiloto IA, 24/09/2026)
   Módulo puro, sem DOM e sem rede: recebe a leitura no formato do app ({motivo, passo, r}) e devolve
   alertas. Não diagnostica: cobra o que não pode passar, com a aula de origem.
   Cada regra tem base nas aulas (aulas/transcricoes) ou no documento do Dr. Vitor (19/09).
   As funções de apoio espelham as de app.js (sinusal, eixo, arritmia, qt...) sobre um r qualquer:
   se a regra mudar lá, mudar aqui também (os testes cobrem os casos do arquivo-ouro).
   No navegador vira window.IARegras; no Node, module.exports. */
(function(raiz){

const MS_POR_MM = 40; // papel a 25 mm/s

/* ---------- espelho do raciocínio do app.js ---------- */
function sinusal(r){
  if (r.ritmo === "sim") return true;
  if (r.ritmo === "nao") return false;
  if (r.ritmo === "duvida" && r.wizFim) return r.wizFim === "sinusal";
  return null;
}
function eixo(r){
  if (!r.di || !r.avf) return null;
  if (r.di === "pos" && r.avf === "pos") return "normal";
  if (r.di === "pos" && r.avf === "neg"){
    if (!r.dii) return null;
    return r.dii === "pos" ? "normal" : "esquerda";
  }
  if (r.di === "neg" && r.avf === "pos") return "direita";
  return "extremo";
}
function faixaFC(r){ const f = r.fc; if (!f) return null; return f > 100 ? "alta" : f < 50 ? "baixa" : "normal"; }
const larguraQRS = r => r.qrs || r.qrs8 || null;
function num(r, k){ const v = parseFloat(String(r[k] ?? "").replace(",", ".")); return isFinite(v) ? v : null; }
const abreSgarbossa = (r, motivo) => larguraQRS(r) === "largo" && r.v1 === "bre" && (motivo === "dor" || (r.isq || []).includes("supra"));
function qt(r){
  const q = num(r, "qtQuad"), fc = r.fc;
  if (q === null || q <= 0 || !fc || !r.sexo) return null;
  const qtMs = Math.round(q * MS_POR_MM), qtc = Math.round(qtMs / Math.sqrt(60 / fc));
  const longo = r.sexo === "m" ? qtc > 450 : qtc >= 460, curto = qtc < 350;
  return {qtMs, qtc, longo, curto};
}
/* só o título do resultado da etapa 6 (arritmia() do app, sem construir tela); null enquanto falta resposta */
function arritmia(r){
  const fc = r.fc, reg = r.reg, sin = sinusal(r), faixa = faixaFC(r);
  if (sin === null || !fc || !reg) return null;
  if (sin){
    if (!r.extra) return null;
    return faixa === "alta" ? "Taquicardia sinusal" : faixa === "baixa" ? "Bradicardia sinusal" : "Ritmo sinusal";
  }
  if (faixa === "alta"){
    if (!r.qrs) return null;
    if (r.qrs === "estreito" && reg === "regular"){
      if (!r.tq) return null;
      return {flutter:"Flutter atrial", patrial:"Taquicardia atrial", nenhum:"Taquicardia supraventricular"}[r.tq];
    }
    if (r.qrs === "estreito"){
      if (!r.pind) return null;
      return r.pind === "nao" ? "Fibrilação atrial de alta resposta ventricular" : "Taquicardia irregular com ondas P individualizadas";
    }
    return reg === "regular" ? "Taquicardia regular de QRS largo" : "Taquicardia irregular de QRS largo";
  }
  if (faixa === "baixa"){
    if (!r.temP) return null;
    if (r.temP === "nao"){
      if (reg === "irregular") return "Considerar fibrilação atrial com baixa resposta ventricular";
      if (!r.qrs) return null;
      return r.qrs === "estreito" ? "Considerar escape juncional" : "Considerar escape ventricular";
    }
    if (!r.rel) return null;
    if (r.rel === "nao") return "BAV total";
    if (r.rel === "todas") return "Considerar ritmo atrial ectópico";
    if (!r.bav) return null;
    return {m1:"BAV de 2º grau Mobitz I", m2:"BAV de 2º grau Mobitz II", "21":"BAV 2:1", avancado:"BAV avançado"}[r.bav];
  }
  if (reg === "irregular"){
    if (!r.pind) return null;
    return r.pind === "nao" ? "Padrão compatível com fibrilação atrial" : "Ritmo irregular com atividade atrial identificável";
  }
  if (!r.pns) return null;
  if (r.pns === "sim") return "Considerar ritmo atrial ectópico";
  if (!r.qrs) return null;
  return r.qrs === "estreito" ? "Considerar ritmo juncional" : "Considerar ritmo idioventricular";
}
const avaliouSobrecarga = r => !!(r.amp8 && r.amp8 !== "nao");
function svdSugere(r){
  const itens = new Set((r.svd || []).filter(x => x !== "eixo"));
  if (eixo(r) === "direita") itens.add("eixo");
  return itens.size >= 2;
}
/* os quatro achados da etapa 10 (TEP) que o app recupera sozinho, sem o S1Q3T3 */
function tepAchados(r){
  return [
    ["taquicardia sinusal", arritmia(r) === "Taquicardia sinusal"],
    ["desvio do eixo para a direita", eixo(r) === "direita"],
    ["BRD", larguraQRS(r) === "largo" && r.v1 === "brd"],
    ["achados sugestivos de SVD/strain de VD", avaliouSobrecarga(r) && svdSugere(r)]
  ].filter(x => x[1]).map(x => x[0]);
}
const lista = xs => xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " e " + xs[xs.length - 1];
/* a queixa do motivo do exame, para a pergunta que vai à IA ("Marquei X num paciente com …") */
const QUEIXA = {dor:"num paciente com dor torácica", palp:"num paciente com palpitação", bradi:"num paciente com bradicardia",
  sincope:"num paciente com síncope", disp:"num paciente com dispneia", metab:"num paciente com alteração eletrolítica ou metabólica",
  rotina:"num paciente assintomático, em exame de rotina"};
const NOME_PADRAO = {wellens:"padrão de Wellens", dewinter:"padrão de de Winter", aslanger:"padrão de Aslanger", avr:"infra difuso de ST com supra em aVR", hiper:"ondas T hiperagudas"};

/* ---------- as regras ----------
   gatilho: o que a regra olha, em português, para a tabela do Dr. Vitor (tutora.md).
   testar(c) devolve null ou {titulo, texto, pergunta, nivel?, etapa?}. */
const REGRAS = [
  { id:"eletrodos-trocados", etapa:5, nivel:"atencao",
    gatilho:"Seguiu com possível troca de eletrodos (etapa 2) e depois marcou desvio do eixo para a direita, desvio extremo ou ritmo não sinusal",
    aula:"Aula 37 · Quando o problema é quem fez o exame",
    testar(c){
      const r = c.r;
      if (!(r.elet === "nao" && r.eletSeguir === "sim")) return null;
      const e = eixo(r), desvio = e === "direita" || e === "extremo", naoSin = sinusal(r) === false;
      if (!desvio && !naoSin) return null;
      const marcou = lista([desvio ? (e === "direita" ? "desvio do eixo para a direita" : "desvio extremo do eixo") : "", naoSin ? "ritmo não sinusal" : ""].filter(Boolean));
      return { etapa:desvio ? 5 : 3,
        titulo:"A troca de eletrodos pode explicar o que você marcou",
        texto:`Você seguiu com suspeita de troca de eletrodos e marcou ${marcou}. Na aula 37, P e QRS negativos em DI, aVR positivo e precordiais progredindo normalmente são troca dos eletrodos dos braços, não doença do paciente: o eixo e a P "não sinusal" podem ser só efeito da troca. Se puder, corrija os eletrodos e repita o ECG antes de seguir.`,
        pergunta:`Seguimos com possível troca de eletrodos e marquei ${marcou}. Como eu separo o que é da troca do que é do paciente?` };
    }},

  { id:"bradicardia-sinusal-p-conduz", etapa:6, nivel:"info",
    gatilho:"Ritmo marcado como sinusal com FC abaixo de 50 bpm (vira atenção se a queixa for bradicardia ou síncope)",
    aula:"Aula 68 · Síncope; Aula 54 · Bloqueio AV; Aula 10 · Identificando o ritmo sinusal",
    testar(c){
      const r = c.r;
      if (!(sinusal(r) === true && r.fc && r.fc < 50)) return null;
      return { nivel:["bradi", "sincope"].includes(c.motivo) ? "atencao" : "info",
        titulo:"Bradicardia sinusal: toda P gera QRS?",
        texto:`Antes de fechar como bradicardia sinusal, confira no DII longo se toda onda P gera um QRS. Na aula 68, a P bloqueada estava escondida dentro da onda T (a T que parecia diferente das outras, mais apiculada) e o ritmo era um BAV total. No BAV 2:1, uma P conduz e a seguinte bloqueia (aula 54).`,
        pergunta:`Marquei bradicardia sinusal com FC ${r.fc} bpm. Como eu confiro se não tem P bloqueada escondida na onda T?` };
    }},

  { id:"fa-com-bavt", etapa:6, nivel:"atencao",
    gatilho:"Bradicardia não sinusal, sem onda P, ritmo regular e FC abaixo de 40 bpm",
    aula:"Aula 54 · Bloqueio AV; Aula 53 · Introdução bradicardias",
    testar(c){
      const r = c.r;
      if (!(sinusal(r) === false && faixaFC(r) === "baixa" && r.temP === "nao" && r.reg === "regular" && r.fc < 40)) return null;
      return { titulo:"Regular, sem P e abaixo de 40: lembre da FA com BAV total",
        texto:`Na aula 54, a FA de baixa resposta que fica regular, sem onda P, perto de 30 bpm, é FA com BAV total, e confunde com ritmo juncional, que costuma bater entre 40 e 60 (aula 53). Paciente com FA conhecida, ou em uso de betabloqueador ou amiodarona? Olhe a linha de base atrás da atividade da FA.`,
        pergunta:`Ritmo regular, sem onda P, FC ${r.fc} bpm. Como diferencio escape juncional de FA com BAV total?` };
    }},

  { id:"taquicardia-sinusal-qrs-largo", etapa:8, nivel:"atencao",
    gatilho:"Ritmo marcado como sinusal, FC acima de 100 bpm e QRS largo na etapa 8",
    aula:"Aula 50 · Taquicardia ventricular; Aula 47 · Introdução a taquiarritmias",
    testar(c){
      const r = c.r;
      if (!(sinusal(r) === true && r.fc > 100 && larguraQRS(r) === "largo")) return null;
      return { titulo:"Taquicardia de QRS largo: a P vem antes de cada QRS?",
        texto:`Você marcou taquicardia sinusal e o QRS saiu largo. Taquicardia de QRS largo só é sinusal com bloqueio de ramo se houver onda P precedendo cada QRS. Sem P antes do QRS, a aula 50 é clara: conduzir como taquicardia ventricular até que se prove o contrário. Volte ao DII longo e confira.`,
        pergunta:`Marquei ritmo sinusal com FC ${r.fc} bpm e QRS largo. Como confirmo que é taquicardia sinusal com bloqueio de ramo e não TV?` };
    }},

  { id:"fc-150-flutter", etapa:6, nivel:"info",
    gatilho:"Taquicardia regular de QRS estreito com FC entre 145 e 155 bpm fechada como taquicardia sinusal, atrial ou supraventricular",
    aula:"Aula 48 · Fibrilação atrial e flutter atrial",
    testar(c){
      const r = c.r, t = arritmia(r);
      if (!(r.reg === "regular" && r.fc >= 145 && r.fc <= 155 && larguraQRS(r) !== "largo")) return null;
      if (!["Taquicardia sinusal", "Taquicardia supraventricular", "Taquicardia atrial"].includes(t)) return null;
      return { titulo:"Perto de 150 bpm e regular: procurou flutter?",
        texto:`Na aula 48, taquiarritmia regular batendo a 150 "cravado" faz pensar em flutter atrial 2:1. Na prática as ondas F nem sempre ficam claras: antes de fechar em ${t.toLowerCase()}, procure o dente de serrote, mais bem visto na parede inferior (DII, DIII e aVF) e às vezes também em V1.`,
        pergunta:`Taquicardia regular de QRS estreito a ${r.fc} bpm. Como eu procuro ondas F de flutter 2:1?` };
    }},

  { id:"fa-pre-excitada", etapa:6, nivel:"atencao",
    gatilho:"Resultado da etapa 6: taquicardia irregular de QRS largo",
    aula:"Aula 60 · Síndrome de Wolff-Parkinson-White; Aula 47 · Introdução a taquiarritmias",
    testar(c){
      if (arritmia(c.r) !== "Taquicardia irregular de QRS largo") return null;
      return { titulo:"Irregular e largo: se for FA pré-excitada, nada de bloquear o nó AV",
        texto:`Uma das hipóteses é a FA pré-excitada: irregular, QRS largo que muda de forma batimento a batimento, às vezes com onda delta visível, e que se confunde com TV polimórfica. Na aula 60 o Dr. Vitor avisa: nesse paciente, nenhuma medicação que bloqueie o nó AV, como adenosina ou betabloqueador, pelo risco de degenerar em fibrilação ventricular.`,
        pergunta:"Taquicardia irregular de QRS largo. Como diferencio FA pré-excitada de TV polimórfica no traçado?" };
    }},

  { id:"sincope-conducao", etapa:6, nivel:"atencao",
    gatilho:"Queixa de síncope com ritmo marcado como sinusal (o app não mede PR nem pausas)",
    aula:"Aula 41 · Olhar para o ECG sem olhar para o paciente; Aula 54 · Bloqueio AV; Aula 90 · Palpitação e desmaio",
    testar(c){
      if (!(c.motivo === "sincope" && sinusal(c.r) === true && c.r.fc)) return null;
      return { titulo:"Síncope: o que o app não mede, você confere",
        texto:`Na síncope, mais do que isquemia, o Dr. Vitor procura bloqueio AV, pausas, taquiarritmias e QT longo (aula 41). O app não mede o PR: confira no DII longo se toda P gera QRS e se o PR fica entre 3 e 5 quadradinhos (acima disso, BAV de 1º grau, aula 54). Procure também pausas: acima de 2 segundos já pode dar sintoma, acima de 3 costuma dar (aula 90).`,
        pergunta:"Paciente com síncope e ritmo sinusal no ECG. O que mais eu preciso procurar no traçado?" };
    }},

  { id:"sincope-supra-brugada", etapa:7, nivel:"atencao",
    gatilho:"Queixa de síncope ou palpitação com supra de ST marcado na etapa 7",
    aula:"Aula 59 · Síndromes hereditárias arritmogênicas; Aula 93 · Síncope em jovem",
    testar(c){
      if (!(["sincope", "palp"].includes(c.motivo) && (c.r.isq || []).includes("supra"))) return null;
      const sinc = c.motivo === "sincope";
      return { titulo:sinc ? "Supra em quem desmaiou: olhe V1 e V2" : "Supra em quem tem palpitação: olhe V1 e V2",
        texto:`Se o supra está em V1 e V2, com mais de 2 mm, e termina em onda T invertida, pense em síndrome de Brugada tipo 1 antes de isquemia (aulas 59 e 93). ${sinc
          ? "Pergunte se a síncope foi noturna ou sem pródromo, se houve febre como gatilho e se há morte súbita na família."
          : "Pergunte se já houve síncope, principalmente noturna ou sem pródromo, se a febre foi gatilho e se há morte súbita na família."}`,
        pergunta:`${sinc ? "Síncope" : "Palpitação"} com supra de ST em V1 e V2. Como diferencio padrão de Brugada de isquemia?` };
    }},

  { id:"palpitacao-pre-excitacao", etapa:6, nivel:"info",
    gatilho:"Queixa de palpitação com ritmo marcado como sinusal",
    aula:"Aula 60 · Síndrome de Wolff-Parkinson-White",
    testar(c){
      if (!(c.motivo === "palp" && sinusal(c.r) === true && c.r.fc)) return null;
      return { titulo:"Palpitação em ritmo sinusal: olhe o PR e o começo do QRS",
        texto:`PR curto, com a P quase colada no QRS e uma "barriguinha" no início dele (onda delta), é pré-excitação. Em quem tem palpitação ou síncope, isso é Wolff-Parkinson-White, e o risco está na arritmia que ele pode fazer (aula 60). O app não mede o PR: essa conferência é sua.`,
        pergunta:"Palpitação e ECG em ritmo sinusal. Como reconheço PR curto e onda delta?" };
    }},

  { id:"supra-inferior-vd", etapa:7, nivel:"atencao",
    gatilho:"Supra de ST territorial marcado na parede inferior",
    aula:"Aula 40 · Indo além das 12 derivações; Aula 43 · Supra de ST; Aula 76 · Dor torácica e bradicardia",
    testar(c){
      const r = c.r;
      if (!((r.isq || []).includes("supra") && r.supraDist === "sim" && (r.terr || []).includes("inf"))) return null;
      return { titulo:"Supra inferior: procure infarto de ventrículo direito",
        texto:`As pistas das aulas 40 e 43: supra de DIII maior que o de DII, V1 isoelétrico ou com supra, infra em V2; na clínica, bradicardia, hipotensão, jugular túrgida e pulmão limpo. Quem confirma são V3R e V4R. O VD infartado depende da pré-carga: o que reduz a pré-carga pode levar ao colapso hemodinâmico (aula 40). Com o VD acometido, a bradiarritmia é mais frequente (aula 76).`,
        pergunta:"Supra de parede inferior. Quando e como eu faço V3R e V4R?" };
    }},

  { id:"alto-risco-oclusao", etapa:7, nivel:"atencao",
    gatilho:"Padrão de de Winter, de Aslanger ou T hiperaguda marcado na checagem de alto risco",
    aula:"Aula 45 · Padrões de alto risco",
    testar(c){
      const p = (c.r.padroes || []).filter(x => ["dewinter", "aslanger", "hiper"].includes(x));
      if (!p.length) return null;
      const frases = [];
      if (p.includes("dewinter")) frases.push("de Winter é equivalente de infarto com supra de parede anterior, por oclusão da DA proximal, e é conduzido como infarto com supra");
      if (p.includes("aslanger")) frases.push("Aslanger é equivalente de infarto com supra de parede inferior em doença multiarterial");
      if (p.includes("hiper")) frases.push("a T hiperaguda, em dor típica de poucos minutos, é a primeira manifestação da oclusão: conduz-se como síndrome coronariana com supra e o ECG se repete em 15 a 30 minutos, porque via de regra vira supra");
      return { titulo:"Padrão de alto risco: a mesma urgência do supra",
        texto:`Você marcou ${lista(p.map(x => NOME_PADRAO[x]))}. Na aula 45: ${frases.join("; ")}. Com clínica compatível, a ausência do supra clássico não tira a urgência.`,
        pergunta:`Marquei ${lista(p.map(x => NOME_PADRAO[x]))} ${QUEIXA[c.motivo] || "neste paciente"}. O que o Dr. Vitor ensina a fazer?` };
    }},

  { id:"wellens-nao-liberar", etapa:7, nivel:"atencao",
    gatilho:"Padrão de Wellens marcado na checagem de alto risco",
    aula:"Aula 45 · Padrões de alto risco; Aula 73 · Dor precordial que já melhorou",
    testar(c){
      if (!(c.r.padroes || []).includes("wellens")) return null;
      return { titulo:"Wellens: sem dor não quer dizer liberar",
        texto:`Wellens marca suboclusão da descendente anterior e costuma aparecer depois que a dor passou, às vezes com troponina normal. O risco, diz a aula 45, é liberar e o paciente infartar em casa. Mesmo assintomático: internar, conduzir como síndrome coronariana aguda e levar ao cateterismo o mais precoce possível (aulas 45 e 73).`,
        pergunta:"Marquei padrão de Wellens num paciente que já está sem dor. Como conduzir?" };
    }},

  { id:"infra-difuso-avr", etapa:7, nivel:"atencao",
    gatilho:"Infra difuso de ST com supra em aVR marcado na checagem de alto risco",
    aula:"Aula 45 · Padrões de alto risco; Aula 44 · Infra de ST e inversão de onda T",
    testar(c){
      if (!(c.r.padroes || []).includes("avr")) return null;
      return { titulo:"Infra difuso com supra de aVR: isquemia circunferencial",
        texto:`Na aula 45, esse desenho aponta para lesão grave do tronco da coronária esquerda ou da DA proximal com doença multiarterial. O mesmo padrão aparece por desbalanço entre oferta e demanda, na taquicardia ou na sepse, e aí melhora ao controlar a causa (aulas 44 e 45). Quem separa os dois é a clínica.`,
        pergunta:"Infra difuso com supra em aVR. Como separo isquemia circunferencial de desbalanço por taquicardia?" };
    }},

  { id:"bre-infra-v1v3-sgarbossa", etapa:8, nivel:"atencao",
    gatilho:"BRE com infra de ST predominante em V1–V3 marcado na etapa 7, sem dor torácica nem supra (o Sgarbossa não abriu)",
    aula:"Aula 45 · Padrões de alto risco",
    testar(c){
      const r = c.r;
      if (!(larguraQRS(r) === "largo" && r.v1 === "bre" && (r.isq || []).includes("infra") && r.infraV1 === "sim" && !abreSgarbossa(r, c.motivo))) return null;
      return { titulo:"BRE com infra em V1–V3 não é o esperado",
        texto:`No BRE, o esperado em V1–V3 é o ST discordante do QRS negativo, para cima. Infra concordante de 1 mm ou mais em V1–V3 é critério de Sgarbossa e, na aula 45, equivalente de infarto com supra. O app só abre o Sgarbossa com dor torácica ou supra marcado: se houver qualquer equivalente anginoso, trate esse infra como achado de alto risco.`,
        pergunta:"BRE com infra de ST em V1 a V3. Isso entra nos critérios de Sgarbossa?" };
    }},

  { id:"bloqueio-alteracao-secundaria", etapa:8, nivel:"info",
    gatilho:"BRD com T invertida marcada, ou BRE com infra/T invertida marcados, fora de dor torácica",
    aula:"Aula 55 · Dispneia e bloqueio de ramos; Aula 44 · Infra de ST e inversão de onda T",
    testar(c){
      const r = c.r, m = r.isq || [];
      if (c.motivo === "dor" || larguraQRS(r) !== "largo") return null;
      if (r.v1 === "brd" && m.includes("tinv")) return { titulo:"BRD: T negativa em V1–V3 é do bloqueio",
        texto:`No BRD, ondas T negativas de V1 a V3 são o padrão esperado e não indicam isquemia (aula 55). Se a inversão que você marcou na etapa 7 está só em V1–V3, ela é do bloqueio; se aparece fora dessas derivações, aí vale olhar de novo.`,
        pergunta:"BRD com T invertida. Como sei se a inversão é do bloqueio ou isquêmica?" };
      if (r.v1 === "bre" && (m.includes("tinv") || (m.includes("infra") && r.infraV1 !== "sim"))) return { titulo:"BRE: ST e T discordantes são do bloqueio",
        texto:`No BRE, onde o QRS é positivo (DI, aVL, V5 e V6) o esperado é infra de ST com T invertida, discordante do QRS. Isso é alteração do bloqueio, não isquemia (aulas 44 e 55). Se o paciente tiver dor torácica, quem decide é o Sgarbossa, não o infra.`,
        pergunta:"BRE com infra e T invertida nas laterais. Isso é isquemia ou do bloqueio?" };
      return null;
    }},

  { id:"qt-longo-risco", etapa:9, nivel:"atencao",
    gatilho:"QTc prolongado acima de 500 ms, ou prolongado com queixa de síncope ou palpitação (com QRS largo, desce para info e abre com a ressalva do documento do Dr. Vitor)",
    aula:"Aula 59 · Síndromes hereditárias arritmogênicas; Aula 41 · Olhar para o ECG sem olhar para o paciente; documento do Dr. Vitor, etapa 9",
    testar(c){
      const q = qt(c.r);
      if (!q || !q.longo) return null;
      const acima500 = q.qtc > 500, queixa = ["sincope", "palp"].includes(c.motivo), largo = larguraQRS(c.r) === "largo";
      if (!acima500 && !queixa) return null;
      const partes = [];
      if (largo) partes.push("O QRS é largo, e o alargamento do QRS pode prolongar o QT pelo aumento da duração da despolarização ventricular: interprete o QTc com cautela.");
      if (acima500) partes.push(`QTc de ${q.qtc} ms: acima de 500 ms o risco de torsades de pointes é alto (aula 59).`);
      if (queixa) partes.push(`Na ${c.motivo === "sincope" ? "síncope" : "palpitação"}, QT longo é uma das causas arrítmicas a procurar (aula 41).`);
      partes.push("Revise o que alonga o QT: amiodarona, macrolídeos como azitromicina, haloperidol, álcool, cocaína, hipocalemia e hipocalcemia (aula 59).");
      // com QRS largo o número não fecha sozinho: o aviso desce para info e começa pela ressalva
      return { nivel:largo ? "info" : "atencao",
        titulo:largo ? "QTc longo com QRS largo: interprete com cautela" : acima500 ? "QTc acima de 500 ms" : "QT longo com queixa arrítmica",
        texto:partes.join(" "),
        pergunta:`QTc de ${q.qtc} ms${largo ? " com QRS largo" : ""}${queixa ? " em paciente com " + (c.motivo === "sincope" ? "síncope" : "palpitação") : ""}. O que eu preciso revisar?` };
    }},

  { id:"hipercalemia-qrs-largo", etapa:10, nivel:"atencao",
    gatilho:"Suspeita de hipercalemia, T apiculada e padrão sinusoidal respondidos sem 'sim', mas QRS largo ou bradicardia sem onda P",
    aula:"Aula 58 · Distúrbios eletrolíticos",
    testar(c){
      const r = c.r;
      if (!(r.esp || []).includes("hiperk")) return null;
      if (!(["sim", "nao"].includes(r.hk1) && ["sim", "nao"].includes(r.hk2)) || r.hk1 === "sim" || r.hk2 === "sim") return null;
      const largo = larguraQRS(r) === "largo", semP = r.temP === "nao";
      if (!largo && !semP) return null;
      const viu = lista([largo ? "QRS largo" : "", semP ? "bradicardia sem onda P" : ""].filter(Boolean));
      return { titulo:"Hipercalemia não é só T apiculada",
        texto:`Você não marcou T apiculada nem padrão sinusoidal, mas o traçado tem ${viu}. Na aula 58, com o potássio subindo, o QRS alarga, o PR aumenta e a P achata até sumir, antes do padrão sinusoidal. Com suspeita clínica de hipercalemia, isso também conta: correlacione com o potássio.`,
        pergunta:`Suspeita de hipercalemia com ${viu}, sem T apiculada. Isso pode ser do potássio?` };
    }},

  { id:"hipocalemia-qt-onda-u", etapa:10, nivel:"info",
    gatilho:"Suspeita de hipocalemia com QTc prolongado",
    aula:"Aula 58 · Distúrbios eletrolíticos",
    testar(c){
      const q = qt(c.r);
      if (!((c.r.esp || []).includes("hipok") && q && q.longo)) return null;
      return { titulo:"QT longo na hipocalemia: T ou onda U?",
        texto:`Na hipocalemia, a onda T se funde com a onda U e dá a impressão de um QT muito aumentado (aula 58). Confira se a sua medida terminou no fim da T ou emendou na U. O risco arrítmico da hipocalemia existe dos dois jeitos.`,
        pergunta:`Suspeita de hipocalemia e QTc de ${q.qtc} ms. Como separo o fim da onda T da onda U?` };
    }},

  { id:"t-apiculada-contexto", etapa:7, nivel:"info",
    gatilho:"T hiperaguda marcada fora de dor torácica, ou T apiculada da hipercalemia marcada em quem veio por dor torácica",
    aula:"Aula 45 · Padrões de alto risco; Aula 74 · Faltou hemodiálise; Aula 58 · Distúrbios eletrolíticos",
    testar(c){
      const r = c.r;
      if ((r.padroes || []).includes("hiper") && c.motivo !== "dor") return { etapa:7,
        titulo:"T alta e apiculada sem dor torácica: pense no potássio",
        texto:`A T hiperaguda da oclusão aparece na dor típica recente e respeita a parede; a da hipercalemia costuma ser difusa e de base mais estreita (aulas 45 e 74). Sem dor, pense no potássio: renal crônico, diálise perdida, IECA, BRA ou espironolactona (aula 58). Se for o caso, marque hipercalemia na etapa 10.`,
        pergunta:"T alta e apiculada num paciente sem dor torácica. Como diferencio T hiperaguda de hipercalemia?" };
      if ((r.esp || []).includes("hiperk") && r.hk1 === "sim" && c.motivo === "dor") return { etapa:10,
        titulo:"Dor torácica com T apiculada: potássio ou oclusão?",
        texto:`Antes de fechar em hipercalemia, lembre que a T hiperaguda é a primeira manifestação da oclusão coronariana, nos primeiros minutos, e respeita a parede; a da hipercalemia costuma ser difusa (aula 45). Quem decide é o contexto clínico.`,
        pergunta:"Dor torácica e T apiculada. Como separo T hiperaguda de hipercalemia?" };
      return null;
    }},

  { id:"dispneia-achados-tep", etapa:10, nivel:"info",
    gatilho:"Queixa de dispneia, etapa 10 respondida sem TEP, e o traçado já tem taquicardia sinusal, eixo para a direita, BRD ou sobrecarga de VD",
    aula:"Aula 57 · ECG no TEP; Aula 41 · Olhar para o ECG sem olhar para o paciente",
    testar(c){
      const r = c.r, esp = r.esp || [];
      if (!(c.motivo === "disp" && esp.length && !esp.includes("tep"))) return null;
      const a = tepAchados(r);
      if (!a.length) return null;
      return { titulo:"Dispneia com achados que podem ocorrer no TEP",
        texto:`O traçado já tem ${lista(a)}. Esses estão entre os achados que podem ocorrer no TEP (aula 57). Se houver suspeita clínica, marque TEP nesta etapa para o app reunir tudo. O ECG não confirma nem afasta TEP: pode ser normal em até um quarto dos casos.`,
        pergunta:`Dispneia com ${lista(a)} no ECG. Isso aumenta a suspeita de TEP?` };
    }}
];

/* ---------- avaliar ----------
   leitura: {motivo, r, passo?}. Com passo, só volta o que já foi alcançado (etapa ≤ passo). */
function avaliar(leitura){
  const L = leitura || {}, c = {motivo:L.motivo || null, r:L.r || {}};
  const out = [];
  REGRAS.forEach(g => {
    let a = null;
    try { a = g.testar(c); } catch(_){ a = null; } // regra quebrada não pode derrubar a leitura
    if (!a) return;
    const etapa = a.etapa || g.etapa;
    if (L.passo && etapa > L.passo) return;
    out.push({id:g.id, etapa, nivel:a.nivel || g.nivel, titulo:a.titulo, texto:a.texto, pergunta_para_ia:a.pergunta, aula:g.aula});
  });
  return out.sort((x, y) => x.etapa - y.etapa || (x.nivel === y.nivel ? 0 : x.nivel === "atencao" ? -1 : 1));
}
const alertasDaEtapa = (leitura, etapa) => avaliar(Object.assign({}, leitura, {passo:null})).filter(a => a.etapa === etapa);

/* ---------- "por que isso importa?" ----------
   Um texto por etapa do app (1 = motivo do exame, 2 a 11 = sequência). Tirado das aulas, na voz didática do Dr. Vitor. */
const PORQUE = {
  1:{titulo:"Antes do traçado, o paciente",
    texto:"O eletrocardiograma é uma resposta, e toda resposta precisa de uma pergunta. Um jovem com dor depois de uma bolada no peito e um diabético de 70 anos com dor igual à do infarto pedem olhares diferentes para o mesmo traçado. A queixa diz o que é mais provável encontrar e onde olhar com mais cuidado.",
    aula:"Aula 41 · Olhar para o ECG sem olhar para o paciente"},
  2:{titulo:"Técnica de realização",
    texto:"Antes de procurar doença, confirme que o exame foi bem feito: 25 mm/s e 10 mm/mV. Com a configuração errada, toda medida em quadradinhos sai errada. Com os eletrodos dos braços trocados, DI fica negativo e simula área inativa lateral alta, e esse erro pode deixar o paciente horas no pronto-socorro, internar sem necessidade ou levá-lo a um cateterismo de que ele não precisava.",
    aula:"Aula 14 · Passo a Passo; Aula 37 · Quando o problema é quem fez o exame"},
  3:{titulo:"Ritmo",
    texto:"Ritmo sinusal não é só P positiva em DI, DII e aVF e negativa em aVR: toda P tem que gerar um QRS, com a mesma morfologia na mesma derivação. É no \"toda P gera QRS\" que aparece a P bloqueada escondida na onda T. Parece simples, e é justamente por isso que acaba negligenciado.",
    aula:"Aula 10 · Identificando o ritmo sinusal; Aula 68 · Síncope"},
  4:{titulo:"Regularidade e frequência",
    texto:"A forma mais prática de contar a FC é pegar o DII longo, que tem 10 segundos, contar os QRS e multiplicar por 6. No ritmo irregular, dividir 1.500 ou 300 pelos quadradinhos dá um número diferente a cada intervalo: aí só a contagem em 10 segundos serve. E regular ou irregular é uma das três perguntas que organizam qualquer taquiarritmia.",
    aula:"Aula 11 · Como calcular a frequência cardíaca; Aula 47 · Introdução a taquiarritmias"},
  5:{titulo:"Eixo",
    texto:"No plantão, DI e aVF resolvem: os dois positivos, eixo preservado. O desvio conta uma história: sobrecargas ventriculares e bloqueios de ramo mexem no eixo, o desvio para a direita entra no raciocínio do TEP, e desvio extremo numa taquicardia de QRS largo fala muito a favor de taquicardia ventricular.",
    aula:"Aula 12 · Eixo cardíaco; Aula 51 · TV x taquicardia supraventricular com aberrância; Aula 57 · ECG no TEP"},
  6:{titulo:"Descarte de arritmias",
    texto:"Na taquicardia, a clínica não separa uma FA de uma TV: quem separa é o eletro, com três perguntas: o QRS é estreito ou largo, o ritmo é regular ou irregular e se tem onda P. E QRS largo é taquicardia ventricular até que se prove o contrário, porque quem conduz como TV não erra.",
    aula:"Aula 47 · Introdução a taquiarritmias; Aula 50 · Taquicardia ventricular"},
  7:{titulo:"Descarte de isquemia",
    texto:"Infarto respeita a anatomia: supra e infra valem em derivações contíguas, nunca numa derivação isolada. Supra em duas contíguas com clínica compatível é infarto com supra até que se prove o contrário. E sem supra, sem infra e sem T invertida óbvia ainda existem padrões de alto risco que exigem a mesma urgência: quem não conhece não enxerga.",
    aula:"Aula 43 · Supra de ST; Aula 45 · Padrões de alto risco"},
  8:{titulo:"QRS",
    texto:"O QRS largo muda a leitura do que vem depois. No BRE, o supra de V1 a V3 pode ser só do bloqueio, e é o Sgarbossa que diz quando desconfiar de infarto; no BRD, T negativa de V1 a V3 é esperada e não é isquemia. Na amplitude, é aqui que aparece o coração do hipertenso crônico: critérios de hipertrofia e o strain.",
    aula:"Aula 45 · Padrões de alto risco; Aula 55 · Dispneia e bloqueio de ramos; Aula 41 · Olhar para o ECG sem olhar para o paciente"},
  9:{titulo:"Intervalo QT",
    texto:"O QT longo é risco de torsades de pointes, e com QTc acima de 500 ms esse risco é alto. Como a taquicardia encurta o QT e a bradicardia alonga, o número só vale corrigido pela frequência. Meça do início do QRS ao fim da onda T, numa derivação em que o fim da T esteja bem definido.",
    aula:"Aula 58 · Distúrbios eletrolíticos; Aula 59 · Síndromes hereditárias arritmogênicas"},
  10:{titulo:"Padrões especiais",
    texto:"Algumas condições só aparecem se você for atrás delas. A hipercalemia vai da T apiculada ao padrão sinusoidal, que é risco iminente de parada. Já no TEP o eletro não dá o diagnóstico: pode ser normal, e o S1Q3T3 aparece em poucos casos. Ele é mais uma peça do raciocínio clínico, não a resposta.",
    aula:"Aula 58 · Distúrbios eletrolíticos; Aula 57 · ECG no TEP"},
  11:{titulo:"Volte ao paciente",
    texto:"O eletrocardiograma é sempre um exame complementar ao paciente que está na sua frente. Análise estruturada e contexto clínico, as duas juntas, são o que separa quem sabe ver eletro de quem não sabe. Agora junte os achados com a história, o exame físico e o que mais você tiver.",
    aula:"Aula 41 · Olhar para o ECG sem olhar para o paciente; Aula 44 · Infra de ST e inversão de onda T"}
};

const API = {avaliar, alertasDaEtapa, PORQUE, REGRAS:REGRAS.map(g => ({id:g.id, etapa:g.etapa, nivel:g.nivel, gatilho:g.gatilho, aula:g.aula})),
  _apoio:{sinusal, eixo, arritmia, qt, tepAchados, abreSgarbossa}};
if (typeof module === "object" && module.exports) module.exports = API;
else raiz.IARegras = API;

})(typeof window !== "undefined" ? window : globalThis);
