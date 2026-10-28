/* FichaCSIRC - prototipo web (pywebview).
 *
 * El JS solo pinta y recoge lo que hace el usuario: toda la logica (estado de
 * cada dia, avisos antes de anadir, llamadas a ProyectosTic) vive en Python,
 * en la clase Api de registrar_web.py, accesible como window.pywebview.api.
 * Cada llamada devuelve una promesa: la ventana nunca se congela.
 *
 * Todo el texto que viene de los datos se pone con textContent (nunca
 * innerHTML), para que un comentario con "<" no pueda inyectar HTML.
 */
"use strict";

const $ = (id) => document.getElementById(id);
const api = () => window.pywebview.api;

const st = {
  lunes: null,          // "AAAA-MM-DD"
  hoyLunes: null,
  semana: null,         // ultima respuesta de api.semana()
  marcados: new Set(),  // iso de los dias marcados
  seleccion: new Set(), // "fecha|id" de las filas seleccionadas
  tareas: new Map(),    // texto -> id
  horasAuto: "",
  comAuto: "",
  comentarioGuardia: "",
  ocupado: false,
};

// ---------------------------------------------------------------- utilidades

function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const h of hijos) if (h) n.append(h);
  return n;
}

function sumarDias(iso, n) {
  const [a, m, d] = iso.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d + n));
  return f.toISOString().slice(0, 10);
}

function fmtHoras(h) {
  return (Math.round(h * 100) / 100).toString().replace(".", ",");
}

function estado(texto) { $("estado").textContent = texto || ""; }

function nombreDia(iso) {
  const d = (st.semana?.dias || []).find((x) => x.iso === iso);
  return d ? `${d.nombre} ${d.fecha}` : iso;
}

// Modal propio (confirm() no es igual en todos los visores web).
function preguntar(titulo, texto, { soloAceptar = false } = {}) {
  return new Promise((resolver) => {
    $("modal-titulo").textContent = titulo;
    $("modal-texto").textContent = texto;
    $("modal-no").hidden = soloAceptar;
    $("modal-si").textContent = soloAceptar ? "Aceptar" : "Sí";
    $("modal").hidden = false;
    $("modal-si").focus();
    const cerrar = (valor) => {
      $("modal").hidden = true;
      $("modal-si").onclick = $("modal-no").onclick = null;
      document.removeEventListener("keydown", teclas, true);
      resolver(valor);
    };
    const teclas = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cerrar(false); }
    };
    document.addEventListener("keydown", teclas, true);
    $("modal-si").onclick = () => cerrar(true);
    $("modal-no").onclick = () => cerrar(false);
  });
}
const avisar = (titulo, texto) => preguntar(titulo, texto, { soloAceptar: true });

async function llamar(fn, ...args) {
  try {
    return await api()[fn](...args);
  } catch (e) {
    const msg = (e && (e.message || e.toString())) || "error desconocido";
    estado(`Error: ${msg}`);
    await avisar("Algo ha fallado", msg);
    throw e;
  }
}

// ---------------------------------------------------------------- arranque

async function arrancar() {
  const ini = await llamar("inicio");
  st.lunes = st.hoyLunes = ini.lunes;
  st.comentarioGuardia = ini.comentario_guardia;
  $("version").textContent = `${ini.plataforma} · v${ini.version} · prototipo web`;
  if (ini.logo) { $("logo").src = ini.logo; $("logo").hidden = false; }
  if (ini.inari) { $("subtitulo").textContent += " e INARI"; $("conn-inari").hidden = false; }
  ponerTareas(ini.tareas);
  ponerActividades(ini.actividades, ini.actividad_preferida);
  await cargarSemana({ marcarHoy: true });
  if (st.tareas.size) elegirTarea();
  llamar("usuario").then((n) => { $("usuario").textContent = n || ""; }).catch(() => {});
}

// ---------------------------------------------------------------- semana

async function cargarSemana({ marcarHoy = false } = {}) {
  estado("Cargando semana…");
  $("conn").className = "conn";
  const s = await llamar("semana", st.lunes);
  pintarSemana(s, marcarHoy);
}

