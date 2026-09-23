/* Copiloto de ECG — sync.js
   As leituras salvas sobem para a conta (tabela "leituras" do Supabase) e descem nos outros aparelhos.
   Sobe o registro sem a miniatura (thumb): a foto do eletro nunca sai do aparelho.
   Toda mudança entra primeiro numa fila local ("copiloto.fila") e sobe quando há rede; apagar deixa uma
   lápide ("copiloto.lapides") até a fila subir, para a leitura não voltar na próxima junção.
   Cada operação leva o e-mail de quem a fez (dono) e só sobe para essa conta.
   Sem localStorage (modo privado), fila e lápides vivem só na memória. Sem cliente (config vazia), nada sobe
   e a fila espera. Regra da junção: vence o atualizadaEm mais novo; empate, a apagada vence. */
(function(){
  "use strict";
  const FILA = "copiloto.fila", LAPIDES = "copiloto.lapides", DONO = "copiloto.dono";
  const LOTE = 100, PAGINA = 1000, LIMITE = 15000;

  // cópia em memória de cada chave: vale mesmo quando o localStorage recusa gravar
  const memoria = {};
  function ler(k, padrao){
    if (!(k in memoria)){ try { memoria[k] = JSON.parse(localStorage.getItem(k)) || padrao; } catch(_){ memoria[k] = padrao; } }
    return memoria[k];
  }
  function gravar(k, v){ memoria[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch(_){} }
  function esquecer(k){ delete memoria[k]; try { localStorage.removeItem(k); } catch(_){} }

  const comLimite = (p, ms) => new Promise((ok, erro) => {
    const r = setTimeout(() => erro(new Error("tempo esgotado")), ms);
    Promise.resolve(p).then(v => { clearTimeout(r); ok(v); }, x => { clearTimeout(r); erro(x); });
  });
  const quandoMudou = l => +l.atualizadaEm || +l.quando || 0;
  const iso = ms => new Date(ms).toISOString();
  function semApagada(l){ const r = Object.assign({}, l); delete r.apagadaEm; return r; }
  function semThumb(reg){ const r = Object.assign({}, reg); delete r.thumb; delete r.apagadaEm; return r; }

  /* regra pura: junta pelo id; vence o maior atualizadaEm; empate → a apagada vence. A foto não viaja:
     se a vencedora viva não tem miniatura e a outra tem (a deste aparelho), a miniatura fica.
     Devolve todas as vencedoras, inclusive as apagadas (com apagadaEm); quem desenha filtra. */
  function juntar(locais, remotas){
    const porId = new Map();
    const pesar = l => {
      const a = porId.get(l.id);
      if (!a){ porId.set(l.id, l); return; }
      const ta = quandoMudou(a), tl = quandoMudou(l);
      const vence = tl > ta || (tl === ta && !!l.apagadaEm && !a.apagadaEm) ? l : a, perde = vence === l ? a : l;
      porId.set(l.id, !vence.apagadaEm && !vence.thumb && perde.thumb ? Object.assign({}, vence, {thumb:perde.thumb}) : vence);
    };
    (locais || []).forEach(pesar); (remotas || []).forEach(pesar);
    // viva sai sem o campo apagadaEm (a remota traz apagadaEm:null)
    return [...porId.values()].map(l => l.apagadaEm || !("apagadaEm" in l) ? l : semApagada(l));
  }

  /* ---------- fila ----------
     Uma operação por id: a mais nova substitui a anterior. Cada uma leva um número (n) para o envio
     saber se ela mudou enquanto subia, e o dono (e-mail da conta em uso). */
  const fila = () => ler(FILA, []);
  const lapides = () => ler(LAPIDES, []);
  const emailAgora = () => (window.Conta && Conta.email()) || ler(DONO, null);
  // apagadas desde que a página abriu: a lápide sai quando o apagar sobe, mas uma sincronização que
  // baixou antes disso ainda traz a leitura viva e não pode ressuscitá-la
  const apagadasAqui = new Map();
  function enfileirar(op){
    if (!op || !op.id) return;
    const n = Date.now() + Math.random(), dono = emailAgora();
    let item;
    if (op.tipo === "apagar"){
      const apagadaEm = Date.now();
      item = {tipo:"apagar", id:op.id, apagadaEm, n, dono};
      apagadasAqui.set(op.id, apagadaEm);
      gravar(LAPIDES, lapides().filter(x => x.id !== op.id).concat({id:op.id, apagadaEm}));
    } else {
      const registro = semThumb(op.registro || {id:op.id});
      if (!registro.atualizadaEm) registro.atualizadaEm = quandoMudou(registro) || Date.now();
      item = {tipo:"salvar", id:op.id, registro, n, dono};
      apagadasAqui.delete(op.id);
      if (lapides().some(x => x.id === op.id)) gravar(LAPIDES, lapides().filter(x => x.id !== op.id));
    }
    gravar(FILA, fila().filter(x => x.id !== op.id).concat(item));
  }
  function pendentes(){ return fila().length; }

  function linha(op){
    if (op.tipo === "apagar") return {id:op.id, dados:{}, atualizada_em:iso(op.apagadaEm), apagada_em:iso(op.apagadaEm)};
    return {id:op.id, dados:op.registro, atualizada_em:iso(quandoMudou(op.registro)), apagada_em:null};
  }
  // o banco preenche user_id sozinho (padrão auth.uid()); a chave é (user_id, id)
  async function subir(c, ops){
    for (let i = 0; i < ops.length; i += LOTE){
      const r = await comLimite(c.from("leituras").upsert(ops.slice(i, i + LOTE).map(linha), {onConflict:"user_id,id"}), LIMITE);
      if (r && r.error) throw r.error;
      tirarDaFila(ops.slice(i, i + LOTE));
    }
  }
  // sai da fila só o que subiu e não mudou enquanto subia; a lápide sai junto com o seu apagar
  function tirarDaFila(enviadas){
    const n = new Map(enviadas.map(o => [o.id, o.n]));
    gravar(FILA, fila().filter(o => n.get(o.id) !== o.n));
    const apagadas = new Set(enviadas.filter(o => o.tipo === "apagar").map(o => o.id));
    const pendentesApagar = new Set(fila().filter(o => o.tipo === "apagar").map(o => o.id));
    if (apagadas.size) gravar(LAPIDES, lapides().filter(x => !apagadas.has(x.id) || pendentesApagar.has(x.id)));
  }

  /* Uma subida de cada vez: quem pede durante outra espera a vez e roda de novo (pode ter entrado coisa
     nova na fila). Sem cliente, sem sessão ou sem rede, a fila fica como está. */
  let corrente = null;
  function enviar(){
    if (corrente) return corrente.then(() => enviar());
    corrente = (async () => {
      const c = window.Conta && Conta.cliente(), eu = c && Conta.email();
      const ops = fila().filter(o => o.dono === eu);   // a fila de outra conta nunca sobe para esta
      if (!c || !eu || !ops.length) return {enviadas:0, pendentes:pendentes()};
      const antes = pendentes();
      try { await subir(c, ops); } catch(_){}
      return {enviadas:Math.max(0, antes - pendentes()), pendentes:pendentes()};
    })().finally(() => { corrente = null; });
    return corrente;
  }

  /* todas as leituras da conta, inclusive as apagadas, no formato do aparelho. Falha → rejeita. */
  async function baixar(){
    const c = window.Conta && Conta.cliente();
    if (!c || !Conta.email()) throw new Error("sem conta");
    const linhas = [];
    for (let de = 0; ; de += PAGINA){
      const r = await comLimite(c.from("leituras").select("id, dados, atualizada_em, apagada_em").order("id").range(de, de + PAGINA - 1), LIMITE);
      if (!r || r.error) throw (r && r.error) || new Error("sem resposta");
      const d = r.data || [];
      linhas.push(...d);
      if (d.length < PAGINA) break;
    }
    return linhas.map(l => Object.assign({}, l.dados || {}, {id:l.id, atualizadaEm:Date.parse(l.atualizada_em) || 0,
      apagadaEm:l.apagada_em ? Date.parse(l.apagada_em) : null}));
  }

  /* entrar e abrir com rede: sobe a fila, baixa a conta e junta com o aparelho (e as lápides).
     obterLocais() é lido só depois da rede: a leitura salva ou apagada enquanto a rede demorava entra
     na junção como está agora. Operação da fila que perdeu para uma versão mais nova do servidor sai
     da fila: subir depois ressuscitaria a versão velha. Devolve as leituras vivas, ou null se não deu. */
  async function sincronizar(obterLocais){
    await enviar();
    let remotas;
    try { remotas = await baixar(); } catch(_){ return null; }
    const locais = obterLocais() || [], ids = new Set(locais.map(l => l.id));
    const mortas = new Map(apagadasAqui); lapides().forEach(x => mortas.set(x.id, x.apagadaEm));
    const lap = [...mortas].filter(([id]) => !ids.has(id)).map(([id, em]) => ({id, atualizadaEm:em, apagadaEm:em}));
    const juntas = juntar(locais.concat(lap), remotas);
    const vencedora = new Map(juntas.map(l => [l.id, l]));
    const velhas = fila().filter(o => { const v = vencedora.get(o.id); return v && quandoMudou(v) > (o.tipo === "apagar" ? o.apagadaEm : quandoMudou(o.registro)); });
    if (velhas.length) tirarDaFila(velhas);
    return juntas.filter(l => !l.apagadaEm);
  }

  /* leituras sem dono: o primeiro e-mail que entra neste aparelho fica com elas (todas entram na fila).
     Aparelho de outra conta: quem chama limpa o aparelho antes (limparLocal) e só então adota. */
  function adotar(email, locais){
    const dono = ler(DONO, null);
    if (dono) return false;
    (locais || []).forEach(l => enfileirar({tipo:"salvar", id:l.id, registro:l}));
    gravar(DONO, email);
    return true;
  }

  /* sair e excluir: o aparelho volta a ficar vazio — leituras, fotos, andamento, fila, lápides, dono e o
     nome da assinatura. Tema e modo revisão são do aparelho, ficam. */
  async function limparLocal(){
    [FILA, LAPIDES, DONO].forEach(esquecer); apagadasAqui.clear();
    try { localStorage.removeItem("copiloto.leituras"); localStorage.removeItem("copiloto.andamento"); } catch(_){}
    try {
      const p = JSON.parse(localStorage.getItem("copiloto.prefs"));
      if (p && "nome" in p){ delete p.nome; localStorage.setItem("copiloto.prefs", JSON.stringify(p)); }
    } catch(_){}
    try {
      await comLimite(new Promise(ok => {
        const r = indexedDB.open("copiloto", 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("fotos")) r.result.createObjectStore("fotos"); };
        r.onsuccess = () => { const b = r.result, t = b.transaction("fotos", "readwrite"); t.objectStore("fotos").clear(); t.oncomplete = t.onerror = () => { b.close(); ok(); }; };
        r.onerror = () => ok();
      }), 3000);
    } catch(_){}
  }

  window.Sync = {juntar, enfileirar, enviar, baixar, pendentes, limparLocal, sincronizar, adotar,
    dono(){ return ler(DONO, null); }};
})();
