/* FichaCSIRC - prototipo web (pywebview): ventana principal.
 *
 * El JS solo pinta y recoge lo que hace el usuario: toda la logica (estado de
 * cada dia, avisos antes de anadir, llamadas a ProyectosTic) vive en Python,
 * en la clase Api de registrar_web.py, accesible como window.pywebview.api.
 * Cada llamada devuelve una promesa: la ventana nunca se congela.
 * Los dialogos (editar, plantillas, permisos...) estan en dialogos.js y las
 * utilidades comunes (el, llamar, preguntar...) en comun.js.
 *
 * Todo el texto que viene de los datos se pone con textContent (nunca
 * innerHTML), para que un comentario con "<" no pueda inyectar HTML.
 */
"use strict";

const st = {
  ini: null,            // respuesta de api.inicio()
  lunes: null,          // "AAAA-MM-DD"
  hoyLunes: null,
  semana: null,         // ultima respuesta de api.semana() o api.mes()
  dias: [],             // dias visibles (5 en la semana; semanas enteras en el mes)
  vista: "semana",      // "semana" | "mes" (se recuerda entre sesiones)
  mesSel: null,         // {anio, mes} del mes visible
  ancla: null,          // ultimo dia pulsado (Mayus+clic marca el rango)
  marcados: new Set(),  // iso de los dias marcados
  seleccion: new Set(), // "fecha|id" de las filas seleccionadas
  tareas: new Map(),    // texto -> id
  asociaciones: {},     // actividad -> wp_id (hechas a mano)
  horasAuto: "",
  comAuto: "",
  comHabitual: "",
  ocupado: false,
  habituales: null,     // tareas habituales (las del "+" de cada dia)
  portapapeles: null,   // {iso, texto}: dia copiado con Ctrl+C
  expandidos: new Set(),// dias de la semana con "+N mas" desplegado
  arrastre: null,       // lo que se esta arrastrando (apunte o tarea habitual)
  paneles: {},          // caja -> "abierto" | "min" | "oculto" (menu Ver)
  zoom: 1,
};

// ---------------------------------------------------------------- tamaño de letra

// Ctrl + / Ctrl - / Ctrl 0 (y menu Ver). Escalones fijos, se recuerda.
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.4];
function aplicarZoom(z, guardar = true) {
  st.zoom = z;
  document.documentElement.style.zoom = z === 1 ? "" : String(z);
  if (guardar) {
    llamar("guardar_zoom", z).catch(() => {});
    estado(z === 1 ? "Tamaño de letra normal." : `Tamaño de letra: ${Math.round(z * 100)} %.`);
  }
}
function cambiarZoom(delta) {
  const i = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(st.zoom) + delta));
  aplicarZoom(ZOOMS[i]);
}

// ---------------------------------------------------------------- bloqueo por inactividad

// Con PIN: pasados N minutos sin tocar la app, se vuelve a pedir.
let inactividadT = null;
function vigilarInactividad() {
  const min = st.ini?.pin?.activo ? st.ini.pin.auto_min : 0;
  clearTimeout(inactividadT);
  if (!min) return;
  const reiniciar = () => {
    clearTimeout(inactividadT);
    inactividadT = setTimeout(bloquearAhora, min * 60 * 1000);
  };
  for (const ev of ["mousemove", "mousedown", "keydown", "wheel", "touchstart"]) {
    document.addEventListener(ev, reiniciar, { passive: true });
  }
  reiniciar();
}
async function bloquearAhora() {
  if (document.querySelector(".bloqueo")) return;
  const r = await llamar("pin_bloquear").catch(() => ({}));
  if (!r.bloqueada) return;
  cerrarMenu();
  if (await desbloquear()) { await cargarSemana(); vigilarInactividad(); }
  else location.href = "configurar.html";
}

// ---------------------------------------------------------------- semana anterior incompleta

async function avisarSemanaAnterior() {
  let r;
  try { r = await api().semana_anterior_pendiente(); } catch (_e) { return; }
  const a = $("aviso-semana");
  if (!r) { a.hidden = true; return; }
  a.replaceChildren(
    el("span", { class: "aviso-semana-texto", text: r.texto }),
    el("button", { class: "enlace", text: "Ir a esa semana", onclick: () => {
      a.hidden = true;
      if (st.vista !== "semana") { st.vista = "semana"; pintarSelectorVista(); llamar("guardar_vista", "semana").catch(() => {}); }
      st.lunes = r.lunes;
      cargarSemana({ marcar: r.dias });
    } }),
    el("button", { class: "cerrar-aviso", text: "×", title: "No volver a avisar de esa semana",
                   "aria-label": "Cerrar", onclick: () => { a.hidden = true; llamar("aviso_semana_visto", r.lunes).catch(() => {}); } }));
  a.hidden = false;
}

// ---------------------------------------------------------------- utilidades

function sumarDias(iso, n) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

function lunesDe(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay();   // 0 = domingo
  return sumarDias(iso, -((dia + 6) % 7));
}

function diasMarcados() {
  return st.dias.filter((d) => st.marcados.has(d.iso));
}

// Resultado de crear apuntes en lote (anadir, copiar, plantilla): avisa de
// los errores, recarga la semana y deja el resumen en la barra de estado.
async function informarLote(r, { hecho, nada }) {
  if (r.error) { await avisar("No se pudo", r.error); return; }
  if (r.errores && !r.creados) {
    await avisar("No se creó ningún apunte", `Detalle: ${r.ultimo}`);
  } else if (r.errores) {
    await avisar("Hecho con errores",
      `Creados: ${r.creados}. Con errores: ${r.errores}.\nÚltimo error: ${r.ultimo}`);
  }
  await cargarSemana();
  if (r.creados) {
    trasCambio(r, `${hecho(r.creados)}${r.saltados ? ` Saltados ${r.saltados} (ya existían).` : ""}`);
  } else if (!r.errores) {
    estado(nada);
  }
}

// ---------------------------------------------------------------- aviso "Deshacer"

// Tras borrar, editar, mover o anadir: un aviso abajo con su "Deshacer" (mas a
// la vista que el boton del panel, que sigue ahi, igual que Ctrl+Z).
let avisoT = null;
function trasCambio(r, texto) {
  estado(texto);
  if (!r.puede_deshacer) { $("b-deshacer").hidden = true; ocultarAviso(); return; }
  $("b-deshacer").hidden = false;
  const a = $("aviso-deshacer");
  a.replaceChildren(el("span", { text: texto }),
    el("button", { class: "enlace", text: "Deshacer", onclick: () => deshacer() }),
    el("button", { class: "cerrar-aviso", text: "×", title: "Cerrar", "aria-label": "Cerrar",
                   onclick: ocultarAviso }));
  a.hidden = false;
  clearTimeout(avisoT);
  avisoT = setTimeout(ocultarAviso, 10000);
}
function ocultarAviso() {
  clearTimeout(avisoT);
  $("aviso-deshacer").hidden = true;
}

// ---------------------------------------------------------------- menus

function cerrarMenu() { $("menu").hidden = true; }

/* items: [{texto, accion, desactivado}] | "-" (separador) | {titulo} */
function mostrarMenu(x, y, items) {
  const m = $("menu");
  m.replaceChildren();
  for (const it of items) {
    if (it === "-") { m.append(el("hr")); continue; }
    if (it.titulo) { m.append(el("div", { class: "titulo-menu", text: it.titulo })); continue; }
    m.append(el("button", {
      text: it.texto, disabled: !!it.desactivado, class: it.clase,
      onclick: () => { cerrarMenu(); it.accion(); },
    }));
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 8))}px`;
  m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 8))}px`;
  m.querySelector("button:not([disabled])")?.focus();
}