async function repintarLocal() {
  pintarSemana(await llamar("repintar", st.lunes), false);
}

function pintarSemana(s, marcarHoy) {
  st.semana = s;
  $("titulo-semana").textContent = s.titulo;
  $("total-semana").textContent = s.total;
  $("tt-semana").hidden = !s.teletrabajo;
  $("tt-semana").textContent = `⌂ ${s.teletrabajo}`;
  $("conn").className = `conn ${s.conexion}`;
  $("conn").title = { ok: "Conectado", warn: "Algún día no se pudo leer",
                      error: "Sin conexión con ProyectosTic" }[s.conexion];
  if (marcarHoy) {
    st.marcados = new Set(s.dias.filter((d) => d.es_hoy).map((d) => d.iso));
  }
  // los marcados que ya no estan en esta semana se descartan
  st.marcados = new Set([...st.marcados].filter((i) => s.dias.some((d) => d.iso === i)));
  st.seleccion.clear();

  const cont = $("dias");
  cont.replaceChildren();
  s.dias.forEach((d, i) => {
    const chips = el("div", { class: "chips" });
    if (d.guardia) chips.append(el("span", { class: "chip chip-guardia", text: "⚙ Guardia" }));
    if (d.teletrabajo) chips.append(el("span", { class: "chip chip-tele", text: "⌂ Teletrabajo" }));
    if (d.permiso) {
      chips.append(el("span", { class: "chip chip-permiso", text: `🕐 Permiso ${d.permiso}`,
                                title: d.permiso_detalle.join("\n") }));
    }
    const barra = el("div", { class: "barra" }, el("i"));
    const tarjeta = el("div", {
      class: `dia ${d.estado}${d.es_hoy ? " hoy" : ""}`,
      tabindex: "0", role: "button",
      title: `${d.nombre} ${d.fecha} · Alt+${i + 1}`,
      onclick: () => alternarDia(d.iso),
      oncontextmenu: (e) => { e.preventDefault(); menuDia(e, d); },
      onkeydown: (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); alternarDia(d.iso); } },
    },
      el("div", { class: "titulo", text: `${d.nombre} ${d.fecha}${d.es_hoy ? "  · hoy" : ""}` }),
      barra,
      el("div", { class: "cifra", text: d.texto }),
      chips.childElementCount ? chips : null);
    tarjeta.dataset.iso = d.iso;
    cont.append(tarjeta);
    // la barra se anima desde 0 al ancho que toca
    requestAnimationFrame(() => { barra.firstChild.style.width = `${d.frac * 100}%`; });
  });
  pintarMarcados();
}

function alternarDia(iso) {
  if (st.marcados.has(iso)) st.marcados.delete(iso); else st.marcados.add(iso);
  pintarMarcados();
}

function pintarMarcados() {
  for (const t of $("dias").children) t.classList.toggle("marcado", st.marcados.has(t.dataset.iso));
  $("toda-semana").checked = st.semana && st.marcados.size === st.semana.dias.length;
  pintarTabla();
  actualizarTotales();
}

// ---------------------------------------------------------------- tabla

function pintarTabla() {
  const cuerpo = $("tabla");
  cuerpo.replaceChildren();
  let filas = 0;
  for (const d of st.semana?.dias || []) {
    if (!st.marcados.has(d.iso)) continue;
    for (const a of d.apuntes) {
      const clave = `${d.iso}|${a.id}`;
      const tr = el("tr", {
        class: st.seleccion.has(clave) ? "sel" : "",
        title: a.comentario ? `${a.tarea}\n“${a.comentario}”` : a.tarea,
        onclick: () => {
          if (st.seleccion.has(clave)) st.seleccion.delete(clave); else st.seleccion.add(clave);
          tr.classList.toggle("sel");
          $("b-eliminar").disabled = !st.seleccion.size;
        },
      },
        el("td", { text: `${d.nombre.slice(0, 3)} ${d.fecha}` }),
        el("td", { class: "num", text: a.horas_txt }),
        el("td", { text: a.tarea }),
        el("td", { text: a.actividad }),
        el("td", { class: "comentario", text: a.comentario }));
      tr.dataset.clave = clave;
      tr.dataset.destino = a.destino;
      cuerpo.append(tr);
      filas++;
    }
  }
  $("tabla-vacia").hidden = filas > 0;
  $("tabla-vacia").textContent = st.marcados.size
    ? "Los días marcados no tienen apuntes." : "Marca un día para ver sus apuntes.";
  $("b-eliminar").disabled = !st.seleccion.size;
}

