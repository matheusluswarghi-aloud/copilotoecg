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

/* ---------- papel de ECG: fundo comum das réguas ---------- */
const claro = () => document.documentElement.dataset.theme === "light";
const fundoPapel = () => claro() ? "#FFF7F6" : "rgba(255,255,255,.04)";

// grade milimetrada: linha fina a cada quadradinho, grossa a cada 5, alinhadas a (x0, y0)
function papel(ctx, larg, alt, pxQ, x0, y0){
  ctx.fillStyle = fundoPapel(); ctx.fillRect(0, 0, larg, alt);
  const fina = claro() ? "rgba(200,60,60,.18)" : "rgba(240,87,154,.16)";
  const grossa = claro() ? "rgba(200,60,60,.45)" : "rgba(240,87,154,.42)";
  const risco = (ax, ay, bx, by, i) => {
    const g = (((i % 5) + 5) % 5) === 0;
    ctx.strokeStyle = g ? grossa : fina; ctx.lineWidth = g ? 1.2 : .7;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  };
  for (let i = Math.ceil(-x0 / pxQ); ; i++){ const x = Math.round(x0 + i * pxQ) + .5; if (x > larg) break; risco(x, 0, x, alt, i); }
  for (let j = Math.ceil((y0 - alt) / pxQ); ; j++){ const y = Math.round(y0 - j * pxQ) + .5; if (y < 0) break; risco(0, y, larg, y, j); }
}

// rótulo sobre o papel: limpa a grade atrás das letras e não passa da borda
function rotulo(ctx, txt, x, y, cor, larg){
  ctx.font = "500 10px " + (corTema("--mono") || "monospace");
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const l = ctx.measureText(txt).width + 8, cx = larg ? trava(x, l / 2 + 1, larg - l / 2 - 1) : x;
  ctx.clearRect(cx - l / 2, y - 10, l, 13);
  ctx.fillStyle = fundoPapel(); ctx.fillRect(cx - l / 2, y - 10, l, 13);
  ctx.fillStyle = cor; ctx.fillText(txt, cx, y);
}

function marcador(ctx, x, alt, cor, tracejado){
  ctx.save();
  ctx.strokeStyle = cor; ctx.lineWidth = 2; ctx.lineCap = "butt";
  if (tracejado) ctx.setLineDash([5, 4]);
  const xx = Math.round(x);          // 2 px de largura: sem o meio pixel, a linha fica nítida
  ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, alt); ctx.stroke();
  ctx.restore();
}

// pegador redondo de 26 px, borda branca de 3 px e duas barrinhas de agarrar
function pegador(ctx, x, cy, cor){
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
  ctx.beginPath(); ctx.arc(x, cy, 11.5, 0, 7); ctx.fillStyle = cor; ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.stroke();
  ctx.lineWidth = 1.6; ctx.lineCap = "round"; ctx.strokeStyle = "rgba(255,255,255,.9)";
  for (const d of [-3.4, 3.4]){ ctx.beginPath(); ctx.moveTo(x + d, cy - 4); ctx.lineTo(x + d, cy + 4); ctx.stroke(); }
  ctx.restore();
}

// papel arrastável: o dedo leva o marcador, sem inércia; setas andam meio quadradinho.
// `aceita(x)` recusa o começo do toque fora da área útil; arrasto que já começou segue valendo.
function ligarPapel(el, h){
  let puxando = false;
  const desligar = arrasto(el, {
    inicio(p){
      if (h.aceita && !h.aceita(p.x)) return;
      el.classList.add("sem-anel"); try { el.focus({preventScroll:true}); } catch(_){}
      puxando = true; el.classList.add("puxando"); h.levar(h.de(p.x));
    },
    mover(p){ if (puxando) h.levar(h.de(p.x)); },
    fim(p){ if (!puxando) return; puxando = false; el.classList.remove("puxando"); h.levar(h.de(p.x)); h.soltar(); }
  });
  const naTecla = e => {
    el.classList.remove("sem-anel");
    const d = (e.key === "ArrowLeft" || e.key === "ArrowDown") ? -1 : ((e.key === "ArrowRight" || e.key === "ArrowUp") ? 1 : 0);
    if (!d) return;
    e.preventDefault(); h.andar(d);
  };
  const naSaida = () => el.classList.remove("sem-anel");
  el.addEventListener("keydown", naTecla); el.addEventListener("blur", naSaida);
  return () => { desligar(); el.removeEventListener("keydown", naTecla); el.removeEventListener("blur", naSaida); };
}