function menuBajo(boton, items) {
  const r = boton.getBoundingClientRect();
  mostrarMenu(r.left, r.bottom + 2, items);
}

const MENUS = {
  archivo: () => [
    { texto: "Exportar a CSV…", accion: dlgExportar },
    { texto: "Resumen del mes", accion: dlgResumen },
  ],
  ver: () => [
    ...PANELES.map(([id, nombre]) => ({
      texto: `${st.paneles[id] === "oculto" ? "      " : "✓   "}${nombre}`
             + (st.paneles[id] === "min" ? "  (minimizada)" : ""),
      accion: () => ponerPanel(id, st.paneles[id] === "oculto" ? "abierto" : "oculto"),
    })),
    "-",
    { texto: "Mostrar todo", accion: () => { for (const [id] of PANELES) ponerPanel(id, "abierto", false); guardarPaneles(); } },
    "-",
    { texto: "Aumentar texto\tCtrl +", desactivado: st.zoom >= ZOOMS[ZOOMS.length - 1], accion: () => cambiarZoom(1) },
    { texto: "Reducir texto\tCtrl −", desactivado: st.zoom <= ZOOMS[0], accion: () => cambiarZoom(-1) },
    { texto: "Tamaño normal\tCtrl 0", desactivado: st.zoom === 1, accion: () => aplicarZoom(1) },
  ],
  herramientas: () => [
    { texto: "Plantillas…", accion: dlgPlantillas },
    { texto: "Importar festivos…", accion: dlgFestivos },
    { texto: "Vacaciones y teletrabajo…", accion: dlgAjustesDias },
    { texto: "Permisos (horas)…", accion: dlgPermisos },
    { texto: "Integraciones (INARI)…", accion: dlgInari },
    { texto: "Aviso diario de fichaje…", accion: dlgRecordatorio },
    { texto: "PIN de acceso…", accion: dlgPin },
    "-",
    { texto: "Configuración (asistente)…", accion: () => { location.href = "configurar.html"; } },
  ],
  ayuda: () => [
    { texto: "Atajos de teclado", accion: dlgAtajos },
    { texto: "Novedades (qué hay de nuevo)", accion: dlgNovedades },
    { texto: "Comprobar actualizaciones", accion: () => dlgActualizacion({ forzar: true }) },
    st.ini?.github ? { texto: "Ver en GitHub", accion: () => llamar("abrir_github", "") } : null,
    "-",
    { texto: "Tecnología utilizada", accion: dlgTecnologia },
    { texto: "Acerca de FichaCSIRC", accion: dlgAcerca },
  ].filter(Boolean),
};

// ---------------------------------------------------------------- cajas (menu Ver)

// Cada caja se puede minimizar (queda su titulo; un clic la abre) o cerrar, y
// volver a poner desde Ver. La franja y la leyenda, solo mostrar u ocultar.
const PANELES = [["form", "Añadir apunte"], ["habituales", "Tus tareas habituales"],
                 ["apuntes", "Apuntes de la semana"], ["franja", "Franja de resumen"],
                 ["leyenda", "Leyenda de colores"]];
const MINIMIZABLES = ["form", "habituales", "apuntes"];
const nodoPanel = (id) => document.querySelector(`[data-panel="${id}"]`);

function controlesPaneles() {
  for (const id of MINIMIZABLES) {
    const cab = nodoPanel(id).querySelector(".cabeza-seccion");
    const min = el("button", { class: "b-panel", "data-accion": "min" });
    const cerrar = el("button", { class: "b-panel", text: "×", title: "Cerrar (vuelve desde el menú Ver)",
                                  "aria-label": "Cerrar esta caja" });
    min.onclick = (e) => { e.stopPropagation(); ponerPanel(id, st.paneles[id] === "min" ? "abierto" : "min"); };
    cerrar.onclick = (e) => { e.stopPropagation(); ponerPanel(id, "oculto"); };
    cab.append(el("span", { class: "controles-panel" }, min, cerrar));
    // minimizada: un clic en su titulo la vuelve a abrir
    cab.querySelector("h2").addEventListener("click", () => {
      if (st.paneles[id] === "min") ponerPanel(id, "abierto");
    });
  }
}

function pintarPaneles() {
  for (const [id] of PANELES) {
    const n = nodoPanel(id);
    const e = st.paneles[id] || "abierto";
    n.classList.toggle("cerrado", e === "oculto");
    n.classList.toggle("minimizado", e === "min");
    const b = n.querySelector('.b-panel[data-accion="min"]');
    if (b) {
      b.textContent = e === "min" ? "▢" : "–";
      b.title = e === "min" ? "Abrir" : "Minimizar (queda solo el título)";
      b.setAttribute("aria-label", b.title);
    }
  }
  // Una columna si la otra se quedo sin cajas; ninguna, si se cerraron todas.
  const izq = ["form", "habituales"].some((id) => st.paneles[id] !== "oculto");
  const der = st.paneles.apuntes !== "oculto";
  const zona = document.querySelector(".zona-trabajo");
  zona.classList.toggle("una-columna", izq !== der);
  zona.classList.toggle("cerrado", !izq && !der);
  document.querySelector(".col-izq").classList.toggle("cerrado", !izq);
}

function ponerPanel(id, estadoPanel, guardar = true) {
  st.paneles[id] = estadoPanel;
  pintarPaneles();
  if (guardar) guardarPaneles();
}

function guardarPaneles() {
  llamar("guardar_paneles", st.paneles).catch(() => {});
}

// ---------------------------------------------------------------- arranque

async function arrancar() {
  // Con PIN, nada se pide ni se pinta hasta acertarlo; si se olvido y se borro
  // la configuracion, al asistente.
  if (!(await desbloquear())) { location.href = "configurar.html"; return; }
  const ini = st.ini = await llamar("inicio");
  st.paneles = { ...(ini.paneles || {}) };
  controlesPaneles();
  pintarPaneles();
  if (ini.zoom && ini.zoom !== 1) aplicarZoom(ini.zoom, false);
  vigilarInactividad();
  st.lunes = st.hoyLunes = ini.lunes;
  st.mesSel = mesDe(hoyIso());
  st.vista = ini.vista === "mes" ? "mes" : "semana";
  pintarSelectorVista();
  st.asociaciones = ini.asociaciones || {};
  $("version").textContent = `${ini.plataforma} · v${ini.version}${ini.experimento ? " · prototipo web" : ""}`;
  document.querySelector(".etiqueta-prototipo").hidden = !ini.experimento;
  if (ini.logo) { $("logo").src = ini.logo; $("logo").hidden = false; }
  if (ini.inari) { $("subtitulo").textContent += " e INARI"; $("conn-inari").hidden = false; }
  ponerTareas(ini.tareas);
  ponerActividades(ini.actividades, ini.actividad_preferida);
  await cargarSemana({ marcarHoy: true });
  avisarSemanaAnterior();
  refrescarFranja();
  if (st.tareas.size) elegirTarea();
  llamar("usuario").then((n) => { $("usuario").textContent = n || ""; }).catch(() => {});
  // A partir del 1 de enero: ofrecer (una vez, opcional) los permisos del año.
  if (ini.toca_permisos_anio) setTimeout(() => dlgPermisosAnio({ manual: false }), 700);
  // Recien actualizada: lo nuevo de esta version, una sola vez.
  if (ini.novedades_tras_actualizar) setTimeout(() => dlgNovedades(ini.novedades_tras_actualizar), 400);
  // Sin PIN: sugerirlo (no a la vez que las novedades, para no amontonar).
  else if (ini.sugerir_pin) setTimeout(dlgSugerirPin, 900);
  // Version nueva (como mucho cada pocas horas; si falla, en silencio).
  setTimeout(() => dlgActualizacion({ forzar: false }), 1500);
  // Mac: avisar si la app no esta en Aplicaciones (una vez por ruta).
  llamar("aviso_aplicaciones").then((m) => { if (m) dlgAplicaciones(m); }).catch(() => {});
}

