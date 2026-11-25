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
  hoyDia: null,              // el dia en que se miro por ultima vez si habia cambiado (cambioDeDia)
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
  portapapeles: null,   // lo copiado con Ctrl+C: un dia {iso, texto} o varios {isos, texto}
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
  // se llama al arrancar y cada vez que el PIN se activa, cambia o se quita:
  // el boton Bloquear de la cabecera dice que va a hacer
  $("b-bloquear").title = st.ini?.pin?.activo
    ? "Bloquear FichaCSIRC: pide el PIN para volver a entrar (Ctrl+L)"
    : "Bloquear FichaCSIRC: hace falta un PIN, y aún no lo tienes. Pulsa para activarlo (Ctrl+L)";
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
  if (await desbloquear()) { cambioDeDia({ recargar: false }); await cargarSemana(); vigilarInactividad(); }
  else location.href = "configurar.html";
}

// Bloquear (boton de la cabecera, Archivo > Bloquear, Ctrl+L): con PIN, tapa la
// ventana hasta que se escriba; sin PIN, lleva a activarlo.
function bloquearOActivar() {
  if (st.ini?.pin?.activo) return bloquearAhora();
  return dlgPin({ paraBloquear: true });
}

// Salir del todo (boton de la cabecera, Archivo > Salir, Ctrl+Q). Con el icono
// junto al reloj, la X de la ventana solo la esconde: esto cierra el programa
// y quita el icono.
async function salirDeLaApp() {
  if (st.ocupado) return;                  // a mitad de guardar algo, no
  cerrarMenu();
  try {
    await api().cerrar();
  } catch (_e) { /* la ventana ya se esta cerrando */ }
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
    // a "Por completar", con esos dias ya marcados
    el("button", { class: "enlace", text: "Completar ahora", onclick: () => {
      a.hidden = true;
      const meses = new Set(r.dias.map((i) => i.slice(0, 7)));
      entrarPendientes({ anio: Number(r.dias[0].slice(0, 4)), marcar: r.dias,
                         filtro: meses.size === 1 ? Number(r.dias[0].slice(5, 7)) : "anio" });
    } }),
    el("button", { class: "cerrar-aviso", text: "×", title: "No volver a avisar de esa semana",
                   "aria-label": "Cerrar", onclick: () => { a.hidden = true; llamar("aviso_semana_visto", r.lunes).catch(() => {}); } }));
  a.hidden = false;
}

// ---------------------------------------------------------------- sin conexion: por que

// No es lo mismo estar fuera de la UGR sin VPN, tener la API key caducada o
// que ProyectosTIC este caido: se dice cual y que hacer (antes, todo "sin
// conexion" en rojo).
function pintarAvisoConexion(datos) {
  const a = $("aviso-conexion");
  const dg = datos.conexion !== "ok" ? datos.conexion_detalle : null;
  if (!dg) { a.hidden = true; return; }
  const boton = (texto, accion) => el("button", { class: "enlace", text: texto, onclick: accion });
  const botones = [];
  if (dg.tipo === "clave" || dg.tipo === "config") {
    botones.push(boton("Abrir el asistente", () => { location.href = "configurar.html"; }));
  }
  if (dg.tipo === "config") botones.push(boton("Copias de seguridad…", dlgCopias));
  botones.push(boton("Reintentar", () => cargarSemana()), boton("Copiar diagnóstico", dlgDiagnostico));
  a.replaceChildren(el("div", { class: "aviso-conexion-texto" },
    el("b", { text: dg.titulo }), el("span", { text: `. ${dg.texto}` })), ...botones);
  a.hidden = false;
}

// ---------------------------------------------------------------- cierre de mes

