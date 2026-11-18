/* FichaCSIRC - ventanita del aviso diario (--recordatorio).
 * Se cierra sola a los pocos minutos: si nadie la atiende, el proceso no puede
 * quedarse vivo dias bloqueando el ejecutable (impedia actualizar).
 * Desde la 3.1 se ficha desde aqui: un renglon por dia con huecos, con la
 * tarea habitual y las horas que faltan ya puestas. Hoy va el primero y
 * destacado (a la hora del aviso es normal que aun le falte); con varios dias
 * hay "Fichar todo". Abajo, la campana: cambiar la hora del aviso o quitarlo. */
"use strict";

let cierreT = null;
let datos = null;        // lo ultimo que dijo el motor
let filas = [];          // un renglon por dia que se puede fichar: {dia, sel, horas, boton}

const hoyIso = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
};
const numero = (texto) => Number(String(texto).replace(",", "."));

function renglon(d, dia, esHoy) {
  const nombre = el("div", { class: "aviso-dia-nombre" },
    el("b", { text: esHoy ? `Hoy · ${dia.nombre.toLowerCase()}` : dia.nombre }),
    el("span", { class: "tenue", text: `${dia.fecha} · faltan ${dia.falta_txt}` }));
  const clase = `aviso-dia${esHoy ? " hoy" : ""}`;
  // sin tareas habituales no hay con que fichar desde aqui: solo se dice
  if (!d.habituales.length) return el("div", { class: `${clase} sin-tarea` }, nombre);
  const sel = el("select", { "aria-label": "Tarea" },
    ...d.habituales.map((h, i) => el("option", { value: String(i),
      text: `${h.tarea}${h.actividad ? ` · ${h.actividad}` : ""}` })));
  const horas = el("input", { class: "horas", inputmode: "decimal", "aria-label": "Horas" });
  horas.value = fmtHoras(dia.falta);
  const boton = el("button", { class: "primario", text: `Fichar ${dia.falta_txt}` });
  const fila = { dia, sel, horas, boton };
  horas.addEventListener("input", () => {
    const n = numero(horas.value);
    boton.textContent = n > 0 ? `Fichar ${fmtHoras(n)}h` : "Fichar";
    pintarTodo();
  });
  boton.onclick = () => fichar([fila]);
  filas.push(fila);
  return el("div", { class: clase }, nombre, sel, el("span", { class: "fila" }, horas, " h"), boton);
}

// "Fichar todo (19,5h)": la suma de lo que dicen los renglones ahora mismo
function pintarTodo() {
  $("todo-aviso").hidden = filas.length < 2;
  const total = filas.reduce((s, f) => s + (numero(f.horas.value) > 0 ? numero(f.horas.value) : 0), 0);
  $("b-todo").textContent = `Fichar todo (${fmtHoras(total)}h)`;
}

function bloquear(si) {
  for (const f of filas) f.boton.disabled = si;
  $("b-todo").disabled = si;
}

// Ficha los renglones de la lista (uno, o todos), cada uno con su tarea y sus
// horas. Si alguno falla, se para ahi y se dice; lo ya fichado, fichado queda.
async function fichar(lista) {
  const d = datos;
  for (const f of lista) {
    const n = numero(f.horas.value);
    if (!(n > 0 && n <= 24)) {
      await avisar("Horas", "Escribe un número entre 0 y 24 (por ejemplo 3,5).");
      f.horas.focus();
      return;
    }
    if (!d.habituales[Number(f.sel.value)]) return;
  }
  if (lista.length > 1) {
    const total = lista.reduce((s, f) => s + numero(f.horas.value), 0);
    if (!(await preguntar("Fichar todo",
        `Se fichan ${fmtHoras(total)}h en ${lista.length} días, cada uno con la tarea y las horas de su fila.`,
        { si: "Fichar todo", no: "Cancelar" }))) return;
  }
  // Con PIN, se pide antes de tocar nada (misma pantalla que en la app).
  if (d.pin && !(await desbloquear())) { api().aviso_responder(false); return; }
  bloquear(true);
  let ultimo = null, fallo = "";
  for (const f of lista) {
    const h = d.habituales[Number(f.sel.value)];
    let r;
    try {
      r = await llamar("aviso_fichar", f.dia.iso, h.wp_id, f.horas.value, h.actividad || "");
    } catch (_e) { break; }                 // llamar ya lo ha dicho
    if (r.error) { fallo = r.error; break; }
    ultimo = r;
  }
  if (ultimo) pintar(ultimo); else bloquear(false);
  if (fallo) await avisar("No se pudo fichar", fallo);
}