// ---------------------------------------------------------------- semana / mes

function hoyIso() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
}
const mesDe = (iso) => ({ anio: Number(iso.slice(0, 4)), mes: Number(iso.slice(5, 7)) });

// Lunes de la semana "de trabajo": la visible en vista semana; en la mensual,
// la del primer dia marcado (o la actual). Lo usa "Copiar semana anterior".
function lunesReferencia() {
  if (st.vista === "semana") return st.lunes;
  const marcados = [...st.marcados].sort();
  return marcados.length ? lunesDe(marcados[0]) : st.hoyLunes;
}

// Recarga la vista actual (semana o mes) desde ProyectosTic.
async function cargarSemana({ marcarHoy = false, marcar = null } = {}) {
  estado(st.vista === "mes" ? "Cargando mes…" : "Cargando semana…");
  $("conn").className = "conn";
  const datos = st.vista === "mes" ? await llamar("mes", st.mesSel.anio, st.mesSel.mes)
                                   : await llamar("semana", st.lunes);
  pintarVista(datos, marcarHoy, marcar);
  // Navegar (marcarHoy/marcar) no cambia los datos; recargar tras añadir,
  // borrar, editar, copiar o F5 si: entonces se rehace la franja.
  if (!marcarHoy && !marcar) refrescarFranja();
}

// Repinta sin red tras una marca local (festivo, guardia, permiso...).
async function repintarLocal() {
  const datos = st.vista === "mes" ? await llamar("repintar_mes", st.mesSel.anio, st.mesSel.mes)
                                   : await llamar("repintar", st.lunes);
  pintarVista(datos, false);
  refrescarFranja();
}

// ---------------------------------------------------------------- franja de resumen

let franjaSeq = 0;
async function refrescarFranja() {
  const mio = ++franjaSeq;
  let r;
  try {
    r = await api().resumen_franja();       // sin modal: si falla, no se pinta
  } catch (_e) {
    return;
  }
  if (mio !== franjaSeq) return;
  const items = [el("span", { class: "franja-titulo", text: "Resumen" })];
  for (const m of r.meses) {
    items.push(el("button", {
      class: `franja-item ${m.al_dia ? "ok" : "aviso"}`, title: `Ver ${m.titulo} en la vista mensual`,
      onclick: () => irAMes(m.anio, m.mes),
    }, el("span", { class: "tenue", text: `${m.titulo}: ` }), el("span", { text: m.texto })));
  }
  for (const p of r.permisos) {
    items.push(el("button", { class: `franja-item${p.negativo ? " aviso" : ""}`,
                              title: "Herramientas > Permisos", onclick: () => dlgPermisos() },
      el("span", { class: "tenue", text: `${p.nombre}: ` }), el("span", { text: `${p.disponible} h` })));
  }
  if (r.vacaciones) {
    items.push(el("button", { class: "franja-item", title: "Herramientas > Vacaciones y teletrabajo",
                              onclick: () => dlgAjustesDias() },
      el("span", { class: "tenue", text: "Vacaciones: " }),
      el("span", { text: `quedan ${r.vacaciones.quedan} de ${r.vacaciones.cupo} días` })));
  }
  $("franja").replaceChildren(...items);
  st.habituales = r.habituales;
  pintarHabituales(r.habituales);
  $("franja").hidden = items.length < 2;
}

// ---------------------------------------------------------------- tareas habituales

function pintarHabituales(h) {
  const lista = $("lista-habituales");
  if (!h || !h.filas.length) { $("habituales").hidden = true; return; }
  $("habituales-periodo").textContent = `${h.desde} · ${h.total}`;
  const max = Math.max(...h.filas.map((f) => f.horas));
  lista.replaceChildren(...h.filas.map((f) => {
    const barra = el("div", { class: "hab-barra" }, el("i"));
    const fila = el("div", { class: "hab-fila" },
      // Dos lineas: "tarea · actividad ... horas · %" y la barra. Las horas de
      // cada dia ya las dice el boton "+ 6,5h"; la ayuda va en el globo.
      el("button", { class: "hab-info",
                     title: `${f.tarea}${f.actividad ? ` · ${f.actividad}` : ""}\n`
                            + `Normalmente ${f.tipico_txt} al día\n`
                            + "Clic: rellena el formulario con esta tarea",
                     onclick: () => usarHabitual(f) },
        el("div", { class: "hab-cab" },
          el("span", { class: "hab-tarea" }, f.tarea,
            f.actividad ? el("span", { class: "tenue", text: ` · ${f.actividad}` }) : null),
          el("span", { class: "tenue hab-num", text: `${f.horas_txt} · ${f.pct}%` })),
        barra),
      el("button", { class: "hab-mas", title: `Añadir ${f.tipico_txt} a los días marcados`,
                     onclick: () => usarHabitual(f, true) }, `+ ${f.tipico_txt}`));
    arrastrable(fila, { tipo: "habitual", f });
    fila.title = "Arrástrala a un día para añadirla";
    requestAnimationFrame(() => { barra.firstChild.style.width = `${Math.round((f.horas / max) * 100)}%`; });
    return fila;
  }));
  $("habituales").hidden = false;
}

// Rellena el formulario con la tarea, su actividad y sus horas habituales; con
// anadirYa, ademas la anade (pasando por los avisos de siempre).
async function usarHabitual(f, anadirYa = false) {
  if (!anadirYa && st.paneles.form !== "abierto") ponerPanel("form", "abierto");
  let texto = textoDeTarea(f.wp_id);
  if (!texto) {                         // no esta en favoritas: a la lista de la sesion
    ponerTareas(await llamar("elegir_tareas", [{ id: f.wp_id, nombre: f.tarea }], false));
    texto = textoDeTarea(f.wp_id);
  }
  $("tarea").value = texto;
  await elegirTarea();                  // carga SUS actividades
  if (f.actividad) {
    const sel = $("actividad");
    if (![...sel.options].some((o) => o.value === f.actividad)) {
      sel.append(el("option", { value: f.actividad, text: f.actividad }));
    }
    sel.value = f.actividad;
  }
  $("horas").value = st.horasAuto = fmtHoras(f.tipico);
  if (anadirYa) await anadir();
  else { $("horas").focus(); estado(`Formulario rellenado con «${f.tarea}».`); }
}

function irAMes(anio, mes) {
  st.vista = "mes";
  st.mesSel = { anio, mes };
  pintarSelectorVista();
  llamar("guardar_vista", "mes").catch(() => {});
  cargarSemana({ marcarHoy: true });
}

