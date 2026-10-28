/* FichaCSIRC - ventanita del aviso diario (--recordatorio).
 * Se cierra sola a los pocos minutos: si nadie la atiende, el proceso no puede
 * quedarse vivo dias bloqueando el ejecutable (impedia actualizar). */
"use strict";

async function arrancarAviso() {
  let d;
  try {
    d = await api().aviso_datos();
  } catch (_e) {
    api().aviso_responder(false);    // sin datos no hay nada que avisar
    return;
  }
  $("texto").textContent = d.texto;
  $("cierre").textContent = `Esta ventana se cierra sola en ${d.minutos} minutos.`;
  setTimeout(() => api().aviso_responder(false), d.minutos * 60 * 1000);
  $("b-si").focus();
}

$("b-si").onclick = () => api().aviso_responder(true);
$("b-no").onclick = () => api().aviso_responder(false);
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") api().aviso_responder(true);
  if (e.key === "Escape") api().aviso_responder(false);
});

cuandoListo(arrancarAviso);
