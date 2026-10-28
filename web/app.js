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
};

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
    estado(`${hecho(r.creados)}${r.saltados ? ` Saltados ${r.saltados} (ya existían).` : ""}`);
  } else if (!r.errores) {
    estado(nada);
  }
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
      text: it.texto, disabled: !!it.desactivado,
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
  herramientas: () => [
    { texto: "Plantillas…", accion: dlgPlantillas },
    { texto: "Importar festivos…", accion: dlgFestivos },
    { texto: "Vacaciones y teletrabajo…", accion: dlgAjustesDias },
    { texto: "Permisos (horas)…", accion: dlgPermisos },
    { texto: "Integraciones (INARI)…", accion: dlgInari },
    { texto: "Aviso diario de fichaje…", accion: dlgRecordatorio },
    "-",
    { texto: "Configuración (asistente)…", accion: () => { location.href = "configurar.html"; } },
  ],
  ayuda: () => [
    { texto: "Atajos de teclado", accion: dlgAtajos },
    { texto: "Novedades (qué hay de nuevo)", accion: dlgNovedades },
    { texto: "Comprobar actualizaciones", accion: () => dlgActualizacion({ forzar: true }) },
    st.ini?.github ? { texto: "Ver en GitHub", accion: () => llamar("abrir_github", "") } : null,
    "-",
    { texto: "Acerca de FichaCSIRC", accion: dlgAcerca },
  ].filter(Boolean),
};

// ---------------------------------------------------------------- arranque

async function arrancar() {
  const ini = st.ini = await llamar("inicio");
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
  if (st.tareas.size) elegirTarea();
  llamar("usuario").then((n) => { $("usuario").textContent = n || ""; }).catch(() => {});
  // A partir del 1 de enero: ofrecer (una vez, opcional) los permisos del año.
  if (ini.toca_permisos_anio) setTimeout(() => dlgPermisosAnio({ manual: false }), 700);
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
}

// Repinta sin red tras una marca local (festivo, guardia, permiso...).
async function repintarLocal() {
  const datos = st.vista === "mes" ? await llamar("repintar_mes", st.mesSel.anio, st.mesSel.mes)
                                   : await llamar("repintar", st.lunes);
  pintarVista(datos, false);
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
  nodo.addEventListener("keydown", (e) => {
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
      chips.childElementCount ? chips : null);
    eventosDia(tarjeta, d);
    cont.append(tarjeta);
    requestAnimationFrame(() => { barra.firstChild.style.width = `${d.frac * 100}%`; });
  });
}

// Texto corto de una celda del mes (la tarjeta de la semana tiene sitio para
// mas; aqui caben unas pocas letras).
function cifraMes(d) {
  if (d.no_laborable) return d.motivo.charAt(0).toUpperCase() + d.motivo.slice(1);
  if (d.estado === "error") return "sin conexión";
  if (d.estado === "permiso") return "Permiso";
  if (d.estado === "completo") return `${fmtHoras(d.reg)}h ✔`;
  if (d.estado === "vacio" && d.futuro) return "";
  return `${fmtHoras(d.reg)}/${fmtHoras(d.obj)}h`;
}

function pintarMes(m) {
  const cont = $("dias");
  cont.className = "dias mes";
  cont.replaceChildren(...["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"].map((n) =>
    el("div", { class: "cab-mes", text: n })));
  for (const d of m.semanas.flat()) {
    const iconos = [d.guardia ? "⚙" : "", d.teletrabajo ? "⌂" : "", d.permiso ? "🕐" : ""].join(" ").trim();
    const barra = el("div", { class: "barra" }, el("i"));
    const celda = el("div", {
      class: `celda ${d.estado}${d.es_hoy ? " hoy" : ""}${d.del_mes ? "" : " fuera"}${d.futuro ? " futuro" : ""}`,
      title: [`${d.nombre} ${d.fecha}`, d.texto, d.guardia ? "Guardia" : "", d.teletrabajo ? "Teletrabajo" : "",
              ...(d.permiso_detalle || [])].filter(Boolean).join("\n")
             + "\nMayús+clic: rango · botón derecho: más opciones",
    },
      el("div", { class: "num-dia" }, el("span", { text: String(d.dia) }),
        iconos ? el("span", { class: "iconos", text: iconos }) : null),
      barra,
      el("div", { class: "cifra", text: cifraMes(d) }));
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
  const items = [{ titulo: `${d.nombre} ${d.fecha}` }];
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
      accion: () => dlgGuardarPlantillaDia(d) },
    { texto: "Eliminar apuntes de este día…", desactivado: !d.apuntes.length,
      accion: () => dlgEliminarDia(d) });
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

function filaApunte(d, a) {
  const clave = claveDe(d, a);
  const fila = el("div", {
    class: `apunte${st.seleccion.has(clave) ? " sel" : ""}`, role: "listitem", tabindex: "0",
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

function pintarApuntes() {
  const lista = $("lista-apuntes");
  lista.replaceChildren();
  const marcados = diasMarcados();
  const varios = marcados.length > 1;
  let filas = 0;
  for (const d of marcados) {
    if (!d.apuntes.length) continue;
    // Con varios dias, cada uno con su cabecera; con uno, va en el titulo.
    if (varios) {
      lista.append(el("div", { class: "grupo-dia" },
        el("span", { text: `${d.nombre} ${d.fecha}` }),
        el("span", { class: "tenue", text: `${fmtHoras(d.reg)}h de ${fmtHoras(d.obj)}h` })));
    }
    for (const a of d.apuntes) {
      lista.append(filaApunte(d, a));
      filas++;
    }
  }
  if (marcados.length === 1) {
    const d = marcados[0];
    $("titulo-apuntes").textContent = `Apuntes · ${d.nombre} ${d.fecha}`;
    $("resumen-apuntes").textContent = d.no_laborable ? d.motivo
      : `${fmtHoras(d.reg)}h de ${fmtHoras(d.obj)}h`;
  } else {
    $("titulo-apuntes").textContent = varios ? `Apuntes · ${marcados.length} días` : "Apuntes";
    $("resumen-apuntes").textContent = varios
      ? `${fmtHoras(marcados.reduce((t, d) => t + d.reg, 0))}h en total` : "";
  }
  lista.hidden = !filas;
  $("apuntes-vacio").hidden = filas > 0;
  $("apuntes-vacio").textContent = !marcados.length ? "Marca un día para ver sus apuntes."
    : (varios ? "Los días marcados no tienen apuntes." : "Este día aún no tiene apuntes.");
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
    $("b-deshacer").hidden = !r.puede_deshacer;
    await cargarSemana();
    estado(r.eliminados === 1 ? "Apunte eliminado." : `${r.eliminados} apuntes eliminados.`);
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
  else if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); deshacer(); }
  else if (e.key === "Delete") { e.preventDefault(); eliminarSeleccion(); }
});

cuandoListo(arrancar);
