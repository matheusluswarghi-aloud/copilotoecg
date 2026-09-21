/* Copiloto de ECG — controles de arrastar (fita, traçado, contador).
   Independente do app.js: só depende dos tokens de style.css.
   Todo controle: fn(host, opcoes) → api, e grava host.__ctl = api. */
(function(){
"use strict";

/* ---------- base ---------- */
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const reduzido = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const vibrar = () => { try { if (navigator.vibrate) navigator.vibrate(3); } catch(_){} };
const fmt = (v, casas) => v == null ? "—" : Number(v).toLocaleString("pt-BR", {maximumFractionDigits: casas == null ? 1 : casas});
const esc = s => String(s).replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const trava = (v, a, b) => Math.min(b, Math.max(a, v));
// mesma leitura de `css`, com memória: os laços de desenho rodam a 60 quadros e getComputedStyle força recálculo
let memoria = {}, memoriaTema = null;
function corTema(n){
  const tema = (document.documentElement.getAttribute("data-theme") || "") + (matchMedia("(prefers-color-scheme: dark)").matches ? "|d" : "|c");
  if (tema !== memoriaTema){ memoriaTema = tema; memoria = {}; }
  if (memoria[n] === undefined) memoria[n] = css(n);
  return memoria[n];
}

// canvas nítido no dispositivo (dpr no máximo 2); largura sempre a do host
function tela(host, altura){
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  const o = {c, ctx, larg:1, alt:1, ajustar};
  function ajustar(){
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    o.larg = Math.max(1, Math.round(host.clientWidth || 320));
    o.alt = Math.max(1, Math.round(altura || host.clientHeight || 56));
    c.width = Math.round(o.larg * dpr); c.height = Math.round(o.alt * dpr);
    c.style.width = "100%"; c.style.height = o.alt + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  host.appendChild(c); ajustar();
  return o;
}

// ponteiro com captura; p = {x, y} relativo ao elemento
function arrasto(el, h){
  let id = null;
  const rel = e => { const r = el.getBoundingClientRect(); return {x:e.clientX - r.left, y:e.clientY - r.top}; };
  const baixo = e => { if (id !== null) return; id = e.pointerId; try { el.setPointerCapture(id); } catch(_){}
    if (e.cancelable) e.preventDefault(); if (h.inicio) h.inicio(rel(e), e); };
  const meio = e => { if (e.pointerId !== id) return; if (e.cancelable) e.preventDefault(); if (h.mover) h.mover(rel(e), e); };
  const cima = e => { if (e.pointerId !== id) return; try { el.releasePointerCapture(id); } catch(_){} id = null; if (h.fim) h.fim(rel(e), e); };
  el.addEventListener("pointerdown", baixo); el.addEventListener("pointermove", meio);
  el.addEventListener("pointerup", cima); el.addEventListener("pointercancel", cima);
  return () => { el.removeEventListener("pointerdown", baixo); el.removeEventListener("pointermove", meio);
    el.removeEventListener("pointerup", cima); el.removeEventListener("pointercancel", cima); };
}

// toque no número troca o conteúdo por um campo numérico já focado e selecionado
function numeroTocavel(botao, o){
  const abrir = () => {
    if (botao.querySelector("input")) return;
    const atual = o.ler();
    const guarda = document.createDocumentFragment();          // guarda os nós, não o HTML: quem apontava para eles continua valendo
    while (botao.firstChild) guarda.appendChild(botao.firstChild);
    const inp = document.createElement("input");
    inp.type = "number"; inp.inputMode = "decimal"; inp.className = "ctl-inp";
    inp.step = String(o.passo || 1); inp.value = atual == null ? "" : String(atual);
    botao.appendChild(inp); botao.classList.add("digitando");
    inp.focus({preventScroll:true}); try { inp.select(); } catch(_){}
    let pronto = false;
    const fechar = grava => {
      if (pronto) return; pronto = true;
      const txt = inp.value;
      botao.removeChild(inp); botao.appendChild(guarda); botao.classList.remove("digitando");
      if (!grava) return;
      let n = parseFloat(String(txt).replace(",", "."));
      if (!isFinite(n)) return;
      const p = o.passo || 1;
      o.gravar(+(Math.round(trava(n, o.min, o.max) / p) * p).toFixed(6));
    };
    inp.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Enter"){ e.preventDefault(); fechar(true); }
      else if (e.key === "Escape"){ e.preventDefault(); fechar(false); }
    });
    inp.addEventListener("blur", () => fechar(true));
    inp.addEventListener("click", e => e.stopPropagation());
  };
  botao.addEventListener("click", abrir);
  return abrir;
}

// um passo por toque; segurando, repete a cada 80 ms depois de 350 ms (o clique sintético dos testes também conta)
function botaoRepetir(btn, fn){
  let espera = null, ritmo = null, ponteiro = false;
  const parar = () => { clearTimeout(espera); clearInterval(ritmo); espera = ritmo = null; };
  const baixo = () => { ponteiro = true; fn(); espera = setTimeout(() => { ritmo = setInterval(fn, 80); }, 350); };
  const solta = () => { parar(); setTimeout(() => { ponteiro = false; }, 0); };
  btn.addEventListener("pointerdown", baixo);
  btn.addEventListener("pointerup", solta); btn.addEventListener("pointercancel", solta);
  btn.addEventListener("pointerleave", parar);
  btn.addEventListener("click", () => { if (ponteiro){ ponteiro = false; return; } fn(); });
  return parar;
}

const CORES = {ok:"--teal", warn:"--violet", bad:"--mag", info:"--blue"};

/* ---------- fita ---------- */
function fita(host, o){
  o = o || {};
  const min = o.min, max = o.max, passo = o.passo || 1;
  const ppp = o.pxPorPasso || (o.compacta ? 14 : 8);        // px por passo
  const ppu = ppp / passo;                                   // px por unidade
  const casas = (String(passo).split(".")[1] || "").length;  // 0,5 → 1 casa
  const dig = o.digitar || {min:min, max:max};
  const medio = o.medio || 5, maior = o.maior || 10;
  const arred = v => +(min + Math.round((v - min) / passo) * passo).toFixed(casas);

  let val = o.valor == null ? null : arred(o.valor);
  let pos = trava(val == null ? (o.inicial == null ? min : o.inicial) : val, min, max);
  let anim = null, puxando = false, x0 = 0, pos0 = 0, rastro = [];

  host.innerHTML = "";
  const raiz = document.createElement("div");
  raiz.className = "ctl fita" + (o.compacta ? " compacta" : "") + (val == null ? " vazia" : "");
  raiz.innerHTML = (o.rotulo ? `<span class="ctl-rot">${esc(o.rotulo)}</span>` : "")
    + `<div class="ctl-leitura"><button type="button" class="ctl-num" aria-label="Digitar o valor"><span class="n">—</span><span class="u">${esc(o.unidade || "")}</span></button>`
    + (o.zonas ? `<span class="tag zona"></span>` : "") + `</div>`
    + `<div class="ctl-linha"><button type="button" class="ctl-passo" data-d="-1" aria-label="Diminuir">−</button>`
    + `<div class="ctl-trilho" role="slider" tabindex="0"></div>`
    + `<button type="button" class="ctl-passo" data-d="1" aria-label="Aumentar">+</button></div>`;
  host.appendChild(raiz);

  const elN = raiz.querySelector(".ctl-num .n"), elNum = raiz.querySelector(".ctl-num");
  const elZona = raiz.querySelector(".zona"), trilho = raiz.querySelector(".ctl-trilho");
  const t = tela(trilho);
  const agulha = document.createElement("i"); agulha.className = "ctl-agulha"; trilho.appendChild(agulha);
  trilho.setAttribute("aria-label", o.aria || o.rotulo || (o.unidade ? "Valor em " + o.unidade : "Valor"));
  trilho.setAttribute("aria-valuemin", String(min)); trilho.setAttribute("aria-valuemax", String(max));

  const zonaDe = v => { if (!o.zonas || v == null) return null; for (const z of o.zonas) if (v <= z.ate) return z; return o.zonas[o.zonas.length - 1]; };

  function pintar(){
    const ctx = t.ctx, larg = t.larg, alt = t.alt, meio = larg / 2;
    const xDe = v => meio + (v - pos) * ppu;
    ctx.clearRect(0, 0, larg, alt);
    if (o.zonas){                                            // fundo da faixa, 8% da cor da classe
      let de = min;
      for (const z of o.zonas){
        const ate = Math.min(max, z.ate), a = Math.max(0, xDe(de)), b = Math.min(larg, xDe(ate));
        if (b > a && CORES[z.classe]){ ctx.globalAlpha = .08; ctx.fillStyle = corTema(CORES[z.classe]); ctx.fillRect(a, 0, b - a, alt); }
        de = ate; if (de >= max) break;
      }
      ctx.globalAlpha = 1;
    }
    const nMax = Math.round((max - min) / passo);
    const i0 = Math.max(0, Math.floor((pos - meio / ppu - min) / passo));
    const i1 = Math.min(nMax, Math.ceil((pos + meio / ppu - min) / passo));
    const hMenor = Math.round(alt * .20), hMedio = Math.round(alt * .34), hMaior = Math.round(alt * .50);
    const cRisco = corTema("--mute-2") || "#5C5C67", cTexto = corTema("--mute") || "#8A8A95";
    ctx.font = "500 10px " + (corTema("--mono") || "monospace");
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let i = i0; i <= i1; i++){
      const v = min + i * passo, x = Math.round(xDe(v)) + .5;
      if (x < -2 || x > larg + 2) continue;
      const g = i % maior === 0 ? 2 : (i % medio === 0 ? 1 : 0);
      ctx.strokeStyle = cRisco; ctx.lineWidth = g === 2 ? 1.4 : 1;
      ctx.globalAlpha = g === 2 ? .95 : (g === 1 ? .72 : .5);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, g === 2 ? hMaior : (g === 1 ? hMedio : hMenor)); ctx.stroke();
      if (g === 2){ ctx.globalAlpha = 1; ctx.fillStyle = cTexto; ctx.fillText(fmt(v, casas), x, hMaior + 5); }
    }
    ctx.globalAlpha = 1;
  }

  function mostrar(){
    if (!elNum.querySelector("input")) elN.textContent = val == null ? "—" : fmt(val, casas);
    raiz.classList.toggle("vazia", val == null);
    if (val == null) trilho.removeAttribute("aria-valuenow"); else trilho.setAttribute("aria-valuenow", String(val));
    trilho.setAttribute("aria-valuetext", val == null ? "não informado" : fmt(val, casas) + " " + (o.unidade || ""));
    if (elZona){
      const z = zonaDe(val);
      elZona.textContent = z ? z.rotulo : "";
      elZona.className = "tag zona" + (z && z.classe ? " " + z.classe : "");
      elZona.style.display = z ? "" : "none";
    }
    pintar();
  }

  function pararAnim(){ if (anim){ cancelAnimationFrame(anim); anim = null; } }
  function soltar(){ if (o.aoSoltar) o.aoSoltar(val); }

  // move a régua; avisa só quando o valor encaixado muda
  function levar(np, calado){
    pos = trava(np, min, max);
    const v = arred(pos), mudou = v !== val;
    val = v; mostrar();
    if (mudou && !calado){ vibrar(); if (o.aoMudar) o.aoMudar(val); }
    return mudou;
  }

  // primeira interação com a fita vazia: parte de `inicial`
  function estrear(calado){
    if (val != null) return false;
    pos = trava(o.inicial == null ? min : o.inicial, min, max);
    val = arred(pos); mostrar();
    if (!calado && o.aoMudar) o.aoMudar(val);
    return true;
  }

  function encaixar(ms){
    const alvo = trava(arred(pos), min, max);
    if (!ms || reduzido() || Math.abs(alvo - pos) < 1e-6){ pos = alvo; mostrar(); soltar(); return; }
    const de = pos, t0 = performance.now();
    const quadro = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      pos = de + (alvo - de) * (1 - Math.pow(1 - p, 3)); mostrar();
      if (p < 1 && trilho.isConnected){ anim = requestAnimationFrame(quadro); return; }
      anim = null; pos = alvo; mostrar(); soltar();
    };
    anim = requestAnimationFrame(quadro);
  }

  function inercia(vel){
    pararAnim();
    if (reduzido()){ encaixar(0); return; }
    if (Math.abs(vel) < .02){ encaixar(120); return; }
    let v = vel, ant = performance.now();
    const quadro = () => {
      const ag = performance.now(), dt = Math.min(48, ag - ant); ant = ag;
      v *= Math.pow(.95, dt / 16.67);
      levar(pos - v * dt / ppu);
      if (Math.abs(v) < .02 || !trilho.isConnected){ anim = null; encaixar(120); return; }
      anim = requestAnimationFrame(quadro);
    };
    anim = requestAnimationFrame(quadro);
  }

  const desligarArrasto = arrasto(trilho, {
    inicio(p){
      // foco no dedo: o trilho passa a responder às setas, mas sem o anel de foco do teclado
      pararAnim(); trilho.classList.add("sem-anel"); try { trilho.focus({preventScroll:true}); } catch(_){}
      puxando = true; raiz.classList.add("arrastando");
      x0 = p.x; pos0 = pos; rastro = [{x:p.x, t:performance.now()}];
      estrear();
    },
    mover(p){
      if (!puxando) return;
      rastro.push({x:p.x, t:performance.now()}); if (rastro.length > 12) rastro.shift();
      levar(pos0 - (p.x - x0) / ppu);           // arrastar para a esquerda aumenta
    },
    fim(){
      if (!puxando) return;
      puxando = false; raiz.classList.remove("arrastando");
      const ag = performance.now(), ult = rastro[rastro.length - 1];
      let vel = 0;                               // px/ms nos últimos 80 ms; dedo parado = sem inércia
      if (ult && ag - ult.t < 80){
        const ref = rastro.find(a => ag - a.t <= 80) || rastro[0], dt = ult.t - ref.t;
        if (dt > 8) vel = (ult.x - ref.x) / dt;
      }
      inercia(vel);
    }
  });

  const andar = d => { pararAnim(); estrear(true); levar(arred(pos) + d * passo); soltar(); };
  const paraMenos = botaoRepetir(raiz.querySelector('.ctl-passo[data-d="-1"]'), () => andar(-1));
  const paraMais = botaoRepetir(raiz.querySelector('.ctl-passo[data-d="1"]'), () => andar(1));

  const naTecla = e => {
    trilho.classList.remove("sem-anel");
    let d = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") d = -1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") d = 1;
    else if (e.key === "PageDown") d = -10;
    else if (e.key === "PageUp") d = 10;
    else if (e.key === "Home" || e.key === "End"){ e.preventDefault(); pararAnim(); estrear(true); levar(e.key === "Home" ? min : max); soltar(); return; }
    else return;
    e.preventDefault(); pararAnim(); estrear(true);
    levar(arred(pos) + d * passo); soltar();
  };
  const naSaida = () => trilho.classList.remove("sem-anel");
  trilho.addEventListener("keydown", naTecla);
  trilho.addEventListener("blur", naSaida);

  numeroTocavel(elNum, {ler: () => val, gravar: n => definir(n), min: dig.min, max: dig.max, passo: passo});

  // digitado fora da fita: a agulha para no limite, mas o valor devolvido é o digitado
  function definir(v, op){
    pararAnim();
    if (v == null){ val = null; pos = trava(o.inicial == null ? min : o.inicial, min, max); mostrar(); }
    else {
      const n = trava(Number(v), dig.min, dig.max);
      val = +(min + Math.round((n - min) / passo) * passo).toFixed(casas);
      pos = trava(val, min, max); mostrar();
    }
    if (!(op && op.silencioso)){ if (o.aoMudar) o.aoMudar(val); if (o.aoSoltar) o.aoSoltar(val); }
  }

  let ro = null;
  if (window.ResizeObserver){ ro = new ResizeObserver(() => { t.ajustar(); pintar(); }); ro.observe(trilho); }

  const api = {
    valor: () => val,
    definir: definir,
    destruir(){
      pararAnim(); desligarArrasto(); paraMenos(); paraMais();
      trilho.removeEventListener("keydown", naTecla); trilho.removeEventListener("blur", naSaida);
      if (ro) ro.disconnect();
      host.innerHTML = ""; delete host.__ctl;
    }
  };
  mostrar();
  host.__ctl = api;
  return api;
}