// Ultimos dias del mes (y primeros del siguiente): los dias del mes que
// quedan con huecos, cada uno con su enlace. La X lo calla hasta manana.
async function avisarCierreMes() {
  let r;
  try { r = await api().mes_pendiente(); } catch (_e) { return; }
  const a = $("aviso-mes");
  if (!r) { a.hidden = true; return; }
  const ir = (iso) => {
    if (st.vista !== "semana") { st.vista = "semana"; pintarSelectorVista(); llamar("guardar_vista", "semana").catch(() => {}); }
    st.lunes = lunesDe(iso);
    cargarSemana({ marcar: r.dias.map((x) => x.iso).filter((i) => lunesDe(i) === st.lunes) });
  };
  const max = 8;
  const enlaces = r.dias.slice(0, max).map((x) => el("button", { class: "enlace", text: x.texto, onclick: () => ir(x.iso) }));
  if (r.dias.length > max) enlaces.push(el("span", { text: `y ${r.dias.length - max} más` }));
  a.replaceChildren(
    el("span", { class: "aviso-semana-texto", text: `📅 ${r.texto}` }),
    // a "Por completar", en ese mes y con sus dias ya marcados
    el("button", { class: "enlace", text: "Completar ahora", onclick: () => {
      a.hidden = true;
      entrarPendientes({ anio: r.anio, filtro: r.mes, marcar: r.dias.map((x) => x.iso) });
    } }),
    el("button", { class: "cerrar-aviso", text: "×", title: "No volver a avisar hasta mañana", "aria-label": "Cerrar",
                   onclick: () => { a.hidden = true; llamar("aviso_mes_visto").catch(() => {}); } }),
    el("div", { class: "dias-mes" }, ...enlaces));
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
async function informarLote(r, { hecho, nada, saltados = (n) => ` Saltados ${n} (ya existían).` }) {
  if (r.error) { await avisar("No se pudo", r.error); return; }
  if (r.errores && !r.creados) {
    await avisar("No se creó ningún apunte", `Detalle: ${r.ultimo}`);
  } else if (r.errores) {
    await avisar("Hecho con errores",
      `Creados: ${r.creados}. Con errores: ${r.errores}.\nÚltimo error: ${r.ultimo}`);
  }
  await cargarSemana();
  if (r.creados) {
    trasCambio(r, `${hecho(r.creados)}${r.saltados ? saltados(r.saltados) : ""}`);
  } else if (!r.errores) {
    estado(nada);
  }
}

// ---------------------------------------------------------------- aviso "Deshacer"

// Tras borrar, editar, mover o anadir: un aviso abajo con su "Deshacer" (mas a
// la vista que el boton del panel, que sigue ahi, igual que Ctrl+Z).
let avisoT = null;
// El boton grande de arriba (caja Dias): visible solo si hay algo que
// deshacer, con cuantos cambios quedan y cual sera el siguiente.
function ponerDeshacer(quedan, siguiente = "") {
  const b = $("b-deshacer");
  b.hidden = !quedan;
  b.querySelector(".n-deshacer").textContent = quedan > 1 ? String(quedan) : "";
  b.title = siguiente ? `Deshacer: ${siguiente} (Ctrl+Z)` : "Deshacer el último cambio (Ctrl+Z)";
  pintarDeshacerPend();
}
function trasCambio(r, texto) {
  estado(texto);
  if (r.quedan !== undefined) ponerDeshacer(r.quedan, r.siguiente);   // la pila sigue aunque esta accion no entre
  if (!r.puede_deshacer) { ocultarAviso(); return; }
  if (r.quedan === undefined) ponerDeshacer(1);
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
// Tras crear una tarea en ProyectosTIC: lo dice abajo, con un enlace para
// verla alli (crearla no se deshace desde aqui).
function avisoTareaCreada(t) {
  avisoTarea(`Tarea ${t.id} creada en ProyectosTIC: «${t.nombre}».`, t.id);
}
// Lo mismo tras modificar o duplicar: el texto, y la tarea que abre el enlace.
function avisoTarea(texto, id) {
  estado(texto);
  const a = $("aviso-deshacer");
  a.replaceChildren(el("span", { text: texto }),
    el("button", { class: "enlace", text: "Abrir en ProyectosTIC",
                   onclick: () => llamar("abrir_tarea", id).catch(() => {}) }),
    el("button", { class: "cerrar-aviso", text: "×", title: "Cerrar", "aria-label": "Cerrar",
                   onclick: ocultarAviso }));
  a.hidden = false;
  clearTimeout(avisoT);
  avisoT = setTimeout(ocultarAviso, 12000);
}
// ¿Deja ProyectosTIC crear tareas en algun proyecto? Solo entonces se ofrece
// (el boton «Tareas» de la barra y «Crear la tarea…» en el buscador). En segundo plano: si no hay
// red, no molesta; Archivo > Nueva tarea lo vuelve a mirar.
async function cargarPermisoCrear() {
  try { st.crear = await api().nueva_tarea_proyectos(); }
  catch (_e) { st.crear = null; }
  pintarPermisoCrear();
}
const MAX_PROYECTOS_NIVEL = 6;
function pintarPermisoCrear() {
  const n = st.crear?.proyectos?.length || 0, no = !n;
  $("b-tareas").hidden = !puedeModificarTareas();
  // la insignia de la cabecera (una broma): solo cuando ProyectosTIC ha contestado
  const m = $("modo");
  m.hidden = !st.crear;
  m.classList.toggle("dios", !no);
  // al pasar el raton (o con el foco), una galleta explica los dos niveles y marca el tuyo
  const nivel = (icono, nombre, texto, mio, extra = null) => el("div", { class: `modo-nivel${mio ? " mio" : ""}` },
    el("span", { class: "ico", "aria-hidden": "true", text: icono }),
    el("div", {}, el("b", { text: nombre }), mio ? el("i", { text: "tu nivel" }) : null, el("p", { text: texto }), extra));
  // de donde viene el nivel: los proyectos en los que deja (los primeros, si son muchos)
  const lista = (ps) => el("ul", { class: "modo-proyectos" },
    ...ps.slice(0, MAX_PROYECTOS_NIVEL).map((p) => el("li", { text: p.nombre })),
    ps.length > MAX_PROYECTOS_NIVEL ? el("li", { class: "mas", text: `y ${ps.length - MAX_PROYECTOS_NIVEL} más` }) : null);
  const donde = no ? null : lista(st.crear.proyectos);
  // sin poder crear, quiza si se puedan modificar (es otro permiso)
  const ms = (no && st.crear?.modificar) || [];
  const cuantos = (k) => (k === 1 ? "1 proyecto" : `${k} proyectos`);
  m.replaceChildren(el("span", { class: "ico", "aria-hidden": "true", text: no ? "🎮" : "⚔️" }), no ? "Nivel loser" : "Nivel dios",
    el("div", { class: "modo-galleta", role: "tooltip" },
      nivel("⚔️", "Nivel dios", no ? "ProyectosTIC te deja crear tareas en algún proyecto: puedes crearlas, modificarlas, "
        + "duplicarlas con todo su árbol y guardar plantillas, desde el botón «Tareas» y el menú Archivo."
        : "Puedes crear tareas, modificarlas, duplicarlas con todo su árbol y guardar plantillas, desde el botón "
        + `«Tareas» y el menú Archivo. ProyectosTIC te deja crearlas en ${cuantos(n)}:`, !no, donde),
      nivel("🎮", "Nivel loser", "A fichar en las tareas que ya existen. Para subir de nivel, quien administra un proyecto "
        + "tiene que darte permiso para crear tareas en él."
        + (ms.length ? ` Eso sí: puedes modificar tareas (botón «Tareas») en ${cuantos(ms.length)}:` : ""),
        no, ms.length ? lista(ms) : null)));
}
// Lo que se hace con las tareas de ProyectosTIC (el boton «Tareas» de la
// barra): crear y duplicar piden el permiso de crear; modificar, el de crear o
// el de editar. Modificar y duplicar parten de la tarea puesta en el formulario.
const menuTareas = () => [
  puedeCrearTareas() ? { texto: "Nueva tarea…\tCtrl+N", accion: () => dlgNuevaTarea() } : null,
  { texto: "Modificar una tarea…", accion: () => dlgModificarTarea({ tarea: tareaDelFormulario() }) },
  puedeCrearTareas() ? { texto: "Duplicar una tarea con las que cuelgan de ella…", accion: () => dlgDuplicarTarea({ tarea: tareaDelFormulario() }) } : null,
].filter(Boolean);

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
    { texto: "Nueva tarea en ProyectosTIC…\tCtrl+N", accion: () => dlgNuevaTarea() },
    // solo a quien ProyectosTIC deja: modificar (crear o editar en algun proyecto) y duplicar (crear)
    puedeModificarTareas() ? { texto: "Modificar una tarea de ProyectosTIC…", accion: () => dlgModificarTarea({ tarea: tareaDelFormulario() }) } : null,
    st.crear?.proyectos?.length ? { texto: "Duplicar una tarea con las que cuelgan de ella…", accion: () => dlgDuplicarTarea({ tarea: tareaDelFormulario() }) } : null,
    "-",
    { texto: "Exportar a CSV…", accion: dlgExportar },
    { texto: "Resumen del mes", accion: () => entrarEstadisticas("mes") },
    { texto: "Estadísticas", accion: () => entrarEstadisticas() },
    { texto: "Días por completar", accion: () => entrarPendientes() },
    "-",
    { texto: "Buscar en mis apuntes…\tCtrl+F", accion: dlgBuscarApuntes },
    "-",
    { texto: (st.ini?.pin?.activo ? "Bloquear con el PIN" : "Bloquear con un PIN…") + "\tCtrl+L", accion: bloquearOActivar },
    { texto: "Salir de FichaCSIRC\tCtrl+Q", accion: salirDeLaApp },
  ].filter(Boolean),
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
    "-",
    ...[["sistema", "Tema del sistema"], ["claro", "Tema claro"], ["oscuro", "Tema oscuro"]].map(([t, nombre]) => ({
      texto: `${(st.ini?.tema || "sistema") === t ? "✓   " : "      "}${nombre}`,
      accion: () => { st.ini.tema = t; aplicarTema(t); llamar("guardar_tema", t).catch(() => {}); },
    })),
  ],
  herramientas: () => [
    { texto: "Plantillas…", accion: dlgPlantillas },
    { texto: "Proyectos visibles…", accion: () => dlgProyectosVisibles() },
    { texto: "Importar festivos…", accion: dlgFestivos },
    { texto: "Vacaciones y teletrabajo…", accion: dlgAjustesDias },
    { texto: "Permisos (horas)…", accion: dlgPermisos },
    { texto: "Integraciones (INARI)…", accion: dlgInari },
    { texto: "Aviso diario de fichaje…", accion: dlgRecordatorio },
    { texto: "PIN de acceso…", accion: dlgPin },
    { texto: "Bandeja e inicio con Windows…", accion: dlgBandeja },
    { texto: "Copias de seguridad…", accion: dlgCopias },
    ...((st.ini?.avisos_local_no || []).length ? [{ texto: "Volver a avisar al marcar días en local", accion: async () => {
      await llamar("volver_a_avisar_local");
      st.ini.avisos_local_no = [];
      estado("Se volverá a avisar al marcar festivos, vacaciones, bajas y permisos (solo en este equipo).");
    } }] : []),
    "-",
    { texto: "Configuración (asistente)…", accion: () => { location.href = "configurar.html"; } },
  ],
  ayuda: () => [
    { texto: "Atajos de teclado", accion: dlgAtajos },
    { texto: "Novedades (qué hay de nuevo)", accion: dlgNovedades },
    { texto: "Comprobar actualizaciones", accion: () => dlgActualizacion({ forzar: true }) },
    { texto: "Copiar diagnóstico (si algo no va)…", accion: dlgDiagnostico },
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
  aplicarTema(ini.tema);
  if (ini.zoom && ini.zoom !== 1) aplicarZoom(ini.zoom, false);
  vigilarInactividad();
  st.lunes = st.hoyLunes = ini.lunes;
  st.hoyDia = hoyIso();
  st.mesSel = mesDe(hoyIso());
  st.vista = ini.vista === "mes" ? "mes" : "semana";
  pintarSelectorVista();
  st.asociaciones = ini.asociaciones || {};
  $("version").textContent = `${ini.plataforma} · v${ini.version}${ini.experimento ? " · prototipo web" : ""}`;
  document.querySelector(".etiqueta-prototipo").hidden = !ini.experimento;
  if (ini.logo) { $("logo").src = ini.logo; $("logo").hidden = false; }
  if (ini.inari) { $("subtitulo").textContent += " e INARI"; $("conn-inari").hidden = false; }
  ponerTareas(ini.tareas);
  // El campo Tarea del formulario: buscador (habituales, favoritas y todo
  // ProyectosTIC, tambien por numero de tarea).
  buscadorTarea($("tarea"), { alElegir: async (t) => {
    if (!textoDeTarea(t.id)) ponerTareas(await llamar("elegir_tareas", [t], false));
    $("tarea").value = textoDeTarea(t.id) || `${t.id} - ${t.nombre}`;
    await elegirTarea();
  } });
  ponerActividades(ini.actividades, ini.actividad_preferida);
  await cargarSemana({ marcarHoy: true });
  avisarSemanaAnterior();
  avisarCierreMes();
  refrescarFranja();
  refrescarPendientes(0);
  pintarCampana();
  cargarPermisoCrear();
  // "Abrir «Por completar»" desde el aviso diario
  if (ini.abrir_pendientes) entrarPendientes();
  if (st.tareas.size) elegirTarea();
  llamar("usuario").then((n) => { $("usuario").textContent = n || ""; }).catch(() => {});
  // A partir del 1 de enero: ofrecer (una vez, opcional) los permisos del año.
  if (ini.toca_permisos_anio) setTimeout(() => dlgPermisosAnio({ manual: false }), 700);
  // La config se habia quedado sin conexion y se recupero sola de una copia
  // (3.2.2): decirlo antes que nada, para que revise.
  if (ini.recuperada) {
    await preguntar("Configuración recuperada",
      "Tu configuración se había quedado incompleta (sin la conexión con ProyectosTIC) "
      + `y se ha recuperado de la copia de seguridad del ${ini.recuperada}: conexión, `
      + "favoritas, plantillas y permisos. Lo que cambiaste después, como los días "
      + "marcados, se ha conservado.\n\nRevisa que todo esté como lo dejaste.",
      { soloAceptar: true, si: "Entendido" });
  }
  // Recien actualizada: lo nuevo de esta version, una sola vez.
  if (ini.novedades_tras_actualizar) setTimeout(() => dlgNovedades(ini.novedades_tras_actualizar), 400);
  // Sin PIN: sugerirlo (no a la vez que las novedades, para no amontonar).
  else if (ini.sugerir_pin) setTimeout(dlgSugerirPin, 900);
  // Version nueva (como mucho cada pocas horas; si falla, en silencio).
  setTimeout(() => dlgActualizacion({ forzar: false }), 1500);
  // Mac: avisar si la app no esta en Aplicaciones (una vez por ruta).
  llamar("aviso_aplicaciones").then((m) => { if (m) dlgAplicaciones(m); }).catch(() => {});
  // A quien nunca ha tenido el aviso diario: ofrecerlo (una vez) bajo la campana.
  setTimeout(() => pintarCampana({ ofrecer: true }), 2600);
}

