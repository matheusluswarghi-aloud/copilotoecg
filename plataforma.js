/* Copiloto de ECG — plataforma.js
   Única porta para o que muda entre navegador e app nativo. Hoje só a versão web; o Capacitor
   troca este arquivo depois (mesma interface, nativo:true), sem mexer em app.js. */
(function(){
  "use strict";

  let trava = null;  // Wake Lock em uso, se houver

  function escolherFoto(fonte /* "camera" | "galeria" */){
    const input = document.getElementById("arquivo");
    if (!input) return;
    if (fonte === "camera") input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
  }

  async function telaAcesa(ligar){
    try {
      if (ligar && !trava && navigator.wakeLock){
        trava = await navigator.wakeLock.request("screen");
        trava.addEventListener("release", () => { trava = null; });
      } else if (!ligar && trava){
        const x = trava; trava = null; await x.release();
      }
    } catch(_){ trava = null; }  // falha silenciosa: nem todo navegador tem Wake Lock
  }

  async function copiar(texto){
    try { await navigator.clipboard.writeText(texto); return true; }
    catch(_){ return false; }
  }

  async function compartilhar(texto){
    if (!navigator.share) return false;
    try { await navigator.share({text: texto}); return true; }
    catch(_){ return false; }  // inclui o usuário cancelando o painel de compartilhamento
  }

  function abrirExterno(url){
    try { window.open(url, "_blank", "noopener"); } catch(_){}
  }

  function online(){ return navigator.onLine; }

  function aoMudarRede(fn){
    window.addEventListener("online", () => fn(true));
    window.addEventListener("offline", () => fn(false));
  }

  window.Plataforma = {
    nativo: false,
    escolherFoto,
    telaAcesa,
    copiar,
    compartilhar,
    abrirExterno,
    online,
    aoMudarRede
  };
})();