function pintarVista(datos, marcarHoy, marcar = null) {
  st.semana = datos;
  st.dias = st.vista === "mes" ? datos.semanas.flat() : datos.dias;
  $("titulo-semana").textContent = datos.titulo;
  $("total-semana").textContent = datos.total;
  $("tt-semana").hidden = st.vista === "mes" || !datos.teletrabajo;
  $("tt-semana").textContent = `⌂ ${datos.teletrabajo || ""}`;
  $("estado-vista").hidden = st.vista !== "mes";
  if (st.vista === "mes") {
    $("estado-vista").textContent = datos.estado;
    $("estado-vista").className = `chip-estado ${datos.al_dia ? "ok" : "aviso"}`;
  }
  $("conn").className = `conn ${datos.conexion}`;
  $("conn").title = { ok: "Conectado", warn: "Algún día no se pudo leer",
                      error: "Sin conexión con ProyectosTic" }[datos.conexion];
  if (marcar) st.marcados = new Set(marcar);
  else if (marcarHoy) st.marcados = new Set(st.dias.filter((d) => d.es_hoy).map((d) => d.iso));
  st.marcados = new Set([...st.marcados].filter((i) => st.dias.some((d) => d.iso === i)));
  st.seleccion.clear();
  st.scrollPanel = true;          // periodo nuevo: el panel va al dia marcado
  $("lbl-todo").textContent = st.vista === "mes" ? " Todo el mes" : " Toda la semana";
  if (st.vista === "mes") pintarMes(datos); else pintarDiasSemana(datos);
  pintarMarcados();
}

// Comportamiento comun de una tarjeta o celda de dia.
function eventosDia(nodo, d) {
  nodo.tabIndex = 0;
  nodo.setAttribute("role", "button");
  nodo.dataset.iso = d.iso;
  nodo.addEventListener("click", (e) => alternarDia(d.iso, e));
  nodo.addEventListener("contextmenu", (e) => { e.preventDefault(); menuDia(e.clientX, e.clientY, d); });
  nodo.addEventListener("dragover", (e) => {
    if (!st.arrastre || d.estado === "error") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.shiftKey && st.arrastre.tipo === "apunte" ? "move" : "copy";
    nodo.classList.add("soltar");
  });
  nodo.addEventListener("dragleave", (e) => {
    if (!nodo.contains(e.relatedTarget)) nodo.classList.remove("soltar");
  });
  nodo.addEventListener("drop", (e) => {
    e.preventDefault();
    nodo.classList.remove("soltar");
    const a = st.arrastre;
    st.arrastre = null;
    if (a) soltarEnDia(d, a, e.shiftKey);
  });
  nodo.addEventListener("keydown", (e) => {
    if (e.key === "+") { e.preventDefault(); const r = nodo.getBoundingClientRect(); menuAnadirRapido(d, r.left + 20, r.top + 30); }
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); alternarDia(d.iso, e); }
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = nodo.getBoundingClientRect();
      menuDia(r.left + 20, r.bottom - 10, d);
    }
  });
}

function pintarDiasSemana(s) {
  const cont = $("dias");
  cont.className = "dias";
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
      title: `${d.nombre} ${d.fecha} · Alt+${i + 1} · Mayús+clic: rango · botón derecho: más opciones`,
    },
      el("div", { class: "titulo", text: `${d.nombre} ${d.fecha}${d.es_hoy ? "  · hoy" : ""}` }),
      barra,
      el("div", { class: "cifra", text: d.texto }),
      chips.childElementCount ? chips : null,
      ...apuntesTarjeta(d),
      botonMasDia(d));
    eventosDia(tarjeta, d);
    cont.append(tarjeta);
    requestAnimationFrame(() => { barra.firstChild.style.width = `${d.frac * 100}%`; });
  });
}

// Lo que se hizo ese dia, dentro de la tarjeta de la semana: con 1-2 apuntes
// habituales se ve la semana entera sin ir marcando dia a dia.
const MAX_APUNTES_TARJETA = 3;
function apuntesTarjeta(d) {
  if (d.estado === "vacio") return [el("div", { class: "sin-apuntes", text: "Sin apuntes" })];
  const abierto = st.expandidos.has(d.iso);
  const max = abierto ? Infinity : MAX_APUNTES_TARJETA;
  const out = d.apuntes.slice(0, max).map((a) => {
    const n = el("div", { class: "ap-tarjeta" },
      el("div", { class: "linea-ap" },
        horasEditables(d, a),
        el("span", { class: "linea-t", text: a.tarea })),
      a.actividad ? el("div", { class: "linea-act", text: a.actividad }) : null,
      accionesTarjeta(d, a));
    arrastrableApunte(n, d, a);
    return n;
  });
  const resto = d.apuntes.length - MAX_APUNTES_TARJETA;
  if (resto > 0) {
    out.push(botonMas(abierto ? "ver menos" : `+${resto} más`, () => {
      if (abierto) st.expandidos.delete(d.iso); else st.expandidos.add(d.iso);
      pintarDiasSemana(st.semana);
      pintarMarcados();
    }));
  }
  return out;
}

// "+N mas" como boton: no marca el dia al pulsarlo.
function botonMas(texto, accion) {
  const b = el("button", { class: "linea-mas boton-mas", text: texto });
  b.addEventListener("click", (e) => { e.stopPropagation(); accion(); });
  b.addEventListener("keydown", (e) => e.stopPropagation());
  return b;
}

// ---------------------------------------------------------------- añadir desde la ficha

// "+" en la esquina de cada dia (al pasar el raton): tus tareas habituales con
// las horas ya puestas; un clic y añadida, sin marcar el dia ni el formulario.
function botonMasDia(d) {
  if (d.estado === "error") return null;
  const b = el("button", { class: "b-mas-dia", title: "Añadir una tarea a este día (tecla +)",
                           "aria-label": `Añadir una tarea al ${d.nombre} ${d.fecha}`, text: "+" });
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = b.getBoundingClientRect();
    menuAnadirRapido(d, r.left, r.bottom + 2);
  });
  b.addEventListener("keydown", (e) => e.stopPropagation());
  return b;
}

// Horas que se proponen para una tarea habitual en un dia: lo que falta si es
// menos que lo de siempre (el hueco de la tarde), y si no, lo de siempre.
function horasPropuestas(d, f) {
  const falta = Math.max(0, d.falta || 0);
  return falta > 0.001 ? Math.min(f.tipico, falta) : f.tipico;
}

const corto = (t, n = 38) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function menuAnadirRapido(d, x, y) {
  if (d.estado === "error") return;
  const filas = st.habituales?.filas || [];
  const items = [{ titulo: `Añadir al ${d.nombre.toLowerCase()} ${d.fecha}`
                           + (d.falta > 0.001 ? ` · faltan ${fmtHoras(d.falta)}h` : "") }];
  for (const f of filas) {
    const h = horasPropuestas(d, f);
    items.push({ texto: `+ ${fmtHoras(h)}h   ${corto(f.tarea)}${f.actividad ? ` · ${f.actividad}` : ""}`,
                 accion: () => anadirRapido(d, f, h) });
  }
  if (filas.length) items.push("-");
  items.push({ texto: "Otra tarea u otras horas…", accion: () => dlgEditarDia(d, { nueva: true }) });
  mostrarMenu(x, y, items);
}

// Añade UNA tarea a UN dia pasando por los mismos avisos que el formulario
// (tarea repetida ese dia, pasarse de la jornada). f: {wp_id, tarea, actividad}.
async function anadirRapido(d, f, horas, comentario = null) {
  if (st.ocupado) return;
  const h = fmtHoras(horas);
  const chk = await llamar("comprobar", [d.iso], f.wp_id, h);
  if (chk.error) { await avisar("No se puede añadir", chk.error); return; }
  for (const a of chk.avisos) {
    if (!(await preguntar(a.titulo, a.texto))) return;
  }
  st.ocupado = true;
  estado("Registrando…");
  try {
    if (comentario === null) {
      comentario = (await llamar("actividades", f.wp_id).catch(() => ({}))).comentario || "";
    }
    const r = await llamar("anadir", [d.iso], f.wp_id, h, comentario, f.actividad || "", true);
    await informarLote(r, { hecho: () => `${h}h de «${corto(f.tarea, 50)}» al ${d.nombre.toLowerCase()} ${d.fecha}.`,
                            nada: "No se añadió nada." });
  } finally {
    st.ocupado = false;
  }
}