function actualizarTotales() {
  const marcados = (st.semana?.dias || []).filter((d) => st.marcados.has(d.iso));
  if (marcados.length === 1) {
    const d = marcados[0];
    if (d.no_laborable) {
      estado(`${d.nombre} ${d.fecha}: no laborable (${d.motivo})`);
      sugerirHoras(0);
    } else {
      const extra = d.falta > 0.001 ? `faltan ${fmtHoras(d.falta)}h`
        : (Math.abs(d.falta) < 0.001 ? "completo" : `te pasas ${fmtHoras(-d.falta)}h`);
      estado(`${d.nombre} ${d.fecha}: ${fmtHoras(d.reg)}h / ${fmtHoras(d.obj)}h  (${extra})`);
      sugerirHoras(d.falta);
    }
  } else {
    estado(marcados.length ? `${marcados.length} días marcados` : "Marca al menos un día");
  }
  sugerirComentario();
}

// ---------------------------------------------------------------- formulario

function ponerTareas(tareas) {
  st.tareas.clear();
  const lista = $("lista-tareas");
  lista.replaceChildren();
  for (const t of tareas) {
    st.tareas.set(t.texto, t.id);
    lista.append(el("option", { value: t.texto }));
  }
}

function ponerActividades(nombres, preferida) {
  const sel = $("actividad");
  sel.replaceChildren(...nombres.map((n) => el("option", { value: n, text: n })));
  const i = nombres.findIndex((n) => preferida && n.toLowerCase() === preferida.toLowerCase());
  sel.selectedIndex = i >= 0 ? i : 0;
}

function resolverTarea() {
  const txt = $("tarea").value.trim();
  if (st.tareas.has(txt)) return st.tareas.get(txt);
  if (!txt) return null;
  const cand = [...st.tareas.keys()].filter((k) => k.toLowerCase().includes(txt.toLowerCase()));
  if (cand.length === 1) { $("tarea").value = cand[0]; return st.tareas.get(cand[0]); }
  return null;
}

async function elegirTarea() {
  if (!$("tarea").value && st.tareas.size) $("tarea").value = st.tareas.keys().next().value;
  const id = resolverTarea();
  if (id == null) return;
  const r = await llamar("actividades", id);
  ponerActividades(r.nombres, r.preferida);
  st.comHabitual = r.comentario || "";
  sugerirComentario();
}

function sugerirHoras(falta) {
  const campo = $("horas");
  if (campo.value.trim() && campo.value.trim() !== st.horasAuto) return;
  st.horasAuto = falta > 0.001 ? fmtHoras(falta) : "";
  campo.value = st.horasAuto;
}

function sugerirComentario() {
  const campo = $("comentario");
  if (campo.value.trim() && campo.value.trim() !== st.comAuto) return;
  const marcados = (st.semana?.dias || []).filter((d) => st.marcados.has(d.iso));
  const sugerido = (marcados.length === 1 && marcados[0].guardia)
    ? st.comentarioGuardia : (st.comHabitual || "");
  st.comAuto = sugerido;
  campo.value = sugerido;
}