/* ---------- régua do R-R ---------- */
function reguaRR(host, o){
  o = o || {};
  const MIN = 4, MAX = 50, QS = 52, ALT = 132, INICIAL = 20, R = 46;
  const REGRA = [300, 150, 100, 75, 60, 50, 43, 38, 33, 30];
  const arred = v => trava(Math.round(v * 2) / 2, MIN, MAX);
  let val = o.valor == null ? null : arred(o.valor);

  host.innerHTML = "";
  const raiz = document.createElement("div");
  raiz.className = "ctl regua rr";
  raiz.innerHTML = `<div class="ctl-leitura"><span class="ctl-num"><span class="n">—</span><span class="u">bpm</span></span><span class="ctl-conta"></span></div>`
    + `<div class="ctl-papel" role="slider" tabindex="0" aria-label="Quadradinhos até o segundo QRS" aria-valuemin="${MIN}" aria-valuemax="${MAX}"></div>`
    + `<div class="ctl-linha"><button type="button" class="ctl-passo" data-d="-1" aria-label="Meio quadradinho para trás">−</button>`
    + `<button type="button" class="ctl-passo" data-d="1" aria-label="Meio quadradinho para a frente">+</button>`
    + (o.aoUsar ? `<button type="button" class="btn small ctl-usar" disabled>Usar</button>` : "") + `</div>`;
  host.appendChild(raiz);

  const elN = raiz.querySelector(".ctl-num .n"), elConta = raiz.querySelector(".ctl-conta");
  const pap = raiz.querySelector(".ctl-papel"), elUsar = raiz.querySelector(".ctl-usar");
  const t = tela(pap, ALT);
  const fc = () => val == null ? null : Math.round(1500 / val);

  // molde de um batimento, em quadradinhos a partir do pico do R: P e T encurtam quando o R-R encurta
  function molde(rr){
    const folga = Math.max(.8, rr - 2), comP = rr >= 9;
    const pg = trava(.2 * folga, .5, 1.4), pd = trava(.25 * folga, 1, 2), st = trava(.12 * folga, .4, 1.2);
    const td = Math.max(.6, Math.min(trava(.42 * folga, 1.6, 5), folga - .3 - st - (comP ? pg + pd : 0)));
    return {comP, pIni:-.8 - pg - pd, pFim:-.8 - pg, tIni:1.2 + st, tFim:1.2 + st + td};
  }
  // P arredondada, QRS fino com q e S, T assimétrica — os vértices exatos entram no caminho
  function pontos(m){
    const p = [];
    if (m.comP){
      p.push([m.pIni, 0]);
      for (let i = 1; i < 8; i++) p.push([m.pIni + (m.pFim - m.pIni) * i / 8, .17 * R * Math.sin(Math.PI * i / 8)]);
      p.push([m.pFim, 0]);
    }
    p.push([-.8, 0], [-.55, -.10 * R], [0, R], [.55, -.26 * R], [1.2, 0], [m.tIni, 0]);
    for (let i = 1; i < 14; i++) p.push([m.tIni + (m.tFim - m.tIni) * i / 14, .24 * R * Math.pow(Math.sin(Math.PI * i / 14), 1.3)]);
    p.push([m.tFim, 0]);
    return p;
  }

  function pintar(){
    const ctx = t.ctx, larg = t.larg, alt = t.alt, q = larg / QS, x0 = q;
    const base = Math.round(alt * .55), yNum = alt - 30, cy = alt - 15;
    ctx.clearRect(0, 0, larg, alt);
    papel(ctx, larg, alt, q, x0, base);
    const v = val == null ? INICIAL : val, m = molde(v), pts = pontos(m);
    const xb = k => x0 + k * v * q;
    const nb = xb(2) + 1.4 * q < larg ? 3 : 2;      // entra o terceiro batimento se o QRS dele couber inteiro
    const linha = [[-12, base]];
    for (let k = 0; k < nb; k++) for (const p of pts) linha.push([xb(k) + p[0] * q, base - p[1]]);
    linha.push([larg + 12, base]);
    const traco = (a, b, alfa) => {
      ctx.save(); ctx.beginPath(); ctx.rect(a, 0, b - a, alt); ctx.clip();
      ctx.globalAlpha = alfa; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.strokeStyle = corTema("--ink") || "#fff";
      ctx.beginPath(); linha.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.stroke(); ctx.restore();
    };
    // o corte cai na linha de base entre dois batimentos, então a emenda não aparece
    const corte = (a, b) => Math.min(larg, x0 + ((a + b) / 2) * q);
    if (val == null){ const k = corte(m.tFim, v + m.pIni); traco(0, k, 1); traco(k, larg, .4); }
    else if (nb === 3){ const k = corte(v + m.tFim, 2 * v + m.pIni); traco(0, k, 1); traco(k, larg, .4); }
    else traco(0, larg, 1);
    const cor = corTema("--cal-2") || "#5DB4FF";
    ctx.globalAlpha = val == null ? .45 : 1;
    marcador(ctx, xb(1), alt, cor, true);
    pegador(ctx, xb(1), cy, cor);
    ctx.globalAlpha = 1;
    // a regra dos 300 vem por último: a linha do marcador não pode cortar o número
    for (let i = 1; i <= 10; i++){
      const x = x0 + i * 5 * q; if (x > larg - 2) break;
      rotulo(ctx, String(REGRA[i - 1]), x, yNum, corTema("--mute") || "#8A8A95", larg);
    }
  }

  function mostrar(){
    raiz.classList.toggle("vazia", val == null);
    elN.textContent = val == null ? "—" : String(fc());
    const qg = val == null ? 0 : val / 5;
    elConta.textContent = val == null ? "toque onde cai o segundo QRS"
      : fmt(val, 1) + " quadradinhos · " + fmt(qg, 1) + (qg === 1 ? " quadrado grande" : " quadrados grandes");
    if (val == null) pap.removeAttribute("aria-valuenow"); else pap.setAttribute("aria-valuenow", String(val));
    pap.setAttribute("aria-valuetext", val == null ? "não informado" : fmt(val, 1) + " quadradinhos, " + fc() + " bpm");
    if (elUsar){ elUsar.disabled = val == null; elUsar.textContent = val == null ? "Usar" : "Usar " + fc() + " bpm"; }
    pintar();
  }

  function levar(nv){
    const n = arred(nv);
    if (n === val) return;
    val = n; mostrar(); vibrar();
    if (o.aoMudar) o.aoMudar(val);
  }
  const soltar = () => { if (o.aoSoltar) o.aoSoltar(val); };
  const andar = d => { levar(val == null ? INICIAL : val + d * .5); soltar(); };

  const desligar = ligarPapel(pap, {de: x => x / (t.larg / QS) - 1, levar, soltar, andar});
  const paraMenos = botaoRepetir(raiz.querySelector('.ctl-passo[data-d="-1"]'), () => andar(-1));
  const paraMais = botaoRepetir(raiz.querySelector('.ctl-passo[data-d="1"]'), () => andar(1));
  if (elUsar) elUsar.addEventListener("click", () => { if (val != null && o.aoUsar) o.aoUsar(fc()); });

  let ro = null;
  if (window.ResizeObserver){ ro = new ResizeObserver(() => { t.ajustar(); pintar(); }); ro.observe(pap); }

  const api = {
    valor: () => val,
    fc: fc,
    definir(v, op){
      val = v == null ? null : arred(v); mostrar();
      if (!(op && op.silencioso)){ if (o.aoMudar) o.aoMudar(val); if (o.aoSoltar) o.aoSoltar(val); }
    },
    destruir(){ desligar(); paraMenos(); paraMais(); if (ro) ro.disconnect(); host.innerHTML = ""; delete host.__ctl; }
  };
  mostrar();
  host.__ctl = api;
  return api;
}