function pintar(d) {
  datos = d;
  filas = [];
  const cont = $("dias-aviso");
  cont.replaceChildren();
  const hoy = hoyIso();
  const deHoy = d.dias.filter((x) => x.iso === hoy), antes = d.dias.filter((x) => x.iso !== hoy);
  for (const dia of deHoy) cont.append(renglon(d, dia, true));
  if (deHoy.length && antes.length) {
    cont.append(el("p", { class: "grupo-aviso", text: antes.length === 1 ? "Día anterior" : "Días anteriores" }));
  }
  for (const dia of antes) cont.append(renglon(d, dia, false));
  const nada = !d.dias.length;
  const total = d.dias.reduce((s, x) => s + x.falta, 0);
  $("titulo-aviso").textContent = nada ? "⏰ Fichaje al día"
    : (!antes.length ? `⏰ Hoy te faltan ${fmtHoras(total)}h por fichar`
      : `⏰ Te faltan ${fmtHoras(total)}h por fichar esta semana`);
  $("sub-aviso").hidden = nada;
  $("sub-aviso").textContent = d.habituales.length
    ? "Fíchalas desde aquí con una de tus tareas habituales. Para otra tarea, abre FichaCSIRC."
    : "Abre FichaCSIRC para ficharlas.";
  cont.hidden = nada;
  $("b-todo").disabled = false;      // renglones nuevos: se puede otra vez
  pintarTodo();
  $("hecho").hidden = !nada;
  if (nada) {
    $("pend-aviso").hidden = true;
    $("b-no").textContent = "Cerrar";
    clearTimeout(cierreT);
    cierreT = setTimeout(() => api().aviso_responder(false), 4000);
  }
}

// ---- la campana: a que hora avisa, cambiarla o quitar el aviso ----

async function pintarCampana() {
  let e;
  try {
    e = await api().recordatorio_estado();
  } catch (_e) { return null; }
  const b = $("b-campana");
  b.hidden = !e.soportado || !!e.experimento;
  b.textContent = e.activo ? `🔔 ${e.hora || "Aviso"} · Cambiar` : "🔕 Aviso desactivado";
  return e;
}

async function abrirAjuste() {
  const e = await pintarCampana();
  if (!e) return;
  $("ajuste-hora").value = (e.activo && e.hora) || e.por_defecto || "14:00";
  $("ajuste-quitar").hidden = !e.activo;
  $("ajuste-si").textContent = e.activo ? "Guardar" : "Activar";
  $("ajuste").hidden = false;
  $("ajuste-hora").focus();
}

function cerrarAjuste() {
  $("ajuste").hidden = true;
  $("b-campana").focus();
}

async function guardarAjuste() {
  const hora = $("ajuste-hora").value;
  if (!hora) { $("ajuste-hora").focus(); return; }
  if (datos?.pin && !(await desbloquear())) { api().aviso_responder(false); return; }
  const r = await llamar("recordatorio_activar", hora);
  if (r.error) { await avisar("No se pudo guardar", r.error); return; }
  cerrarAjuste();
  await pintarCampana();
  await avisar("Aviso diario", `Hecho. Te avisaré los días laborables a las ${hora}, solo si te faltan horas por fichar.`);
}

async function quitarAjuste() {
  if (!(await preguntar("Desactivar el aviso",
      "No volveré a avisarte de las horas que falten.\n\nPuedes activarlo otra vez con la campana 🔔 de FichaCSIRC.",
      { si: "Desactivar", no: "Cancelar" }))) return;
  if (datos?.pin && !(await desbloquear())) { api().aviso_responder(false); return; }
  const r = await llamar("recordatorio_desactivar");
  if (r.error) { await avisar("No se pudo desactivar", r.error); return; }
  cerrarAjuste();
  await pintarCampana();
}

async function arrancarAviso() {
  let d;
  try {
    d = await api().aviso_datos();
  } catch (_e) {
    api().aviso_responder(false);    // sin datos no hay nada que avisar
    return;
  }
  aplicarTema(d.tema);
  pintar(d);
  if (d.por_completar > 0 && d.dias.length) {
    const n = d.por_completar;
    $("pend-aviso").replaceChildren(
      el("span", { text: `🧩 En el año tienes ${n} ${n === 1 ? "día" : "días"} sin completar. ` }),
      el("button", { class: "enlace", text: "Abrir «Por completar»",
                     onclick: () => api().aviso_responder(true, "pendientes") }));
    $("pend-aviso").hidden = false;
  }
  $("cierre").textContent = `Se cierra sola en ${d.minutos} min`;
  cierreT = setTimeout(() => api().aviso_responder(false), d.minutos * 60 * 1000);
  (document.querySelector(".aviso-dia button") || $("b-si")).focus();
  pintarCampana();
}

$("b-si").onclick = () => api().aviso_responder(true);
$("b-no").onclick = () => api().aviso_responder(false);
$("b-todo").onclick = () => fichar([...filas]);
$("b-campana").onclick = abrirAjuste;
$("ajuste-no").onclick = cerrarAjuste;
$("ajuste-si").onclick = guardarAjuste;
$("ajuste-quitar").onclick = quitarAjuste;
document.addEventListener("keydown", (e) => {
  if (!$("modal").hidden || document.querySelector(".bloqueo")) return;
  if (e.key !== "Escape") return;
  if (!$("ajuste").hidden) cerrarAjuste();
  else api().aviso_responder(false);
});

cuandoListo(arrancarAviso);