// ---------------------------------------------------------------- campana del aviso diario

// El boton de la barra dice si el aviso diario esta puesto y a que hora
// ("🔔 14:00") o que se puede activar ("🔕 Activar aviso"). Un clic abre el
// formulario para cambiar la hora o quitarlo. Se repinta al volver a la
// ventana: la hora tambien se cambia desde la ventanita del propio aviso.
let campanaT = 0;
async function pintarCampana({ ofrecer = false } = {}) {
  let e;
  try {
    e = await api().recordatorio_estado();
  } catch (_e) { return; }
  campanaT = Date.now();
  const b = $("b-aviso");
  b.hidden = !e.soportado || !!e.experimento;
  $("ancla-aviso").hidden = b.hidden;
  // encendida, la hora siempre a la vista; apagada, el rotulo se esconde con
  // la ventana estrecha y el icono va en gris (no es una alarma)
  b.replaceChildren(
    el("span", { class: "ico", "aria-hidden": "true", text: e.activo ? "🔔" : "🔕" }),
    el("span", { class: e.activo ? "hora" : "rot", text: e.activo ? (e.hora || "Aviso") : "Activar aviso" }));
  b.setAttribute("aria-label", e.activo ? `Aviso diario a las ${e.hora || "su hora"}` : "Activar el aviso diario");
  b.classList.toggle("apagado", !e.activo);
  b.title = e.activo
    ? `Aviso diario a las ${e.hora || "su hora"}, de lunes a viernes, si te faltan horas por fichar. Pulsa para cambiar la hora o quitarlo.`
    : "Que FichaCSIRC te avise cada día laborable si te faltan horas por fichar";
  if (ofrecer && e.ofrecer && !b.hidden) globoAviso(e);
}

// La primera vez (a quien nunca ha tenido el aviso): un globo bajo la campana
// que lo ofrece a las 14:00. Se conteste lo que se conteste, no vuelve a salir.
function globoAviso(e) {
  if ($("globo-aviso") || (typeof pila !== "undefined" && pila.length) || !$("modal").hidden) return;
  const hora = e.por_defecto || "14:00";
  const cerrar = () => {
    g.remove();
    try { api().recordatorio_ofrecido()?.catch?.(() => {}); } catch (_e) { /* nada */ }
  };
  const g = el("div", { id: "globo-aviso", class: "globo-aviso", role: "dialog", "aria-label": "Aviso diario de fichaje" },
    el("button", { class: "cerrar-aviso", title: "Cerrar", "aria-label": "Cerrar", text: "×", onclick: cerrar }),
    el("p", {}, el("b", { text: `¿Te aviso a las ${hora} si te faltan horas por fichar?` })),
    el("p", { class: "tenue", text: "Solo los días laborables. Se cambia o se quita aquí, en la campana." }),
    el("div", { class: "fila globo-botones" },
      el("button", { text: "Ahora no", onclick: cerrar }),
      el("button", { class: "primario", text: `Activar a las ${hora}`, onclick: async () => {
        g.remove();
        const r = await llamar("recordatorio_activar", hora);
        if (r.error) { await avisar("No se pudo activar", r.error); return; }
        estado(`Aviso diario activado: los días laborables a las ${hora}, si te faltan horas por fichar.`);
        pintarCampana();
      } })));
  $("ancla-aviso").append(g);      // cuelga del boton: lo sigue al desplazar o redimensionar
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
  return marcados.length ? lunesDe(marcados[0]) : lunesDe(hoyIso());
}