/* ---------- régua do QT ---------- */
function reguaQT(host, o){
  o = o || {};
  const MIN = 5, MAX = 20, QS = 26, X0Q = 5, ALT = 168, FANTASMA = 9;
  const arred = v => trava(Math.round(v * 2) / 2, MIN, MAX);
  let val = o.valor == null ? null : arred(o.valor), fc = o.fc == null ? null : o.fc;
  const largo = !!o.largo;

  host.innerHTML = "";
  const raiz = document.createElement("div");
  raiz.className = "ctl regua qt";
  raiz.innerHTML = `<div class="ctl-leitura"><button type="button" class="ctl-num" aria-label="Digitar os quadradinhos"><span class="n">—</span><span class="u">quadradinhos</span></button><span class="ctl-conta"></span></div>`
    + `<div class="ctl-papel" role="slider" tabindex="0" aria-label="Quadradinhos do início do QRS até o fim da onda T" aria-valuemin="${MIN}" aria-valuemax="${MAX}"></div>`
    + `<div class="ctl-linha"><button type="button" class="ctl-passo" data-d="-1" aria-label="Meio quadradinho para trás">−</button>`
    + `<button type="button" class="ctl-passo" data-d="1" aria-label="Meio quadradinho para a frente">+</button></div>`;
  host.appendChild(raiz);

  const elNum = raiz.querySelector(".ctl-num"), elN = raiz.querySelector(".ctl-num .n");
  const elConta = raiz.querySelector(".ctl-conta"), pap = raiz.querySelector(".ctl-papel");
  const t = tela(pap, ALT);
  const ms = () => val == null ? null : val * 40;
  const qtc = () => (val == null || !fc) ? null : Math.round(val * 40 / Math.sqrt(60 / fc));

  function pintar(){
    const ctx = t.ctx, larg = t.larg, alt = t.alt, q = larg / QS, x0 = X0Q * q;
    const base = Math.round(alt * .62), cy = alt - 32, yRot = alt - 7, yCota = 20;
    const v = val == null ? FANTASMA : val, w = largo ? 3.5 : 2;
    let lt = trava(.45 * (v - w), 2.5, 7);
    if (v - lt < w + .5) lt = v - w - .5;
    const xf = x0 + v * q, cor1 = corTema("--cal-2") || "#5DB4FF", cor2 = corTema("--cal") || "#FF6A7A";
    ctx.clearRect(0, 0, larg, alt);
    papel(ctx, larg, alt, q, x0, base);
    ctx.globalAlpha = val == null ? .45 : 1;

    ctx.fillStyle = "rgba(93,180,255,.14)"; ctx.fillRect(x0, 7, xf - x0, alt - 45);

    const cx = (x0 + xf) / 2;                      // cota do QT, com o rótulo no meio
    ctx.save(); ctx.strokeStyle = cor1; ctx.lineWidth = 1.2; ctx.lineCap = "butt"; ctx.beginPath();
    ctx.moveTo(x0 + .5, yCota - 5); ctx.lineTo(x0 + .5, yCota + 5);
    ctx.moveTo(xf - .5, yCota - 5); ctx.lineTo(xf - .5, yCota + 5);
    ctx.moveTo(x0, yCota + .5); ctx.lineTo(cx - 12, yCota + .5);
    ctx.moveTo(cx + 12, yCota + .5); ctx.lineTo(xf, yCota + .5);
    ctx.stroke(); ctx.restore();
    rotulo(ctx, "QT", cx, yCota + 4, cor1, larg);

    const p = [[-X0Q - .5, 0], [-4, 0]];           // P · QRS · ST · T, tudo em quadradinhos a partir do início do QRS
    for (let i = 1; i < 8; i++) p.push([-4 + 2.5 * i / 8, 9 * Math.sin(Math.PI * i / 8)]);
    p.push([-1.5, 0], [0, 0], [.15 * w, -5], [.4 * w, 58], [.65 * w, -14], [w, 0], [v - lt, 0]);
    for (let i = 1; i < 16; i++) p.push([v - lt + lt * i / 16, 18 * Math.pow(Math.sin(Math.PI * i / 16), 1.3)]);
    p.push([v, 0], [(larg - x0) / q + .5, 0]);
    ctx.save(); ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = corTema("--ink") || "#fff"; ctx.beginPath();
    p.forEach((a, i) => i ? ctx.lineTo(x0 + a[0] * q, base - a[1]) : ctx.moveTo(x0 + a[0] * q, base - a[1]));
    ctx.stroke(); ctx.restore();

    marcador(ctx, x0, alt, cor1, false);
    marcador(ctx, xf, alt, cor2, true);
    pegador(ctx, xf, cy, cor2);
    // com o QT curto os dois rótulos se encostam: o da esquerda recua o quanto precisar
    const cMute = corTema("--mute") || "#8A8A95";
    ctx.font = "500 10px " + (corTema("--mono") || "monospace");
    const lIni = ctx.measureText("início do QRS").width + 8, lFim = ctx.measureText("fim da T").width + 8;
    const cFim = trava(xf, lFim / 2 + 1, larg - lFim / 2 - 1);
    rotulo(ctx, "início do QRS", Math.min(x0, cFim - (lFim + lIni) / 2 - 5), yRot, cMute, larg);
    rotulo(ctx, "fim da T", cFim, yRot, cMute, larg);
    ctx.globalAlpha = 1;
  }

  function mostrar(){
    raiz.classList.toggle("vazia", val == null);
    if (!elNum.querySelector("input")) elN.textContent = val == null ? "—" : fmt(val, 1);
    elConta.textContent = val == null ? "arraste o marcador até o fim da onda T"
      : ms() + " ms" + (fc ? " · QTc " + qtc() + " ms" : "");
    if (val == null) pap.removeAttribute("aria-valuenow"); else pap.setAttribute("aria-valuenow", String(val));
    pap.setAttribute("aria-valuetext", val == null ? "não informado" : fmt(val, 1) + " quadradinhos, " + ms() + " milissegundos");
    pintar();
  }

  function levar(nv){
    const n = arred(nv);
    if (n === val) return;
    val = n; mostrar(); vibrar();
    if (o.aoMudar) o.aoMudar(val);
  }
  const soltar = () => { if (o.aoSoltar) o.aoSoltar(val); };
  const andar = d => { levar(val == null ? FANTASMA : val + d * .5); soltar(); };

  // só pega à direita do início do QRS: toque sobre a P ou o QRS não mexe no fim da T
  const desligar = ligarPapel(pap, {de: x => x / (t.larg / QS) - X0Q, aceita: x => x >= X0Q * (t.larg / QS), levar, soltar, andar});
  const paraMenos = botaoRepetir(raiz.querySelector('.ctl-passo[data-d="-1"]'), () => andar(-1));
  const paraMais = botaoRepetir(raiz.querySelector('.ctl-passo[data-d="1"]'), () => andar(1));
  numeroTocavel(elNum, {ler: () => val, gravar: n => api.definir(n), min: MIN, max: MAX, passo: .5});

  let ro = null;
  if (window.ResizeObserver){ ro = new ResizeObserver(() => { t.ajustar(); pintar(); }); ro.observe(pap); }

  const api = {
    valor: () => val,
    ms: ms,
    qtc: qtc,
    definir(v, op){
      val = v == null ? null : arred(v); mostrar();
      if (!(op && op.silencioso)){ if (o.aoMudar) o.aoMudar(val); if (o.aoSoltar) o.aoSoltar(val); }
    },
    definirFC(v){ fc = v == null ? null : v; mostrar(); },
    destruir(){ desligar(); paraMenos(); paraMais(); if (ro) ro.disconnect(); host.innerHTML = ""; delete host.__ctl; }
  };
  mostrar();
  host.__ctl = api;
  return api;
}

window.Controles = {fita, tracado, contador, reguaRR, reguaQT};
window.Controles._base = {css, reduzido, vibrar, fmt, tela, arrasto, numeroTocavel};
})();
