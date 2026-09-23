/* Copiloto de ECG — conta-falsa.js
   Só age com ?conta=falsa na URL: troca o cliente Supabase por um falso em memória, para os
   testes rodarem sem rede nem projeto real. Imita só o que conta.js (T07) usa do supabase-js:
   auth.getSession/onAuthStateChange/verifyOtp/signOut, rpc("tem_acesso"),
   from("leituras").select/upsert/eq/gt/order/range e functions.invoke("pedir-codigo"|"excluir-conta").
   Expõe window.__contaFalsa = {cliente, estado}, com o estado controlável pelos testes. */
(function(){
  "use strict";
  const parametros = new URLSearchParams(location.search);
  if (parametros.get("conta") !== "falsa") return;

  const normalizarEmail = e => String(e || "").trim().toLowerCase();

  const estado = {
    emailsComAcesso: new Set(),  // e-mails que "compraram", para pedir-codigo e o login inicial
    acesso: true,                // resultado de rpc("tem_acesso") — liga/desliga para simular corte
    offline: false,              // true: toda chamada rejeita com TypeError("Failed to fetch")
    atrasoSelect: 0,             // ms de espera em cada select de "leituras" (a baixa lenta do plantão)
    codigo: "123456",            // código que verifyOtp aceita
    sessao: null,                // sessão atual, ou null (sem login)
    leituras: [],                // linhas de "leituras" no servidor falso
    chamadas: []                 // registro de toda chamada, para os testes conferirem
  };

  const ouvintes = [];
  function dispararSessao(sessao){
    ouvintes.slice().forEach(fn => { try { fn(sessao ? "SIGNED_IN" : "SIGNED_OUT", sessao); } catch(_){} });
  }
  function criarSessao(email){
    return {
      access_token: "falso." + email,
      refresh_token: "falso-refresh." + email,
      token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {id: "uid-" + email, email, aud: "authenticated"}
    };
  }
  async function falhaSeOffline(){
    if (estado.offline) throw new TypeError("Failed to fetch");
  }

  // O servidor falso sobrevive ao recarregar (T07): a sessão fica "guardada no aparelho" como a do
  // supabase-js, e o que o teste ligou (acesso, offline, e-mails, leituras) continua valendo depois do
  // reload. Vive no sessionStorage da aba: some quando o navegador fecha. As chamadas não persistem.
  const CHAVE_FALSA = "copiloto.contaFalsa";
  try {
    const g = JSON.parse(sessionStorage.getItem(CHAVE_FALSA));
    if (g){
      Object.assign(estado, {acesso:g.acesso, offline:g.offline, codigo:g.codigo, sessao:g.sessao, leituras:g.leituras || [], atrasoSelect:g.atrasoSelect || 0});
      estado.emailsComAcesso = new Set(g.emailsComAcesso || []);
    }
  } catch(_){}
  addEventListener("pagehide", () => {
    try { sessionStorage.setItem(CHAVE_FALSA, JSON.stringify(Object.assign({}, estado, {emailsComAcesso:[...estado.emailsComAcesso], chamadas:undefined}))); } catch(_){}
  });

  // &logado=1: já nasce com sessão de medico@teste.com, com acesso — atalho para os testes que
  // não precisam repetir o fluxo de login inteiro (e volta logado a cada reload).
  if (parametros.get("logado") === "1"){
    const email = "medico@teste.com";
    estado.emailsComAcesso.add(email);
    if (!estado.sessao) estado.sessao = criarSessao(email);
  }

  // imita o query builder do supabase-js sobre "leituras": encadeia filtros e só executa quando
  // é aguardado (o builder é "thenable", como o de verdade)
  function leiturasBuilder(){
    let operacao = null, dadosUpsert = null, opcoesUpsert = null, faixa = null;
    const filtros = [];
    const builder = {
      select(){ if (!operacao) operacao = "select"; return builder; },
      upsert(dados, opcoes){ operacao = "upsert"; dadosUpsert = Array.isArray(dados) ? dados : [dados]; opcoesUpsert = opcoes || null; return builder; },
      eq(coluna, valor){ filtros.push({tipo: "eq", coluna, valor}); return builder; },
      gt(coluna, valor){ filtros.push({tipo: "gt", coluna, valor}); return builder; },
      order(coluna){ filtros.push({tipo: "order", coluna}); return builder; },
      range(de, ate){ faixa = [de, ate]; return builder; },
      then(aoResolver, aoRejeitar){ return executar().then(aoResolver, aoRejeitar); },
      catch(aoRejeitar){ return executar().catch(aoRejeitar); }
    };
    async function executar(){
      estado.chamadas.push({tabela: "leituras", operacao, filtros, dados: dadosUpsert, opcoes: opcoesUpsert, faixa});
      // resposta lenta: o servidor lê as linhas na hora do pedido e a resposta chega depois
      const foto = operacao === "select" && estado.atrasoSelect ? JSON.parse(JSON.stringify(estado.leituras)) : null;
      if (foto) await new Promise(r => setTimeout(r, estado.atrasoSelect));
      await falhaSeOffline();
      // RLS: leituras só enquanto tem_acesso()
      if (!estado.acesso) return {data: null, error: {code: "42501", message: "new row violates row-level security policy for table \"leituras\""}};
      if (operacao === "upsert"){
        dadosUpsert.forEach(n => {
          const novo = JSON.parse(JSON.stringify(n));  // o servidor guarda uma cópia, como o de verdade
          const i = estado.leituras.findIndex(l => l.id === novo.id);
          if (i >= 0) estado.leituras[i] = Object.assign({}, estado.leituras[i], novo);
          else estado.leituras.push(Object.assign({}, novo));
        });
        return {data: dadosUpsert, error: null};
      }
      let linhas = (foto || estado.leituras).slice();
      filtros.forEach(f => {
        if (f.tipo === "eq") linhas = linhas.filter(l => l[f.coluna] === f.valor);
        if (f.tipo === "gt") linhas = linhas.filter(l => l[f.coluna] > f.valor);
        if (f.tipo === "order") linhas.sort((a, b) => a[f.coluna] < b[f.coluna] ? -1 : a[f.coluna] > b[f.coluna] ? 1 : 0);
      });
      if (faixa) linhas = linhas.slice(faixa[0], faixa[1] + 1);
      return {data: JSON.parse(JSON.stringify(linhas)), error: null};
    }
    return builder;
  }

  const cliente = {
    auth: {
      // como no supabase-js: a sessão é lida do aparelho, sem rede, enquanto o token vale. Token vencido:
      // renova; sem rede, insiste por uns segundos e devolve erro de rede mantendo a sessão guardada;
      // renovação recusada (refresh_token "revogado") apaga a sessão e devolve null sem erro.
      async getSession(){
        const s = estado.sessao;
        if (s && s.expires_at * 1000 < Date.now()){
          if (estado.offline){
            await new Promise(r => setTimeout(r, 3000));
            return {data: {session: null}, error: {name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0}};
          }
          if (s.refresh_token === "revogado"){ estado.sessao = null; dispararSessao(null); return {data: {session: null}, error: null}; }
          s.expires_at = Math.floor(Date.now() / 1000) + 3600;
        }
        return {data: {session: estado.sessao || null}, error: null};
      },
      onAuthStateChange(fn){
        ouvintes.push(fn);
        // o supabase-js de verdade dispara um evento inicial assim que alguém assina
        setTimeout(() => fn("INITIAL_SESSION", estado.sessao || null), 0);
        return {data: {subscription: {unsubscribe(){ const i = ouvintes.indexOf(fn); if (i >= 0) ouvintes.splice(i, 1); }}}};
      },
      async verifyOtp({email, token}){
        estado.chamadas.push({metodo: "verifyOtp", email, token});
        await falhaSeOffline();
        if (token !== estado.codigo){
          return {data: {session: null, user: null}, error: {name: "AuthApiError", message: "Token has expired or is invalid", status: 403}};
        }
        const sessao = criarSessao(normalizarEmail(email));
        estado.sessao = sessao;
        dispararSessao(sessao);
        return {data: {session: sessao, user: sessao.user}, error: null};
      },
      // scope "local" só esquece a sessão no aparelho, sem rede (como no supabase-js)
      async signOut(opcoes){
        const escopo = (opcoes && opcoes.scope) || "global";
        estado.chamadas.push({metodo: "signOut", escopo});
        if (escopo !== "local") await falhaSeOffline();
        estado.sessao = null;
        dispararSessao(null);
        return {error: null};
      }
    },
    async rpc(nome, parametrosRpc){
      estado.chamadas.push({rpc: nome, parametros: parametrosRpc});
      await falhaSeOffline();
      if (nome === "tem_acesso") return {data: estado.acesso, error: null};
      return {data: null, error: {message: "conta-falsa: rpc não suportada: " + nome}};
    },
    from(tabela){
      if (tabela === "leituras") return leiturasBuilder();
      throw new Error("conta-falsa: tabela não suportada: " + tabela);
    },
    functions: {
      async invoke(nome, opcoes){
        const corpo = (opcoes && opcoes.body) || {};
        estado.chamadas.push({funcao: nome, corpo});
        await falhaSeOffline();
        if (nome === "pedir-codigo"){
          const email = normalizarEmail(corpo.email);
          if (estado.emailsComAcesso.has(email)) return {data: {ok: true}, error: null};
          const resposta = new Response(JSON.stringify({erro: "sem_acesso"}), {status: 404, headers: {"content-type": "application/json"}});
          return {data: null, error: {name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: resposta}};
        }
        if (nome === "excluir-conta"){
          estado.leituras = [];
          estado.sessao = null;
          dispararSessao(null);
          return {data: {ok: true}, error: null};
        }
        return {data: null, error: {message: "conta-falsa: função não suportada: " + nome}};
      }
    }
  };

  window.__contaFalsa = {cliente, estado};
})();