// La app vive en la bandeja y puede pasar dias abierta: al volver a la ventana
// (o al pulsar «Hoy») se mira si ha cambiado el dia. Si cambio, «Hoy» apunta a
// la semana nueva, se recarga lo que se ve (la pastilla "hoy" la pone el motor
// al cargar) y se vuelven a pedir los avisos y el numero de «Por completar».
function cambioDeDia({ recargar = true } = {}) {
  const hoy = hoyIso();
  if (!st.ini || !st.hoyDia || hoy === st.hoyDia) return false;
  // con el PIN pedido el motor no da nada: se mira al desbloquear
  if (document.querySelector(".bloqueo")) return false;
  st.hoyDia = hoy;
  st.hoyLunes = lunesDe(hoy);
  // con un dialogo abierto o algo a medias no se repinta por debajo
  const libre = !st.ocupado && !(typeof pila !== "undefined" && pila.length) && $("modal").hidden;
  if (recargar && libre) Promise.resolve(st.estad ? st.estad.cargar() : cargarSemana()).catch(() => {});
  avisarSemanaAnterior();
  avisarCierreMes();
  refrescarPendientes(0);
  return true;
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
  if (!marcarHoy && !marcar) { refrescarFranja(); refrescarPendientes(); }
}

// Repinta sin red tras una marca local (festivo, guardia, permiso...).
async function repintarLocal() {
  const datos = st.vista === "mes" ? await llamar("repintar_mes", st.mesSel.anio, st.mesSel.mes)
                                   : await llamar("repintar", st.lunes);
  pintarVista(datos, false);
  refrescarFranja();
  // un festivo, unas vacaciones o un permiso cambian lo que queda por completar
  // (en segundo plano y con su respiro: varias marcas seguidas, una consulta)
  refrescarPendientes();
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
  // al menu del icono de la bandeja: "Completar hoy con ..." (sin las de permiso)
  try {
    api().bandeja_habituales((r.habituales?.filas || []).filter((f) => !f.permiso).slice(0, 3)
      .map((f) => ({ wp_id: f.wp_id, tarea: f.tarea, actividad: f.actividad })))?.catch?.(() => {});
  } catch (_e) { /* sin bandeja */ }
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
  $("conn").title = datos.conexion_detalle?.titulo || { ok: "Conectado", warn: "Algún día no se pudo leer",
                      error: "Sin conexión con ProyectosTic" }[datos.conexion];
  pintarAvisoConexion(datos);
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
  repartirColores(s.dias);
  s.dias.forEach((d, i) => {
    const chips = el("div", { class: "chips" });
    for (const c of chipsMarcas(d)) chips.append(c);
    const tarjeta = el("div", {
      class: `dia ${d.estado}${d.es_hoy ? " hoy" : ""}`,
      title: `${d.nombre} ${d.fecha} · Alt+${i + 1} · Mayús+clic: rango · botón derecho: más opciones`,
    },
      el("div", { class: "titulo" },
        el("span", { class: "titulo-dia", text: d.nombre }),
        el("span", { class: "titulo-fecha", text: d.fecha }),
        d.es_hoy ? el("span", { class: "titulo-hoy", text: "hoy" }) : null),
      el("div", { class: "cifra", text: d.texto }),
      barraTareas(d),
      chips.childElementCount ? chips : null,
      ...apuntesTarjeta(d),
      botonMasDia(d));
    eventosDia(tarjeta, d);
    cont.append(tarjeta);
  });
}

// Cada tarea con su color: la barra se reparte por tareas y la lista de abajo
// lleva el mismo color delante. Se reparten por horas en lo que se ve (la de
// mas horas, el primero...): en la semana o el mes nunca se repiten, y como
// las tareas principales suelen ser las mismas, casi siempre conservan color.
const COLORES_TAREA = 8;
const claveTarea = (a) => String(a.wp_id || a.tarea);
function repartirColores(dias) {
  const horas = new Map();
  for (const a of dias.flatMap((d) => d.apuntes)) {
    if (a.destino !== "inari") horas.set(claveTarea(a), (horas.get(claveTarea(a)) || 0) + a.horas);
  }
  st.colores = new Map([...horas].sort((x, y) => y[1] - x[1]).map(([k], i) => [k, i % COLORES_TAREA]));
}
function colorTarea(a) {
  if (a.destino === "inari") return "var(--t-inari)";
  return `var(--t${st.colores?.get(claveTarea(a)) ?? 0})`;
}