// ---------------------------------------------------------------- cambiar horas en la ficha

// Doble clic sobre las horas de un apunte: se escriben ahi mismo (Enter guarda,
// Esc cancela). Para el retoque de media hora, sin abrir ninguna ventana.
function horasEditables(d, a) {
  const s = el("span", { class: "linea-h", text: a.horas_txt });
  if (a.destino === "inari" || d.estado === "error") return s;
  s.classList.add("editable");
  s.title = "Doble clic: cambiar las horas";
  s.addEventListener("dblclick", (e) => { e.stopPropagation(); editarHorasEnSitio(s, d, a); });
  return s;
}

function editarHorasEnSitio(s, d, a) {
  const i = el("input", { class: "horas-en-sitio", inputmode: "decimal",
                          "aria-label": `Horas de ${a.tarea}` });
  i.value = fmtHoras(a.horas);
  const padre = s.closest("[draggable]");
  if (padre) padre.draggable = false;        // para poder seleccionar el texto
  let hecho = false;
  const terminar = async (guardar) => {
    if (hecho) return;
    hecho = true;
    const v = i.value.trim();
    i.replaceWith(s);
    if (padre) padre.draggable = true;
    const n = Number(v.replace(",", "."));
    if (!guardar || !v || Math.abs(n - a.horas) < 0.001) return;
    if (!(n > 0 && n <= 24)) { await avisar("Horas no válidas", "Escribe un número entre 0 y 24 (por ejemplo 3,5)."); return; }
    s.textContent = `${fmtHoras(n)}h`;
    const r = await llamar("editar", d.iso, a.id, v);
    if (r.error) { s.textContent = a.horas_txt; await avisar("No se pudo cambiar", r.error); return; }
    await cargarSemana();
    trasCambio(r, `${corto(a.tarea, 40)}: ${a.horas_txt} → ${fmtHoras(n)}h.`);
  };
  i.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); terminar(true); }
    if (e.key === "Escape") { e.preventDefault(); terminar(false); }
  });
  for (const ev of ["click", "dblclick", "mousedown"]) i.addEventListener(ev, (e) => e.stopPropagation());
  i.addEventListener("blur", () => terminar(true));
  s.replaceWith(i);
  i.focus();
  i.select();
}

// ---------------------------------------------------------------- arrastrar a otro dia

// Arrastrar un apunte a otro dia lo COPIA; con Mayus pulsada al soltar, lo
// MUEVE. Una tarea habitual arrastrada a un dia se añade con sus horas.
function arrastrable(nodo, datos) {
  nodo.draggable = true;
  nodo.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    st.arrastre = datos;
    e.dataTransfer.setData("text/plain", datos.tipo === "apunte" ? datos.a.tarea : datos.f.tarea);
    e.dataTransfer.effectAllowed = "copyMove";
    document.body.classList.add("arrastrando");
  });
  nodo.addEventListener("dragend", () => {
    document.body.classList.remove("arrastrando");
    setTimeout(() => { st.arrastre = null; }, 0);
  });
}

function arrastrableApunte(nodo, d, a) {
  if (a.destino === "inari" || d.estado === "error") return;
  arrastrable(nodo, { tipo: "apunte", fecha: d.iso, a });
  nodo.title = "Arrástralo a otro día para copiarlo (con Mayús, para moverlo)";
}

async function soltarEnDia(d, x, mover) {
  if (x.tipo === "habitual") { await anadirRapido(d, x.f, horasPropuestas(d, x.f)); return; }
  if (x.fecha === d.iso) return;
  const tarea = { wp_id: x.a.wp_id, tarea: x.a.tarea, actividad: x.a.actividad };
  if (!mover) { await anadirRapido(d, tarea, x.a.horas, x.a.comentario || ""); return; }
  if (st.ocupado) return;
  st.ocupado = true;
  estado("Moviendo…");
  try {
    const r = await llamar("mover_apunte", x.fecha, x.a.id, d.iso);
    if (r.error) await avisar("No se pudo mover", r.error);
    await cargarSemana();
    if (!r.error) trasCambio(r, `«${corto(x.a.tarea, 40)}» movido al ${d.nombre.toLowerCase()} ${d.fecha}.`);
  } finally {
    st.ocupado = false;
  }
}

// ---------------------------------------------------------------- copiar y pegar dias

// Ctrl+C sobre un dia (con el foco, o el unico marcado) y Ctrl+V sobre los
// marcados (o el que tiene el foco). Tambien desde el boton derecho.
function diaConFoco() {
  const n = document.activeElement?.closest?.("[data-iso]");
  return n ? st.dias.find((d) => d.iso === n.dataset.iso) : null;
}

function copiarDia(d) {
  if (!d) return;
  if (!d.apuntes.length) { estado(`El ${d.nombre.toLowerCase()} ${d.fecha} no tiene apuntes que copiar.`); return; }
  st.portapapeles = { iso: d.iso, texto: `${d.nombre} ${d.fecha}` };
  estado(`${st.portapapeles.texto} copiado: marca los días de destino y pulsa Ctrl+V (o botón derecho → Pegar).`);
}

function pegarDia(destino = null) {
  if (!st.portapapeles) return;
  const dias = destino ? [destino] : [...st.marcados];
  return dlgCopiarDia(dias.length ? dias : null, st.portapapeles.iso);
}

// Editar y borrar ese apunte sin salir de la tarjeta. Salen al pasar el raton
// (o con el foco del teclado): siempre a la vista, un clic para marcar el dia
// acabaria a veces en la papelera.
function accionesTarjeta(d, a) {
  const boton = (clase, titulo, icon, accion) => {
    const b = el("button", { class: clase, title: titulo, "aria-label": `${titulo}: ${a.tarea}` }, icono(icon));
    b.addEventListener("click", (e) => { e.stopPropagation(); accion(); });
    b.addEventListener("keydown", (e) => e.stopPropagation());   // Enter no marca el dia
    return b;
  };
  return el("span", { class: "ap-acciones" },
    boton("icono", "Editar", "editar", () => dlgEditar(d, a)),
    boton("icono borrar", "Eliminar", "borrar",
          () => borrarItems([{ fecha: d.iso, id: a.id, destino: a.destino || "op" }])));
}

// Texto corto de una celda del mes (la tarjeta de la semana tiene sitio para
// mas; aqui caben unas pocas letras).
function cifraMes(d) {
  if (d.no_laborable) return d.motivo.charAt(0).toUpperCase() + d.motivo.slice(1);
  if (d.estado === "error") return "sin conexión";
  if (d.estado === "permiso") return "Permiso ✔";
  if (d.estado === "completo") return `${fmtHoras(d.reg)}h ✔`;
  if (d.estado === "pasado") return `${fmtHoras(d.reg)}h · +${fmtHoras(d.exceso)}h`;
  if (d.estado === "vacio" && d.futuro) return "";
  return `${fmtHoras(d.reg)} / ${fmtHoras(d.obj)}h`;
}

// En la celda caben 2 apuntes; el resto, "+N más" (el detalle, en el panel de
// la derecha al marcar el dia, o en el globo al pasar el raton).
const MAX_APUNTES_CELDA = 2;

