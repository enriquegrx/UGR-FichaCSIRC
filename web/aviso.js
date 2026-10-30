/* FichaCSIRC - ventanita del aviso diario (--recordatorio).
 * Se cierra sola a los pocos minutos: si nadie la atiende, el proceso no puede
 * quedarse vivo dias bloqueando el ejecutable (impedia actualizar).
 * Desde la 3.1 se ficha desde aqui: un renglon por dia con huecos, con la
 * tarea habitual y las horas que faltan ya puestas. */
"use strict";

let cierreT = null;

function pintar(d) {
  $("texto").textContent = d.texto;
  const cont = $("dias-aviso");
  cont.replaceChildren();
  for (const dia of d.dias) {
    const sel = el("select", { "aria-label": "Tarea" },
      ...d.habituales.map((h, i) => el("option", { value: String(i),
        text: `${h.tarea}${h.actividad ? ` · ${h.actividad}` : ""}` })));
    const horas = el("input", { class: "horas", inputmode: "decimal", "aria-label": "Horas" });
    horas.value = fmtHoras(dia.falta);
    const boton = el("button", { class: "primario", text: `Fichar ${dia.falta_txt}` });
    horas.addEventListener("input", () => {
      const n = Number(horas.value.replace(",", "."));
      boton.textContent = n > 0 ? `Fichar ${fmtHoras(n)}h` : "Fichar";
    });
    boton.onclick = async () => {
      const h = d.habituales[Number(sel.value)];
      if (!h) return;
      const n = Number(horas.value.replace(",", "."));
      if (!(n > 0 && n <= 24)) { await avisar("Horas", "Escribe un número entre 0 y 24 (por ejemplo 3,5)."); horas.focus(); return; }
      // Con PIN, se pide antes de tocar nada (misma pantalla que en la app).
      if (d.pin && !(await desbloquear())) { api().aviso_responder(false); return; }
      boton.disabled = true;
      const r = await llamar("aviso_fichar", dia.iso, h.wp_id, horas.value, h.actividad || "");
      if (r.error) { boton.disabled = false; await avisar("No se pudo fichar", r.error); return; }
      pintar(r);
    };
    cont.append(el("div", { class: "aviso-dia" },
      el("span", { class: "aviso-dia-nombre", text: `${dia.nombre} ${dia.fecha}` }),
      el("span", { class: "tenue", text: `faltan ${dia.falta_txt}` }),
      sel, el("span", { class: "fila" }, horas, " h"), boton));
  }
  const nada = !d.dias.length;
  cont.hidden = nada || !d.habituales.length;
  $("hecho").hidden = !nada;
  if (nada) {
    $("texto").textContent = "";
    $("b-no").textContent = "Cerrar";
    clearTimeout(cierreT);
    cierreT = setTimeout(() => api().aviso_responder(false), 4000);
  }
}

async function arrancarAviso() {
  let d;
  try {
    d = await api().aviso_datos();
  } catch (_e) {
    api().aviso_responder(false);    // sin datos no hay nada que avisar
    return;
  }
  pintar(d);
  $("cierre").textContent = `Esta ventana se cierra sola en ${d.minutos} minutos.`;
  cierreT = setTimeout(() => api().aviso_responder(false), d.minutos * 60 * 1000);
  (document.querySelector(".aviso-dia button") || $("b-si")).focus();
}

$("b-si").onclick = () => api().aviso_responder(true);
$("b-no").onclick = () => api().aviso_responder(false);
document.addEventListener("keydown", (e) => {
  if (!$("modal").hidden || document.querySelector(".bloqueo")) return;
  if (e.key === "Escape") api().aviso_responder(false);
});

cuandoListo(arrancarAviso);
