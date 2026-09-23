/* Copiloto de ECG — conta.js
   A sessão do aluno: pedir o código, confirmar, conferir se o acesso continua, sair e excluir.
   O cliente é o supabase-js (sessão guardada no localStorage, chave "copiloto.sessao") ou, com
   ?conta=falsa, o falso em memória da conta-falsa.js. Sem config preenchida (antes da T09) e sem
   conta falsa, não há cliente: o app abre em Entrar e todo pedido devolve "falha".
   Regra do plantão: rede ruim nunca derruba. Só um false explícito do servidor encerra o acesso. */
(function(){
  "use strict";
  const cfg = window.COPILOTO_CONFIG || {};
  const CHAVE_SESSAO = "copiloto.sessao";
  const falsa = new URLSearchParams(location.search).get("conta") === "falsa";

  let cli = null, emailAtual = null;
  function cliente(){
    if (cli) return cli;
    if (falsa){ cli = window.__contaFalsa ? window.__contaFalsa.cliente : null; return cli; }
    if (cfg.supabaseUrl && cfg.supabaseAnon && window.supabase){
      try {
        cli = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnon, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, storageKey:CHAVE_SESSAO}});
      } catch(_){ cli = null; }
    }
    return cli;
  }

  const comLimite = (p, ms) => new Promise((ok, erro) => {
    const r = setTimeout(() => erro(new Error("tempo esgotado")), ms);
    Promise.resolve(p).then(v => { clearTimeout(r); ok(v); }, x => { clearTimeout(r); erro(x); });
  });
  const normalizar = e => String(e || "").trim().toLowerCase().replace(/\.+$/, "");
  // falha de rede: TypeError do fetch, ou o erro que o supabase-js devolve no lugar dele
  const deRede = e => !!e && (e instanceof TypeError || /FetchError|RetryableFetch/.test(e.name || "") || e.status === 0);

  // sessão que o supabase-js deixou no aparelho: vale quando a rede não deixa confirmar
  function emailGuardado(){
    try { const s = JSON.parse(localStorage.getItem(CHAVE_SESSAO)); return (s && s.user && s.user.email) || (s && s.currentSession && s.currentSession.user && s.currentSession.user.email) || null; }
    catch(_){ return null; }
  }

  /* Lê a sessão sem esperar rede: o getSession pode tentar renovar o token e, com sinal ruim,
     demorar. Passou de 1,5 s ou deu erro, vale a sessão guardada no aparelho. */
  async function iniciar(){
    const c = cliente();
    if (!c){ emailAtual = null; return {sessao:false, email:null}; }
    let email = null;
    try {
      const r = await comLimite(c.auth.getSession(), 1500);
      const s = r && r.data && r.data.session;
      email = s ? (s.user && s.user.email) || emailGuardado() || "" : (r && r.error ? emailGuardado() : null);
    } catch(_){ email = emailGuardado(); }
    emailAtual = email;  // "" = sessão sem e-mail legível: conta como dentro
    return {sessao:emailAtual !== null, email:emailAtual || null};
  }

  async function pedirCodigo(email){
    const e = normalizar(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "email_invalido";
    const c = cliente(); if (!c) return "falha";
    try {
      const {data, error} = await c.functions.invoke("pedir-codigo", {body:{email:e}});
      if (!error) return data && data.ok ? "ok" : "falha";
      if (deRede(error)) return "sem_rede";
      const status = error.context && error.context.status;
      if (status === 404) return "sem_acesso";
      if (status === 429) return "muitos_pedidos";
      if (status === 400) return "email_invalido";
      return "falha";
    } catch(x){ return deRede(x) ? "sem_rede" : "falha"; }
  }

  /* O GoTrue devolve "Token has expired or is invalid" tanto para código errado quanto para vencido:
     nesse caso a resposta é codigo_errado (o mais provável é dígito trocado; depois de 5 erros a tela
     pede um código novo). Só "expired" sem "invalid" vira codigo_expirado. */
  async function confirmar(email, codigo){
    const c = cliente(); if (!c) return "falha";
    try {
      const {data, error} = await c.auth.verifyOtp({email:normalizar(email), token:String(codigo || ""), type:"email"});
      if (!error && data && data.session){ emailAtual = (data.session.user && data.session.user.email) || normalizar(email); return "ok"; }
      if (!error) return "falha";
      if (deRede(error)) return "sem_rede";
      const msg = String(error.message || "").toLowerCase();
      if (/expired/.test(msg) && !/invalid/.test(msg)) return "codigo_expirado";
      if (error.status >= 500 || error.status === 429) return "falha";
      return "codigo_errado";
    } catch(x){ return deRede(x) ? "sem_rede" : "falha"; }
  }

  // true: acesso ativo · false: o servidor disse que não · null: não deu para saber (só false derruba)
  async function conferirAcesso(){
    const c = cliente(); if (!c) return null;
    try {
      const {data, error} = await comLimite(c.rpc("tem_acesso"), 8000);
      if (error) return null;
      return data === true ? true : data === false ? false : null;
    } catch(_){ return null; }
  }

  /* Sair encerra no servidor quando dá; sem rede, esquece a sessão só no aparelho (escopo local),
     que é o que importa para quem entrega o celular a outra pessoa. */
  async function sair(){
    const c = cliente();
    emailAtual = null;
    if (!c) return;
    try {
      const r = await comLimite(c.auth.signOut(), 5000);
      if (r && r.error) throw r.error;
    } catch(_){
      try { await c.auth.signOut({scope:"local"}); } catch(__){}
      try { localStorage.removeItem(CHAVE_SESSAO); } catch(__){}
    }
  }

  async function excluir(){
    const c = cliente(); if (!c) return "falha";
    try {
      const {error} = await c.functions.invoke("excluir-conta", {body:{}});
      if (error) return deRede(error) ? "sem_rede" : "falha";
    } catch(x){ return deRede(x) ? "sem_rede" : "falha"; }
    // o usuário já não existe no servidor: basta esquecer a sessão aqui
    emailAtual = null;
    try { await c.auth.signOut({scope:"local"}); } catch(_){}
    try { localStorage.removeItem(CHAVE_SESSAO); } catch(_){}
    return "ok";
  }

  window.Conta = {
    iniciar, pedirCodigo, confirmar, conferirAcesso, sair, excluir,
    email(){ return emailAtual || null; },
    cliente
  };
})();