// Cada celda dice que dia es ("Mié 14", sin tener que mirar una cabecera) y
// QUE se hizo: lo habitual son 1-2 apuntes y el ancho de la celda sobraba.
function pintarMes(m) {
  const cont = $("dias");
  cont.className = "dias mes";
  cont.replaceChildren();
  for (const d of m.semanas.flat()) {
    const iconos = [d.guardia ? "⚙" : "", d.teletrabajo ? "⌂" : "", d.permiso ? "🕐" : ""].join(" ").trim();
    const barra = el("div", { class: "barra" }, el("i"));
    const lineas = d.apuntes.slice(0, MAX_APUNTES_CELDA).map((a) => {
      const n = el("div", { class: "linea-ap" },
        horasEditables(d, a),
        el("span", { class: "linea-t", text: a.tarea }));
      arrastrableApunte(n, d, a);
      return n;
    });
    const resto = d.apuntes.length - MAX_APUNTES_CELDA;
    const celda = el("div", {
      class: `celda ${d.estado}${d.es_hoy ? " hoy" : ""}${d.del_mes ? "" : " fuera"}${d.futuro ? " futuro" : ""}`,
      title: [`${d.nombre} ${d.fecha}`, d.texto,
              ...d.apuntes.map((a) => `${a.horas_txt}  ${a.tarea}${a.actividad ? ` · ${a.actividad}` : ""}`),
              d.guardia ? "Guardia" : "", d.teletrabajo ? "Teletrabajo" : "",
              ...(d.permiso_detalle || [])].filter(Boolean).join("\n")
             + "\nMayús+clic: rango · botón derecho: más opciones",
    },
      el("div", { class: "cab-celda" },
        el("span", { class: "dia-celda", text: `${d.nombre.slice(0, 3)} ${d.dia}${d.es_hoy ? " · hoy" : ""}` }),
        iconos ? el("span", { class: "iconos", text: iconos }) : null,
        el("span", { class: "cifra", text: cifraMes(d) })),
      barra,
      ...lineas,
      resto > 0 ? botonMas(`+${resto} más`, () => dlgEditarDia(d)) : null,
      botonMasDia(d));
    eventosDia(celda, d);
    cont.append(celda);
    requestAnimationFrame(() => { barra.firstChild.style.width = `${d.frac * 100}%`; });
  }
}

// Clic marca/desmarca; Mayus+clic marca todo el rango desde el ultimo dia
// pulsado (vacaciones de dos semanas, o rellenar huecos, de una vez).
function alternarDia(iso, e = null) {
  if (e?.shiftKey && st.ancla && st.ancla !== iso) {
    const orden = st.dias.map((d) => d.iso);
    const [a, b] = [orden.indexOf(st.ancla), orden.indexOf(iso)].sort((x, y) => x - y);
    if (a >= 0) {
      for (const i of orden.slice(a, b + 1)) st.marcados.add(i);
      st.ancla = iso;
      pintarMarcados();
      return;
    }
  }
  if (st.marcados.has(iso)) st.marcados.delete(iso); else st.marcados.add(iso);
  st.ancla = iso;
  pintarMarcados();
}

function pintarSelectorVista() {
  for (const b of document.querySelectorAll(".selector-vista button")) {
    const activo = b.dataset.vista === st.vista;
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-pressed", String(activo));
  }
  $("b-ant").title = st.vista === "mes" ? "Mes anterior (Ctrl+←)" : "Semana anterior (Ctrl+←)";
  $("b-sig").title = st.vista === "mes" ? "Mes siguiente (Ctrl+→)" : "Semana siguiente (Ctrl+→)";
  $("b-hoy").title = st.vista === "mes" ? "Volver al mes actual" : "Volver a la semana actual";
}

async function cambiarVista(vista) {
  if (vista === st.vista) return;
  // Se conserva lo marcado; se abre el periodo que lo contiene (o el actual).
  const ref = [...st.marcados].sort()[0] || hoyIso();
  st.vista = vista;
  if (vista === "mes") st.mesSel = mesDe(ref); else st.lunes = lunesDe(ref);
  pintarSelectorVista();
  llamar("guardar_vista", vista).catch(() => {});
  await cargarSemana({ marcar: [...st.marcados] });
}

function diasDelPeriodo() {
  return st.vista === "mes" ? st.dias.filter((d) => d.del_mes) : st.dias;
}

function pintarMarcados() {
  for (const t of $("dias").children) {
    if (t.dataset.iso) t.classList.toggle("marcado", st.marcados.has(t.dataset.iso));
  }
  const todos = diasDelPeriodo();
  $("toda-semana").checked = todos.length > 0 && todos.every((d) => st.marcados.has(d.iso));
  pintarApuntes();
  pintarBotonAnadir();
  actualizarTotales();
}

function menuDia(x, y, d) {
  // Lo mas repetido del dia a dia, lo primero y destacado (en negrita, no en
  // rojo: el rojo en la app es borrar).
  const items = [{ titulo: `${d.nombre} ${d.fecha}` },
                 { texto: "⧉ Copiar día anterior", clase: "destacado",
                   accion: () => dlgCopiarDia([d.iso]) },
                 { texto: "✎ Editar día…", desactivado: d.estado === "error",
                   accion: () => dlgEditarDia(d) },
                 { texto: "🗑 Eliminar apuntes de este día…", clase: "destacado",
                   desactivado: !d.apuntes.length, accion: () => dlgEliminarDia(d) },
                 "-"];
  // Rellenar lo que falta con una tarea habitual: un clic y el dia en verde.
  if (d.falta > 0.001 && !d.no_laborable && d.estado !== "error") {
    for (const f of (st.habituales?.filas || []).slice(0, 2)) {
      items.push({ texto: `＋ Completar con ${corto(f.tarea, 32)} (+${fmtHoras(d.falta)}h)`,
                   accion: () => anadirRapido(d, f, d.falta) });
    }
    items.push({ texto: "＋ Añadir otra tarea…", accion: () => menuAnadirRapido(d, x, y) }, "-");
  }
  items.push({ texto: "Copiar este día (Ctrl+C)", desactivado: !d.apuntes.length,
               accion: () => copiarDia(d) });
  if (st.portapapeles && st.portapapeles.iso !== d.iso) {
    items.push({ texto: `Pegar aquí lo del ${st.portapapeles.texto.toLowerCase()} (Ctrl+V)`,
                 accion: () => pegarDia(d.iso) });
  }
  items.push("-");
  const marca = (accion, motivo = "") => async () => {
    if (accion === "teletrabajo" && (await llamar("teletrabajo_lleno", d.iso))
        && !(await preguntar("Teletrabajo",
              "Ya tienes cubierto el cupo de teletrabajo de esta semana.\n¿Marcar otro igualmente?"))) return;
    await llamar("accion_dia", d.iso, accion, motivo);
    await repintarLocal();
  };
  if (d.no_laborable) {
    items.push({ texto: `Quitar marca (${d.motivo})`, accion: marca("quitar_no_laborable") });
  } else {
    for (const motivo of ["festivo", "vacaciones", "apertura de curso", "baja"]) {
      items.push({ texto: `Marcar como ${motivo}`, accion: marca("no_laborable", motivo) });
    }
    items.push("-", { texto: "Añadir permiso por horas…", accion: () => dlgPermisoDia(d) });
    d.permiso_detalle.forEach((p, i) => {
      items.push({ texto: `Quitar permiso: ${p}`, accion: marca("quitar_permiso", String(i)) });
    });
  }
  items.push("-",
    { texto: d.guardia ? "Quitar guardia" : "Marcar día de guardia",
      accion: marca(d.guardia ? "quitar_guardia" : "guardia") },
    { texto: d.teletrabajo ? "Quitar teletrabajo" : "Marcar teletrabajo",
      accion: marca(d.teletrabajo ? "quitar_teletrabajo" : "teletrabajo") },
    "-",
    { texto: "Guardar este día como plantilla…", desactivado: !d.apuntes.length,
      accion: () => dlgGuardarPlantillaDia(d) });
  if (d.teletrabajo && st.ini?.inari_listo) {
    items.push("-", { texto: "Registrar slot en INARI…", accion: () => dlgSlotInari(d) });
  }
  mostrarMenu(x, y, items);
}