async function anadir(e) {
  e?.preventDefault();
  if (st.ocupado) return;
  const dias = [...st.marcados].sort();
  const wp = resolverTarea();
  if (wp == null) {
    await avisar("Falta tarea", "Elige una tarea de tus favoritas (puedes escribir para filtrar).");
    return;
  }
  const horas = $("horas").value.trim();
  const actividad = $("actividad").value;
  const comentario = $("comentario").value.trim();
  const chk = await llamar("comprobar", dias, wp, horas);
  if (chk.error) { await avisar("No se puede añadir", chk.error); return; }
  if (dias.length > 1 && !(await preguntar("Confirmar",
      `¿Añadir ${horas}h de «${$("tarea").value}» [${actividad}] a ${dias.length} días?`))) return;
  let permitirRepetir = true;
  for (const a of chk.avisos) {
    const si = await preguntar(a.titulo, a.texto);
    if (a.clave === "repetir") permitirRepetir = si;   // "No" = saltar esos dias
    else if (!si) return;
  }
  st.ocupado = true;
  $("b-anadir").disabled = true;
  estado("Registrando…");
  try {
    const r = await llamar("anadir", dias, wp, horas, comentario, actividad, permitirRepetir);
    $("horas").value = st.horasAuto = "";
    $("comentario").value = st.comAuto = "";
    if (r.errores && !r.creados) {
      await avisar("No se pudo registrar", `No se creó ningún apunte.\n\nDetalle: ${r.ultimo}`);
    } else if (r.errores) {
      await avisar("Registrado con errores",
        `Añadidos: ${r.creados}. Con errores: ${r.errores}.\nÚltimo error: ${r.ultimo}`);
    }
    await cargarSemana();
    if (r.creados) {
      estado(`Apunte añadido (${r.creados}).${r.saltados ? ` Saltados ${r.saltados} (ya existían).` : ""}`);
      st.comHabitual = comentario && comentario !== st.comentarioGuardia ? comentario : st.comHabitual;
    } else if (!r.errores) {
      estado("Esa tarea ya estaba registrada en los días marcados; no se añadió nada.");
    }
  } finally {
    st.ocupado = false;
    $("b-anadir").disabled = false;
  }
}

// ---------------------------------------------------------------- borrar / deshacer

async function eliminar() {
  if (!st.seleccion.size || st.ocupado) return;
  const items = [...st.seleccion].map((clave) => {
    const [fecha, id] = clave.split("|");
    const fila = document.querySelector(`tr[data-clave="${CSS.escape(clave)}"]`);
    return { fecha, id, destino: fila?.dataset.destino || "op" };
  });
  const n = items.length;
  if (!(await preguntar("Eliminar",
      n === 1 ? "¿Seguro que quieres eliminar este apunte?"
              : `¿Seguro que quieres eliminar estos ${n} apuntes?`))) return;
  st.ocupado = true;
  estado("Eliminando…");
  try {
    const r = await llamar("eliminar", items);
    if (r.errores) {
      await avisar("Eliminado con errores",
        `Eliminados: ${r.eliminados}. Con errores: ${r.errores}.\nÚltimo error: ${r.ultimo}`);
    }
    $("b-deshacer").hidden = !r.puede_deshacer;
    await cargarSemana();
    estado(r.eliminados === 1 ? "Apunte eliminado." : `${r.eliminados} apuntes eliminados.`);
  } finally {
    st.ocupado = false;
  }
}

async function deshacer() {
  if ($("b-deshacer").hidden || st.ocupado) return;
  $("b-deshacer").hidden = true;
  st.ocupado = true;
  estado("Restaurando…");
  try {
    const r = await llamar("deshacer");
    if (r.errores) {
      await avisar("Restaurado con errores",
        `Restaurados: ${r.restaurados}. Con errores: ${r.errores}.\nÚltimo error: ${r.ultimo}`);
    }
    await cargarSemana();
    estado(r.restaurados === 1 ? "Apunte restaurado." : `${r.restaurados} apuntes restaurados.`);
  } finally {
    st.ocupado = false;
  }
}

// ---------------------------------------------------------------- menu del dia

function cerrarMenu() { $("menu").hidden = true; }