// La barra del dia: un trozo por apunte, de su color y de su tamaño sobre la
// jornada (lo que falta queda vacio). Si te pasas, una marca donde acaba la
// jornada. Sin apuntes (festivo, vacaciones, permiso), la barra del estado.
function barraTareas(d) {
  const tope = Math.max(d.obj || 0, d.reg || 0);
  if (!d.apuntes.length || !tope) {
    return el("div", { class: "barra" }, el("i", { class: "llena", style: `--w:${Math.round(d.frac * 100)}%` }));
  }
  const barra = el("div", { class: "barra barra-tareas",
                            title: d.apuntes.map((a) => `${a.horas_txt}  ${a.tarea}`).join("\n") });
  for (const a of d.apuntes) {
    barra.append(el("i", { class: "seg", style: `--c:${colorTarea(a)};--w:${(a.horas / tope) * 100}%` }));
  }
  if (d.obj && d.reg > d.obj + 0.001) {
    barra.append(el("b", { class: "meta", style: `left:${(d.obj / tope) * 100}%`, title: "Aquí acaba tu jornada" }));
  }
  return barra;
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
        el("i", { class: "punto", style: `--c:${colorTarea(a)}`, "aria-hidden": "true" }),
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

async function menuAnadirRapido(d, x, y) {
  if (d.estado === "error") return;
  const filas = st.habituales?.filas || [];
  // las plantillas viven en este equipo: leerlas es inmediato
  const plantillas = (await llamar("plantillas").catch(() => [])).filter((p) => !p.semana);
  const items = [{ titulo: `Añadir al ${d.nombre.toLowerCase()} ${d.fecha}`
                           + (d.falta > 0.001 ? ` · faltan ${fmtHoras(d.falta)}h` : "") },
                 // lo mas repetido, lo primero (como en el botón derecho)
                 { texto: "⧉ Copiar día anterior", clase: "destacado", accion: () => dlgCopiarDia([d.iso]) }];
  if (sePuedePegarEn(d)) {
    const n = diasCopiados().length;
    items.push({ texto: n > 1 ? `Pegar desde aquí los ${n} días copiados` : `Pegar lo del ${st.portapapeles.texto.toLowerCase()}`,
                 accion: () => pegarDia(d.iso) });
  }
  items.push("-");
  for (const f of filas) {
    const h = horasPropuestas(d, f);
    items.push({ texto: `+ ${fmtHoras(h)}h   ${corto(f.tarea)}${f.actividad ? ` · ${f.actividad}` : ""}`,
                 accion: () => anadirRapido(d, f, h) });
  }
  if (filas.length) items.push("-");
  for (const p of plantillas.slice(0, 4)) {
    items.push({ texto: `▤ Plantilla «${corto(p.nombre, 30)}» (${p.n} apuntes, ${p.total})`,
                 accion: () => aplicarPlantillaDia(p, d) });
  }
  if (plantillas.length) items.push("-");
  items.push({ texto: "Otra tarea u otras horas…", accion: () => dlgEditarDia(d, { nueva: true }) });
  mostrarMenu(x, y, items);
}

// Una plantilla a UN dia, desde el "+" de su ficha (sin marcar dias).
async function aplicarPlantillaDia(p, d) {
  if (st.ocupado) return;
  st.ocupado = true;
  estado("Aplicando plantilla…");
  try {
    await informarLote(await llamar("aplicar_plantilla", p.nombre, [d.iso]), {
      hecho: (n) => `Plantilla «${corto(p.nombre, 40)}» aplicada al ${d.nombre.toLowerCase()} ${d.fecha}: ${n} apuntes.`,
      nada: "No se añadió nada: esas tareas ya estaban ese día." });
  } finally {
    st.ocupado = false;
  }
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
// Con varios marcados se copian todos, por fecha: al pegar, el primero va al
// primer marcado, el segundo al segundo... (el emparejado lo hace el motor).
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

// Los dias copiados, por fecha (uno o varios)
function diasCopiados() {
  const p = st.portapapeles;
  return p ? (p.isos || [p.iso]) : [];
}

// Un dia solo no se pega sobre si mismo; varios si pueden empezar en uno de ellos
function sePuedePegarEn(d) {
  const c = diasCopiados();
  return c.length > 1 || (c.length === 1 && c[0] !== d.iso);
}

// Varios marcados: solo los que tienen apuntes. Si queda uno, como copiar ese dia.
function copiarDias(ds) {
  const con = ds.filter((d) => d.apuntes.length).sort((a, b) => a.iso.localeCompare(b.iso));
  if (!con.length) { estado(`Ninguno de los ${ds.length} días marcados tiene apuntes que copiar.`); return; }
  if (con.length === 1) { copiarDia(con[0]); return; }
  const nombres = con.map((d) => `${d.nombre.toLowerCase()} ${d.fecha}`);
  st.portapapeles = { isos: con.map((d) => d.iso),
                      texto: `${con.length} días (${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]})` };
  estado(`Copiados ${st.portapapeles.texto}: marca los días de destino y pulsa Ctrl+V (o botón derecho → Pegar). `
    + "Con un solo día marcado se pegan a partir de él, en los días laborables siguientes.");
}

function pegarDia(destino = null) {
  if (!st.portapapeles) return;
  const dias = destino ? [destino] : [...st.marcados];
  const copiados = diasCopiados();
  if (copiados.length > 1) return dlgPegarDias(copiados, dias);
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

// Guardia, teletrabajo y permiso: rellena si esta IMPUTADO en ProyectosTIC
// (su tarea de Herramientas > Permisos, el comentario de guardia o una
// actividad de permiso); con borde y "· local" si solo esta marcado aqui.
function chipsMarcas(d) {
  const out = [];
  const chip = (clase, texto, pt, local, titulo = "") => {
    if (pt) {
      out.push(el("span", { class: `chip ${clase}`, text: texto,
                            title: `Imputado en ProyectosTIC${local ? " (y marcado aquí)" : ""}${titulo ? `\n${titulo}` : ""}` }));
    } else if (local) {
      out.push(el("span", { class: `chip ${clase} local`, text: `${texto} · local`,
                            title: `Marcado solo en este equipo: no está en ProyectosTIC${titulo ? `\n${titulo}` : ""}` }));
    }
  };
  chip("chip-guardia", "⚙ Guardia", d.guardia_pt, d.guardia);
  chip("chip-tele", "⌂ Teletrabajo", d.teletrabajo_pt, d.teletrabajo);
  if (d.permiso_pt) chip("chip-permiso", `🕐 Permiso ${d.permiso_pt}`, true, false);
  if (d.permiso) chip("chip-permiso", `🕐 Permiso ${d.permiso}`, false, true, (d.permiso_detalle || []).join("\n"));
  return out;
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
  repartirColores(m.semanas.flat());
  for (const d of m.semanas.flat()) {
    const iconos = [d.guardia || d.guardia_pt ? "⚙" : "", d.teletrabajo || d.teletrabajo_pt ? "⌂" : "",
                    d.permiso || d.permiso_pt ? "🕐" : ""].join(" ").trim();
    const lineas = d.apuntes.slice(0, MAX_APUNTES_CELDA).map((a) => {
      const n = el("div", { class: "linea-ap" },
        el("i", { class: "punto", style: `--c:${colorTarea(a)}`, "aria-hidden": "true" }),
        horasEditables(d, a),
        el("span", { class: "linea-t", text: a.tarea }));
      arrastrableApunte(n, d, a);
      return n;
    });
    const resto = d.apuntes.length - MAX_APUNTES_CELDA;
    // calendario de calor: el color del dia dice como va (y un dia a medias,
    // mas intenso cuanto mas le falta)
    const celda = el("div", {
      class: `celda ${d.estado}${d.es_hoy ? " hoy" : ""}${d.del_mes ? "" : " fuera"}${d.futuro ? " futuro" : ""}`,
      style: `--frac:${d.frac}`,
      title: [`${d.nombre} ${d.fecha}`, d.texto,
              ...d.apuntes.map((a) => `${a.horas_txt}  ${a.tarea}${a.actividad ? ` · ${a.actividad}` : ""}`),
              d.guardia_pt ? "Guardia (en ProyectosTIC)" : d.guardia ? "Guardia (local)" : "",
              d.teletrabajo_pt ? "Teletrabajo (en ProyectosTIC)" : d.teletrabajo ? "Teletrabajo (local)" : "",
              d.permiso_pt ? `Permiso ${d.permiso_pt} (en ProyectosTIC)` : "",
              ...(d.permiso_detalle || [])].filter(Boolean).join("\n")
             + "\nMayús+clic: rango · botón derecho: más opciones",
    },
      el("div", { class: "cab-celda" },
        el("span", { class: "dia-celda", text: `${d.nombre.slice(0, 3)} ${d.dia}${d.es_hoy ? " · hoy" : ""}` }),
        iconos ? el("span", { class: "iconos", text: iconos }) : null,
        el("span", { class: "cifra", text: cifraMes(d) })),
      ...lineas,
      resto > 0 ? botonMas(`+${resto} más`, () => dlgEditarDia(d)) : null,
      botonMasDia(d));
    eventosDia(celda, d);
    cont.append(celda);
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
    const activo = b.dataset.vista === (st.estad ? "estad" : st.vista);
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-pressed", String(activo));
  }
  $("b-ant").title = st.vista === "mes" ? "Mes anterior (Ctrl+←)" : "Semana anterior (Ctrl+←)";
  $("b-sig").title = st.vista === "mes" ? "Mes siguiente (Ctrl+→)" : "Semana siguiente (Ctrl+→)";
  $("b-hoy").title = st.vista === "mes" ? "Volver al mes actual" : "Volver a la semana actual";
  for (const [id, tipo] of [["b-estad", "estad"], ["b-pend", "pend"]]) {
    $(id).classList.toggle("activo", st.estad?.tipo === tipo);
    $(id).setAttribute("aria-pressed", String(st.estad?.tipo === tipo));
  }
  if (st.estad) {
    const anio = st.estad.tipo === "pend";
    $("b-ant").title = anio ? "Año anterior (Ctrl+←)" : "Periodo anterior (Ctrl+←)";
    $("b-sig").title = anio ? "Año siguiente (Ctrl+→)" : "Periodo siguiente (Ctrl+→)";
    $("b-hoy").title = "Volver a la semana de hoy";
  }
}

// ---------------------------------------------------------------- estadisticas, en la ventana

// La pestaña Estadisticas ocupa el sitio de las fichas, la franja y los
// paneles de abajo (los esconde el CSS con body.modo-estad); el titulo de
// arriba dice el periodo y las flechas / "Hoy" lo mueven.
function entrarEstadisticas(periodo = "anio") {
  if (st.estad?.tipo === "estad") return;
  if (st.estad) salirEstadisticas();
  const ref = st.vista === "mes" ? `${st.mesSel.anio}-${String(st.mesSel.mes).padStart(2, "0")}-01` : st.lunes;
  document.body.classList.add("modo-estad");
  $("estadisticas").hidden = false;
  // se abre en el año: la vista de conjunto; Semanal y Mensual, a un clic
  st.estad = { tipo: "estad", ...montarEstadisticas($("estadisticas"), {
    periodo, ref,
    alTitulo: (t) => { $("titulo-semana").textContent = t; },
    // un dia por completar: a su semana (o su mes), con el dia marcado
    alIrADia: (iso) => { salirEstadisticas(); pintarSelectorVista(); irADia(iso); },
  }) };
  pintarSelectorVista();
}

// La pestaña "Por completar": en el mismo sitio que Estadisticas (las flechas
// cambian de año; "Hoy", a la semana de hoy).
// opciones (desde un aviso): {anio, filtro (mes o "anio"), marcar: [iso]}
function entrarPendientes(opciones = null) {
  if (st.estad?.tipo === "pend" && !opciones) return;
  if (st.estad) salirEstadisticas();
  document.body.classList.add("modo-estad");
  $("estadisticas").hidden = false;
  st.estad = { tipo: "pend", ...montarPendientes($("estadisticas"), {
    ...(opciones || {}),
    alTitulo: (t) => { $("titulo-semana").textContent = t; },
    alIrADia: irADiaSaliendo,
    alDatos: ponerContadorPendientes,
  }) };
  pintarSelectorVista();
}

// Se ha fichado desde el menu del icono de la bandeja ("Completar hoy con
// ..."): la ventana se pone al dia y ofrece su Deshacer. Lo llama el motor.
async function alFicharFuera(r, texto) {
  if (document.querySelector(".bloqueo")) return;
  await cargarSemana();
  trasCambio(r, texto);
  if (st.estad?.tipo === "pend") st.estad.cargar();
}

// A la semana de ese dia, con el dia marcado (saliendo de Estadisticas o de
// Por completar si se estaba en ellos).
function irADiaSaliendo(iso) {
  if (st.estad) { salirEstadisticas(); pintarSelectorVista(); }
  irADia(iso);
}

// El numero del boton 🧩: los dias por completar de este año. Tras cada
// cambio (con un respiro, que un cambio trae otro) y sin avisos si falla.
let pendT = null, pendSeq = 0;
function refrescarPendientes(retraso = 1500) {
  clearTimeout(pendT);
  pendT = setTimeout(async () => {
    if (st.estad?.tipo === "pend") return;          // el panel ya lo pone al cargar
    const mio = ++pendSeq;
    let r;
    try { r = await api().por_completar(null); } catch (_e) { return; }
    if (mio === pendSeq) ponerContadorPendientes(r);
  }, retraso);
}
function ponerContadorPendientes(r) {
  if (!r || r.error || r.anio !== Number(hoyIso().slice(0, 4))) return;
  const b = $("b-pend");
  b.classList.toggle("al-dia", !r.n);
  b.querySelector(".n-pend").textContent = r.n ? String(r.n) : "✔";
  b.title = r.n ? `${r.n} ${r.n === 1 ? "día" : "días"} de ${r.anio} sin completar (faltan ${r.falta}): `
                  + "márcalos y rellénalos de una vez"
                : `Todo completo en ${r.anio} hasta ayer`;
  // y en el menu del icono de la bandeja: "Por completar (n)"
  try { api().bandeja_pendientes(r.n)?.catch?.(() => {}); } catch (_e) { /* sin bandeja (demo) */ }
}

function salirEstadisticas() {
  document.body.classList.remove("modo-estad");
  $("estadisticas").hidden = true;
  $("estadisticas").replaceChildren();
  st.estad = null;
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
  // rojo: el rojo en la app es borrar). Copiar y pegar, juntos: el dia anterior,
  // este dia y, si hay algo copiado, pegarlo aqui.
  const marcados = diasMarcados();
  const varios = marcados.length > 1 && st.marcados.has(d.iso);
  const items = [{ titulo: `${d.nombre} ${d.fecha}` },
                 { texto: "⧉ Copiar día anterior", clase: "destacado",
                   accion: () => dlgCopiarDia([d.iso]) },
                 // sobre uno de varios marcados, copiar (y pegar varios) va con todos ellos
                 varios
                   ? { texto: `Copiar estos ${marcados.length} días (Ctrl+C)`,
                       desactivado: !marcados.some((x) => x.apuntes.length), accion: () => copiarDias(marcados) }
                   : { texto: "Copiar este día (Ctrl+C)", desactivado: !d.apuntes.length,
                       accion: () => copiarDia(d) }];
  if (sePuedePegarEn(d)) {
    const n = diasCopiados().length;
    if (n === 1) {
      items.push({ texto: `Pegar aquí lo del ${st.portapapeles.texto.toLowerCase()} (Ctrl+V)`,
                   accion: () => pegarDia(d.iso) });
    } else if (varios) {
      items.push({ texto: `Pegar los ${n} días copiados en los ${marcados.length} marcados (Ctrl+V)`,
                   accion: () => pegarDia() });
    } else {
      items.push({ texto: `Pegar desde aquí los ${n} días copiados (Ctrl+V)`, accion: () => pegarDia(d.iso) });
    }
  }
  items.push("-",
    { texto: "✎ Editar día…", desactivado: d.estado === "error", accion: () => dlgEditarDia(d) },
    { texto: "🗑 Eliminar apuntes de este día…", clase: "destacado",
      desactivado: !d.apuntes.length, accion: () => dlgEliminarDia(d) },
    "-");
  // Rellenar lo que falta con una tarea habitual: un clic y el dia en verde.
  if (d.falta > 0.001 && !d.no_laborable && d.estado !== "error") {
    for (const f of (st.habituales?.filas || []).slice(0, 2)) {
      items.push({ texto: `＋ Completar con ${corto(f.tarea, 30)}${f.actividad ? ` · ${f.actividad}` : ""} (+${fmtHoras(d.falta)}h)`,
                   accion: () => anadirRapido(d, f, d.falta) });
    }
    // Despues del clic: si no, el mismo clic llega al documento y, como la
    // opcion pulsada ya no existe, lo toma por "fuera del menu" y lo cierra.
    items.push({ texto: "＋ Añadir otra tarea…", accion: () => setTimeout(() => menuAnadirRapido(d, x, y)) }, "-");
  }
  const marca = (accion, motivo = "") => async () => {
    if (accion === "teletrabajo" && (await llamar("teletrabajo_lleno", d.iso))
        && !(await preguntar("Teletrabajo",
              "Ya tienes cubierto el cupo de teletrabajo de esta semana.\n¿Marcar otro igualmente?"))) return;
    // festivo, vacaciones, baja, guardia, teletrabajo...: solo en este equipo
    // (avisar antes). Quitar una marca no pregunta.
    const local = accion === "no_laborable" ? motivo
      : accion === "guardia" || accion === "teletrabajo" ? accion : "";
    if (local && (await confirmarLocal(d, local)) !== "local") return;
    await llamar("accion_dia", d.iso, accion, motivo);
    await repintarLocal();
  };
  if (d.no_laborable) {
    items.push({ texto: `Quitar marca (${d.motivo})`, accion: marca("quitar_no_laborable") });
  } else {
    // "(local)": se guarda en este equipo, NO se envia a ProyectosTic
    for (const motivo of ["festivo", "vacaciones", "apertura de curso", "baja"]) {
      items.push({ texto: `Marcar como ${motivo} (local)`, accion: marca("no_laborable", motivo) });
    }
    items.push("-", { texto: "Añadir permiso por horas… (local)", accion: async () => {
      if ((await confirmarLocal(d, "permiso")) === "local") dlgPermisoDia(d);
    } });
    d.permiso_detalle.forEach((p, i) => {
      items.push({ texto: `Quitar permiso: ${p}`, accion: marca("quitar_permiso", String(i)) });
    });
  }
  items.push("-",
    { texto: d.guardia ? "Quitar guardia" : "Marcar día de guardia (local)",
      accion: marca(d.guardia ? "quitar_guardia" : "guardia") },
    { texto: d.teletrabajo ? "Quitar teletrabajo" : "Marcar teletrabajo (local)",
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
  if (!marcados.length) b.textContent = "Añadir apunte (marca un día)";
  else if (marcados.length === 1) {
    const d = marcados[0];
    b.textContent = `Añadir apunte a ${d.nombre.slice(0, 3).toLowerCase()} ${d.fecha}`;
  } else b.textContent = `Añadir apunte a ${marcados.length} días`;
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
  st.favoritas = new Set(tareas.filter((t) => t.favorita).map((t) => Number(t.id)));
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

// ---------------------------------------------------------------- comentarios usados con la tarea

// El campo Comentario se rellena solo con el ultimo que usaste con la tarea;
// al entrar en el ofrece ademas los anteriores (los distintos del ultimo año).
// Se piden una vez, al entrar en el campo, y valen un rato; lo que añades
// desde aqui se suma al momento.
const comTareas = { mapa: null, cuando: 0, pidiendo: null };
const COM_CADUCA = 10 * 60 * 1000, COM_MAX = 8;
const comNormal = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\s+/g, " ").trim();
function cargarComentariosTareas() {
  if (comTareas.mapa && Date.now() - comTareas.cuando < COM_CADUCA) return Promise.resolve(comTareas.mapa);
  comTareas.pidiendo ??= (async () => {
    try {
      const r = await api().comentarios_tareas();
      comTareas.mapa = r?.por_tarea || {};
      comTareas.cuando = Date.now();
    } catch (_e) {
      comTareas.mapa ??= {};                 // es una ayuda: sin conexion, sin sugerencias
    } finally {
      comTareas.pidiendo = null;
    }
    return comTareas.mapa;
  })();
  return comTareas.pidiendo;
}
function recordarComentario(wp, comentario) {
  if (!comTareas.mapa || wp == null || !comentario) return;
  const k = String(wp);
  comTareas.mapa[k] = [comentario, ...(comTareas.mapa[k] || []).filter((c) => comNormal(c) !== comNormal(comentario))]
    .slice(0, COM_MAX);
}

// Convierte el campo Comentario en un desplegable de los usados con la tarea
// elegida. Escribir filtra (sin tildes); el que la app ha puesto sola no
// filtra ni se repite en la lista. Flechas e Intro, o clic, para elegir.
let listaCom = null;
function sugerenciasComentario(input) {
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", "lista-comentarios");
  const caja = el("div", { id: "lista-comentarios", class: "buscador-tareas lista-comentarios", role: "listbox" });
  caja.hidden = true;
  document.body.append(caja);
  let items = [], activo = -1;

  function colocar() {
    // con zoom en <html>, el rect ya viene ampliado y left/top se volverian a ampliar
    const z = parseFloat(document.documentElement.style.zoom) || 1;
    const r = input.getBoundingClientRect();
    const abajo = innerHeight - r.bottom;
    caja.style.left = `${r.left / z}px`;
    caja.style.width = `${r.width / z}px`;
    // encima del campo siempre que quepa: justo debajo esta el boton Añadir
    if (r.top > 170 || r.top > abajo) {
      caja.style.top = ""; caja.style.bottom = `${(innerHeight - r.top + 2) / z}px`;
      caja.style.maxHeight = `${Math.min(300, r.top - 12) / z}px`;
    } else {
      caja.style.bottom = ""; caja.style.top = `${(r.bottom + 2) / z}px`;
      caja.style.maxHeight = `${Math.min(300, abajo - 12) / z}px`;
    }
  }
  function cerrar() {
    caja.hidden = true;
    activo = -1;
    input.setAttribute("aria-expanded", "false");
  }
  function elegir(c) {
    input.value = c;
    cerrar();
  }
  function pintar() {
    const wp = resolverTarea();
    const todos = (wp != null && comTareas.mapa?.[String(wp)]) || [];
    const escrito = input.value.trim();
    const q = escrito && escrito !== st.comAuto ? comNormal(escrito) : "";
    items = todos.filter((c) => comNormal(c) !== comNormal(escrito) && (!q || comNormal(c).includes(q)));
    if (!items.length || document.activeElement !== input) { cerrar(); return; }
    if (activo >= items.length) activo = -1;
    caja.replaceChildren(el("div", { class: "bt-grupo", text: "Usados con esta tarea" }),
      ...items.map((c, i) => {
        const fila = el("div", { class: `bt-item${i === activo ? " activo" : ""}`, role: "option", title: c, text: c });
        fila.addEventListener("mousedown", (e) => { e.preventDefault(); elegir(c); });
        return fila;
      }));
    caja.hidden = false;
    input.setAttribute("aria-expanded", "true");
    colocar();
  }

  input.addEventListener("focus", async () => {
    activo = -1;
    pintar();
    await cargarComentariosTareas();
    pintar();
  });
  input.addEventListener("input", () => { activo = -1; pintar(); });
  input.addEventListener("blur", () => setTimeout(cerrar, 120));
  input.addEventListener("keydown", (e) => {
    if (caja.hidden) {
      if (e.key === "ArrowDown") { e.preventDefault(); pintar(); }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      activo = e.key === "ArrowDown" ? (activo + 1) % items.length : (activo <= 0 ? items.length : activo) - 1;
      pintar();
      caja.querySelector(".bt-item.activo")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && activo >= 0) {
      e.preventDefault();                    // Intro sobre una sugerencia la elige; no añade el apunte
      e.stopPropagation();
      elegir(items[activo]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cerrar();
    }
  });
  return { cerrar, pintar };
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
  listaCom?.cerrar();
  const dias = [...st.marcados].sort();
  const wp = resolverTarea();
  if (wp == null) {
    await avisar("Falta tarea", "Elige la tarea en la lista del campo Tarea: escribe parte del nombre "
                 + "o su número y pulsa sobre ella (o flechas e Intro). También con «Buscar tarea…».");
    $("tarea").focus();                  // con su lista abierta, para elegirla
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
    // solo si se creo algo: si ProyectosTIC lo rechaza, se cae la conexion o
    // se contesta «No» a repetir, lo escrito se queda para reintentar
    if (r.creados > 0) {
      $("horas").value = st.horasAuto = "";
      $("comentario").value = st.comAuto = "";
    }
    if (r.creados && comentario && comentario !== st.ini.comentario_guardia) {
      st.comHabitual = comentario;
      recordarComentario(wp, comentario);
    }
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

// Ctrl+Z repetido va hacia atras (hasta 20 acciones). Si algo no se pudo
// deshacer (sin red...), se queda pendiente y el siguiente Ctrl+Z lo reintenta.
async function deshacer() {
  if ($("b-deshacer").hidden || st.ocupado) return;
  ocultarAviso();
  st.ocupado = true;
  estado("Deshaciendo…");
  try {
    const r = await llamar("deshacer");
    ponerDeshacer(r.quedan, r.siguiente);
    await cargarSemana();
    if (st.estad?.tipo === "pend") st.estad.cargar();
    if (r.pendiente) {
      estado(`No se pudo deshacer todo «${r.texto}» (${r.ultimo || "sin conexión"}). Pulsa Ctrl+Z para reintentarlo.`);
    } else if (r.texto) {
      estado(`Deshecho: ${r.texto}.` + (r.quedan ? ` Ctrl+Z otra vez: ${r.siguiente} (quedan ${r.quedan}).` : ""));
    }
  } finally {
    st.ocupado = false;
  }
}

// ---------------------------------------------------------------- eventos

function enCampo(e) {
  return ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
}

function navegar(delta) {
  // En Estadisticas, las flechas mueven su periodo; "Hoy" vuelve a la semana
  // de hoy con su ficha marcada (es lo que se espera de "Hoy" en cualquier sitio).
  if (st.estad && delta !== 0) { st.estad.mover(delta); return; }
  // «Hoy» y «Fichar hoy» de la bandeja con la app abierta desde ayer: antes
  // de leer st.hoyLunes se pone al dia (la vista la carga este mismo navegar)
  if (delta === 0) cambioDeDia({ recargar: false });
  if (st.estad) {
    salirEstadisticas();
    if (st.vista !== "semana") { st.vista = "semana"; llamar("guardar_vista", "semana").catch(() => {}); }
    pintarSelectorVista();
  }
  if (st.vista === "mes") {
    if (delta === 0) st.mesSel = mesDe(hoyIso());
    else {
      const m = st.mesSel.mes - 1 + delta;
      st.mesSel = { anio: st.mesSel.anio + Math.floor(m / 12), mes: ((m % 12) + 12) % 12 + 1 };
    }
  } else {
    st.lunes = delta === 0 ? st.hoyLunes : sumarDias(st.lunes, 7 * delta);
  }
  ocultarAviso();
  st.ancla = null;
  cargarSemana({ marcarHoy: true });
}

function irADia(iso) {
  if (st.vista === "mes") st.mesSel = mesDe(iso); else st.lunes = lunesDe(iso);
  cargarSemana({ marcar: [iso] });
}

$("b-ant").onclick = () => navegar(-1);
$("b-sig").onclick = () => navegar(1);
$("b-hoy").onclick = () => navegar(0);
$("b-recargar").onclick = () => (st.estad ? st.estad.cargar() : cargarSemana());
// Estadisticas: entra en el panel; pulsado otra vez, vuelve a las fichas
$("b-estad").onclick = async () => {
  if (st.estad?.tipo !== "estad") { entrarEstadisticas(); return; }
  salirEstadisticas();
  pintarSelectorVista();
  await cargarSemana();
};
// Por completar: igual (otra pulsacion, a las fichas)
$("b-pend").onclick = async () => {
  if (st.estad?.tipo !== "pend") { entrarPendientes(); return; }
  salirEstadisticas();
  pintarSelectorVista();
  await cargarSemana();
};
$("b-aviso").onclick = () => { $("globo-aviso")?.remove(); dlgRecordatorio(); };
$("b-salir").onclick = salirDeLaApp;
$("b-bloquear").onclick = () => { bloquearOActivar(); };
listaCom = sugerenciasComentario($("comentario"));
// al volver a la ventana (p. ej. tras cambiar la hora desde el propio aviso)
for (const [quien, ev] of [[window, "focus"], [document, "visibilitychange"]]) {
  quien.addEventListener(ev, () => {
    if (!st.ini || document.hidden) return;
    if (Date.now() - campanaT > 20000) pintarCampana();
    cambioDeDia();                     // abierta desde ayer: «hoy» ya es otro dia
  });
}
$("b-buscar").onclick = () => dlgBuscar();
$("b-tareas").onclick = (e) => { e.stopPropagation(); menuBajo($("b-tareas"), menuTareas()); };
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
  b.addEventListener("click", async () => {
    const v = b.dataset.vista;
    if (v === "estad") { entrarEstadisticas(); return; }
    if (st.estad) {
      salirEstadisticas();
      if (v === st.vista) { pintarSelectorVista(); await cargarSemana(); return; }
    }
    cambiarVista(v);
  });
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
    // F5: que no recargue la pagina con un dialogo a medias; si el de arriba
    // sabe actualizarse (Buscar tarea), lo hace, este donde este el foco
    if (e.key === "F5") { e.preventDefault(); pila[pila.length - 1].alF5?.(); }
    return;                                   // con un dialogo abierto, nada mas
  }
  if (e.key === "F5") { e.preventDefault(); cargarSemana(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); dlgBuscarApuntes(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); dlgNuevaTarea(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "q") { e.preventDefault(); salirDeLaApp(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") { e.preventDefault(); bloquearOActivar(); return; }
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
    const marcados = diasMarcados();
    if (marcados.length > 1) { e.preventDefault(); copiarDias(marcados); return; }
    const d = diaConFoco() || (st.marcados.size === 1 ? marcados[0] : null);
    if (d) { e.preventDefault(); copiarDia(d); }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && st.portapapeles) {
    e.preventDefault();
    pegarDia(st.marcados.size ? null : diaConFoco()?.iso);
  }
  else if (e.key === "Delete") { e.preventDefault(); eliminarSeleccion(); }
});

cuandoListo(arrancar);