// ---------------------------------------------------------------- apuntes

// Iconos dibujados con SVG (sin fuentes externas: la app funciona sin red).
const ICONOS = {
  editar: ["M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4", "M13.5 6.5l4 4"],
  borrar: ["M4 7h16", "M10 11v6", "M14 11v6", "M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12",
           "M9 7V4h6v3"],
};
function icono(nombre) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "16", height: "16",
    fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round",
    "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
  for (const d of ICONOS[nombre]) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

const claveDe = (d, a) => `${d.iso}|${a.id}`;

function filaApunte(d, a, delMarcado = false) {
  const clave = claveDe(d, a);
  const fila = el("div", {
    class: `apunte${st.seleccion.has(clave) ? " sel" : ""}${delMarcado ? " del-marcado" : ""}`,
    role: "listitem", tabindex: "0",
    title: `${a.tarea}${a.comentario ? `\n“${a.comentario}”` : ""}\n`
           + "Clic: seleccionar (para borrar varios) · Doble clic o Enter: editar",
    onclick: () => alternarSeleccion(clave, fila),
    ondblclick: () => dlgEditar(d, a),
    onkeydown: (e) => {
      if (e.key === "Enter") { e.preventDefault(); dlgEditar(d, a); }
      if (e.key === " ") { e.preventDefault(); alternarSeleccion(clave, fila); }
    },
  },
    el("span", { class: "ap-horas", text: a.horas_txt }),
    el("span", { class: "ap-texto" },
      el("span", { class: "ap-tarea", text: a.tarea }),
      a.actividad ? el("span", { class: "tenue", text: ` · ${a.actividad}` }) : null,
      a.comentario ? el("span", { class: "tenue ap-com", text: ` · «${a.comentario}»` }) : null),
    el("button", { class: "icono", title: "Editar", "aria-label": `Editar el apunte de ${a.tarea}`,
                   onclick: (e) => { e.stopPropagation(); dlgEditar(d, a); } }, icono("editar")),
    el("button", { class: "icono borrar", title: "Eliminar",
                   "aria-label": `Eliminar el apunte de ${a.tarea}`,
                   onclick: (e) => {
                     e.stopPropagation();
                     borrarItems([{ fecha: d.iso, id: a.id, destino: a.destino }]);
                   } }, icono("borrar")));
  fila.dataset.clave = clave;
  fila.dataset.destino = a.destino;
  return fila;
}

function alternarSeleccion(clave, fila) {
  if (st.seleccion.has(clave)) st.seleccion.delete(clave); else st.seleccion.add(clave);
  fila.classList.toggle("sel");
  pintarBotonEliminar();
}

function pintarBotonEliminar() {
  const n = st.seleccion.size;
  $("b-eliminar").hidden = !n;
  $("b-eliminar").textContent = n === 1 ? "Eliminar seleccionado" : `Eliminar ${n} seleccionados`;
}

// El panel de la derecha es el DETALLE con acciones de todo el periodo visible
// (las tarjetas son el resumen): todos los dias, agrupados, con editar y borrar
// en cada apunte sin tener que marcar antes el dia. Los marcados, resaltados.
// En el mes, los dias del mes (y los de relleno solo si se marcaron).
function diasDelPanel() {
  return st.vista === "mes" ? st.dias.filter((d) => d.del_mes || st.marcados.has(d.iso)) : st.dias;
}

function pintarApuntes() {
  const lista = $("lista-apuntes");
  const scrollPrevio = lista.scrollTop;
  lista.replaceChildren();
  let primerMarcado = null;
  let total = 0;
  for (const d of diasDelPanel()) {
    const marcado = st.marcados.has(d.iso);
    total += d.reg;
    const resumen = d.no_laborable ? d.motivo
      : (d.estado === "error" ? "sin conexión"
         : (d.apuntes.length ? `${fmtHoras(d.reg)}h de ${fmtHoras(d.obj)}h` : "sin apuntes"));
    const cab = el("button", {
      class: `grupo-dia${marcado ? " marcado" : ""}${d.es_hoy ? " hoy" : ""}${d.apuntes.length ? "" : " vacio-dia"}`,
      title: "Clic: marcar o desmarcar este día (Mayús+clic: rango)",
      onclick: (e) => alternarDia(d.iso, e),
    },
      el("span", { text: `${d.nombre} ${d.fecha}${d.es_hoy ? " · hoy" : ""}` }),
      el("span", { class: "tenue", text: resumen }));
    lista.append(cab);
    if (marcado && !primerMarcado) primerMarcado = cab;
    for (const a of d.apuntes) lista.append(filaApunte(d, a, marcado));
  }
  $("titulo-apuntes").textContent = st.vista === "mes"
    ? `Apuntes de ${st.semana?.titulo?.split(" ")[0]?.toLowerCase() || "el mes"}` : "Apuntes de la semana";
  $("resumen-apuntes").textContent = `${fmtHoras(total)}h`;
  lista.hidden = false;
  $("apuntes-vacio").hidden = true;
  // Al cargar otro periodo, que se vea el primer dia marcado; al marcar o
  // desmarcar, que la lista se quede donde estaba (no salte arriba).
  if (st.scrollPanel && primerMarcado) {
    lista.scrollTop = Math.max(0, primerMarcado.offsetTop - lista.offsetTop - 4);
  } else {
    lista.scrollTop = scrollPrevio;
  }
  st.scrollPanel = false;
  pintarBotonEliminar();
}

// El boton dice A QUE dias anade (antes: "Añadir a días marcados", que obligaba
// a mirar arriba para saberlo).
function pintarBotonAnadir() {
  const marcados = diasMarcados();
  const b = $("b-anadir");
  if (!marcados.length) b.textContent = "Añadir (marca un día)";
  else if (marcados.length === 1) {
    const d = marcados[0];
    b.textContent = `Añadir a ${d.nombre.slice(0, 3).toLowerCase()} ${d.fecha}`;
  } else b.textContent = `Añadir a ${marcados.length} días`;
}