function menuDia(evento, d) {
  const m = $("menu");
  m.replaceChildren(el("div", { class: "titulo-menu", text: `${d.nombre} ${d.fecha}` }));
  const opcion = (texto, accion, motivo) => m.append(el("button", {
    text: texto,
    onclick: async () => {
      cerrarMenu();
      if (accion === "teletrabajo" && (await llamar("teletrabajo_lleno", d.iso))
          && !(await preguntar("Teletrabajo",
                "Ya tienes cubierto el cupo de teletrabajo de esta semana.\n¿Marcar otro igualmente?"))) return;
      await llamar("accion_dia", d.iso, accion, motivo || "");
      await repintarLocal();
    },
  }));
  if (d.no_laborable) {
    opcion(`Quitar marca (${d.motivo})`, "quitar_no_laborable");
  } else {
    for (const motivo of ["festivo", "vacaciones", "apertura de curso", "baja"]) {
      opcion(`Marcar como ${motivo}`, "no_laborable", motivo);
    }
  }
  m.append(el("hr"));
  opcion(d.guardia ? "Quitar guardia" : "Marcar día de guardia", d.guardia ? "quitar_guardia" : "guardia");
  opcion(d.teletrabajo ? "Quitar teletrabajo" : "Marcar teletrabajo",
         d.teletrabajo ? "quitar_teletrabajo" : "teletrabajo");
  m.append(el("hr"));
  m.append(el("button", { text: "Permisos, plantillas y más: aún no en el prototipo", disabled: "" }));
  m.hidden = false;
  // que no se salga de la ventana
  const { innerWidth: w, innerHeight: h } = window;
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(evento.clientX, w - r.width - 8)}px`;
  m.style.top = `${Math.min(evento.clientY, h - r.height - 8)}px`;
  m.querySelector("button:not([disabled])")?.focus();
}

// ---------------------------------------------------------------- eventos

function enCampo(e) {
  return ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
}

function navegar(delta) {
  st.lunes = delta === 0 ? st.hoyLunes : sumarDias(st.lunes, 7 * delta);
  $("b-deshacer").hidden = true;
  cargarSemana({ marcarHoy: true });
}

$("b-ant").onclick = () => navegar(-1);
$("b-sig").onclick = () => navegar(1);
$("b-hoy").onclick = () => navegar(0);
$("b-recargar").onclick = () => cargarSemana();
$("b-eliminar").onclick = eliminar;
$("b-deshacer").onclick = deshacer;
$("form").addEventListener("submit", anadir);
$("tarea").addEventListener("change", elegirTarea);
$("toda-semana").addEventListener("change", (e) => {
  st.marcados = new Set(e.target.checked ? st.semana.dias.map((d) => d.iso) : []);
  pintarMarcados();
});

document.addEventListener("click", (e) => { if (!$("menu").contains(e.target)) cerrarMenu(); });
window.addEventListener("blur", cerrarMenu);
document.addEventListener("contextmenu", (e) => {
  // fuera de las tarjetas, sin el menu del navegador (no es una web)
  if (!e.target.closest(".dia") && !enCampo(e)) e.preventDefault();
});

document.addEventListener("keydown", (e) => {
  if (!$("modal").hidden) return;
  if (e.key === "Escape") { cerrarMenu(); return; }
  if (e.key === "F5") { e.preventDefault(); cargarSemana(); return; }
  if (e.altKey && /^[1-5]$/.test(e.key)) {
    e.preventDefault();
    const d = st.semana?.dias[Number(e.key) - 1];
    if (d) alternarDia(d.iso);
    return;
  }
  if (enCampo(e)) return;
  if (e.ctrlKey && e.key === "ArrowLeft") { e.preventDefault(); navegar(-1); }
  else if (e.ctrlKey && e.key === "ArrowRight") { e.preventDefault(); navegar(1); }
  else if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); deshacer(); }
  else if (e.key === "Delete") { e.preventDefault(); eliminar(); }
});

if (window.pywebview && window.pywebview.api) arrancar();
else window.addEventListener("pywebviewready", arrancar);