/* ---------- traçado ---------- */
// varredura com memória por coluna: a frequência pode mudar no meio sem o traçado pular
function tracado(host, o){
  o = o || {};
  let fc = o.fc || 72, largo = !!o.largo, irr = !!o.irregular;
  const altura = o.altura || 118, segundos = o.segundos || 3.2, grade = o.grade !== false;

  host.innerHTML = "";
  const raiz = document.createElement("div"); raiz.className = "ctl tracado"; host.appendChild(raiz);
  const t = tela(raiz, altura);
  let amostras = new Float32Array(t.larg), msPorPx = segundos * 1000 / t.larg;
  let fase = 0, k = 0, x = 0, volta = 0, anim = null, ant = 0;

  const rrAgora = () => (60000 / fc) * (irr ? (1 + (((k * 7919) % 11) - 5) / 22) : 1);

  // mesma forma da v5, com compressão quando o batimento é curto
  function forma(tt, RR, lg){
    const kk = Math.min(1, RR / 640), z = tt / kk;
    let v = 0;
    if (z >= 0 && z <= 90) v += .12 * Math.sin(Math.PI * z / 90);
    const q0 = 160, qd = lg ? 130 : 80, u = z - q0;
    if (u >= 0 && u <= qd){
      const pts = [[0,0],[.15,-.12],[.4,1],[.65,-.28],[1,0]];
      for (let i = 0; i < 4; i++){
        const a = pts[i][0], va = pts[i][1], b = pts[i+1][0], vb = pts[i+1][1], A = a * qd, B = b * qd;
        if (u >= A && u <= B){ v += va + (vb - va) * (u - A) / (B - A); break; }
      }
    }
    const t0 = q0 + qd + 90;
    if (z >= t0 && z <= t0 + 200) v += .22 * Math.pow(Math.sin(Math.PI * (z - t0) / 200), 1.3);
    return v;
  }

  function avancar(col){
    fase += msPorPx / rrAgora();
    if (fase >= 1){ fase -= 1; k++; }
    const RR = rrAgora();
    amostras[col] = forma(fase * RR, RR, largo);
  }

  const tinta = () => corTema("--ink") || "#fff";

  function pintar(cur, temVolta){
    const ctx = t.ctx, larg = t.larg, alt = t.alt, cor = tinta();
    ctx.clearRect(0, 0, larg, alt);
    if (grade){
      ctx.strokeStyle = cor; ctx.globalAlpha = .05; ctx.lineWidth = 1;
      for (let gx = 0; gx < larg; gx += 20){ ctx.beginPath(); ctx.moveTo(gx + .5, 0); ctx.lineTo(gx + .5, alt); ctx.stroke(); }
      for (let gy = 0; gy < alt; gy += 20){ ctx.beginPath(); ctx.moveTo(0, gy + .5); ctx.lineTo(larg, gy + .5); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    const base = alt * .6, amp = alt * .34;
    ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = cor;
    ctx.shadowColor = cor; ctx.shadowBlur = 6;
    const traco = (a, b, alfa) => {
      if (b <= a) return;
      ctx.globalAlpha = alfa; ctx.beginPath();
      for (let i = a; i <= b; i++){ const y = base - amostras[i] * amp; if (i === a) ctx.moveTo(i, y); else ctx.lineTo(i, y); }
      ctx.stroke();
    };
    traco(0, cur, 1);
    if (temVolta) traco(Math.min(larg - 1, cur + 22), larg - 1, .35);   // volta anterior, apagada
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    ctx.fillStyle = cor; ctx.beginPath(); ctx.arc(cur, base - amostras[cur] * amp, 2.6, 0, 7); ctx.fill();
  }

  function encher(){                       // tela cheia parada (movimento reduzido)
    fase = 0; k = 0; x = 0; volta = 0;
    for (let i = 0; i < t.larg; i++) avancar(i);
    pintar(t.larg - 1, false);
  }

  function passo(){
    if (!t.c.isConnected){ anim = null; return; }
    const ag = performance.now(), dt = Math.min(64, ag - ant); ant = ag;
    const alvo = x + dt / msPorPx;
    for (let col = Math.floor(x) + 1; col <= Math.floor(alvo); col++){
      const i = ((col % t.larg) + t.larg) % t.larg;
      if (i === 0) volta++;
      avancar(i);
    }
    x = alvo;
    pintar(Math.min(t.larg - 1, Math.floor(x % t.larg)), volta > 0);
    anim = requestAnimationFrame(passo);
  }

  function redimensionar(){
    const antes = t.larg; t.ajustar();
    if (t.larg === antes){ if (reduzido()) encher(); return; }
    amostras = new Float32Array(t.larg); msPorPx = segundos * 1000 / t.larg;
    if (reduzido()) encher(); else { x = 0; volta = 0; fase = 0; k = 0; }
  }

  let ro = null;
  if (window.ResizeObserver){ ro = new ResizeObserver(redimensionar); ro.observe(raiz); }

  if (reduzido()) encher();
  else { ant = performance.now(); anim = requestAnimationFrame(passo); }

  const api = {
    definir(op){
      op = op || {};
      if (op.fc != null) fc = op.fc;
      if (op.largo != null) largo = !!op.largo;
      if (op.irregular != null) irr = !!op.irregular;
      if (reduzido()) encher();
      else if (!anim && t.c.isConnected){ ant = performance.now(); anim = requestAnimationFrame(passo); }   // voltou ao DOM
    },
    destruir(){ if (anim) cancelAnimationFrame(anim); anim = null; if (ro) ro.disconnect(); host.innerHTML = ""; delete host.__ctl; }
  };
  host.__ctl = api;
  return api;
}

/* ---------- contador ---------- */
function contador(host, o){
  o = o || {};
  const fator = o.fator == null ? 6 : o.fator, uni = o.unidadeConta || "QRS";
  let n = o.valor || 0;

  host.innerHTML = "";
  const raiz = document.createElement("div"); raiz.className = "ctl contador";
  raiz.innerHTML = (o.rotulo ? `<span class="ctl-rot">${esc(o.rotulo)}</span>` : "")
    + `<div class="ctl-leitura"><span class="ctl-num"><span class="n">0</span><span class="u">${esc(uni)}</span></span><span class="ctl-conta"></span></div>`
    + `<div class="ctl-linha"><button type="button" class="ctl-passo" data-d="-1" aria-label="Tirar um">−</button>`
    + `<button type="button" class="ctl-toque">+1 ${esc(uni)}<small>toque a cada ${esc(uni)} do traçado</small></button>`
    + `<button type="button" class="ctl-passo" data-zerar="1" aria-label="Zerar">0</button></div>`
    + (o.aoUsar ? `<button type="button" class="btn small ctl-usar" disabled>Usar</button>` : "");
  host.appendChild(raiz);

  const elN = raiz.querySelector(".ctl-num .n"), elConta = raiz.querySelector(".ctl-conta");
  const elToque = raiz.querySelector(".ctl-toque"), elUsar = raiz.querySelector(".ctl-usar");
  const resultado = () => Math.round(n * fator);

  function mostrar(){
    elN.textContent = String(n);
    elConta.textContent = "× " + fmt(fator, 1) + " = " + (n ? fmt(resultado(), 0) : "—") + " bpm";
    if (elUsar){ elUsar.disabled = !n; elUsar.textContent = n ? "Usar " + fmt(resultado(), 0) + " bpm" : "Usar"; }
  }

  function contar(novo, pulsa, calado){
    const antes = n; n = Math.max(0, Math.round(novo)); mostrar();
    if (n === antes || calado) return;
    vibrar();
    if (pulsa && !reduzido()){ elToque.classList.remove("pulsa"); void elToque.offsetWidth; elToque.classList.add("pulsa"); }
    if (o.aoMudar) o.aoMudar(n);
  }

  elToque.addEventListener("click", () => contar(n + 1, true));
  elToque.addEventListener("animationend", () => elToque.classList.remove("pulsa"));
  const paraMenos = botaoRepetir(raiz.querySelector('.ctl-passo[data-d="-1"]'), () => contar(n - 1));
  raiz.querySelector("[data-zerar]").addEventListener("click", () => contar(0));
  if (elUsar) elUsar.addEventListener("click", () => { if (n && o.aoUsar) o.aoUsar(resultado()); });

  const api = {
    valor: () => n,
    resultado: resultado,
    definir(v, op){ contar(v || 0, false, !!(op && op.silencioso)); },
    destruir(){ paraMenos(); host.innerHTML = ""; delete host.__ctl; }
  };
  mostrar();
  host.__ctl = api;
  return api;
}

window.Controles = {fita, tracado, contador};
window.Controles._base = {css, reduzido, vibrar, fmt, tela, arrasto, numeroTocavel};
})();