function actualizarTotales() {
  const marcados = diasMarcados();
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
  $("lista-tareas").replaceChildren(...tareas.map((t) => {
    st.tareas.set(t.texto, t.id);
    return el("option", { value: t.texto });
  }));
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

function textoDeTarea(id) {
  for (const [texto, wid] of st.tareas) if (wid === Number(id)) return texto;
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

// Al elegir una actividad asociada a mano, la tarea salta sola a la suya (el
// caso de "Asuntos propios" que acababa imputado en Mantenimientos).
async function tareaDeActividad() {
  const destino = st.asociaciones[$("actividad").value];
  if (destino == null || resolverTarea() === Number(destino)) return;
  const texto = textoDeTarea(destino);
  if (!texto) return;                  // la tarea asociada ya no esta en la lista
  $("tarea").value = texto;
  const r = await llamar("actividades", destino);   // solo su comentario habitual:
  st.comHabitual = r.comentario || "";               // no se pisa la actividad elegida
  st.comAuto = "";
  sugerirComentario();
  estado(`Tarea cambiada a «${texto.split(" - ").slice(1).join(" - ").slice(0, 40)}» por la actividad elegida.`);
}

function menuActividad(e) {
  e.preventDefault();
  const wp = resolverTarea();
  const act = $("actividad").value;
  if (wp == null || !act) return;
  const tarea = $("tarea").value.split(" - ").slice(1).join(" - ");
  const items = [{ texto: `Asociar «${act}» con «${tarea.slice(0, 32)}»`, accion: async () => {
    st.asociaciones = await llamar("asociar", wp, act);
    estado(`«${act}» queda asociada a esa tarea.`);
  } }];
  if (st.asociaciones[act] != null) {
    items.push({ texto: `Quitar la asociación de «${act}»`, accion: async () => {
      st.asociaciones = await llamar("desasociar", act);
      estado(`Asociación de «${act}» retirada.`);
    } });
  }
  mostrarMenu(e.clientX, e.clientY, items);
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
  const marcados = diasMarcados();
  const sugerido = (marcados.length === 1 && marcados[0].guardia)
    ? st.ini.comentario_guardia : (st.comHabitual || "");
  st.comAuto = sugerido;
  campo.value = sugerido;
}

async function anadir(e) {
  e?.preventDefault();
  if (st.ocupado) return;
  const dias = [...st.marcados].sort();
  const wp = resolverTarea();
  if (wp == null) {
    await avisar("Falta tarea", "Elige una tarea de tus favoritas (puedes escribir para "
                 + "filtrar) o búscala con «Buscar…».");
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
    if (r.creados && comentario && comentario !== st.ini.comentario_guardia) st.comHabitual = comentario;
    await informarLote(r, { hecho: (n) => `Apunte añadido (${n}).`,
      nada: "Esa tarea ya estaba registrada en los días marcados; no se añadió nada." });
  } finally {
    st.ocupado = false;
    $("b-anadir").disabled = false;
  }
}

// ---------------------------------------------------------------- borrar / deshacer

async function borrarItems(items, { confirmar = true } = {}) {
  if (!items.length || st.ocupado) return;
  const n = items.length;
  if (confirmar && !(await preguntar("Eliminar",
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
    await cargarSemana();
    trasCambio(r, r.eliminados === 1 ? "Apunte eliminado." : `${r.eliminados} apuntes eliminados.`);
  } finally {
    st.ocupado = false;
  }
}

// Supr / boton: lo seleccionado; si no hay nada seleccionado, el apunte que
// tenga el foco del teclado.
function eliminarSeleccion() {
  const claves = st.seleccion.size ? [...st.seleccion]
    : [document.activeElement?.closest?.(".apunte")?.dataset.clave].filter(Boolean);
  return borrarItems(claves.map((clave) => {
    const [fecha, id] = clave.split("|");
    const fila = document.querySelector(`.apunte[data-clave="${CSS.escape(clave)}"]`);
    return { fecha, id, destino: fila?.dataset.destino || "op" };
  }));
}

async function deshacer() {
  if ($("b-deshacer").hidden || st.ocupado) return;
  $("b-deshacer").hidden = true;
  ocultarAviso();
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

// ---------------------------------------------------------------- eventos

function enCampo(e) {
  return ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
}

function navegar(delta) {
  if (st.vista === "mes") {
    if (delta === 0) st.mesSel = mesDe(hoyIso());
    else {
      const m = st.mesSel.mes - 1 + delta;
      st.mesSel = { anio: st.mesSel.anio + Math.floor(m / 12), mes: ((m % 12) + 12) % 12 + 1 };
    }
  } else {
    st.lunes = delta === 0 ? st.hoyLunes : sumarDias(st.lunes, 7 * delta);
  }
  $("b-deshacer").hidden = true;
  ocultarAviso();
  st.ancla = null;
  cargarSemana({ marcarHoy: true });
}

function irADia(iso) {
  if (st.vista === "mes") st.mesSel = mesDe(iso); else st.lunes = lunesDe(iso);
  $("b-deshacer").hidden = true;
  cargarSemana({ marcar: [iso] });
}

$("b-ant").onclick = () => navegar(-1);
$("b-sig").onclick = () => navegar(1);
$("b-hoy").onclick = () => navegar(0);
$("b-recargar").onclick = () => cargarSemana();
$("b-resumen").onclick = () => dlgResumen();
$("b-exportar").onclick = () => dlgExportar();
$("b-buscar").onclick = () => dlgBuscar();
$("b-copiar").onclick = (e) => menuBajo(e.currentTarget, [
  { texto: "Copiar día anterior a los días marcados", accion: dlgCopiarDia },
  { texto: "Copiar semana anterior completa", accion: dlgCopiarSemana },
  "-",
  { texto: "Plantillas…", accion: dlgPlantillas },
]);
$("b-eliminar").onclick = eliminarSeleccion;
$("b-deshacer").onclick = deshacer;
$("form").addEventListener("submit", anadir);
$("tarea").addEventListener("change", elegirTarea);
$("actividad").addEventListener("change", tareaDeActividad);
$("actividad").addEventListener("contextmenu", menuActividad);
$("toda-semana").addEventListener("change", (e) => {
  st.marcados = new Set(e.target.checked ? diasDelPeriodo().map((d) => d.iso) : []);
  pintarMarcados();
});
for (const b of document.querySelectorAll(".selector-vista button")) {
  b.addEventListener("click", () => cambiarVista(b.dataset.vista));
}
for (const b of document.querySelectorAll(".menubar button")) {
  b.addEventListener("click", (e) => { e.stopPropagation(); menuBajo(b, MENUS[b.dataset.menu]()); });
}

document.addEventListener("click", (e) => {
  if (!$("menu").contains(e.target) && !e.target.closest("#b-copiar, .menubar")) cerrarMenu();
});
window.addEventListener("blur", cerrarMenu);

document.addEventListener("keydown", (e) => {
  if (document.querySelector(".bloqueo")) return;        // con el PIN pedido, nada
  if ((e.ctrlKey || e.metaKey) && ["+", "=", "-", "0"].includes(e.key)) {
    e.preventDefault();
    if (e.key === "0") aplicarZoom(1); else cambiarZoom(e.key === "-" ? -1 : 1);
    return;
  }
  if (!$("modal").hidden) return;
  if (!$("menu").hidden && e.key === "Escape") { cerrarMenu(); return; }
  if (typeof pila !== "undefined" && pila.length) {
    if (e.key === "Escape") { e.preventDefault(); pila[pila.length - 1].cerrar(); }
    return;                                   // con un dialogo abierto, nada mas
  }
  if (e.key === "F5") { e.preventDefault(); cargarSemana(); return; }
  if (e.altKey && /^[1-5]$/.test(e.key) && st.vista === "semana") {
    e.preventDefault();
    const d = st.dias[Number(e.key) - 1];
    if (d) alternarDia(d.iso);
    return;
  }
  if (enCampo(e)) return;
  if (e.ctrlKey && e.key === "ArrowLeft") { e.preventDefault(); navegar(-1); }
  else if (e.ctrlKey && e.key === "ArrowRight") { e.preventDefault(); navegar(1); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); deshacer(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
    const d = diaConFoco() || (st.marcados.size === 1 ? diasMarcados()[0] : null);
    if (d) { e.preventDefault(); copiarDia(d); }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && st.portapapeles) {
    e.preventDefault();
    pegarDia(st.marcados.size ? null : diaConFoco()?.iso);
  }
  else if (e.key === "Delete") { e.preventDefault(); eliminarSeleccion(); }
});

cuandoListo(arrancar);
