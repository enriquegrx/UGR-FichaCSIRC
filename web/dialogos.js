/* FichaCSIRC - prototipo web: dialogos (equivalentes a dialogos.py de Tkinter).
 *
 * Todos se montan con dialogo(): cabecera, cuerpo con scroll y pie de botones
 * SIEMPRE visible (la leccion del pie que desaparecia en Tkinter). Se apilan
 * (p. ej. Permisos -> Añadir concesion) y Esc cierra el de arriba.
 * Usa las utilidades de app.js: el, llamar, preguntar, avisar, estado, st...
 */
"use strict";

const pila = [];   // dialogos abiertos, el ultimo arriba

/* botones: [{texto, clase, accion(d), izquierda, id}] */
function dialogo({ titulo, ancho = 520, botones = [] }) {
  const cuerpo = el("div", { class: "dlg-cuerpo" });
  // append() de DOM escribe "null" si le llega un null (salia "null" en el
  // aviso de "solo en este equipo" al marcar un festivo): se filtran aqui,
  // para todos los dialogos.
  const anadir = cuerpo.append.bind(cuerpo);
  cuerpo.append = (...nodos) => anadir(...nodos.filter((n) => n !== null && n !== undefined && n !== false));
  const izq = el("div", { class: "dlg-botones" });
  const der = el("div", { class: "dlg-botones" });
  const d = { cuerpo, botones: {}, cerrar: null };
  const caja = el("div", { class: "dlg", role: "dialog", "aria-modal": "true", "aria-label": titulo },
    el("div", { class: "dlg-cabeza" },
      el("h3", { text: titulo }),
      el("button", { class: "dlg-x", title: "Cerrar (Esc)", "aria-label": "Cerrar", text: "×",
                     onclick: () => d.cerrar() })),
    cuerpo,
    el("div", { class: "dlg-pie" }, izq, der));
  caja.style.width = `min(${ancho}px, 100%)`;
  const capa = el("div", { class: "capa" }, caja);
  capa.style.zIndex = String(30 + pila.length);
  d.cerrar = () => {
    capa.remove();
    const i = pila.indexOf(d);
    if (i >= 0) pila.splice(i, 1);
  };
  for (const b of botones) {
    const btn = el("button", { class: b.clase || "", text: b.texto });
    btn.onclick = async () => {
      btn.disabled = true;
      try { await b.accion(d); } catch (_e) { /* llamar() ya avisó */ }
      finally { btn.disabled = false; }
    };
    (b.izquierda ? izq : der).append(btn);
    if (b.id) d.botones[b.id] = btn;
  }
  document.body.append(capa);
  pila.push(d);
  return d;
}

const cerrarBoton = { texto: "Cerrar", accion: (d) => d.cerrar() };
const cancelarBoton = { texto: "Cancelar", accion: (d) => d.cerrar() };

// ---- piezas de formulario ----
function rejilla(...filas) {
  const g = el("div", { class: "rejilla" });
  for (const [etiqueta, control] of filas) {
    g.append(el("label", { text: etiqueta }), control);
  }
  return g;
}
function entrada(valor = "", props = {}) {
  const i = el("input", props);
  i.value = valor ?? "";
  return i;
}
function selector(opciones, elegido) {
  const s = el("select");
  for (const o of opciones) {
    const op = el("option", { value: String(o.valor), text: o.texto });
    if (String(o.valor) === String(elegido)) op.selected = true;
    s.append(op);
  }
  return s;
}
const nota = (texto, clase = "tenue") => el("p", { class: `nota ${clase}`, text: texto });
const primero = (d) => d.cuerpo.querySelector("input, select, button")?.focus();

// ================================================================ editar

async function dlgEditar(dia, a) {
  if (a.destino === "inari") {
    await avisar("Editar slot de INARI",
      "Para corregir un slot de INARI, bórralo (Supr) y vuelve a registrarlo con las horas correctas.");
    return;
  }
  const horas = entrada(fmtHoras(a.horas), { class: "horas", inputmode: "decimal" });
  const act = el("select", {}, el("option", { text: a.actividad || "…" }));
  const com = entrada(a.comentario, { class: "ancho" });
  const d = dialogo({ titulo: "Editar apunte", botones: [cancelarBoton,
    { texto: "Guardar", clase: "primario", accion: guardar }] });
  d.cuerpo.append(
    el("p", { class: "dlg-sub", text: a.tarea }),
    nota(`${dia.nombre} ${dia.fecha}`),
    rejilla(["Horas", horas], ["Actividad", act], ["Comentario", com]));
  for (const i of [horas, com]) i.addEventListener("keydown", (e) => { if (e.key === "Enter") guardar(d); });
  horas.focus();
  horas.select();
  llamar("actividades", a.wp_id).then((r) => {
    const nombres = r.nombres.includes(a.actividad) || !a.actividad ? r.nombres : [a.actividad, ...r.nombres];
    act.replaceChildren(...nombres.map((n) => el("option", { value: n, text: n })));
    act.value = a.actividad || r.preferida;
  }).catch(() => {});

  async function guardar(dd) {
    const r = await llamar("editar", dia.iso, a.id, horas.value, com.value, act.value);
    if (r.error) { await avisar("No se pudo guardar", r.error); return; }
    dd.cerrar();
    await cargarSemana();
    trasCambio(r, "Apunte actualizado.");
  }
}

// ================================================================ editar dia

// Todo el dia de una vez: horas y actividad de cada apunte, quitar alguno o
// anadir tareas. Nada se envia hasta "Guardar"; entonces va todo junto y
// "Deshacer" (Ctrl+Z) lo devuelve a como estaba.
/* nueva: abre con una fila nueva; tarea {id, nombre} y horas: esa fila ya
   rellena (p. ej. "Imputar en esa tarea" al marcar una baja). */
function dlgEditarDia(dia, { nueva = false, tarea = null, horas = null } = {}) {
  const filas = [];
  const total = el("span", { class: "ed-total" });
  const lista = el("div", { class: "ed-lista" });
  const d = dialogo({ titulo: "Editar día", ancho: 680, botones: [
    { texto: "+ Añadir tarea", izquierda: true, accion: () => nuevaFila() },
    cancelarBoton,
    { texto: "Guardar", clase: "primario", accion: guardar }] });
  d.cuerpo.append(
    el("div", { class: "ed-cabeza" }, el("p", { class: "dlg-sub", text: `${dia.nombre} ${dia.fecha}` }), total),
    lista,
    nota("Cambia las horas aquí mismo. La papelera quita la tarea (se puede deshacer)."));

  const numero = (v) => Number(String(v).trim().replace(",", "."));
  function recalcular() {
    const suma = filas.filter((f) => !f.borrar)
      .reduce((s, f) => s + (numero(f.horas.value) || 0), 0);
    const r = Math.round(suma * 100) / 100;
    total.textContent = `${fmtHoras(r)}h de ${fmtHoras(dia.obj)}h`;
    total.className = "ed-total " + (dia.obj && r > dia.obj + 0.001 ? "mas"
      : r >= dia.obj - 0.001 ? "ok" : "falta");
  }

  // Desplegable de actividades de una tarea: se rellena al abrirlo la primera
  // vez (no se piden las de todas las tareas solo por abrir el dialogo).
  function selectorActividad(wpId, actual) {
    const s = el("select", { class: "ed-act" }, el("option", { value: actual || "", text: actual || "…" }));
    let cargado = null;
    s.cargar = () => (cargado ??= llamar("actividades", wpId).then((r) => {
      const nombres = !actual || r.nombres.includes(actual) ? r.nombres : [actual, ...r.nombres];
      s.replaceChildren(...nombres.map((n) => el("option", { value: n, text: n })));
      s.value = actual || r.preferida;
      return r;
    }).catch(() => ({})));
    s.addEventListener("focus", () => s.cargar(), { once: true });
    s.addEventListener("mousedown", () => s.cargar(), { once: true });
    return s;
  }

  function botonBorrar(f) {
    const b = el("button", { class: "icono borrar", title: "Quitar esta tarea",
                             "aria-label": "Quitar esta tarea" }, icono("borrar"));
    b.onclick = () => {
      if (f.nueva) { f.fila.remove(); filas.splice(filas.indexOf(f), 1); recalcular(); return; }
      f.borrar = !f.borrar;
      f.fila.classList.toggle("quitada", f.borrar);
      f.horas.disabled = f.act.disabled = f.borrar;
      b.title = f.borrar ? "Mantener esta tarea" : "Quitar esta tarea";
      b.replaceChildren(f.borrar ? el("span", { text: "↺" }) : icono("borrar"));
      recalcular();
    };
    return b;
  }

  function campoHoras(valor) {
    const h = entrada(valor, { class: "horas", inputmode: "decimal", "aria-label": "Horas" });
    h.addEventListener("input", recalcular);
    h.addEventListener("keydown", (e) => { if (e.key === "Enter") guardar(d); });
    return h;
  }

  for (const a of dia.apuntes) {
    const inari = a.destino === "inari";
    const f = { a, horas: campoHoras(fmtHoras(a.horas)), borrar: false };
    f.act = inari ? el("span", { class: "tenue", text: "slot de INARI" }) : selectorActividad(a.wp_id, a.actividad);
    if (inari) { f.horas.disabled = true; f.horas.title = "Un slot de INARI no se edita: bórralo y regístralo de nuevo"; }
    f.fila = el("div", { class: "ed-fila" },
      el("span", { class: "ed-h" }, f.horas, " h"),
      el("span", { class: "ed-tarea", title: a.tarea, text: a.tarea }),
      f.act, botonBorrar(f));
    filas.push(f);
    lista.append(f.fila);
  }

  function nuevaFila(puesta = null) {
    // Buscador (no un desplegable): sin favoritas, el desplegable salia vacio.
    const tarea = entrada("", { class: "ed-tarea-input", placeholder: "Busca por nombre o número de tarea",
                                "aria-label": "Tarea" });
    const f = { nueva: true, tarea, wpId: null, horas: campoHoras(""), borrar: false,
                act: el("select", { class: "ed-act", disabled: true }, el("option", { text: "…" })),
                comentario: "" };
    f.fila = el("div", { class: "ed-fila nueva" },
      el("span", { class: "ed-h" }, f.horas, " h"), tarea, f.act, botonBorrar(f));
    filas.push(f);
    lista.append(f.fila);
    tarea.addEventListener("input", () => { f.wpId = null; });     // reescribir = volver a elegir
    const elegir = async (t, actividad = "") => {
      f.wpId = Number(t.id);
      const sel = selectorActividad(t.id, actividad);
      f.act.replaceWith(sel);
      f.act = sel;
      const r = await sel.cargar();
      f.comentario = r.comentario || "";
      f.horas.focus();
    };
    buscadorTarea(tarea, { alElegir: (t) => elegir(t) });
    if (puesta) {
      tarea.value = `${puesta.id} - ${puesta.nombre}`;
      if (puesta.horas) f.horas.value = fmtHoras(puesta.horas);
      elegir(puesta, puesta.actividad || "");
    } else {
      tarea.focus();
    }
    recalcular();
  }

  async function guardar(dd) {
    const cambios = { editar: [], borrar: [], anadir: [] };
    for (const f of filas) {
      if (f.nueva) {
        if (!f.wpId && !f.tarea.value.trim() && !f.horas.value.trim()) continue;   // fila vacia: se ignora
        if (!f.wpId) { await avisar("Falta tarea", "Busca y elige la tarea de la fila nueva."); f.tarea.focus(); return; }
        cambios.anadir.push({ wp_id: f.wpId, horas: f.horas.value,
                              actividad: f.act.value || "", comentario: f.comentario });
      } else if (f.borrar) {
        cambios.borrar.push({ id: f.a.id, destino: f.a.destino || "op" });
      } else if (f.a.destino !== "inari") {
        cambios.editar.push({ id: f.a.id, horas: f.horas.value, actividad: f.act.value || f.a.actividad });
      }
    }
    for (const f of filas.filter((x) => !x.borrar && !x.horas.disabled)) {
      const h = numero(f.horas.value);
      if ((f.nueva && !f.wpId) || (h > 0 && h <= 24)) continue;
      await avisar("Horas no válidas", "Las horas deben ser un número entre 0 y 24 (por ejemplo 3,5).");
      f.horas.focus();
      f.horas.select();
      return;
    }
    const cambiaAlgo = cambios.borrar.length || cambios.anadir.length || cambios.editar.some((e) => {
      const a = dia.apuntes.find((x) => x.id === e.id);
      return Math.abs(numero(e.horas) - a.horas) > 0.001 || e.actividad !== a.actividad;
    });
    if (!cambiaAlgo) { dd.cerrar(); return; }
    estado("Guardando el día…");
    const r = await llamar("guardar_dia", dia.iso, cambios);
    if (r.error) { await avisar("No se pudo guardar", r.error); return; }
    dd.cerrar();
    if (r.errores) {
      await avisar("Guardado con errores",
        `Cambios hechos: ${r.hechos}. Con errores: ${r.errores}.\nÚltimo error: ${r.ultimo}`);
    }
    await cargarSemana();
    trasCambio(r, `${dia.nombre} ${dia.fecha} actualizado.`);
  }

  if (tarea) nuevaFila({ ...tarea, horas });
  else if (!dia.apuntes.length || nueva) nuevaFila();
  else filas[0].horas.focus();
  recalcular();
}

// ================================================================ copias de seguridad

async function dlgCopias() {
  const lista = el("div", { class: "lista-copias" });
  const d = dialogo({ titulo: "Copias de seguridad", ancho: 620, botones: [
    { texto: "Exportar…", izquierda: true, accion: exportar },
    { texto: "Importar…", izquierda: true, accion: importar },
    cerrarBoton] });
  d.cuerpo.append(
    nota("FichaCSIRC guarda sola una copia de tu configuración cada vez que cambian tus favoritas, "
         + "plantillas, permisos, vacaciones o festivos: las 10 últimas y una por día de la última semana."),
    lista,
    nota("Restaurar no cambia tu API key, el token de INARI ni el PIN. Antes se guarda una copia de cómo "
         + "estás ahora, así que también se puede volver atrás.\n«Exportar» crea un archivo para llevarte "
         + "la configuración a otro equipo (sin API key, token ni PIN); allí, «Importar»."));
  await pintar();

  async function pintar() {
    const copias = await llamar("copias");
    lista.replaceChildren(...(copias.length ? copias.map((c, i) => el("div", { class: "fila-copia" },
      el("span", { class: "num", text: c.fecha }),
      el("span", { class: "tenue crece", text: i === 0 ? `${c.resumen}  (la más reciente)` : c.resumen }),
      el("button", { text: "Restaurar", onclick: () => restaurar(c) })))
      : [el("p", { class: "tenue", text: "Todavía no hay copias: se hará la primera al cambiar algo." })]));
  }
  async function restaurar(c) {
    if (!(await preguntar("Restaurar copia",
        `¿Volver a la configuración del ${c.fecha}?\n\n${c.resumen}\n\n`
        + "Tu API key, el token de INARI y el PIN se quedan como están.", { si: "Restaurar", no: "Cancelar" }))) return;
    const r = await llamar("restaurar_copia", c.id);
    if (r.error) { await avisar("Restaurar copia", r.error); return; }
    await avisar("Restaurar copia", `Restaurada la configuración del ${c.fecha}. La app se recarga.`);
    location.reload();
  }
  async function exportar() {
    const r = await llamar("exportar_config");
    if (r.cancelado) return;
    if (r.error) { await avisar("Exportar", r.error); return; }
    estado(`Configuración exportada (sin API key, token ni PIN): ${r.ruta}`);
  }
  async function importar() {
    if (!(await preguntar("Importar configuración",
        "Se sustituirán tus favoritas, plantillas, permisos, vacaciones y festivos por los del archivo "
        + "(antes se guarda una copia de los actuales). Tu API key y el PIN no cambian.\n\n¿Elegir el archivo?",
        { si: "Elegir archivo", no: "Cancelar" }))) return;
    const r = await llamar("importar_config");
    if (r.cancelado) return;
    if (r.error) { await avisar("Importar", r.error); return; }
    await avisar("Importar", "Configuración importada. La app se recarga.");
    location.reload();
  }
}

// ================================================================ marcas solo en este equipo

// Antes de marcar festivo, vacaciones, baja, permiso por horas, guardia o
// teletrabajo: dejar claro
// que se guarda SOLO en este equipo (no va a ProyectosTic) y, si hay una tarea
// de ausencias en ProyectosTic, ofrecer imputar ahi. Devuelve "local"
// (marcar), "imputar" (ya se abrio Editar dia) o null (cancelado).
// "No volver a preguntarme" lo calla para ese motivo (Herramientas lo repone).
const CON_TAREA = ["baja", "vacaciones", "permiso", "guardia", "teletrabajo"];
// como se dice cada motivo en el aviso
const LOCAL_COMO = { guardia: " como día de guardia" };
const LOCAL_NOMBRE = { permiso: "permiso por horas", guardia: "día de guardia" };
const LOCAL_PLURAL = { permiso: "los permisos", baja: "las bajas", vacaciones: "las vacaciones",
                       guardia: "las guardias", teletrabajo: "los días de teletrabajo" };
// alImputar(tarea): que hacer con "Imputar en esa tarea" (por defecto, Editar dia).
async function confirmarLocal(d, motivo, { alImputar = null } = {}) {
  if ((st.ini?.avisos_local_no || []).includes(motivo)) return "local";
  let tarea = null;
  if (CON_TAREA.includes(motivo)) {
    estado(`Comprobando si tienes en ProyectosTIC una tarea de ${LOCAL_PLURAL[motivo]}…`);
    tarea = await llamar("tarea_ausencia", motivo, st.habituales?.filas || []).catch(() => null);
    estado("");
  }
  const que = motivo === "permiso" ? "Añadir un permiso por horas el" : "Marcar el";
  const como = motivo === "permiso" ? "" : (LOCAL_COMO[motivo] || ` como ${motivo}`);
  return new Promise((resolver) => {
    let resuelto = false, cerrarDialogo = null;
    const fin = (v) => { if (!resuelto) { resuelto = true; resolver(v); } };
    // cerrar el dialogo y decir que se eligio (la X y Esc cuentan como Cancelar)
    const salir = (v) => { cerrarDialogo(); fin(v); };
    const nomas = el("input", { type: "checkbox" });
    // se espera a que se guarde antes de marcar el dia: dos guardados a la vez
    // chocaban (3.2.0)
    const recordar = async () => {
      if (!nomas.checked) return;
      try {
        st.ini.avisos_local_no = (await llamar("no_avisar_local", motivo)).avisos_local_no;
      } catch (_e) { /* llamar ya aviso */ }
    };
    const botones = [
      { texto: "Cancelar", accion: () => salir(null) },
      { texto: motivo === "permiso" ? "Seguir (solo aquí)" : "Marcar solo aquí", clase: tarea ? "" : "primario",
        accion: async () => { await recordar(); salir("local"); } }];
    if (tarea) {
      botones.unshift({ texto: "Imputar en esa tarea", clase: "primario", izquierda: true, accion: async () => {
        await recordar();
        salir("imputar");
        if (alImputar) alImputar(tarea);
        else dlgEditarDia(d, { tarea, horas: d.falta > 0.001 ? d.falta : d.obj });
      } });
    }
    const dlg = dialogo({ titulo: `${que} ${d.nombre.toLowerCase()} ${d.fecha}${como} (solo en este equipo)`,
                          ancho: 560, botones });
    cerrarDialogo = dlg.cerrar;
    dlg.cerrar = () => salir(null);                    // la X y Esc = cancelar
    dlg.cuerpo.append(
      el("p", {}, "Esto se guarda ", el("b", { text: "solo en tu FichaCSIRC" }),
         ": no se envía a ProyectosTIC y en OpenProject no aparecerá."),
      tarea ? el("div", { class: "aviso-local" },
        el("p", {}, "⚠ Tienes en ProyectosTIC la tarea ", el("b", { text: `«${tarea.nombre}»` }),
          tarea.proyecto || tarea.padre ? ` (${[tarea.proyecto, tarea.padre].filter(Boolean).join(" › ")})` : "", "."),
        el("p", { text: `Si en tu servicio ${LOCAL_PLURAL[motivo]} `
                        + "se imputan ahí, impútalo en esa tarea en vez de (o además de) marcarlo aquí." }))
        : null,
      el("label", { class: "check" }, nomas, ` No volver a preguntarme para «${LOCAL_NOMBRE[motivo] || motivo}»`));
  });
}

// ================================================================ estadisticas

// Pestaña Estadisticas. Semana, mes o año: horas, jornada cumplida, media, horas de mas, tareas y
// actividades mas hechas (con los colores de las fichas: por horas), el año
// mes a mes con los colores del calendario de calor y unos detalles.
const PERIODOS_ESTAD = [["semana", "Semanal"], ["mes", "Mensual"], ["anio", "Anual"]];
const COLORES_ACTIVIDAD = ["--t5", "--t6", "--t7", "--t2", "--t3", "--t4", "--t0", "--t1"];

// Monta el panel en 'cont' (la seccion #estadisticas de la ventana). Devuelve
// {mover(n), cargar()}: las flechas y "Hoy" de arriba lo mueven (0 = hoy).
function montarEstadisticas(cont, { periodo = "mes", ref = hoyIso(), alTitulo = () => {}, alIrADia = () => {} } = {}) {
  let seq = 0;
  const cuerpo = el("div", { class: "estad" });
  const botones = PERIODOS_ESTAD.map(([p, t]) => el("button", { text: t, onclick: () => { periodo = p; cargar(); } }));
  let ultimo = null;       // lo ultimo pintado: de ahi sale el informe
  const bInforme = el("button", { text: "🖨 Informe…", disabled: true,
    title: "Este periodo en una página para imprimir o guardar como PDF (se abre en el navegador)",
    onclick: () => { if (ultimo) abrirInforme(ultimo); } });
  cont.replaceChildren(
    el("div", { class: "cabeza-seccion" },
      // el periodo, bien a la vista junto al titulo: Semanal | Mensual | Anual
      el("div", { class: "fila estad-cabeza" },
        el("h2", { text: "Estadísticas" }),
        el("div", { class: "pills-periodo", role: "group", "aria-label": "Periodo de las estadísticas" }, ...botones),
        el("span", { class: "pend-hueco" }),
        bInforme)),
    cuerpo);

  function mover(n) {
    const [a, m] = ref.split("-").map(Number);
    if (n === 0) ref = hoyIso();
    else if (periodo === "semana") ref = sumarDias(ref, 7 * n);
    else if (periodo === "anio") ref = `${a + n}-${String(m).padStart(2, "0")}-01`;
    else ref = new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
    cargar();
  }

  async function cargar() {
    botones.forEach((b, i) => {
      b.classList.toggle("activo", PERIODOS_ESTAD[i][0] === periodo);
      b.setAttribute("aria-pressed", String(PERIODOS_ESTAD[i][0] === periodo));
    });
    const mio = ++seq;
    cuerpo.replaceChildren(nota("Calculando…"));
    let r;
    try { r = await llamar("estadisticas", periodo, ref); } catch (_e) { return; }
    if (mio !== seq) return;
    if (r.error) { cuerpo.replaceChildren(nota(r.error, "rojo")); ultimo = null; bInforme.disabled = true; return; }
    alTitulo(r.titulo);
    ultimo = r;
    bInforme.disabled = false;
    pintar(r);
  }

  function pintar(r) {
    const kpi = (etiqueta, valor, clase = "") => el("div", { class: "kpi" },
      el("small", { text: etiqueta }), el("b", { class: clase, text: valor }));
    // "Como va" (lo que era el Resumen del mes): estado, barra y dias por completar
    const c = r.como_va;
    const del = { semana: "de la semana", mes: "del mes", anio: "del año" }[r.periodo];
    const MAX_DIAS = 24;
    const comoVa = el("div", { class: `estad-comova ${c.al_dia ? "ok" : "aviso"}` },
      el("div", { class: "comova-cab" },
        el("span", { class: "comova-estado", text: c.estado }),
        el("span", { class: "comova-cifras",
                     text: `${r.total} registradas · objetivo hasta hoy ${c.objetivo_hoy} · objetivo ${del} ${c.objetivo_periodo}` })),
      el("div", { class: "comova-barra" }, el("i", { style: `--w:${Math.round(c.frac * 100)}%` })),
      c.incompletos.length ? el("div", { class: "comova-dias" },
        el("span", { class: "tenue", text: c.incompletos.length === 1 ? "Día por completar:" : "Días por completar:" }),
        ...c.incompletos.slice(0, MAX_DIAS).map((x) => el("button", {
          class: "chip-dia", title: "Ir a ese día", onclick: () => alIrADia(x.iso) },
          el("b", { text: x.dia }), ` ${x.horas}`)),
        c.incompletos.length > MAX_DIAS ? el("span", { class: "tenue", text: `y ${c.incompletos.length - MAX_DIAS} más` }) : null)
        : null);
    const nodos = [comoVa, el("div", { class: "estad-kpis" },
      kpi("Horas imputadas", r.total),
      kpi("Jornada cumplida", r.cumplida === null ? "—" : `${r.cumplida}%`,
          r.cumplida === null ? "" : r.cumplida >= 100 ? "verde" : "ambar"),
      kpi("Media por día", r.media),
      kpi("Horas de más", r.exceso === "0h" ? "0h" : `+${r.exceso}`, r.exceso === "0h" ? "" : "azul"))];
    if (!r.tareas.length) {
      nodos.push(nota("No hay apuntes en este periodo."));
    } else {
      nodos.push(el("h3", { class: "estad-sec", text: "Tareas más realizadas" }),
        ...r.tareas.map((t, i) => el("div", { class: "estad-fila", title: t.nombre },
          el("span", { class: "estad-nombre", text: t.nombre }),
          el("div", { class: "estad-barra" },
            el("i", { style: `--w:${t.pct}%;--c:${t.wp_id ? `var(--t${i % COLORES_TAREA})` : "var(--tenue)"}` })),
          el("span", { class: "estad-cifra", text: `${t.horas_txt} · ${t.pct}%` }))),
        el("h3", { class: "estad-sec", text: "Por actividad" }),
        el("div", { class: "estad-mezcla" }, ...r.actividades.map((a, i) => el("i", {
          title: `${a.nombre}: ${a.horas_txt}`,
          style: `--w:${a.pct}%;--c:var(${COLORES_ACTIVIDAD[i % COLORES_ACTIVIDAD.length]})` }))),
        el("div", { class: "estad-leyenda" }, ...r.actividades.map((a, i) => el("span", {},
          el("i", { class: "punto", style: `--c:var(${COLORES_ACTIVIDAD[i % COLORES_ACTIVIDAD.length]})` }),
          `${a.nombre} ${a.pct}%`))));
    }
    if (r.meses.length) {
      const tope = Math.max(1, ...r.meses.map((m) => Math.max(m.reg, m.obj)));
      nodos.push(el("h3", { class: "estad-sec", text: "El año, mes a mes" }),
        el("div", { class: "estad-anio" }, ...r.meses.map((m) => el("div", { title: `${m.mes}: ${m.texto}` },
          el("div", { class: "mes-col" },
            el("span", { class: `mes-barra ${m.estado}`, style: `--h:${Math.round((m.reg / tope) * 100)}%` })),
          m.mes))));
    }
    const dt = r.detalles;
    nodos.push(el("h3", { class: "estad-sec", text: "Detalles" }), el("ul", { class: "estad-detalles" },
      dt.racha ? el("li", { text: `🔥 Racha: ${dt.racha} ${dt.racha === 1 ? "día laborable completo" : "días laborables seguidos completos"}` }) : null,
      el("li", { text: `⌂ Teletrabajo: ${dt.teletrabajo} ${dt.teletrabajo === 1 ? "día" : "días"} · ⚙ Guardias: ${dt.guardias} ${dt.guardias === 1 ? "día" : "días"}` }),
      el("li", { text: dt.incompletos
        ? `⚠ ${dt.incompletos} ${dt.incompletos === 1 ? "día incompleto" : "días incompletos"} (faltan ${dt.faltan} en total)`
        : "✔ Ningún día incompleto" }),
      dt.permisos !== "0h" ? el("li", { text: `🕐 Permisos usados: ${dt.permisos}` }) : null));
    cuerpo.replaceChildren(...nodos);
  }
  cargar();
  return { mover, cargar };
}

// ================================================================ informe para imprimir

// El periodo de Estadisticas en una pagina suelta (HTML sin nada de fuera),
// que el motor guarda en un temporal y abre en el navegador: desde ahi se
// imprime o se guarda como PDF. Se monta con el() (textContent): un comentario
// o una tarea con "<" no puede colar HTML.
const CSS_INFORME = `
  body { font: 14px/1.45 "Segoe UI", system-ui, sans-serif; color: #1f2933; margin: 32px auto; max-width: 820px; padding: 0 24px; }
  h1 { font-size: 22px; margin: 0; } h2 { font-size: 16px; margin: 26px 0 8px; border-bottom: 2px solid #0b66c3; padding-bottom: 4px; }
  .sub { color: #64707d; margin: 4px 0 0; } .estado { font-size: 16px; font-weight: 700; margin: 18px 0 2px; }
  .ok { color: #248a46; } .falta { color: #b7791f; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0; }
  .kpi { border: 1px solid #d7dce2; border-radius: 8px; padding: 8px 12px; } .kpi small { display: block; color: #64707d; font-size: 12px; }
  .kpi b { font-size: 20px; }
  table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
  th { font-size: 12px; color: #64707d; } td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  ul { margin: 6px 0; padding-left: 20px; } .pie { color: #64707d; font-size: 12px; margin-top: 28px; }
  .imprimir { float: right; font: inherit; padding: 6px 14px; border: 1px solid #0b66c3; border-radius: 6px; background: #0b66c3; color: #fff; cursor: pointer; }
  @media print { .imprimir { display: none; } body { margin: 0; max-width: none; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
`;

function htmlInforme(r, { usuario = "", version = "" } = {}) {
  const c = r.como_va, dt = r.detalles;
  const del = { semana: "de la semana", mes: "del mes", anio: "del año" }[r.periodo];
  const hoy = hoyIso().split("-").reverse().join("/");
  const tabla = (cab, filas) => el("table", {},
    el("thead", {}, el("tr", {}, ...cab.map(([t, n]) => el("th", { class: n ? "n" : null, text: t })))),
    el("tbody", {}, ...filas.map((f) => el("tr", {}, ...f.map((t, i) => el("td", { class: cab[i][1] ? "n" : null, text: String(t) }))))));
  const kpi = (e, v) => el("div", { class: "kpi" }, el("small", { text: e }), el("b", { text: v }));
  // el() pondria "onclick" como evento de ESTA pagina: aqui tiene que viajar como atributo
  const bImprimir = el("button", { class: "imprimir", text: "Imprimir / guardar PDF" });
  bImprimir.setAttribute("onclick", "window.print()");
  const cuerpo = el("body", {},
    bImprimir,
    el("h1", { text: "FichaCSIRC · Informe de horas" }),
    el("p", { class: "sub", text: `${r.titulo}${usuario ? ` · ${usuario}` : ""} · generado el ${hoy}` }),
    el("p", { class: `estado ${c.al_dia ? "ok" : "falta"}`, text: c.estado }),
    el("p", { class: "sub", text: `${r.total} registradas · objetivo hasta hoy ${c.objetivo_hoy} · objetivo ${del} ${c.objetivo_periodo}` }),
    el("div", { class: "kpis" },
      kpi("Horas imputadas", r.total), kpi("Jornada cumplida", r.cumplida === null ? "—" : `${r.cumplida}%`),
      kpi("Media por día", r.media), kpi("Horas de más", r.exceso === "0h" ? "0h" : `+${r.exceso}`)));
  if (r.tareas.length) {
    cuerpo.append(el("h2", { text: "Horas por tarea" }),
      tabla([["Tarea"], ["Horas", 1], ["%", 1]], r.tareas.map((t) => [t.nombre, t.horas_txt, `${t.pct}%`])),
      el("h2", { text: "Horas por actividad" }),
      tabla([["Actividad"], ["Horas", 1], ["%", 1]], r.actividades.map((a) => [a.nombre, a.horas_txt, `${a.pct}%`])));
  } else {
    cuerpo.append(el("p", { text: "No hay apuntes en este periodo." }));
  }
  if (r.meses.length) {
    cuerpo.append(el("h2", { text: "El año, mes a mes" }),
      tabla([["Mes"], ["Registradas de objetivo", 1], ["Estado"]],
        r.meses.map((m) => [m.mes, m.texto || "—",
          { completo: "Completo", parcial: "Incompleto", futuro: "—", nolab: "Sin días laborables" }[m.estado] || ""])));
  }
  cuerpo.append(el("h2", { text: "Detalles" }), el("ul", {},
    el("li", { text: `Teletrabajo: ${dt.teletrabajo} ${dt.teletrabajo === 1 ? "día" : "días"} · Guardias: ${dt.guardias} ${dt.guardias === 1 ? "día" : "días"}` }),
    el("li", { text: dt.incompletos ? `${dt.incompletos} ${dt.incompletos === 1 ? "día incompleto" : "días incompletos"} (faltan ${dt.faltan} en total)`
                                    : "Ningún día incompleto" }),
    dt.permisos !== "0h" ? el("li", { text: `Permisos usados: ${dt.permisos}` }) : null));
  if (c.incompletos.length) {
    cuerpo.append(el("h2", { text: "Días por completar" }),
      tabla([["Día"], ["Registradas / jornada", 1]], c.incompletos.map((x) => [x.dia, x.horas])));
  }
  cuerpo.append(el("p", { class: "pie", text: `Generado por FichaCSIRC${version ? ` ${version}` : ""} a partir de los apuntes de ProyectosTIC.` }));
  const doc = el("html", { lang: "es" },
    el("head", {}, el("meta", { charset: "utf-8" }), el("title", { text: `FichaCSIRC · ${r.titulo}` }),
      el("style", { text: CSS_INFORME })),
    cuerpo);
  return `<!doctype html>\n${doc.outerHTML}`;
}

async function abrirInforme(r) {
  estado("Preparando el informe…");
  const html = htmlInforme(r, { usuario: $("usuario")?.textContent || "", version: st.ini?.version ? `v${st.ini.version}` : "" });
  const res = await llamar("abrir_informe", html, `informe-${r.periodo}-${r.desde || ""}`);
  if (res.error) { await avisar("Informe", res.error); estado(""); return; }
  estado("Informe abierto en el navegador: desde ahí, Imprimir o Guardar como PDF.");
}

// ================================================================ por completar

// Pestaña "Por completar" (botón 🧩 junto a Estadísticas): los días del año sin
// imputar del todo, hasta ayer. Arriba, una ficha por mes (y una del año
// entero) con lo que falta; la elegida filtra la lista de abajo, para no ver
// un listado enorme. Se marcan uno, varios o todos (también de varios meses) y
// se rellenan de una vez. Tres maneras: completar lo que le falta a cada uno
// con una tarea, aplicar una plantilla o copiar un día. Antes de hacerlo, un
// resumen; después, todo el bloque se deshace de una vez. Devuelve
// {mover(n), cargar()}: las flechas de arriba cambian de año.
const MESES_LARGOS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto",
                      "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function montarPendientes(cont, { alTitulo = () => {}, alIrADia = () => {}, alDatos = () => {},
                                  anio: anioIni = null, filtro: filtroIni = null, marcar: marcarIni = [] } = {}) {
  // filtro: "anio" (la lista entera) o el numero del mes de la ficha elegida;
  // null = elegirlo al cargar (el mes mas reciente con huecos, o el año si son pocos).
  // Desde un aviso llega ya con su año, su mes y sus dias marcados.
  let anio = anioIni || Number(hoyIso().slice(0, 4)), seq = 0, datos = null, ancla = null, filtro = filtroIni;
  // modo: "faltan" (por completar) o "sobran" (dias en que te pasas)
  let modo = "faltan";
  const POCOS = 8;
  const marcados = new Set(marcarIni);
  const fichas = el("div", { class: "pend-fichas", role: "tablist", "aria-label": "Meses" });
  const cuerpo = el("div", { class: "pend" });
  const cifras = el("span", { class: "pend-cifras" });
  const bDeshacer = el("button", { class: "b-deshacer-pend", onclick: () => deshacer() },
    "↶ Deshacer", el("span", { class: "n-deshacer" }));
  const todos = el("input", { type: "checkbox", "aria-label": "Marcar todos los días de la lista",
    onchange: () => marcar(visibles().map((x) => x.iso), todos.checked) });
  const nMarcados = el("span", { class: "pend-marcados" });
  const acciones = [
    el("button", { class: "primario", text: "＋ Completar lo que falta…",
                   title: "A cada día marcado, justo las horas que le faltan, de una tarea",
                   onclick: () => accion(dlgCompletarPend) }),
    el("button", { text: "▤ Aplicar plantilla…", title: "Los apuntes de una plantilla en cada día marcado",
                   onclick: () => accion(dlgPlantillaPend) }),
    el("button", { text: "⧉ Copiar un día…", title: "Los apuntes de un día en cada día marcado",
                   onclick: () => accion(dlgCopiarPend) }),
  ];
  const barra = el("div", { class: "pend-barra" },
    el("label", { class: "check" }, todos, " Todos"), nMarcados, el("span", { class: "pend-hueco" }), ...acciones);
  const bFaltan = el("button", { onclick: () => ponerModo("faltan") });
  const bSobran = el("button", { title: "Días con más horas que su jornada: a veces, un apunte repetido",
                                 onclick: () => ponerModo("sobran") });
  cont.replaceChildren(
    el("div", { class: "cabeza-seccion" },
      el("div", { class: "fila pend-cabeza" },
        el("h2", { text: "🧩 Por completar" }),
        el("div", { class: "pills-periodo pend-modo", role: "group", "aria-label": "Qué ver" }, bFaltan, bSobran),
        cifras, el("span", { class: "pend-hueco" }), bDeshacer)),
    fichas, barra, cuerpo);
  pintarDeshacerPend();

  function ponerModo(m) {
    modo = m;
    ancla = null;
    pintar();
  }

  const visibles = () => (datos?.dias || []).filter((x) => filtro === "anio" || x.mes === filtro);

  function mover(n) {
    if (n === 0) anio = Number(hoyIso().slice(0, 4));
    else if (n < 0 && datos && !datos.anterior) { estado("No se puede ir más atrás."); return; }
    else if (n > 0 && datos && !datos.siguiente) { estado("Los días que vienen se completan en su ficha."); return; }
    else anio += n;
    marcados.clear();
    filtro = null;
    cargar();
  }

  async function cargar() {
    const mio = ++seq;
    cuerpo.replaceChildren(nota("Buscando los días sin completar…"));
    let r;
    try { r = await llamar("por_completar", anio); } catch (_e) { return; }
    if (mio !== seq) return;
    datos = r;
    anio = r.anio;
    alTitulo(r.titulo);
    alDatos(r);
    if (r.error) {
      cuerpo.replaceChildren(nota(r.error, "rojo"));
      barra.hidden = true; fichas.hidden = true; cifras.textContent = "";
      return;
    }
    const hay = new Set(r.dias.map((x) => x.iso));
    for (const i of [...marcados]) if (!hay.has(i)) marcados.delete(i);
    // la ficha elegida se mantiene mientras le queden dias; si no, la de siempre
    const pendientes = r.meses.filter((m) => m.estado === "pendiente");
    if (filtro !== "anio" && !pendientes.some((m) => m.mes === filtro)) {
      filtro = r.n <= POCOS || !pendientes.length ? "anio" : pendientes[pendientes.length - 1].mes;
    }
    pintar();
  }

  function elegir(f) {
    filtro = f;
    ancla = null;
    pintar();
  }

  function marcar(isos, si) {
    for (const i of isos) { if (si) marcados.add(i); else marcados.delete(i); }
    pintarMarcas();
  }

  function pintarFichas() {
    const r = datos;
    const ficha = (f, titulo, linea, frac, clase, n, ayuda) => {
      const activa = filtro === f;
      const marc = (f === "anio" ? r.dias : r.dias.filter((x) => x.mes === f)).filter((x) => marcados.has(x.iso)).length;
      const abre = clase === "pendiente" || f === "anio";
      return el(abre ? "button" : "div", {
        class: `pend-ficha ${clase}${activa ? " activa" : ""}`, role: abre ? "tab" : null,
        "aria-selected": abre ? String(activa) : null,
        title: ayuda,
        onclick: abre ? () => elegir(f) : null },
        el("span", { class: "pf-nombre", text: titulo }),
        el("b", { class: "pf-n", text: n }),
        el("span", { class: "pf-linea", text: linea }),
        el("span", { class: "pf-barra" }, el("i", { style: `--w:${Math.round(frac * 100)}%` })),
        marc ? el("span", { class: "pf-marcados", text: `${marc} ✓` }) : null);
    };
    const pend = (m) => `${m.n} ${m.n === 1 ? "día" : "días"}`;
    fichas.replaceChildren(
      ficha("anio", `Todo ${r.anio}`, r.n ? `faltan ${r.falta}` : "completo", r.frac,
            r.n ? "pendiente anual" : "completo anual", r.n ? pend(r) : "✔",
            `Todo ${r.anio}: ${r.n ? `${pend(r)} por completar, faltan ${r.falta}` : "completo"} · ${Math.round(r.frac * 100)}% imputado`),
      ...r.meses.map((m) => ficha(m.mes, m.nombre.slice(0, 3),
        { pendiente: `faltan ${m.falta}`, completo: "completo", nolab: "libre", futuro: "—" }[m.estado],
        m.frac, m.estado, { pendiente: pend(m), completo: "✔", nolab: "·", futuro: "" }[m.estado],
        `${m.nombre}: ${{ pendiente: `${pend(m)} por completar, faltan ${m.falta} · ${Math.round(m.frac * 100)}% imputado`,
                          completo: "completo", nolab: "sin días laborables", futuro: "aún no ha llegado" }[m.estado]}`)));
    fichas.hidden = false;
  }

  function pintarMarcas() {
    for (const c of cuerpo.querySelectorAll("input[data-iso]")) {
      c.checked = marcados.has(c.dataset.iso);
      c.closest(".pend-dia").classList.toggle("marcado", c.checked);
    }
    for (const c of cuerpo.querySelectorAll("input[data-mes]")) {
      const del = datos.dias.filter((x) => x.mes === Number(c.dataset.mes));
      const n = del.filter((x) => marcados.has(x.iso)).length;
      c.checked = n === del.length;
      c.indeterminate = n > 0 && n < del.length;
    }
    const vis = visibles();
    const nVis = vis.filter((x) => marcados.has(x.iso)).length;
    todos.checked = !!vis.length && nVis === vis.length;
    todos.indeterminate = nVis > 0 && !todos.checked;
    // lo marcado cuenta en todos los meses (se puede marcar en varios y hacerlo de una vez)
    const elegidos = datos.dias.filter((x) => marcados.has(x.iso));
    const fuera = elegidos.length - nVis;
    nMarcados.textContent = elegidos.length
      ? `${elegidos.length} ${elegidos.length === 1 ? "día marcado" : "días marcados"} · faltan ${fmtHoras(elegidos.reduce((s, x) => s + x.falta, 0))}h`
        + (fuera ? ` (${fuera} en otros meses)` : "")
      : "Marca los días que quieras rellenar (Mayús+clic, un rango)";
    nMarcados.classList.toggle("tenue", !elegidos.length);
    for (const b of acciones) b.disabled = !elegidos.length;
    pintarFichas();
  }

  function pintar() {
    const r = datos;
    bFaltan.textContent = `Faltan (${r.n})`;
    bSobran.textContent = `Te pasas (${r.n_excesos || 0})`;
    for (const [b, m] of [[bFaltan, "faltan"], [bSobran, "sobran"]]) {
      b.classList.toggle("activo", modo === m);
      b.setAttribute("aria-pressed", String(modo === m));
    }
    if (modo === "sobran") { pintarExcesos(); return; }
    cifras.textContent = r.n ? `${r.n} ${r.n === 1 ? "día" : "días"} · faltan ${r.falta}` : "";
    barra.hidden = !r.n;
    pintarFichas();
    if (!r.n) {
      cuerpo.replaceChildren(el("div", { class: "pend-vacio" },
        el("b", { text: "✔ Todo completo" }),
        el("span", { text: ` en ${r.anio}${r.siguiente ? "" : " hasta ayer"}.` })));
      return;
    }
    const lista = visibles();
    const orden = lista.map((x) => x.iso);
    const porMes = new Map();
    for (const x of lista) { if (!porMes.has(x.mes)) porMes.set(x.mes, []); porMes.get(x.mes).push(x); }
    const meses = [...porMes].map(([mes, del]) => {
      const cMes = el("input", { type: "checkbox", "data-mes": String(mes),
        "aria-label": `Marcar todo ${MESES_LARGOS[mes - 1].toLowerCase()}`,
        onchange: (e) => marcar(del.map((x) => x.iso), e.target.checked) });
      const falta = fmtHoras(del.reduce((s, x) => s + x.falta, 0));
      return el("section", { class: "pend-mes" },
        el("label", { class: "pend-mes-cab" }, cMes,
          el("b", { text: MESES_LARGOS[mes - 1] }),
          el("span", { class: "tenue", text: `${del.length} ${del.length === 1 ? "día" : "días"} · faltan ${falta}h` })),
        ...del.map((x) => {
          const c = el("input", { type: "checkbox", "data-iso": x.iso, "aria-label": x.dia });
          c.addEventListener("click", (e) => {
            // Mayus+clic: todo el rango desde el ultimo pulsado
            if (e.shiftKey && ancla && ancla !== x.iso) {
              const [a, b] = [orden.indexOf(ancla), orden.indexOf(x.iso)].sort((p, q) => p - q);
              if (a >= 0) marcar(orden.slice(a, b + 1), c.checked);
            } else {
              marcar([x.iso], c.checked);
            }
            ancla = x.iso;
          });
          const pct = x.obj ? Math.round((100 * x.reg) / x.obj) : 0;
          // boton derecho (o ⋯): marcarlo como vacaciones, festivo, permiso...
          return el("label", { class: `pend-dia${x.vacio ? " vacio" : ""}`,
                               oncontextmenu: (e) => { e.preventDefault(); menuDiaPend(e.clientX, e.clientY, x); } }, c,
            el("b", { class: "pend-fecha", text: x.dia }),
            el("span", { class: "pend-mini", title: x.texto }, el("i", { style: `--w:${pct}%` })),
            el("span", { class: "pend-texto", text: x.vacio ? `sin apuntes · ${x.texto}` : x.texto }),
            el("span", { class: "pend-falta", text: `faltan ${x.falta_txt}` }),
            el("span", { class: "pend-marcas" },
              x.guardia ? el("span", { class: "chip-marca guardia", text: "Guardia" }) : null,
              x.teletrabajo ? el("span", { class: "chip-marca tele", text: "Teletrabajo" }) : null),
            el("button", { class: "enlace pend-ir", text: "Ir al día →", title: "Abrir su semana con el día marcado",
                           onclick: (e) => { e.preventDefault(); e.stopPropagation(); alIrADia(x.iso); } }),
            el("button", { class: "pend-mas", text: "⋯", title: "Marcarlo como vacaciones, festivo, baja o permiso",
                           "aria-label": `Más opciones del ${x.dia}`,
                           onclick: (e) => {
                             e.preventDefault(); e.stopPropagation();
                             const b = e.currentTarget.getBoundingClientRect();
                             menuDiaPend(b.left, b.bottom + 2, x);
                           } }));
        }));
    });
    cuerpo.replaceChildren(
      nota("Días laborables con menos horas que su jornada, hasta ayer (hoy se completa en su ficha). "
           + "Festivos, vacaciones y permisos no salen. ¿Estabas de vacaciones o era festivo? "
           + "Botón derecho (o ⋯) sobre el día para marcarlo."),
      ...meses);
    pintarMarcas();
  }

  // Un hueco que no es olvido: vacaciones, festivo, baja o permiso sin
  // marcar. Se marca (solo en este equipo, como en las fichas) y sale de la
  // lista sin imputar nada; o, si hay tarea de ausencias, se completa con ella.
  function menuDiaPend(px, py, x) {
    const [nombre, fecha] = x.dia.split(" ");
    const d = { iso: x.iso, nombre, fecha, falta: x.falta, obj: x.obj };
    const imputar = async (tarea) => {
      estado("Completando…");
      const r = await llamar("completar_dias", [x.iso], tarea.id, tarea.actividad || "", "");
      await informarLote(r, { hecho: () => `${x.dia}: ${r.horas} en «${corto(tarea.nombre, 40)}».`,
                              nada: "No se añadió nada: ese día ya estaba completo." });
      cargar();
    };
    const marca = (motivo) => async () => {
      if ((await confirmarLocal(d, motivo, { alImputar: imputar })) !== "local") return;
      await llamar("accion_dia", x.iso, "no_laborable", motivo);
      estado(`${x.dia} marcado como ${motivo} (solo en este equipo): ya no sale en la lista.`);
      cargar();
    };
    mostrarMenu(px, py, [
      { titulo: `${x.dia} · faltan ${x.falta_txt}` },
      ...["vacaciones", "festivo", "apertura de curso", "baja"].map((m) => ({ texto: `Marcar como ${m} (local)`, accion: marca(m) })),
      "-",
      { texto: "Añadir permiso por horas… (local)", accion: async () => {
        if ((await confirmarLocal(d, "permiso", { alImputar: imputar })) === "local") dlgPermisoDia(d, { alGuardar: cargar });
      } },
      "-",
      { texto: "Ir al día →", accion: () => alIrADia(x.iso) },
    ]);
  }

  // "Te pasas": los dias con mas horas que su jornada (o con horas en un dia
  // no laborable que no es de guardia). A veces es un apunte repetido o con
  // las horas mal puestas: cada uno lleva a su dia para revisarlo.
  function pintarExcesos() {
    const r = datos;
    fichas.hidden = true;
    barra.hidden = true;
    cifras.textContent = r.n_excesos ? `${r.n_excesos} ${r.n_excesos === 1 ? "día" : "días"} · sobran ${r.sobra}` : "";
    if (!r.n_excesos) {
      cuerpo.replaceChildren(el("div", { class: "pend-vacio" },
        el("b", { text: "✔ Ningún día de más" }), el("span", { text: ` en ${r.anio}${r.siguiente ? "" : " hasta ayer"}.` })));
      return;
    }
    const porMes = new Map();
    for (const x of r.excesos) { if (!porMes.has(x.mes)) porMes.set(x.mes, []); porMes.get(x.mes).push(x); }
    cuerpo.replaceChildren(
      nota("Días con más horas que su jornada (o con horas en un día no laborable que no es de guardia), hasta ayer. "
           + "Si no es una jornada larga de verdad, puede ser un apunte repetido o con las horas mal puestas."),
      ...[...porMes].map(([mes, del]) => el("section", { class: "pend-mes" },
        el("div", { class: "pend-mes-cab" }, el("b", { text: MESES_LARGOS[mes - 1] }),
          el("span", { class: "tenue", text: `${del.length} ${del.length === 1 ? "día" : "días"} · sobran ${fmtHoras(del.reduce((s, x) => s + x.sobra, 0))}h` })),
        ...del.map((x) => {
          const detalle = x.apuntes.map((a) => `${a.horas_txt} ${a.tarea}`).join(" · ");
          return el("div", { class: "pend-dia exceso" }, el("span"),
            el("b", { class: "pend-fecha", text: x.dia }),
            el("span", { class: "pend-mini", title: x.texto }, el("i", { style: "--w:100%" })),
            el("span", { class: "pend-texto", title: detalle, text: `${x.texto} · ${detalle}` }),
            el("span", { class: "pend-falta sobra", text: `+${x.sobra_txt}` }),
            el("span", { class: "pend-marcas" },
              x.duplicado ? el("span", { class: "chip-marca repetido", text: "¿Repetido?",
                                         title: "La misma tarea y actividad dos veces ese día" }) : null,
              x.nolab ? el("span", { class: "chip-marca tele", text: x.motivo }) : null),
            el("button", { class: "pend-quitar", text: "Quitar apunte ▾",
                           title: "Quitar ahí mismo el apunte que sobra (se puede deshacer)",
                           onclick: (e) => {
                             e.stopPropagation();
                             const r0 = e.currentTarget.getBoundingClientRect();
                             menuQuitarApunte(r0.left, r0.bottom + 2, x);
                           } }),
            el("button", { class: "enlace pend-ir", text: "Ir al día →", title: "Abrir su semana para revisarlo",
                           onclick: () => alIrADia(x.iso) }));
        }))));
  }

  // Los apuntes de ese dia, para quitar el que sobra sin salir de la lista:
  // se señala el repetido y el que, quitandolo, deja el dia en su jornada.
  function menuQuitarApunte(px, py, x) {
    mostrarMenu(px, py, [
      { titulo: `${x.dia} · sobran ${x.sobra_txt}` },
      ...x.apuntes.map((a) => ({
        texto: `🗑 ${a.horas_txt}  ${corto(a.tarea, 34)}${a.actividad ? ` · ${a.actividad}` : ""}`
               + (a.comentario ? ` · «${corto(a.comentario, 24)}»` : "")
               + (a.justo ? "   ← deja el día justo" : a.repetido ? "   (repetido)" : ""),
        clase: a.justo ? "destacado" : "",
        accion: () => quitarApunte(x, a),
      })),
    ]);
  }

  async function quitarApunte(x, a) {
    if (!(await preguntar("Quitar apunte",
        `¿Quitar ${a.horas_txt} de «${a.tarea}»${a.actividad ? ` (${a.actividad})` : ""} del ${x.dia.toLowerCase()}?\n\n`
        + "Se borra de ProyectosTIC. Después, «Deshacer» lo devuelve.", { si: "Quitar", no: "Cancelar" }))) return;
    estado("Quitando…");
    const r = await llamar("eliminar", [{ id: a.id, fecha: x.iso, destino: "op" }]);
    if (r.errores || !r.eliminados) {
      await avisar("No se pudo quitar", r.ultimo || "El apunte ya no está.");
    } else {
      trasCambio(r, `Quitadas ${a.horas_txt} de «${corto(a.tarea, 40)}» del ${x.dia.toLowerCase()}.`);
    }
    await cargar();
  }

  // Lo que se haga, sobre los marcados (de cualquier mes); luego, la lista
  // otra vez (lo completado desaparece) y fuera las marcas.
  async function accion(fn) {
    const elegidos = (datos?.dias || []).filter((x) => marcados.has(x.iso));
    if (!elegidos.length) { await avisar("Por completar", "Marca al menos un día."); return; }
    if (!(await fn(elegidos, datos))) return;
    marcados.clear();
    ancla = null;
    await cargar();
  }

  cargar();
  return { mover, cargar };
}

// El Deshacer del panel: el mismo que el de la caja Días (que aquí no se ve).
function pintarDeshacerPend() {
  const b = document.querySelector("#estadisticas .b-deshacer-pend");
  if (!b) return;
  const g = $("b-deshacer");
  b.hidden = g.hidden;
  b.title = g.title;
  b.querySelector(".n-deshacer").textContent = g.querySelector(".n-deshacer").textContent;
}

const listaDias = (dias, horas = true, max = 8) =>
  dias.slice(0, max).map((x) => `  · ${x.dia}${horas ? `  +${x.falta_txt}` : ""}`).join("\n")
  + (dias.length > max ? `\n  … y ${dias.length - max} más` : "");

// Reparte 'falta' horas segun 'pesos' a cuartos de hora; lo que deje el
// redondeo, a la ultima (igual que repartir() de Python y Rust).
function repartirHoras(falta, pesos) {
  const total = pesos.reduce((s, p) => s + p, 0);
  const r2 = (x) => Math.round(x * 100) / 100;
  let resto = r2(falta);
  return pesos.map((p, i) => {
    let h = i === pesos.length - 1 ? resto : Math.min(resto, Math.floor((falta * p) / total * 4 + 0.5) / 4);
    h = r2(Math.max(h, 0));
    resto = r2(resto - h);
    return h;
  });
}

// Completar lo que falta: UNA tarea (de las habituales o cualquier otra) o
// REPARTIDO entre varias (p. ej. 70% Mantenimientos, 30% Proxmox; se propone
// el reparto de tus habituales). A cada dia, justo lo que le falta. El
// resumen se ve antes de pulsar.
function dlgCompletarPend(dias) {
  const total = fmtHoras(dias.reduce((s, x) => s + x.falta, 0));
  const isos = dias.map((x) => x.iso);
  const habituales = (st.habituales?.filas || []).slice(0, 5);
  return new Promise((resolver) => {
    let elegida = habituales[0] ? { wp_id: habituales[0].wp_id, tarea: habituales[0].tarea, actividad: habituales[0].actividad } : null;
    let comAuto = "", seqAct = 0, modo = "una";
    const act = el("select");
    const com = entrada("", { class: "ancho", placeholder: "Opcional" });
    const resumen = el("div", { class: "pend-resumen" });
    const opciones = el("div", { class: "pend-tareas", role: "radiogroup", "aria-label": "Tarea" });
    const radio = (valor, texto, extra = null) => {
      const r = el("input", { type: "radio", name: "pend-tarea", value: valor });
      return el("label", { class: "pend-op" }, r, el("span", { text: texto }), extra);
    };
    habituales.forEach((h, i) => {
      const op = radio(String(i), `${h.tarea}${h.actividad ? ` · ${h.actividad}` : ""}`);
      op.querySelector("input").addEventListener("change", () => elegir({ wp_id: h.wp_id, tarea: h.tarea, actividad: h.actividad }));
      opciones.append(op);
    });
    const otra = entrada("", { class: "ancho", placeholder: "Busca por nombre o número de tarea" });
    const opOtra = radio("otra", "Otra tarea:", otra);
    opOtra.classList.add("pend-op-otra");
    opciones.append(opOtra);
    buscadorTarea(otra, { alElegir: (t) => {
      otra.value = `${t.id} - ${t.nombre}`;
      opOtra.querySelector("input").checked = true;
      elegir({ wp_id: t.id, tarea: t.nombre, actividad: "" });
    } });
    otra.addEventListener("focus", () => { opOtra.querySelector("input").checked = true; });
    const unaTarea = el("div", {}, el("h4", { class: "pend-sub", text: "Tarea" }), opciones, rejilla(["Actividad", act]));

    // ---- repartido: un % por tarea (las habituales, con el reparto que sueles hacer)
    const filas = [];
    const tabla = el("div", { class: "pend-reparto" });
    const sumaPct = el("span", { class: "pend-suma" });
    // el reparto que sueles hacer, sin las de permiso (no rellenan huecos)
    const conPct = habituales.filter((h) => !h.permiso).slice(0, 3);
    const sumaHab = conPct.reduce((s, h) => s + (h.pct || 0), 0);
    const ponerFila = (t, pct) => {
      const p = entrada(String(pct), { class: "horas", type: "number", min: "0", max: "100", step: "5",
                                       "aria-label": `Porcentaje de ${t.tarea}` });
      const f = { t, p, nodo: null };
      f.nodo = el("div", { class: "pend-reparto-fila" },
        el("span", { class: "pend-reparto-tarea", title: t.tarea, text: `${t.tarea}${t.actividad ? ` · ${t.actividad}` : ""}` }),
        el("span", { class: "fila" }, p, " %"), el("span", { class: "pend-reparto-h tenue" }));
      p.addEventListener("input", pintarResumen);
      filas.push(f);
      tabla.append(f.nodo);
    };
    habituales.forEach((h) => ponerFila({ wp_id: h.wp_id, tarea: h.tarea, actividad: h.actividad },
      conPct.includes(h) && sumaHab ? Math.round((100 * (h.pct || 0)) / sumaHab / 5) * 5 : 0));
    // que el reparto propuesto sume 100 (el redondeo a 5 lo puede descuadrar)
    const primera = filas[habituales.indexOf(conPct[0])];
    if (primera && sumaHab) {
      const s = filas.reduce((a, f) => a + Number(f.p.value), 0);
      primera.p.value = String(Number(primera.p.value) + 100 - s);
    }
    const otraR = entrada("", { class: "ancho", placeholder: "＋ Añadir otra tarea al reparto…" });
    buscadorTarea(otraR, { alElegir: async (t) => {
      otraR.value = "";
      const r = await llamar("actividades", t.id).catch(() => null);
      ponerFila({ wp_id: t.id, tarea: t.nombre, actividad: r?.preferida || r?.nombres?.[0] || "" }, 0);
      filas[filas.length - 1].p.focus();
      pintarResumen();
    } });
    const repartida = el("div", { hidden: true },
      el("h4", { class: "pend-sub", text: "Reparto (propuesto con lo que sueles hacer)" }), tabla,
      el("div", { class: "fila pend-reparto-pie" }, otraR, sumaPct));

    const modoUna = el("input", { type: "radio", name: "pend-modo", checked: true });
    const modoRep = el("input", { type: "radio", name: "pend-modo" });
    const cambiarModo = () => {
      modo = modoRep.checked ? "reparto" : "una";
      unaTarea.hidden = modo !== "una";
      repartida.hidden = modo !== "reparto";
      pintarResumen();
    };
    modoUna.addEventListener("change", cambiarModo);
    modoRep.addEventListener("change", cambiarModo);

    let fin = () => {};
    const d = dialogo({ titulo: "Completar lo que falta", ancho: 680, botones: [
      { texto: "Cancelar", accion: () => fin(false) },
      { texto: `Completar ${dias.length} ${dias.length === 1 ? "día" : "días"}`, clase: "primario", id: "ok", accion: completar }] });
    const cerrarDialogo = d.cerrar;
    let hecho = false;
    // trabajo: lo que se hace ya sin el dialogo; el panel se recarga despues
    fin = async (v, trabajo = null) => {
      if (hecho) return;
      hecho = true;
      cerrarDialogo();
      try { if (trabajo) await trabajo(); } finally { resolver(v); }
    };
    d.cerrar = () => fin(false);
    d.cuerpo.append(
      nota(`A cada uno de los ${dias.length} días marcados se le añade justo lo que le falta.`),
      el("div", { class: "pend-modos", role: "radiogroup", "aria-label": "Cómo completar" },
        el("label", { class: "check" }, modoUna, " Con una tarea"),
        el("label", { class: "check" }, modoRep, " Repartido entre varias tareas")),
      unaTarea, repartida,
      rejilla(["Comentario", com]),
      resumen);
    if (habituales.length) opciones.querySelector("input").checked = true;
    act.addEventListener("change", pintarResumen);
    if (elegida) elegir(elegida); else pintarResumen();

    async function elegir(t) {
      elegida = t;
      pintarResumen();
      const mio = ++seqAct;
      const r = await llamar("actividades", t.wp_id).catch(() => null);
      if (!r || mio !== seqAct) return;
      act.replaceChildren(...r.nombres.map((n) => el("option", { value: n, text: n })));
      const quiero = (t.actividad || r.preferida || "").toLowerCase();
      const i = r.nombres.findIndex((n) => n.toLowerCase() === quiero);
      act.selectedIndex = i >= 0 ? i : 0;
      // el comentario habitual de la tarea, si no se ha escrito otro
      if (!com.value || com.value === comAuto) { com.value = comAuto = r.comentario || ""; }
      pintarResumen();
    }

    const reparto = () => filas.map((f) => ({ ...f.t, peso: Math.max(0, Number(f.p.value) || 0), fila: f }))
      .filter((f) => f.peso > 0);

    function pintarResumen() {
      if (modo === "reparto") {
        const rep = reparto();
        const suma = filas.reduce((s, f) => s + Math.max(0, Number(f.p.value) || 0), 0);
        sumaPct.textContent = `Suma: ${suma}%${suma && suma !== 100 ? " (se reparte en proporción)" : ""}`;
        sumaPct.classList.toggle("ambar", !!suma && suma !== 100);
        // horas de cada tarea, sumando el reparto de cada dia (a cuartos)
        const horas = new Map();
        for (const x of dias) {
          repartirHoras(x.falta, rep.map((f) => f.peso)).forEach((h, i) => {
            horas.set(i, (horas.get(i) || 0) + h);
          });
        }
        for (const f of filas) f.nodo.querySelector(".pend-reparto-h").textContent = "";
        rep.forEach((r, i) => { r.fila.nodo.querySelector(".pend-reparto-h").textContent = `${fmtHoras(horas.get(i) || 0)}h`; });
        d.botones.ok.disabled = !rep.length;
        resumen.replaceChildren(
          el("p", {}, el("b", { text: `Se añadirán ${total}h en ${dias.length} ${dias.length === 1 ? "día" : "días"}` }),
            rep.length ? `, repartidas entre ${rep.length} ${rep.length === 1 ? "tarea" : "tareas"} (a cuartos de hora).`
                       : ": pon un % a alguna tarea."),
          el("pre", { class: "pend-lista", text: listaDias(dias) }),
          nota("Después, «Deshacer» lo quita todo de una vez."));
        return;
      }
      d.botones.ok.disabled = !elegida;
      resumen.replaceChildren(
        el("p", {}, el("b", { text: `Se añadirán ${total}h en ${dias.length} ${dias.length === 1 ? "día" : "días"}` }),
          elegida ? ` a «${corto(elegida.tarea, 60)}»${act.value ? ` · ${act.value}` : ""}.` : ": elige la tarea."),
        el("pre", { class: "pend-lista", text: listaDias(dias) }),
        nota("Después, «Deshacer» lo quita todo de una vez."));
    }

    async function completar() {
      let r, quien;
      if (modo === "reparto") {
        const rep = reparto();
        if (!rep.length) { await avisar("Completar", "Pon un % a alguna tarea."); return; }
        estado("Completando…");
        r = await llamar("completar_dias", isos, "", "", com.value.trim(),
                         rep.map((f) => ({ wp_id: f.wp_id, actividad: f.actividad || "", peso: f.peso })));
        quien = `${rep.length} tareas`;
      } else {
        if (!elegida) { await avisar("Completar", "Elige la tarea con la que completar."); return; }
        estado("Completando…");
        r = await llamar("completar_dias", isos, elegida.wp_id, act.value || "", com.value.trim());
        quien = `«${corto(elegida.tarea, 40)}»`;
      }
      if (r.error) { await avisar("No se pudo", r.error); return; }
      if (r.fallidos?.length) {
        r.ultimo = `${r.ultimo}\n\nSin imputar: ${r.fallidos.join(", ")}. Si ese mes ya está cerrado en ProyectosTIC, no admite cambios.`;
      }
      await fin(true, () => informarLote(r, {
        hecho: (n) => `Completados ${n} ${n === 1 ? "día" : "días"} con ${quien}: ${r.horas}.`,
        nada: "No se añadió nada: esos días ya estaban completos.",
        saltados: (n) => ` Saltados ${n} (ya completos o no laborables).` }));
    }
  });
}

// Una plantilla en todos los marcados. Si alguno ya tiene horas, se avisa:
// la plantilla es un dia entero y se puede pasar de la jornada.
async function dlgPlantillaPend(dias) {
  const ps = (await llamar("plantillas")).filter((p) => !p.semana);      // las de semana no van a dias sueltos
  if (!ps.length) {
    await avisar("Aplicar plantilla", "Todavía no tienes plantillas. Para crear una: botón derecho sobre un día "
                 + "con las horas que quieras guardar → Guardar este día como plantilla.");
    return false;
  }
  const isos = dias.map((x) => x.iso);
  const conHoras = dias.filter((x) => !x.vacio);
  return new Promise((resolver) => {
    const lista = el("select", { size: String(Math.min(8, Math.max(3, ps.length))), class: "lista" },
      ...ps.map((p, i) => el("option", { value: String(i), text: `${p.nombre}  (${p.n} apuntes, ${p.total})` })));
    lista.selectedIndex = 0;
    const resumen = el("div", { class: "pend-resumen" });
    let fin = () => {};
    const d = dialogo({ titulo: "Aplicar plantilla", ancho: 600, botones: [
      { texto: "Cancelar", accion: () => fin(false) },
      { texto: `Aplicar a ${dias.length} ${dias.length === 1 ? "día" : "días"}`, clase: "primario", accion: aplicar }] });
    const cerrarDialogo = d.cerrar;
    let hecho = false;
    // trabajo: lo que se hace ya sin el dialogo; el panel se recarga despues
    fin = async (v, trabajo = null) => {
      if (hecho) return;
      hecho = true;
      cerrarDialogo();
      try { if (trabajo) await trabajo(); } finally { resolver(v); }
    };
    d.cerrar = () => fin(false);
    const pintarResumen = () => {
      const p = ps[lista.selectedIndex];
      resumen.replaceChildren(
        el("p", {}, el("b", { text: `«${p.nombre}» (${p.n} apuntes, ${p.total})` }),
          ` en ${dias.length} ${dias.length === 1 ? "día" : "días"}. Se saltan las tareas que ya tengan apunte ese día.`),
        el("pre", { class: "pend-lista", text: listaDias(dias, false) }),
        conHoras.length ? nota(`${conHoras.length} de esos días ya tienen horas: con la plantilla podrías pasarte `
                               + "de la jornada. Para esos, mejor «Completar lo que falta».", "ambar") : null,
        nota("Después, «Deshacer» lo quita todo de una vez."));
    };
    lista.addEventListener("change", pintarResumen);
    lista.addEventListener("dblclick", aplicar);
    d.cuerpo.append(nota("Elige la plantilla:"), lista, resumen);
    pintarResumen();
    lista.focus();

    async function aplicar() {
      const p = ps[lista.selectedIndex];
      if (!p) return;
      await fin(true, async () => {
        estado("Aplicando plantilla…");
        await informarLote(await llamar("aplicar_plantilla", p.nombre, isos), {
          hecho: (n) => `Plantilla «${corto(p.nombre, 40)}» aplicada: ${n} apuntes.`,
          nada: "No se añadió nada: esas tareas ya estaban." });
      });
    }
  });
}

// Copiar un dia en todos los marcados: por defecto, el ultimo completo. El
// resumen (sus apuntes y a cuantos dias) lo pregunta "Copiar día" de siempre.
function dlgCopiarPend(dias, datos) {
  const isos = dias.map((x) => x.iso);
  return new Promise((resolver) => {
    const fecha = el("input", { type: "date", max: hoyIso() });
    fecha.value = datos?.modelo || "";
    let fin = () => {};
    const d = dialogo({ titulo: "Copiar un día", ancho: 520, botones: [
      { texto: "Cancelar", accion: () => fin(false) },
      { texto: "Siguiente…", clase: "primario", accion: siguiente }] });
    const cerrarDialogo = d.cerrar;
    let hecho = false;
    // trabajo: lo que se hace ya sin el dialogo; el panel se recarga despues
    fin = async (v, trabajo = null) => {
      if (hecho) return;
      hecho = true;
      cerrarDialogo();
      try { if (trabajo) await trabajo(); } finally { resolver(v); }
    };
    d.cerrar = () => fin(false);
    const [, m, dd] = (datos?.modelo || "--").split("-");
    d.cuerpo.append(
      nota(`Los apuntes del día que elijas se copian a los ${dias.length} días marcados. `
           + "Se saltan las tareas que ya tengan apunte ese día."),
      rejilla(["Día a copiar", fecha]),
      datos?.modelo ? nota(`Propuesto: el último día completo (${dd}/${m}).`) : null);
    fecha.focus();

    async function siguiente() {
      if (!fecha.value) { await avisar("Copiar un día", "Elige el día que quieres copiar."); return; }
      await fin(true, () => dlgCopiarDia(isos, fecha.value));
    }
  });
}

// ================================================================ buscar en mis apuntes

// Archivo > Buscar en mis apuntes (Ctrl+F): por comentario, tarea, actividad
// o fecha (dd/mm), en el año elegido. Cada resultado lleva a su dia.
function dlgBuscarApuntes() {
  const actual = Number(hoyIso().slice(0, 4));
  const caja = entrada("", { class: "ancho", type: "search", "aria-label": "Buscar",
                             placeholder: "Comentario, tarea, actividad o fecha (dd/mm)…" });
  const anio = selector([0, 1, 2, 3].map((i) => ({ valor: actual - i, texto: String(actual - i) })), actual);
  const AYUDA = "Escribe al menos dos letras: busca todas las palabras, sin importar tildes ni mayúsculas.";
  const info = nota(AYUDA);
  const lista = el("div", { class: "busca-lista" });
  const d = dialogo({ titulo: "Buscar en mis apuntes", ancho: 780, botones: [cerrarBoton] });
  d.cuerpo.append(el("div", { class: "fila busca-fila" }, caja, anio), info, lista);
  let seq = 0, t = null;
  async function buscar() {
    const q = caja.value.trim();
    const mio = ++seq;
    if (q.replace(/\s/g, "").length < 2) { lista.replaceChildren(); info.textContent = AYUDA; info.className = "nota tenue"; return; }
    info.textContent = "Buscando…";
    let r;
    try { r = await llamar("buscar_apuntes", q, Number(anio.value)); } catch (_e) { return; }
    if (mio !== seq) return;
    if (r.error) { info.textContent = r.error; info.className = "nota rojo"; lista.replaceChildren(); return; }
    info.className = "nota tenue";
    info.textContent = r.n
      ? `${r.n} ${r.n === 1 ? "apunte" : "apuntes"} · ${r.total}`
        + (r.recortado ? ` (se ven los ${r.resultados.length} más recientes)` : "")
      : `Nada con «${q}» en ${r.anio}.`;
    lista.replaceChildren(...r.resultados.map((x) => el("button", {
      class: "busca-res", title: "Ir a ese día", onclick: () => { d.cerrar(); irADiaSaliendo(x.iso); } },
      el("b", { class: "busca-dia", text: x.dia }),
      el("span", { class: "busca-h", text: x.horas_txt }),
      el("span", { class: "busca-tarea", text: `${x.tarea}${x.actividad ? ` · ${x.actividad}` : ""}` }),
      el("span", { class: "busca-com", text: x.comentario || "—" }))));
  }
  caja.addEventListener("input", () => { clearTimeout(t); t = setTimeout(buscar, 350); });
  caja.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(t); buscar(); } });
  anio.addEventListener("change", buscar);
  caja.focus();
}

// ================================================================ diagnostico

// Ayuda > Copiar diagnostico: para pegar en un correo cuando algo no va. Sin
// API key ni PIN (lo garantiza el Python).
async function dlgDiagnostico() {
  const caja = el("textarea", { class: "diagnostico", rows: "16", spellcheck: "false" });
  caja.readOnly = true;
  caja.value = "Preparando el diagnóstico (comprobando la conexión)…";
  const d = dialogo({ titulo: "Diagnóstico", ancho: 700, botones: [
    { texto: "Copiar", clase: "primario", izquierda: true, accion: async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(caja.value); ok = true; } catch (_e) {
        caja.focus(); caja.select();
        try { ok = document.execCommand("copy"); } catch (_e2) { ok = false; }
      }
      estado(ok ? "Diagnóstico copiado: pégalo en un correo a quien te ayude."
                : "No se pudo copiar solo: selecciona el texto y pulsa Ctrl+C.");
    } },
    cerrarBoton] });
  d.cuerpo.append(nota("Copia este texto y pégalo en un correo a quien te ayude. No lleva tu API key "
                       + "ni tu PIN."), caja);
  try { caja.value = (await llamar("diagnostico")).texto; } catch (e) { caja.value = `No se pudo preparar: ${e.message || e}`; }
}

// ================================================================ bandeja del sistema

// Icono junto al reloj (cerrar = esconder) e iniciar con Windows escondida.
async function dlgBandeja() {
  const e = await llamar("bandeja_estado");
  if (!e.soportada) {
    return avisar("Bandeja del sistema", e.mac
      ? "En Mac no hace falta: FichaCSIRC se queda en el Dock. Para abrirla al iniciar sesión, "
        + "botón derecho sobre su icono del Dock → Opciones → Abrir al iniciar sesión."
      : "La bandeja del sistema solo está disponible en Windows.");
  }
  const activa = el("input", { type: "checkbox" }), inicio = el("input", { type: "checkbox" });
  activa.checked = e.activa; inicio.checked = e.inicio;
  inicio.onchange = () => { if (inicio.checked) activa.checked = true; };
  activa.onchange = () => { if (!activa.checked) inicio.checked = false; };
  const d = dialogo({ titulo: "Bandeja e inicio con Windows", ancho: 520, botones: [cancelarBoton,
    { texto: "Guardar", clase: "primario", accion: async (dd) => {
      const r = await llamar("bandeja_guardar", activa.checked, inicio.checked);
      if (r.error) { await avisar("Bandeja del sistema", r.error); return; }
      dd.cerrar();
      estado(r.activa ? "Icono en la bandeja: cerrar la ventana la esconde junto al reloj." : "Sin icono en la bandeja.");
    } }] });
  d.cuerpo.append(
    el("label", { class: "check bloque" }, activa, " Icono en la bandeja del sistema (junto al reloj)"),
    nota("Cerrar la ventana la esconde en vez de salir; desde el icono la abres, vas a «hoy» o sales del todo."),
    el("label", { class: "check bloque" }, inicio, " Iniciar FichaCSIRC con Windows, escondida en la bandeja"),
    nota("Así el aviso de la semana anterior y el recordatorio te pillan con la app ya abierta. "
         + "Requiere el icono en la bandeja."));
}

// ================================================================ PIN de acceso

// Al abrir, si no hay PIN: se puede poner AHI MISMO (sin otra ventana).
// "Ahora no" vuelve a salir la proxima vez; "No mostrar mas" lo calla 30 dias.
function dlgSugerirPin() {
  const campo = (etiqueta) => entrada("", { type: "password", inputmode: "numeric", maxlength: "8",
                                            autocomplete: "off", class: "horas", "aria-label": etiqueta });
  const nuevo = campo("PIN nuevo"), repetido = campo("Repite el PIN");
  const d = dialogo({ titulo: "🔒 Protege FichaCSIRC con un PIN", ancho: 500, botones: [
    { texto: "No mostrar más", izquierda: true, accion: async (dd) => {
      const r = await llamar("pin_no_sugerir");
      dd.cerrar();
      estado(`De acuerdo: no volverá a salir hasta el ${r.hasta}.`);
    } },
    { texto: "Ahora no", accion: (dd) => dd.cerrar() },
    { texto: "Activar PIN", clase: "primario", accion: activar }] });
  d.cuerpo.append(
    el("p", { text: "Aún no tienes PIN. Si compartes el equipo o lo dejas sin bloquear, "
                    + "cualquiera puede abrir FichaCSIRC y ver o cambiar tus horas." }),
    rejilla(["PIN (4 a 8 cifras)", nuevo], ["Repítelo", repetido]),
    nota("Se pedirá cada vez que abras la app. «No mostrar más» calla este aviso 30 días; "
         + "el PIN se pone o se quita cuando quieras en Herramientas → PIN de acceso."));
  for (const i of [nuevo, repetido]) i.addEventListener("keydown", (e) => { if (e.key === "Enter") activar(d); });
  nuevo.focus();

  async function activar(dd) {
    if (!nuevo.value.trim()) { nuevo.focus(); return; }
    const r = await llamar("pin_fijar", nuevo.value, repetido.value, "");
    if (r.error) { await avisar("PIN de acceso", r.error); nuevo.focus(); return; }
    dd.cerrar();
    if (st.ini) { st.ini.pin = { activo: true, desbloqueada: true, auto_min: 15 }; vigilarInactividad(); }
    estado("PIN activado: se pedirá al abrir FichaCSIRC.");
  }
}

// paraBloquear: se llega desde el boton Bloquear sin tener PIN, y se explica.
async function dlgPin(opciones) {
  const paraBloquear = opciones?.paraBloquear === true;
  const { activo, auto_min } = await llamar("pin_estado");
  const campo = (etiqueta) => entrada("", { type: "password", inputmode: "numeric", maxlength: "8",
                                            autocomplete: "off", class: "horas", "aria-label": etiqueta });
  const actual = campo("PIN actual"), nuevo = campo("PIN nuevo"), repetido = campo("Repite el PIN nuevo");
  const auto = selector([{ valor: 0, texto: "Nunca (solo al abrir)" }, { valor: 5, texto: "5 minutos" },
                         { valor: 15, texto: "15 minutos" }, { valor: 30, texto: "30 minutos" },
                         { valor: 60, texto: "1 hora" }], auto_min);
  // El tiempo de bloqueo se guarda al elegirlo, sin tocar el PIN: con PIN va
  // arriba, en su propio apartado, y la ventana dice que ya esta guardado (el
  // unico boton era "Cambiar PIN" y parecia que habia que cambiarlo).
  const guardado = nota("Se guarda al elegirlo: no hace falta cambiar el PIN.", "tenue pin-guardado");
  guardado.setAttribute("role", "status");
  auto.onchange = async () => {
    const r = await llamar("pin_auto", auto.value);
    if (r.error) { await avisar("PIN de acceso", r.error); return; }
    if (st.ini?.pin) { st.ini.pin.auto_min = Number(auto.value); vigilarInactividad(); }
    const texto = Number(auto.value) ? `Se pedirá el PIN tras ${auto.options[auto.selectedIndex].text} sin usar la app.`
                                     : "El PIN solo se pedirá al abrir la app.";
    estado(texto);
    guardado.textContent = `✓ Guardado. ${texto}`;
    guardado.className = "nota verde pin-guardado";
  };
  const botones = [{ texto: activo ? "Cerrar" : "Cancelar", accion: (dd) => dd.cerrar() },
    { texto: activo ? "Cambiar PIN" : "Activar PIN", clase: "primario", accion: fijar }];
  if (activo) botones.unshift({ texto: "Quitar PIN", clase: "peligro", izquierda: true, accion: quitar });
  const d = dialogo({ titulo: "PIN de acceso", ancho: 520, botones });
  const siSeOlvida = nota("De 4 a 8 cifras. Si lo olvidas, la única salida es borrar la configuración de este equipo "
                          + "y volver a configurar FichaCSIRC (tus horas en ProyectosTIC no se pierden).");
  if (activo) {
    d.cuerpo.append(
      // dos cosas distintas, cada una en su apartado: el tiempo de bloqueo y el PIN
      el("h4", { class: "pend-sub", text: "Tiempo de bloqueo" }),
      nota("FichaCSIRC pide el PIN al abrirse y, si quieres, también tras un rato sin usarla."),
      rejilla(["Pedirlo de nuevo tras", auto]),
      guardado,
      el("h4", { class: "pend-sub pin-apartado", text: "Cambiar o quitar el PIN" }),
      nota("Escribe antes el PIN actual."),
      rejilla(["PIN actual", actual], ["PIN nuevo", nuevo], ["Repítelo", repetido]),
      siSeOlvida);
  } else {
    d.cuerpo.append(
      nota(paraBloquear ? "Para bloquear FichaCSIRC hace falta un PIN, y aún no lo tienes. Actívalo aquí: el botón "
                          + "Bloquear tapará la ventana hasta que lo escribas, y FichaCSIRC lo pedirá también cada vez "
                          + "que se abra."
                        : "Con un PIN, FichaCSIRC lo pedirá cada vez que se abra (también el asistente de configuración)."),
      rejilla(["PIN nuevo", nuevo], ["Repítelo", repetido], ["Pedirlo de nuevo tras", auto]),
      siSeOlvida);
  }
  (activo ? auto : nuevo).focus();
  for (const i of [actual, nuevo, repetido]) i.addEventListener("keydown", (e) => { if (e.key === "Enter") fijar(d); });

  async function fijar(dd) {
    if (activo && !actual.value && !nuevo.value && !repetido.value) {
      await avisar("PIN de acceso", "Para cambiar el PIN, escribe el actual y el nuevo.\n\n"
                   + "El tiempo de bloqueo se guarda solo al elegirlo: para eso no hace falta cambiar el PIN.");
      return;
    }
    const r = await llamar("pin_fijar", nuevo.value, repetido.value, actual.value);
    if (r.error) { await avisar("PIN de acceso", r.error); return; }
    dd.cerrar();
    if (st.ini) { st.ini.pin = { activo: true, desbloqueada: true, auto_min: Number(auto.value) }; vigilarInactividad(); }
    estado(activo ? "PIN cambiado."
           : paraBloquear ? "PIN activado: el botón Bloquear ya tapa la ventana, y se pedirá al abrir FichaCSIRC."
                          : "PIN activado: se pedirá al abrir FichaCSIRC.");
  }
  async function quitar(dd) {
    const r = await llamar("pin_quitar", actual.value);
    if (r.error) { await avisar("PIN de acceso", r.error); actual.focus(); return; }
    dd.cerrar();
    if (st.ini) { st.ini.pin = { activo: false, desbloqueada: true, auto_min: 0 }; vigilarInactividad(); }
    estado("PIN quitado: FichaCSIRC ya no lo pedirá.");
  }
}

// ================================================================ buscador de tareas

// Convierte un <input> en buscador de tareas. Mientras escribes salen, al
// momento, tus habituales, las usadas en el periodo visible y tus favoritas y
// buscadas; con un NUMERO de tarea o 3 letras, ademas, lo que haya en TODO
// ProyectosTIC. Cada resultado dice su proyecto y su tarea padre (las muchas
// "Mantenimientos" de padres distintos se distinguen) y lleva una estrella
// para marcarla o quitarla de favoritas. alElegir(t) recibe {id, nombre}.
// La lista va en <body> con position: fixed: dentro de un dialogo, su cuerpo
// con scroll la recortaria.
/* fuente: en vez de habituales/usadas/favoritas/todo ProyectosTIC, una lista
   propia: () => ({ titulo, tareas (null: cargando), vacio(q) }). La usa "Cuelga
   de" en Nueva tarea, con las tareas del proyecto. Sin fuente, y si ProyectosTIC
   deja crear tareas, al final se ofrece crear una con lo escrito. */
/* Las tareas de un proyecto en orden de arbol: cada una debajo de la que
   cuelga, con su nivel. Con filtro quedan las que encajan y, de contexto, las
   que tienen encima (para ver donde estan). 'suelta': cuelga de una tarea que
   no esta en la lista (cerrada, o de otro proyecto). */
function tareasEnArbol(tareas, encaja = null) {
  const porId = new Map(tareas.map((t) => [Number(t.id), t]));
  const hijas = new Map(), raices = [];
  for (const t of tareas) {
    const p = Number(t.padre_id);
    if (p && p !== Number(t.id) && porId.has(p)) hijas.set(p, [...(hijas.get(p) || []), t]);
    else raices.push(t);
  }
  const out = [], vistas = new Set();
  const bajar = (t, nivel) => {
    if (vistas.has(Number(t.id))) return false;
    vistas.add(Number(t.id));
    const i = out.length;
    const fila = { ...t, nivel, contexto: false, suelta: nivel === 0 && !!t.padre };
    out.push(fila);
    let dentro = false;
    for (const h of hijas.get(Number(t.id)) || []) dentro = bajar(h, nivel + 1) || dentro;
    const mia = !encaja || encaja(t);
    if (!mia && !dentro) { out.length = i; return false; }
    fila.contexto = !mia;
    return true;
  };
  for (const t of raices) bajar(t, 0);
  for (const t of tareas) bajar(t, 0);      // por si ProyectosTIC diera un ciclo: que no se pierdan
  return out;
}

function buscadorTarea(input, { alElegir, fuente = null, crear = true }) {
  input.removeAttribute("list");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  const caja = el("div", { class: "buscador-tareas", role: "listbox" });
  caja.hidden = true;
  document.body.append(caja);
  let items = [], activo = -1, seq = 0, espera = null, remoto = { q: "", tareas: null, error: "" };
  let sobran = 0;                     // tareas de la fuente que no caben en la lista
  const MAX_FUENTE = 300;
  const normal = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const consulta = () => normal(input.value.trim()).replace(/^#/, "");

  function grupos(q) {
    const encaja = (t) => !q || normal(`${t.id} ${t.nombre}`).includes(q);
    if (fuente) {
      const f = fuente();
      sobran = 0;
      if (f.tareas === null) return [[f.titulo, null]];
      // con la elegida puesta ("123 - nombre") no se filtra: se ve la lista entera para cambiarla
      const filtra = q && !/^\d+ - /.test(q);
      const todas = f.arbol ? tareasEnArbol(f.tareas, filtra ? encaja : null) : f.tareas.filter((t) => !filtra || encaja(t));
      sobran = Math.max(0, todas.length - MAX_FUENTE);
      return [[f.titulo, todas.slice(0, MAX_FUENTE)]];
    }
    const max = q ? 8 : 5;
    const vistas = new Set();
    const tomar = (lista) => lista.filter((t) => t && t.id && !vistas.has(String(t.id)) && encaja(t))
      .slice(0, max).map((t) => { vistas.add(String(t.id)); return t; });
    const out = [
      ["Tus tareas habituales", tomar((st.habituales?.filas || []).map((h) => ({ id: h.wp_id, nombre: h.tarea })))],
      [st.vista === "mes" ? "Usadas este mes" : "Usadas esta semana",
       tomar(st.dias.flatMap((d) => d.apuntes).filter((a) => a.destino !== "inari")
         .map((a) => ({ id: a.wp_id, nombre: a.tarea })))],
      ["Favoritas y buscadas", tomar([...st.tareas].map(([texto, id]) => ({ id, nombre: texto.split(" - ").slice(1).join(" - ") || texto })))],
    ];
    if (remoto.q && remoto.q === q) {
      out.push(["En todo ProyectosTIC", remoto.tareas ? tomar(remoto.tareas) : null]);
    }
    return out;
  }

  function colocar() {
    // con zoom en <html>, el rect ya viene ampliado y left/top se volverian a ampliar
    const z = parseFloat(document.documentElement.style.zoom) || 1;
    const r = input.getBoundingClientRect();
    const abajo = innerHeight - r.bottom;
    caja.style.left = `${r.left / z}px`;
    caja.style.width = `${Math.max(r.width, 380) / z}px`;
    if (abajo < 220 && r.top > abajo) {
      caja.style.top = ""; caja.style.bottom = `${(innerHeight - r.top + 2) / z}px`;
      caja.style.maxHeight = `${Math.min(340, r.top - 12) / z}px`;
    } else {
      caja.style.bottom = ""; caja.style.top = `${(r.bottom + 2) / z}px`;
      caja.style.maxHeight = `${Math.min(340, abajo - 12) / z}px`;
    }
  }

  function pintar() {
    const q = consulta();
    items = [];
    const nodos = [];
    for (const [titulo, lista] of grupos(q)) {
      if (lista === null) {
        nodos.push(el("div", { class: "bt-grupo", text: titulo }),
                   el("div", { class: "bt-nada", text: fuente ? "Cargando…" : "Buscando…" }));
        continue;
      }
      if (!lista.length) {
        if (titulo === "En todo ProyectosTIC") {
          nodos.push(el("div", { class: "bt-grupo", text: titulo }),
                     el("div", { class: "bt-nada", text: remoto.error || "Nada más con eso." }));
        }
        continue;
      }
      nodos.push(el("div", { class: "bt-grupo", text: titulo }));
      for (const t of lista) {
        const i = items.length;
        items.push(t);
        const fav = st.favoritas?.has(Number(t.id));
        const estrella = fuente ? null : el("button", { class: `bt-fav${fav ? " si" : ""}`, type: "button", tabindex: "-1",
          title: fav ? "Quitar de favoritas" : "Añadir a favoritas", text: fav ? "★" : "☆" });
        estrella?.addEventListener("mousedown", (e) => e.preventDefault());
        estrella?.addEventListener("click", async (e) => {
          e.stopPropagation();
          const r = await llamar("favorita", t.id, t.nombre, !fav);
          ponerTareas(r.tareas);
          estado(fav ? `«${t.nombre}» ya no es favorita.` : `«${t.nombre}» añadida a favoritas.`);
          pintar();
        });
        // en arbol la de arriba ya dice de cual cuelga; solo se escribe si no esta en la lista
        const enArbol = t.nivel !== undefined;
        const ruta = (enArbol ? [t.suelta ? `Cuelga de ${t.padre}` : ""] : fuente ? [t.padre] : [t.proyecto, t.padre])
          .filter(Boolean).join(" › ");
        const fila = el("div", { class: `bt-item${fuente ? " sin-fav" : ""}${enArbol ? " bt-rama" : ""}`
            + `${t.contexto ? " bt-contexto" : ""}${i === activo ? " activo" : ""}`, role: "option" },
          estrella,
          enArbol && t.nivel ? el("span", { class: "bt-codo", "aria-hidden": "true", text: "└" }) : null,
          el("div", { class: "bt-texto" },
            el("div", { class: "bt-nombre" }, el("span", { class: "bt-id", text: String(t.id) }), ` ${t.nombre}`),
            ruta ? el("div", { class: "bt-ruta", text: ruta }) : null));
        if (enArbol) {
          fila.style.setProperty("--nivel", String(Math.min(t.nivel, 8)));
          fila.setAttribute("aria-level", String(t.nivel + 1));
        }
        fila.addEventListener("mousedown", (e) => { e.preventDefault(); elegir(t); });
        nodos.push(fila);
      }
      if (fuente && sobran) {
        nodos.push(el("div", { class: "bt-nada", text: `…y ${sobran} más: escribe parte del nombre o el número para acotar.` }));
      }
    }
    if (!nodos.length) {
      nodos.push(el("div", { class: "bt-nada", text: fuente ? fuente().vacio(q) : q
        ? "Sin resultados." : "Escribe un nombre o un número de tarea: se busca en todo ProyectosTIC." }));
    }
    // lo escrito no es (o puede que no sea) ninguna: crearla ahi mismo
    if (!fuente && crear && q && !/^\d+$/.test(q) && puedeCrearTareas()) {
      const i = items.length, titulo = input.value.trim().replace(/^#/, "");
      items.push({ crear: true, titulo });
      const fila = el("div", { class: `bt-item bt-crear${i === activo ? " activo" : ""}`, role: "option" },
        el("span", { class: "bt-mas", "aria-hidden": "true", text: "＋" }),
        el("div", { class: "bt-texto" },
          el("div", { class: "bt-nombre" }, "Crear la tarea ", el("b", { text: `«${titulo}»` })),
          el("div", { class: "bt-ruta", text: "Nueva en ProyectosTIC" })));
      fila.addEventListener("mousedown", (e) => { e.preventDefault(); elegir(items[i]); });
      nodos.push(fila);
    }
    caja.replaceChildren(...nodos);
    caja.hidden = false;
    input.setAttribute("aria-expanded", "true");
    colocar();
  }

  function buscarFuera() {
    if (fuente) return;
    const q = consulta();
    clearTimeout(espera);
    if (!q) { remoto = { q: "", tareas: null, error: "" }; return; }   // desde la 1.a letra
    if (remoto.q === q && remoto.tareas) return;
    remoto = { q, tareas: null, error: "" };
    const mio = ++seq;
    espera = setTimeout(async () => {
      let r;
      try { r = await api().buscar_tareas(input.value.trim()); }
      catch (_e) { r = { error: "No se pudo buscar (¿sin conexión?)." }; }
      if (mio !== seq) return;
      remoto = { q, tareas: r.error ? [] : r.tareas, error: r.error || "" };
      if (!caja.hidden) pintar();
    }, 350);
  }

  function cerrar() {
    caja.hidden = true;
    activo = -1;
    input.setAttribute("aria-expanded", "false");
  }

  function elegir(t) {
    if (t.crear) {
      cerrar();
      dlgNuevaTarea({ titulo: t.titulo, alCrear: (nueva) => { input.value = `${nueva.id} - ${nueva.nombre}`; return alElegir(nueva); } });
      return;
    }
    input.value = `${t.id} - ${t.nombre}`;
    cerrar();
    alElegir(t);
  }

  input.addEventListener("focus", () => { input.select(); activo = -1; pintar(); });
  input.addEventListener("input", () => { activo = -1; buscarFuera(); pintar(); });
  input.addEventListener("blur", () => setTimeout(cerrar, 120));
  input.addEventListener("keydown", (e) => {
    if (caja.hidden) {
      if (e.key === "ArrowDown") { e.preventDefault(); pintar(); }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      activo = (activo + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      pintar();
      caja.querySelector(".bt-item.activo")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && activo >= 0) {
      e.preventDefault();
      e.stopPropagation();
      elegir(items[activo]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cerrar();
    }
  });
  addEventListener("resize", cerrar);
  // si el campo desaparece (se cierra el dialogo), su lista tambien
  new MutationObserver(() => { if (!input.isConnected) { caja.remove(); } })
    .observe(document.body, { childList: true, subtree: true });
  // para quien cambia la fuente por debajo (llegan las tareas del proyecto)
  return { repintar: () => { if (!caja.hidden) pintar(); } };
}

// ================================================================ buscar tarea

/* alElegir(tarea): quien lo abre se queda con la tarea elegida (Editar dia);
   sin el, la tarea va al formulario de Añadir apunte, como siempre. */
function dlgBuscar({ alElegir = null } = {}) {
  let tareas = [], filtradas = [], seq = 0;
  const proy = el("select", {}, el("option", { value: "", text: "Cargando proyectos…" }));
  const filtro = entrada("", { placeholder: "Filtra la lista, o Enter para buscar en todos (vacío: todas)", class: "ancho" });
  const lista = el("select", { multiple: true, size: "14", class: "lista" });
  const info = nota("Cargando proyectos…");
  const fav = el("input", { type: "checkbox" });
  const d = dialogo({ titulo: "Buscar tarea", ancho: 640, botones: [
    { texto: "＋ Nueva tarea…", izquierda: true, id: "nueva", accion: nueva }, cancelarBoton,
    { texto: "Elegir", clase: "primario", accion: elegir }] });
  d.botones.nueva.title = "Si no existe, créala en ProyectosTIC";
  d.botones.nueva.hidden = !puedeCrearTareas();
  // en el proyecto que se esta mirando, con lo escrito en el filtro de titulo
  function nueva() {
    dlgNuevaTarea({ proyecto: proy.value, titulo: filtro.value.trim(), alCrear: (t) => {
      d.cerrar();
      return alElegir ? alElegir(t) : usarTareaEnFormulario(t);
    } });
  }
  d.cuerpo.append(
    rejilla(["Proyecto", proy],
            ["Filtro", el("div", { class: "fila" }, filtro,
              el("button", { text: "Buscar en todo", onclick: buscarTodo }))]),
    lista, info,
    el("label", { class: "check" }, fav, " Añadir también a favoritas (se guarda en la configuración)"));

  const pintar = () => {
    const f = filtro.value.trim().toLowerCase();
    filtradas = tareas.filter((t) => t.nombre.toLowerCase().includes(f) || String(t.id).includes(f));
    lista.replaceChildren(...filtradas.map((t, i) => el("option", { value: String(i),
      text: `${t.id} - ${t.nombre}${t.padre ? `   (› ${t.padre})` : ""}` })));
  };
  llamar("proyectos").then((ps) => {
    proy.replaceChildren(el("option", { value: "", text: "— elige un proyecto —" }),
      ...ps.map((p) => el("option", { value: String(p.id), text: `${p.id} - ${p.nombre}` })));
    info.textContent = ps.length ? `${ps.length} proyectos. Elige uno para ver sus tareas.`
                                 : "No apareces asignado a ningún proyecto.";
  }).catch(() => d.cerrar());
  proy.onchange = async () => {
    if (!proy.value) return;
    const mio = ++seq;
    info.textContent = "Cargando tareas…";
    const r = await llamar("tareas_de_proyecto", proy.value);
    if (mio !== seq) return;
    if (r.error) { info.textContent = r.error; return; }
    tareas = r.tareas;
    pintar();
    info.textContent = `${tareas.length} tareas. Filtra y elige (Ctrl o Mayús: varias).`;
  };
  filtro.addEventListener("input", pintar);
  filtro.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); buscarTodo(); } });
  lista.addEventListener("dblclick", () => elegir(d));
  async function buscarTodo() {
    const texto = filtro.value.trim();
    const mio = ++seq;
    info.textContent = texto ? `Buscando «${texto}» en todos los proyectos…`
                             : "Cargando todas tus tareas abiertas de todos los proyectos…";
    const r = await llamar("buscar_tareas", texto);
    if (mio !== seq) return;
    if (r.error) { info.textContent = r.error; return; }
    tareas = r.tareas;
    filtro.value = "";
    pintar();
    info.textContent = tareas.length
      ? `${tareas.length} tareas ${texto ? "encontradas" : "abiertas"} en todos tus proyectos. Filtra y elige.`
      : texto ? `Nada con «${texto}» en tus proyectos.` : "No hay tareas abiertas en tus proyectos.";
  }
  async function elegir(dd) {
    const elegidas = [...lista.selectedOptions].map((o) => filtradas[Number(o.value)]);
    if (!elegidas.length) { info.textContent = "Elige al menos una tarea de la lista."; return; }
    ponerTareas(await llamar("elegir_tareas", elegidas, fav.checked));
    dd.cerrar();
    if (alElegir) { alElegir(elegidas[0]); return; }
    $("tarea").value = `${elegidas[0].id} - ${elegidas[0].nombre}`;
    await elegirTarea();
    estado(fav.checked ? `${elegidas.length} tarea(s) guardada(s) como favoritas.`
                       : `${elegidas.length} tarea(s) añadida(s) al desplegable.`);
  }
  filtro.focus();
}

// ================================================================ nueva tarea

const puedeCrearTareas = () => !!st.crear?.proyectos?.length;

// "1", "1,5" -> horas; lo que no sea un numero de horas, null.
function horasDeTexto(texto) {
  const n = Number(String(texto ?? "").trim().replace(",", "."));
  return String(texto ?? "").trim() && Number.isFinite(n) && n > 0 ? n : null;
}
const textoEstimado = (h) => `${fmtHoras(h)} h ${h === 1 ? "estimada" : "estimadas"}`;

// La tarea que hay puesta en el formulario de Añadir apunte (o ninguna).
function tareaDelFormulario() {
  const texto = $("tarea").value.trim();
  const id = st.tareas.get(texto);
  return id ? { id, nombre: texto.split(" - ").slice(1).join(" - ") || texto } : null;
}

// El proyecto (su numero) de una tarea, o null si no se sabe. Se pregunta una
// vez por tarea: sirve para abrir Nueva tarea en el proyecto en el que se esta.
const proyectosDeTareas = new Map();
async function proyectoDeTarea(id) {
  if (!id) return null;
  if (!proyectosDeTareas.has(id)) {
    try {
      const r = await api().tarea_datos(id);
      if (r?.proyecto?.id) proyectosDeTareas.set(id, r.proyecto.id);
    } catch (_e) { /* sin red: se queda el primero de la lista */ }
  }
  return proyectosDeTareas.get(id) ?? null;
}

// Las tareas de un proyecto de las que PUEDE colgar la tarea 'id': todas menos
// ella y las que cuelgan de ella.
function sinSuRama(tareas, id) {
  const fuera = new Set([Number(id)]);
  for (let crece = true; crece;) {
    crece = false;
    for (const t of tareas) {
      if (!fuera.has(Number(t.id)) && fuera.has(Number(t.padre_id))) { fuera.add(Number(t.id)); crece = true; }
    }
  }
  return tareas.filter((t) => !fuera.has(Number(t.id)));
}

// La tarea, al formulario de Añadir apunte: solo faltan las horas.
async function usarTareaEnFormulario(t) {
  $("tarea").value = textoDeTarea(t.id) || `${t.id} - ${t.nombre}`;
  await elegirTarea();
  if (!pila.length) $("horas").focus();
}

/* Crear una tarea en ProyectosTIC sin salir de FichaCSIRC. Solo en los
   proyectos en los que ProyectosTIC deja (el permiso va por proyecto y rol).
   Los tipos, el que viene por defecto, si se le puede asignar a uno mismo y lo
   que falta los dice el formulario de ProyectosTIC, que no crea nada. Abajo se
   ve como va a quedar antes de crearla: no se deshace desde aqui.
   titulo / proyecto: lo que ya se sabe (lo escrito en el buscador, el proyecto
   de Buscar tarea). alCrear(tarea): quien lo abre se queda con ella; sin el,
   va al formulario de Añadir apunte. */
function dlgNuevaTarea({ titulo = "", proyecto = null, alCrear = null } = {}) {
  const d = dialogo({ titulo: "Nueva tarea", ancho: 600, botones: [
    { texto: "Guardar como plantilla…", izquierda: true, id: "plantilla", accion: guardarPlantilla },
    { texto: "Cancelar", id: "no", accion: (dd) => dd.cerrar() },
    { texto: "Crear tarea", clase: "primario", id: "crear", accion: crear }] });
  d.botones.crear.disabled = true;
  d.botones.plantilla.hidden = true;
  d.botones.plantilla.title = "Guarda lo que hay en el diálogo para rellenarlo otra vez con un clic";
  const cargando = el("p", { class: "nt-cargando tenue", text: "Mirando en qué proyectos puedes crear tareas…" });
  d.cuerpo.append(cargando);

  const tit = entrada(titulo, { class: "nt-titulo", maxlength: "255", placeholder: "Título de la tarea",
                                "aria-label": "Título de la tarea" });
  const cuenta = el("span", { class: "opc" });
  const proy = el("select", { "aria-label": "Proyecto" });
  const tipos = el("div", { class: "nt-tipos", role: "radiogroup", "aria-label": "Tipo" });
  const padre = entrada("", { placeholder: "Busca una tarea del proyecto, por nombre o número",
                              "aria-label": "Tarea de la que cuelga" });
  const quitar = el("button", { type: "button", class: "nt-quitar", title: "Que no cuelgue de ninguna",
                                "aria-label": "Que no cuelgue de ninguna", text: "×", hidden: true });
  const desc = el("textarea", { class: "nt-desc", rows: "3", "aria-label": "Descripción",
                                placeholder: "Lo que haya que saber de la tarea." });
  const est = entrada("", { class: "nt-est", inputmode: "decimal", placeholder: "ej. 1,5",
                            "aria-label": "Tiempo estimado, en horas" });
  const plantillas = el("div", { class: "nt-plantillas", hidden: true });
  const notaPlantilla = el("div", { class: "nt-plantilla-nota tenue", hidden: true });
  const asignar = el("input", { type: "checkbox" });
  const notaAsignar = el("span", { class: "tenue" });
  const fav = el("input", { type: "checkbox" });
  const vista = el("div", { class: "nt-vista" });
  const aviso = el("div", { class: "nt-aviso", role: "status", hidden: true });
  const error = el("div", { class: "nt-error", role: "alert", hidden: true });

  let ops = null;            // lo que dice ProyectosTIC de este proyecto y tipo (null: preguntando)
  let tipoSel = null;        // id del tipo elegido
  let padreSel = null;       // {id, nombre} de la tarea de la que cuelga
  let tareasProy = null;     // tareas del proyecto (null: cargando)
  let quiereAsignar = true, pendiente = false, creando = false, errorCrear = "", seq = 0;
  let plantilla = null;      // la plantilla puesta (si queda su * en el titulo, se avisa antes de crear)

  const proyectoSel = () => st.crear.proyectos.find((p) => String(p.id) === proy.value);
  const tipoActual = () => ops?.tipos?.find((t) => t.id === tipoSel) || null;
  const tituloLimpio = () => tit.value.trim().replace(/\s+/g, " ");

  // ---- como va a quedar ----
  function pintarVista() {
    const t = tipoActual(), p = proyectoSel(), texto = tituloLimpio();
    vista.style.setProperty("--tipo", t?.color || "");
    vista.replaceChildren(
      el("div", { class: "nt-vista-rot", text: "Así quedará en ProyectosTIC" }),
      el("div", { class: "nt-vista-tit" },
        t ? el("span", { class: `nt-sello${t.hito ? " hito" : ""}` }, el("i"), t.nombre) : null,
        el("span", { class: `txt${texto ? "" : " vacio"}`, text: texto || "Sin título todavía" })),
      el("div", { class: "nt-ruta" },
        el("span", { text: p ? p.nombre : "" }),
        padreSel ? el("span", { text: ramaDelPadre().map((n) => ` › ${n}`).join("") })
                 : el("span", { class: "tenue", text: " · directamente en el proyecto" })),
      el("div", { class: "nt-marcas" },
        el("span", { class: "chip chip-tele", text: asignar.checked ? "👤 Asignada a ti" : "Sin asignar" }),
        horasDeTexto(est.value) ? el("span", { class: "chip chip-guardia", text: `⏱ ${textoEstimado(horasDeTexto(est.value))}` }) : null,
        fav.checked ? el("span", { class: "chip chip-permiso", text: "★ En tus favoritas" }) : null));
    cuenta.textContent = tit.value.length > 200 ? `${tit.value.length} / 255` : "";
    d.botones.crear.disabled = creando || pendiente || !ops || !!ops.error || !!ops.faltan?.length;
  }

  function pintarTipos() {
    if (!ops || ops.error || !ops.tipos.length) {
      tipos.replaceChildren(el("span", { class: "tenue", text: ops ? "—" : "Cargando…" }));
      return;
    }
    tipos.replaceChildren(...ops.tipos.map((t) => {
      const b = el("button", { type: "button", class: `nt-tipo${t.hito ? " hito" : ""}`, role: "radio",
        "aria-checked": String(t.id === tipoSel), tabindex: t.id === tipoSel ? "0" : "-1" }, el("i"), t.nombre);
      if (t.color) b.style.setProperty("--tipo", t.color);
      b.onclick = () => elegirTipo(t.id);
      return b;
    }));
  }

  function pintarAvisos() {
    const msg = ops?.error || errorCrear;
    error.hidden = !msg;
    // replaceChildren escribe "null" si le llega un null: solo lo que haya
    error.replaceChildren(...[el("span", { text: msg }),
      ops?.error ? el("button", { type: "button", class: "enlace", text: "Reintentar", onclick: cargarProyecto }) : null].filter(Boolean));
    const faltan = ops?.faltan || [];
    aviso.hidden = !faltan.length;
    if (faltan.length) {
      const t = tipoActual();
      aviso.replaceChildren(
        el("b", { text: `ProyectosTIC pide algo más para ${t ? `una tarea de tipo «${t.nombre}»` : "esta tarea"}, y FichaCSIRC no lo rellena:` }),
        el("ul", {}, ...faltan.map((m) => el("li", { text: m }))),
        el("span", { text: ops.tipos.length > 1 ? "Elige otro tipo o créala en la web: " : "Créala en la web: " }),
        el("button", { type: "button", class: "enlace", text: "abrir el alta en ProyectosTIC ↗",
                       onclick: () => llamar("abrir_alta_tarea", proy.value, tipoSel).catch(() => {}) }));
    }
    // asignarsela: solo si el proyecto deja (lo dice su formulario)
    const puede = !ops || !!ops.error || ops.asignable !== false;
    asignar.disabled = !puede;
    asignar.checked = puede && quiereAsignar;
    notaAsignar.textContent = puede ? "" : " (en este proyecto no se te pueden asignar)";
    // el tiempo estimado: salvo que el proyecto no lo deje poner
    est.disabled = !!ops && !ops.error && ops.estimable === false;
    est.title = est.disabled ? "En este proyecto no se puede poner el tiempo estimado" : "";
  }

  // ---- plantillas: lo que se repite, con un clic ----
  function pintarPlantillas() {
    const ps = st.crear.plantillas || [];
    plantillas.hidden = !ps.length;
    plantillas.replaceChildren(el("span", { class: "nt-plantillas-rot", text: "Plantillas" }), ...ps.map((p) => {
      const puesta = !!plantilla && plantilla.nombre === p.nombre;
      return el("span", { class: `nt-plantilla${puesta ? " puesta" : ""}` },
        el("button", { type: "button", class: "usar", "aria-pressed": String(puesta), text: p.nombre,
                       title: p.titulo ? `Rellena la tarea: «${p.titulo}»` : "Rellena la tarea con esta plantilla",
                       onclick: () => aplicarPlantilla(p) }),
        el("button", { type: "button", class: "borrar", text: "×", title: `Borrar la plantilla «${p.nombre}»`,
                       "aria-label": `Borrar la plantilla «${p.nombre}»`, onclick: () => borrarPlantilla(p) }));
    }));
  }

  async function aplicarPlantilla(p) {
    plantilla = p; errorCrear = "";
    if (p.titulo) tit.value = p.titulo;
    est.value = p.estimado ? fmtHoras(p.estimado) : "";
    desc.value = p.descripcion || "";
    quiereAsignar = !!p.asignar;
    fav.checked = !!p.favorita;
    pintarPlantillas();
    const suyo = p.proyecto != null && st.crear.proyectos.some((x) => x.id === p.proyecto);
    notaPlantilla.hidden = p.proyecto == null || suyo;
    notaPlantilla.textContent = "El proyecto de esta plantilla ya no está entre los tuyos: se queda el que tenías puesto.";
    if (suyo && (proy.value !== String(p.proyecto) || !ops)) { proy.value = String(p.proyecto); await cargarProyecto(); }
    if (plantilla !== p) return;                          // se eligio otra mientras tanto
    if ((suyo || p.proyecto == null) && p.tipo != null && ops?.tipos?.some((t) => t.id === p.tipo)) await elegirTipo(p.tipo);
    if (plantilla !== p) return;
    if (suyo) ponerPadre(p.padre || null);
    pintar();
    // el * del titulo es lo que cambia cada vez: se deja marcado para escribir encima
    tit.focus();
    const i = tit.value.indexOf("*");
    if (i >= 0) tit.setSelectionRange(i, i + 1);
  }

  async function guardarPlantilla() {
    const propuesto = plantilla?.nombre || tituloLimpio().replace(/[\s:,(#-]*\*.*$/, "");
    const nombre = await pedirTexto({ titulo: "Guardar como plantilla", valor: propuesto,
      texto: "Guarda lo que hay ahora en el diálogo: título, proyecto, tipo, de cuál cuelga, tiempo estimado, "
        + "descripción y las dos casillas. En el título, pon un * donde vaya lo que cambia cada vez "
        + "(el número de ticket, por ejemplo)." });
    if (!nombre) return;
    const ya = (st.crear.plantillas || []).find((p) => p.nombre.toLowerCase() === nombre.toLowerCase());
    if (ya && !(await preguntar("Guardar como plantilla", `Ya tienes una plantilla «${ya.nombre}». ¿La sustituyes por esta?`,
                                { si: "Sustituir", no: "Cancelar" }))) return;
    const r = await llamar("plantilla_tarea_guardar", { nombre, titulo: tituloLimpio(), proyecto: Number(proy.value),
      tipo: tipoSel, padre: padreSel, estimado: est.value.trim(), descripcion: desc.value,
      asignar: asignar.checked, favorita: fav.checked });
    if (r.error) { errorCrear = r.error; pintarAvisos(); return; }
    st.crear.plantillas = r.plantillas;
    plantilla = r.plantillas.find((p) => p.nombre.toLowerCase() === nombre.toLowerCase()) || null;
    notaPlantilla.hidden = true;
    pintarPlantillas();
    estado(`Plantilla de tarea «${nombre}» guardada.`);
  }

  async function borrarPlantilla(p) {
    if (!(await preguntar("Borrar plantilla", `¿Borrar la plantilla de tarea «${p.nombre}»?\n\nLas tareas ya creadas con ella no cambian.`,
                          { si: "Borrar", no: "Cancelar" }))) return;
    const r = await llamar("plantilla_tarea_borrar", p.nombre);
    st.crear.plantillas = r.plantillas || [];
    if (plantilla && plantilla.nombre === p.nombre) plantilla = null;
    pintarPlantillas();
  }

  function pintar() { pintarTipos(); pintarAvisos(); pintarVista(); }

  // ---- lo que dice ProyectosTIC ----
  async function opciones(tipo) {
    const mio = ++seq;
    let r;
    try { r = await api().nueva_tarea_opciones(proy.value, tipo); }
    catch (e) { r = { error: `No se pudo preguntar a ProyectosTIC (${(e && e.message) || "sin conexión"}).` }; }
    return mio === seq ? r : null;
  }

  async function cargarProyecto() {
    const pid = proy.value;
    ops = null; tipoSel = null; tareasProy = null; errorCrear = ""; pendiente = false;
    ponerPadre(null);
    pintar();
    // de cual puede colgar: las tareas del proyecto (aparte: tardan mas)
    api().tareas_de_proyecto(pid).then((r) => r.tareas || [], () => []).then((ts) => {
      if (proy.value !== pid) return;
      tareasProy = ts;
      listaPadre?.repintar();
      if (padreSel) pintarVista();
    });
    const r = await opciones(null);
    if (!r) return;
    ops = r.error ? { error: r.error, tipos: [], faltan: [] } : r;
    tipoSel = r.tipo ?? r.tipos?.[0]?.id ?? null;
    pintar();
  }

  async function elegirTipo(id, foco = false) {
    if (id === tipoSel || !ops) return;
    tipoSel = id;
    pendiente = true; errorCrear = "";
    ops = { ...ops, faltan: [] };
    pintar();
    if (foco) tipos.querySelector('[aria-checked="true"]')?.focus();
    const r = await opciones(id);
    if (!r) return;
    pendiente = false;
    ops = r.error ? { ...ops, error: r.error } : { ...ops, error: "", faltan: r.faltan, asignable: r.asignable };
    pintar();
  }

  tipos.addEventListener("keydown", (e) => {
    const paso = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!paso || !ops?.tipos?.length) return;
    e.preventDefault();
    const n = ops.tipos.length, i = ops.tipos.findIndex((t) => t.id === tipoSel);
    elegirTipo(ops.tipos[(i + paso + n) % n].id, true);
  });

  // ---- de cual cuelga ----
  function ponerPadre(t) {
    padreSel = t ? { id: t.id, nombre: t.nombre } : null;
    padre.value = t ? `${t.id} - ${t.nombre}` : "";
    quitar.hidden = !t;
    pintarVista();
  }
  // La lista se monta con el campo ya en el dialogo (montar): el buscador
  // retira la suya en cuanto ve que su campo no esta en la pagina.
  let listaPadre = null;
  const montarListaPadre = () => {
    listaPadre = buscadorTarea(padre, { alElegir: ponerPadre, fuente: () => ({
      titulo: "Tareas abiertas del proyecto", tareas: tareasProy, arbol: true,
      vacio: (q) => (q ? "Ninguna tarea abierta del proyecto con eso." : "Este proyecto no tiene tareas abiertas.") }) });
  };
  // De quien cuelga la elegida, hasta arriba: lo que se vera en ProyectosTIC.
  function ramaDelPadre() {
    if (!padreSel) return [];
    const porId = new Map((tareasProy || []).map((t) => [Number(t.id), t]));
    const out = [];
    let t = porId.get(Number(padreSel.id)) || padreSel;
    for (let n = 0; t && n < 12; n++) {
      out.unshift(t.nombre);
      const arriba = porId.get(Number(t.padre_id));
      if (!arriba && t.padre) out.unshift(t.padre);       // cuelga de una que no esta en la lista
      t = arriba;
    }
    return out;
  }
  // lo escrito sin elegir no vale: o la elegida, o ninguna
  padre.addEventListener("blur", () => setTimeout(() => {
    if (!padre.value.trim()) ponerPadre(null);
    else padre.value = padreSel ? `${padreSel.id} - ${padreSel.nombre}` : "";
  }, 160));
  quitar.onclick = () => { ponerPadre(null); padre.focus(); };

  // ---- crear ----
  async function crear() {
    if (!tituloLimpio()) {
      errorCrear = "Escribe el título de la tarea.";
      pintarAvisos();
      tit.focus();
      return;
    }
    if (est.value.trim() && !horasDeTexto(est.value)) {
      errorCrear = "El tiempo estimado no vale: escribe las horas (ej. 1 o 1,5).";
      pintarAvisos();
      est.focus();
      return;
    }
    // el * de la plantilla sin cambiar: casi seguro que se ha olvidado
    if (plantilla?.titulo?.includes("*") && tituloLimpio().includes("*")
        && !(await preguntar("Nueva tarea", "El título todavía tiene el * de la plantilla, que es donde va lo que cambia cada vez.\n\n¿La creas así?",
                             { si: "Crearla así", no: "Cambiar el título" }))) {
      tit.focus();
      const i = tit.value.indexOf("*");
      if (i >= 0) tit.setSelectionRange(i, i + 1);
      return;
    }
    creando = true; errorCrear = "";
    d.botones.crear.textContent = "Creando…";
    pintarAvisos();
    let r;
    try {
      r = await llamar("nueva_tarea_crear", { proyecto: proy.value, titulo: tituloLimpio(), tipo: tipoSel,
        padre: padreSel ? padreSel.id : null, descripcion: desc.value, estimado: est.value.trim(),
        asignar: asignar.checked, favorita: fav.checked });
    } finally {
      creando = false;
      d.botones.crear.textContent = "Crear tarea";
    }
    if (r.error) { errorCrear = r.error; pintarAvisos(); return; }
    ponerTareas(r.tareas);
    st.crear.ultimo = Number(proy.value);
    cerrarDeVerdad();
    await (alCrear ? alCrear(r.tarea) : usarTareaEnFormulario(r.tarea));
    if (!pila.length) $("horas").focus();
    avisoTareaCreada(r.tarea);
  }

  // Con una descripcion escrita, cerrar pregunta antes (Esc, la X o Cancelar).
  const cerrarDeVerdad = d.cerrar;
  let preguntando = false;
  d.cerrar = async () => {
    if (preguntando) return;
    if (desc.value.trim() && desc.value.trim() !== (plantilla?.descripcion || "")) {
      preguntando = true;
      const si = await preguntar("Descartar la tarea", "Has escrito una descripción y la tarea aún no se ha creado.",
                                 { si: "Descartar", no: "Seguir escribiendo" });
      preguntando = false;
      if (!si) { desc.focus(); return; }
    }
    cerrarDeVerdad();
  };

  tit.addEventListener("input", () => { errorCrear = ""; pintarAvisos(); pintarVista(); });
  tit.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); d.botones.crear.click(); } });
  desc.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); d.botones.crear.click(); }
  });
  proy.onchange = cargarProyecto;
  asignar.onchange = () => { quiereAsignar = asignar.checked; pintarVista(); };
  fav.onchange = pintarVista;
  est.addEventListener("input", () => { errorCrear = ""; pintarAvisos(); pintarVista(); });
  est.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); d.botones.crear.click(); } });

  function montar() {
    const opcional = () => el("span", { class: "opc", text: "opcional" });
    const campo = (rotulo, control, extra = null) => el("div", { class: "nt-campo" },
      el("div", { class: "nt-rot" }, el("span", { text: rotulo }), extra), control);
    cargando.remove();
    d.botones.plantilla.hidden = false;
    pintarPlantillas();
    d.cuerpo.append(el("div", { class: "nt" },
      el("p", { class: "nt-intro", text: "Se da de alta en ProyectosTIC y queda lista para fichar en ella." }),
      plantillas, notaPlantilla,
      campo("Título", tit, cuenta),
      el("div", { class: "nt-dos" }, campo("Proyecto", proy), campo("Tipo", tipos)),
      aviso,
      el("div", { class: "nt-cuelga" },
        campo("Cuelga de", el("div", { class: "nt-padre" }, padre, quitar), opcional()),
        campo("Estimado", el("div", { class: "nt-est-caja" }, est, el("span", { class: "tenue", text: "h" })), opcional())),
      campo("Descripción", desc, opcional()),
      el("div", { class: "nt-opciones" },
        el("label", { class: "check" }, asignar, " Asignármela", notaAsignar),
        el("label", { class: "check" }, fav, " Guardarla en mis favoritas")),
      vista, error));
    montarListaPadre();
  }

  function sinPermiso() {
    cargando.remove();
    d.botones.crear.hidden = true;
    d.botones.no.textContent = "Cerrar";
    d.cuerpo.append(el("div", { class: "nt-sin" },
      el("div", { class: "nt-sin-ico", "aria-hidden": "true", text: "🔒" }),
      el("b", { text: "ProyectosTIC no te deja crear tareas" }),
      el("p", { class: "tenue", text: "Ninguno de tus proyectos te da ese permiso. Lo concede quien administra "
        + "cada proyecto, con un rol que incluya «Añadir paquetes de trabajo»." }),
      el("p", { class: "tenue", text: "Mientras tanto puedes fichar en las tareas que ya existen: «Buscar…»." })));
  }

  (async () => {
    try { st.crear = await llamar("nueva_tarea_proyectos"); }
    catch (_e) { cerrarDeVerdad(); return; }
    pintarPermisoCrear();
    if (!pila.includes(d)) return;                    // se cerro mientras tanto
    if (!puedeCrearTareas()) { sinPermiso(); return; }
    const ps = st.crear.proyectos;
    proy.replaceChildren(...ps.map((p) => el("option", { value: String(p.id), text: p.nombre })));
    // el proyecto que se estaba mirando; si no, el de la ultima vez; y la
    // primera vez, el de la tarea que hay puesta en el formulario
    const esta = (x) => ps.some((p) => String(p.id) === String(x));
    let preferido = [proyecto, st.crear.ultimo].find(esta);
    if (!preferido && ps.length > 1) {
      preferido = [await proyectoDeTarea(tareaDelFormulario()?.id)].find(esta);
      if (!pila.includes(d)) return;
    }
    if (preferido) proy.value = String(preferido);
    montar();
    tit.focus();
    cargarProyecto();
  })();
}

// ================================================================ modificar tarea

/* Modificar una tarea que ya existe en ProyectosTIC: el titulo, de cual cuelga
   (lo que mas se olvida al crearla), el tiempo estimado y la descripcion. Solo
   se manda lo que cambia, y abajo se ve antes de guardarlo. Que campos deja
   tocar lo dice ProyectosTIC (el permiso va por proyecto y rol).
   tarea: {id, nombre} con la que se abre; sin ella, se elige arriba. */
function dlgModificarTarea({ tarea = null } = {}) {
  const d = dialogo({ titulo: "Modificar tarea", ancho: 600, botones: [
    { texto: "Abrir en ProyectosTIC ↗", izquierda: true, id: "abrir", accion: () => t0 && llamar("abrir_tarea", t0.id).catch(() => {}) },
    { texto: "Cancelar", id: "no", accion: (dd) => dd.cerrar() },
    { texto: "Guardar cambios", clase: "primario", id: "guardar", accion: guardar }] });
  const cual = entrada("", { placeholder: "Busca la tarea por nombre o por número", "aria-label": "Tarea que se modifica" });
  const ficha = el("div", { class: "mt-ficha tenue" });
  const tit = entrada("", { class: "nt-titulo", maxlength: "255", "aria-label": "Título de la tarea" });
  const padre = entrada("", { placeholder: "Busca una tarea del proyecto, por nombre o número",
                              "aria-label": "Tarea de la que cuelga" });
  const quitar = el("button", { type: "button", class: "nt-quitar", title: "Que no cuelgue de ninguna",
                                "aria-label": "Que no cuelgue de ninguna", text: "×", hidden: true });
  const est = entrada("", { class: "nt-est", inputmode: "decimal", placeholder: "ej. 1,5",
                            "aria-label": "Tiempo estimado, en horas" });
  const desc = el("textarea", { class: "nt-desc", rows: "4", "aria-label": "Descripción" });
  const cambios = el("div", { class: "nt-vista mt-cambios" });
  const aviso = el("div", { class: "nt-aviso", role: "status", hidden: true });
  const error = el("div", { class: "nt-error", role: "alert", hidden: true });
  const campos = el("div", { class: "mt-campos", hidden: true });

  let t0 = null;             // la tarea como esta en ProyectosTIC (null: sin elegir, o cargando)
  let padreSel = null;       // {id, nombre} de la que colgara
  let tareasProy = null;     // de cuales puede colgar (null: cargando)
  let est0 = "", cargandoTarea = false, guardando = false, msg = "", seq = 0;

  const limpio = (s) => String(s || "").trim().replace(/\s+/g, " ");

  // Lo que cambia respecto a lo que hay en ProyectosTIC: solo eso se manda.
  function cambiosDe() {
    const c = {};
    if (!t0) return c;
    if (limpio(tit.value) !== limpio(t0.titulo)) c.titulo = limpio(tit.value);
    if ((padreSel ? padreSel.id : null) !== (t0.padre ? t0.padre.id : null)) c.padre = padreSel ? padreSel.id : null;
    if (est.value.trim() !== est0) c.estimado = est.value.trim();
    if (desc.value.trim() !== (t0.descripcion || "").trim()) c.descripcion = desc.value;
    return c;
  }

  function pintar() {
    const c = cambiosDe(), n = Object.keys(c).length;
    const puede = t0?.puede || {};
    const bloqueada = !t0 || !t0.editable || guardando;
    tit.disabled = bloqueada || puede.titulo === false;
    padre.disabled = bloqueada || puede.padre === false;
    quitar.disabled = padre.disabled;
    est.disabled = bloqueada || puede.estimado === false;
    desc.disabled = bloqueada || puede.descripcion === false;
    campos.hidden = !t0;
    ficha.replaceChildren(...(cargandoTarea ? [el("span", { text: "Leyendo la tarea en ProyectosTIC…" })]
      : !t0 ? [el("span", { text: "Elige la tarea que quieres modificar." })]
      : [el("b", { text: `#${t0.id}` }), ...[t0.tipo, t0.estado, t0.proyecto?.nombre].filter(Boolean).map((x) => el("span", { text: x }))]));
    // por que no se puede (toda, o algun campo)
    const no = t0 && t0.editable ? [["titulo", "el título"], ["padre", "de cuál cuelga"], ["estimado", "el tiempo estimado"],
                                    ["descripcion", "la descripción"]].filter(([k]) => puede[k] === false).map(([, x]) => x) : [];
    aviso.hidden = !t0 || (t0.editable && !no.length);
    aviso.textContent = !t0 ? "" : !t0.editable
      ? `ProyectosTIC no te deja modificar esta tarea. Lo concede quien administra el proyecto${t0.proyecto?.nombre ? ` «${t0.proyecto.nombre}»` : ""}.`
      : `ProyectosTIC no te deja cambiarle ${no.join(", ")}.`;
    error.hidden = !msg;
    error.textContent = msg;
    // lo que va a cambiar, antes de guardarlo
    const de = (x) => x || "ninguna";
    const horas = (txt) => (horasDeTexto(txt) ? `${fmtHoras(horasDeTexto(txt))} h` : txt.trim() ? `«${txt.trim()}»` : "sin estimar");
    const lineas = [];
    if ("titulo" in c) lineas.push(["Título", `«${limpio(t0.titulo)}»`, `«${c.titulo || "sin título"}»`]);
    if ("padre" in c) lineas.push(["Cuelga de", de(t0.padre?.nombre), de(padreSel?.nombre)]);
    if ("estimado" in c) lineas.push(["Estimado", horas(est0), horas(est.value)]);
    if ("descripcion" in c) lineas.push(["Descripción", "la que tenía", desc.value.trim() ? "la que has escrito" : "sin descripción"]);
    cambios.hidden = !t0 || !t0.editable;
    cambios.replaceChildren(
      el("div", { class: "nt-vista-rot", text: n ? "Lo que va a cambiar en ProyectosTIC" : "Sin cambios todavía" }),
      ...lineas.map(([rot, antes, ahora]) => el("div", { class: "mt-cambio" },
        el("b", { text: rot }), el("s", { text: antes }), el("span", { class: "mt-flecha", "aria-hidden": "true", text: "→" }),
        el("span", { text: ahora }))));
    d.botones.guardar.disabled = !n || bloqueada;
    d.botones.abrir.hidden = !t0;
  }

  function ponerPadre(t) {
    padreSel = t ? { id: t.id, nombre: t.nombre } : null;
    padre.value = t ? `${t.id} - ${t.nombre}` : "";
    quitar.hidden = !t;
    pintar();
  }
  const listaPadre = buscadorTarea(padre, { alElegir: ponerPadre, fuente: () => ({
    titulo: "Tareas abiertas del proyecto", tareas: tareasProy, arbol: true,
    vacio: (q) => (q ? "Ninguna tarea abierta del proyecto con eso." : "No hay otras tareas abiertas en el proyecto.") }) });
  // lo escrito sin elegir no vale: o la elegida, o ninguna
  padre.addEventListener("blur", () => setTimeout(() => {
    if (!padre.value.trim()) ponerPadre(null);
    else padre.value = padreSel ? `${padreSel.id} - ${padreSel.nombre}` : "";
  }, 160));
  quitar.onclick = () => { ponerPadre(null); padre.focus(); };

  async function cargar(id) {
    const mio = ++seq;
    t0 = null; msg = ""; tareasProy = null; cargandoTarea = true;
    pintar();
    let r;
    try { r = await api().tarea_datos(id); }
    catch (e) { r = { error: `No se pudo leer la tarea (${(e && e.message) || "sin conexión"}).` }; }
    if (mio !== seq) return;
    cargandoTarea = false;
    if (r.error) { msg = r.error; pintar(); return; }
    t0 = r;
    tit.value = r.titulo || "";
    est0 = r.estimado ? fmtHoras(r.estimado) : "";
    est.value = est0;
    desc.value = r.descripcion || "";
    ponerPadre(r.padre);
    if (r.editable && r.proyecto?.id != null) {
      // de cuales puede colgar: las abiertas de su proyecto, menos ella y las suyas
      api().tareas_de_proyecto(String(r.proyecto.id)).then((x) => x.tareas || [], () => []).then((ts) => {
        if (mio !== seq) return;
        tareasProy = sinSuRama(ts, r.id);
        listaPadre.repintar();
      });
    } else {
      tareasProy = [];
    }
    if (r.editable && r.puede?.titulo !== false) tit.focus();
  }

  async function guardar() {
    const c = cambiosDe();
    if (!t0 || !Object.keys(c).length) return;
    if ("titulo" in c && !c.titulo) { msg = "Escribe el título de la tarea."; pintar(); tit.focus(); return; }
    if ("estimado" in c && c.estimado && !horasDeTexto(c.estimado)) {
      msg = "El tiempo estimado no vale: escribe las horas (ej. 1 o 1,5).";
      pintar(); est.focus(); return;
    }
    guardando = true; msg = "";
    d.botones.guardar.textContent = "Guardando…";
    pintar();
    let r;
    try { r = await llamar("tarea_modificar", { id: t0.id, version: t0.version, ...c }); }
    finally {
      guardando = false;
      d.botones.guardar.textContent = "Guardar cambios";
    }
    if (r.error) { msg = r.error; pintar(); return; }
    // si es la que hay en el formulario, que se vea con su nombre nuevo
    const enFormulario = tareaDelFormulario()?.id === t0.id;
    ponerTareas(r.tareas);
    if (enFormulario) $("tarea").value = textoDeTarea(t0.id) || `${r.tarea.id} - ${r.tarea.nombre}`;
    cerrarDeVerdad();
    avisoTarea(`Tarea ${r.tarea.id} modificada en ProyectosTIC: «${r.tarea.nombre}».`, r.tarea.id);
  }

  // Con cambios sin guardar, cerrar pregunta antes (Esc, la X o Cancelar).
  const cerrarDeVerdad = d.cerrar;
  let preguntando = false;
  d.cerrar = async () => {
    if (preguntando || guardando) return;
    if (Object.keys(cambiosDe()).length) {
      preguntando = true;
      const si = await preguntar("Modificar tarea", "Has cambiado la tarea y aún no lo has guardado.",
                                 { si: "Descartar los cambios", no: "Seguir aquí" });
      preguntando = false;
      if (!si) return;
    }
    cerrarDeVerdad();
  };

  buscadorTarea(cual, { alElegir: (t) => cargar(t.id), crear: false });
  for (const c of [tit, est, desc]) c.addEventListener("input", () => { msg = ""; pintar(); });
  for (const c of [tit, est]) c.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); d.botones.guardar.click(); } });
  desc.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); d.botones.guardar.click(); }
  });

  const campo = (rotulo, control, extra = null) => el("div", { class: "nt-campo" },
    el("div", { class: "nt-rot" }, el("span", { text: rotulo }), extra), control);
  campos.append(
    campo("Título", tit),
    el("div", { class: "nt-cuelga" },
      campo("Cuelga de", el("div", { class: "nt-padre" }, padre, quitar)),
      campo("Estimado", el("div", { class: "nt-est-caja" }, est, el("span", { class: "tenue", text: "h" })))),
    campo("Descripción", desc),
    cambios);
  d.cuerpo.append(el("div", { class: "nt" },
    el("p", { class: "nt-intro", text: "Cambia una tarea que ya existe en ProyectosTIC: su título, de cuál cuelga, el tiempo estimado o la descripción." }),
    campo("Tarea", cual), ficha, aviso, campos, error));
  pintar();
  if (tarea) {
    cual.value = `${tarea.id} - ${tarea.nombre}`;
    cargar(tarea.id);
  } else {
    cual.focus();
  }
}

// ================================================================ duplicar tarea

/* Duplicar una tarea con todas las que cuelgan de ella, en el mismo proyecto o
   en otro: el arbol de un año para el siguiente, el de un proyecto tipo... Con
   nombre nuevo y sin horas imputadas. ProyectosTIC no tiene una operacion para
   esto en su API: la app lee el arbol y crea las copias una a una, de arriba
   abajo, y lo va enseñando. Si una falla se para ahi (lo ya creado se queda) y
   se puede seguir desde esa. Antes de empezar se ve el arbol tal como quedara.
   tarea: {id, nombre} con la que se abre; sin ella, se elige arriba. */
function dlgDuplicarTarea({ tarea = null } = {}) {
  if (!puedeCrearTareas()) { dlgNuevaTarea(); return; }      // alli se explica por que no
  const d = dialogo({ titulo: "Duplicar tarea", ancho: 680, botones: [
    { texto: "Cancelar", id: "no", accion: (dd) => (marcha?.activo ? (marcha.parar = true, pintar()) : dd.cerrar()) },
    { texto: "Duplicar", clase: "primario", id: "ir", accion: duplicar }] });
  const cual = entrada("", { placeholder: "Busca la tarea por nombre o por número", "aria-label": "Tarea que se duplica" });
  const proy = el("select", { "aria-label": "Proyecto de destino" });
  const padre = entrada("", { placeholder: "Directamente en el proyecto", "aria-label": "Tarea de la que colgará la copia" });
  const quitar = el("button", { type: "button", class: "nt-quitar", title: "Que no cuelgue de ninguna",
                                "aria-label": "Que no cuelgue de ninguna", text: "×", hidden: true });
  const nombre = entrada("", { class: "nt-titulo", maxlength: "255", "aria-label": "Nombre de la copia" });
  const busca = entrada("", { placeholder: "ej. 2026", "aria-label": "Texto que se cambia en los títulos" });
  const pon = entrada("", { placeholder: "ej. 2027", "aria-label": "Texto que se pone en su lugar" });
  const conHijas = el("input", { type: "checkbox" });
  const conCerradas = el("input", { type: "checkbox" });
  conHijas.checked = true; conCerradas.checked = true;
  const rotHijas = el("span"), rotCerradas = el("span"), etiCerradas = el("label", { class: "check" }, conCerradas, " ", rotCerradas);
  const estadoPlan = el("div", { class: "mt-ficha tenue" });
  const arbol = el("div", { class: "dt-arbol", role: "tree", "aria-label": "Las tareas que se van a crear" });
  const cabArbol = el("div", { class: "nt-vista-rot" });
  const progreso = el("div", { class: "dt-progreso", hidden: true }, el("i"));
  const aviso = el("div", { class: "nt-aviso", role: "status", hidden: true });
  const error = el("div", { class: "nt-error", role: "alert", hidden: true });
  const campos = el("div", { class: "dt-campos", hidden: true });

  let plan = null;           // {raiz, tareas, proyecto}: el arbol de la tarea elegida (null: sin elegir, o cargando)
  let ops = null;            // tipos del proyecto de destino (null: preguntando)
  let faltan = new Map();    // tipo -> lo que ProyectosTIC pide de mas para ese tipo en el destino
  let comprobando = false;   // preguntando por los tipos del arbol
  let padreSel = null, tareasProy = null, nombreTocado = false, cargandoPlan = false;
  let marcha = null;         // al crear: {filas, hechas: Map(origen -> copia), ahora, fallo, parar, activo}
  let msg = "", seqPlan = 0, seqOps = 0;

  const proyectoSel = () => st.crear.proyectos.find((p) => String(p.id) === proy.value);
  const raiz = () => plan?.tareas.find((t) => t.id === plan.raiz) || null;
  const cambiar = (s) => (busca.value ? String(s).split(busca.value).join(pon.value) : String(s));
  const limpio = (s) => String(s || "").trim().replace(/\s+/g, " ");

  // El tipo que tendra en el destino: el suyo si alli existe; si no, el de por defecto.
  function tipoEnDestino(t) {
    if (!ops?.tipos?.length) return null;
    const suyo = ops.tipos.find((x) => x.id === t.tipo?.id);
    if (suyo) return suyo;
    return { ...(ops.tipos.find((x) => x.id === ops.tipo) || ops.tipos[0]), era: t.tipo?.nombre || "otro tipo" };
  }

  // Las que se van a crear, de arriba abajo: cada una con su nivel, su titulo y su tipo alli.
  function filas() {
    const r = raiz();
    if (!r) return [];
    const hijas = new Map();
    for (const t of plan.tareas) {
      if (t.id !== plan.raiz) hijas.set(t.padre_id, [...(hijas.get(t.padre_id) || []), t]);
    }
    const out = [];
    const bajar = (t, nivel) => {
      const fila = { t, nivel, titulo: nivel ? limpio(cambiar(t.nombre)) : limpio(nombre.value), tipo: tipoEnDestino(t), hoja: true };
      out.push(fila);
      if (!conHijas.checked || nivel > 20) return;
      for (const h of hijas.get(t.id) || []) {
        if (h.cerrada && !conCerradas.checked) continue;
        fila.hoja = false;
        bajar(h, nivel + 1);
      }
    };
    bajar(r, 0);
    return out;
  }

  function pintarArbol(fs) {
    arbol.replaceChildren(...fs.map((f) => {
      const hecha = marcha?.hechas.get(f.t.id);
      const fallo = marcha?.fallo?.id === f.t.id;
      const fila = el("div", { class: `dt-fila${hecha ? " hecha" : ""}${fallo ? " fallo" : ""}${marcha?.ahora === f.t.id ? " ahora" : ""}`,
                               role: "treeitem", "aria-level": String(f.nivel + 1) },
        f.nivel ? el("span", { class: "bt-codo", "aria-hidden": "true", text: "└" }) : null,
        f.tipo ? el("span", { class: `nt-sello${f.tipo.hito ? " hito" : ""}` }, el("i"), f.tipo.nombre) : null,
        el("span", { class: `dt-titulo${f.titulo ? "" : " vacio"}`, text: f.titulo || "Sin nombre" }),
        f.tipo?.era ? el("span", { class: "chip chip-permiso", text: `era ${f.tipo.era}`,
                                   title: `En el proyecto de destino no hay tipo «${f.tipo.era}»` }) : null,
        f.t.cerrada ? el("span", { class: "chip dt-cerrada", text: "cerrada en el origen", title: "La copia nace abierta" }) : null,
        hecha ? el("span", { class: "dt-marca", text: `✓ ${hecha.id}` })
          : fallo ? el("span", { class: "dt-marca", text: "✕ no creada" })
          : marcha?.ahora === f.t.id ? el("span", { class: "dt-marca", text: "creando…" }) : null);
      fila.style.setProperty("--nivel", String(Math.min(f.nivel, 8)));
      if (f.tipo?.color) fila.style.setProperty("--tipo", f.tipo.color);
      return fila;
    }));
    arbol.querySelector(".ahora, .fallo")?.scrollIntoView({ block: "nearest" });
  }

  function pintar() {
    const fs = marcha ? marcha.filas : filas();
    const r = raiz(), p = proyectoSel();
    const todas = plan ? plan.tareas.length - 1 : 0;
    const cerradas = plan ? plan.tareas.filter((t) => t.cerrada && t.id !== plan.raiz).length : 0;
    campos.hidden = !plan;
    campos.inert = !!marcha;
    campos.classList.toggle("en-marcha", !!marcha);
    cual.disabled = !!marcha;
    estadoPlan.hidden = !!plan;
    estadoPlan.textContent = cargandoPlan ? "Leyendo la tarea y las que cuelgan de ella…" : "Elige la tarea que quieres duplicar.";
    conHijas.disabled = !todas;
    rotHijas.textContent = !todas ? "No tiene tareas colgando: se copia ella sola"
      : `Con ${todas === 1 ? "la tarea que cuelga" : `las ${todas} tareas que cuelgan`} de ella`;
    etiCerradas.hidden = !cerradas || !conHijas.checked;
    rotCerradas.textContent = cerradas === 1 ? "También la que está cerrada" : `También las ${cerradas} que están cerradas`;
    cabArbol.textContent = `Así quedará en ${p ? `«${p.nombre}»` : "el proyecto"}${padreSel ? ` › ${padreSel.nombre}` : ""}`;
    pintarArbol(fs);

    // lo que impide duplicar o conviene saber antes
    const tiposQueFaltan = [...new Set(fs.filter((f) => f.tipo?.era).map((f) => f.tipo.era))];
    const pide = [...new Set(fs.map((f) => f.tipo?.id).filter((id) => faltan.get(id)?.length))];
    const avisos = [];
    if (tiposQueFaltan.length && ops?.tipos?.length) {
      const defecto = ops.tipos.find((x) => x.id === ops.tipo) || ops.tipos[0];
      avisos.push(el("div", { text: `En «${p?.nombre}» no hay tipo ${tiposQueFaltan.map((x) => `«${x}»`).join(", ")}: `
        + `esas tareas se crearán como «${defecto.nombre}».` }));
    }
    for (const id of pide) {
      const t = ops.tipos.find((x) => x.id === id);
      avisos.push(el("div", {}, el("b", { text: `ProyectosTIC pide algo más para las tareas de tipo «${t?.nombre}», y FichaCSIRC no lo rellena:` }),
        el("ul", {}, ...faltan.get(id).map((m) => el("li", { text: m }))),
        el("span", { text: "Así no se pueden duplicar aquí: hazlo en la web de ProyectosTIC." })));
    }
    aviso.hidden = !avisos.length || !!marcha;
    aviso.replaceChildren(...avisos);

    const texto = ops?.error || msg || (marcha?.fallo
      ? `Se han creado ${marcha.hechas.size} de ${marcha.filas.length}. «${marcha.fallo.titulo}» no se ha podido crear: ${marcha.fallo.error}`
      : "");
    error.hidden = !texto;
    error.replaceChildren(...[el("span", { text: texto }),
      ops?.error && !marcha ? el("button", { type: "button", class: "enlace", text: "Reintentar", onclick: cargarDestino }) : null].filter(Boolean));

    const n = fs.length, hechas = marcha ? marcha.hechas.size : 0;
    progreso.hidden = !marcha;
    progreso.firstChild.style.width = `${n ? Math.round((hechas / n) * 100) : 0}%`;
    const sinNombre = fs.some((f) => !f.titulo || f.titulo.length > 255);
    d.botones.ir.textContent = marcha?.activo ? `Creando ${Math.min(hechas + 1, n)} de ${n}…`
      : marcha ? `Seguir (${n - hechas} por crear)`
      : n > 1 ? `Duplicar las ${n} tareas` : "Duplicar la tarea";
    d.botones.ir.disabled = !!marcha?.activo || !plan || !ops || !!ops.error || comprobando || !!pide.length || sinNombre || !n;
    d.botones.no.textContent = marcha?.activo ? (marcha.parar ? "Parando…" : "Parar") : marcha ? "Cerrar" : "Cancelar";
    d.botones.no.disabled = !!marcha?.activo && marcha.parar;
  }

  function ponerPadre(t) {
    padreSel = t ? { id: t.id, nombre: t.nombre } : null;
    padre.value = t ? `${t.id} - ${t.nombre}` : "";
    quitar.hidden = !t;
    pintar();
  }
  const listaPadre = buscadorTarea(padre, { alElegir: ponerPadre, fuente: () => ({
    titulo: "Tareas abiertas del proyecto de destino", tareas: tareasProy, arbol: true,
    vacio: (q) => (q ? "Ninguna tarea abierta del proyecto con eso." : "Este proyecto no tiene tareas abiertas.") }) });
  padre.addEventListener("blur", () => setTimeout(() => {
    if (!padre.value.trim()) ponerPadre(null);
    else padre.value = padreSel ? `${padreSel.id} - ${padreSel.nombre}` : "";
  }, 160));
  quitar.onclick = () => { ponerPadre(null); padre.focus(); };

  // Los tipos del proyecto de destino y, para cada tipo del arbol, si ProyectosTIC
  // pide algo que la app no rellena (un campo propio obligatorio): asi no se empieza
  // un arbol que se quedaria a medias.
  async function cargarDestino() {
    const mio = ++seqOps, pid = proy.value;
    ops = null; faltan = new Map(); tareasProy = null; comprobando = true; msg = "";
    ponerPadre(null);
    api().tareas_de_proyecto(pid).then((x) => x.tareas || [], () => []).then((ts) => {
      if (mio !== seqOps) return;
      tareasProy = ts;
      listaPadre.repintar();
    });
    const pedir = async (tipo) => {
      try { return await api().nueva_tarea_opciones(pid, tipo); }
      catch (e) { return { error: `No se pudo preguntar a ProyectosTIC (${(e && e.message) || "sin conexión"}).` }; }
    };
    const r = await pedir(null);
    if (mio !== seqOps) return;
    ops = r.error ? { error: r.error, tipos: [] } : r;
    if (!r.error) faltan.set(r.tipo, r.faltan || []);
    pintar();
    await comprobarTipos(mio, pedir);
  }

  async function comprobarTipos(mio = seqOps, pedir = null) {
    if (!plan || !ops || ops.error) { comprobando = !ops; pintar(); return; }
    const pid = proy.value;
    pedir = pedir || (async (tipo) => {
      try { return await api().nueva_tarea_opciones(pid, tipo); }
      catch (e) { return { error: `No se pudo preguntar a ProyectosTIC (${(e && e.message) || "sin conexión"}).` }; }
    });
    comprobando = true;
    pintar();
    const usados = [...new Set(plan.tareas.map((t) => tipoEnDestino(t)?.id).filter((id) => id != null && !faltan.has(id)))];
    for (const id of usados) {
      const r = await pedir(id);
      if (mio !== seqOps) return;
      if (r.error) { msg = r.error; break; }
      faltan.set(id, r.faltan || []);
    }
    comprobando = false;
    pintar();
  }

  async function cargarPlan(id) {
    const mio = ++seqPlan;
    plan = null; msg = ""; cargandoPlan = true; nombreTocado = false;
    pintar();
    let r;
    try { r = await api().duplicar_plan(id); }
    catch (e) { r = { error: `No se pudo leer la tarea (${(e && e.message) || "sin conexión"}).` }; }
    if (mio !== seqPlan) return;
    cargandoPlan = false;
    if (r.error) { msg = r.error; pintar(); return; }
    plan = r;
    nombre.value = cambiar(raiz()?.nombre || "");
    pintar();
    nombre.focus();
    nombre.select();
    comprobarTipos();
  }

  async function duplicar() {
    if (!marcha) {
      const fs = filas(), n = fs.length, p = proyectoSel();
      if (!(await preguntar("Duplicar tarea",
          `Se ${n === 1 ? "va a crear 1 tarea nueva" : `van a crear ${n} tareas nuevas`} en «${p?.nombre}»${padreSel ? `, colgando de «${padreSel.nombre}»` : ""}.\n\n`
          + "Crearlas no se deshace desde FichaCSIRC: si te equivocas, hay que borrarlas en ProyectosTIC.",
          { si: n === 1 ? "Crear la tarea" : `Crear las ${n} tareas`, no: "Cancelar" }))) return;
      marcha = { filas: fs, hechas: new Map(), ahora: null, fallo: null, parar: false, activo: true,
                 proyecto: Number(proy.value), padre: padreSel ? padreSel.id : null, destino: p?.nombre || "" };
    } else {
      marcha.fallo = null; marcha.parar = false; marcha.activo = true;      // se sigue desde la que fallo
    }
    msg = "";
    for (const f of marcha.filas) {
      if (marcha.hechas.has(f.t.id)) continue;
      if (marcha.parar) break;
      marcha.ahora = f.t.id;
      pintar();
      let r;
      try {
        r = await api().duplicar_una({ origen: f.t.id, proyecto: marcha.proyecto, titulo: f.titulo,
          padre: f.nivel ? marcha.hechas.get(f.t.padre_id)?.id ?? null : marcha.padre,
          tipo: f.tipo ? f.tipo.id : null, estimado: f.hoja && !!f.t.estimado });
      } catch (e) {
        r = { error: `no se pudo hablar con ProyectosTIC (${(e && e.message) || "sin conexión"}). Mira allí si llegó a crearse.` };
      }
      if (r.error) { marcha.fallo = { id: f.t.id, titulo: f.titulo, error: r.error }; break; }
      marcha.hechas.set(f.t.id, r.tarea);
    }
    marcha.ahora = null; marcha.activo = false;
    if (marcha.hechas.size === marcha.filas.length) {
      const copia = marcha.hechas.get(plan.raiz), n = marcha.filas.length;
      cerrarDeVerdad();
      avisoTarea(n === 1 ? `Tarea ${copia.id} creada en «${marcha.destino}»: «${copia.nombre}».`
                         : `${n} tareas creadas en «${marcha.destino}», desde la ${copia.id} «${copia.nombre}».`, copia.id);
      return;
    }
    pintar();
  }

  // Mientras se crean no se cierra (para eso esta Parar); a medias, se dice lo que queda hecho.
  const cerrarDeVerdad = d.cerrar;
  d.cerrar = () => {
    if (marcha?.activo) return;
    cerrarDeVerdad();
    const copia = marcha?.hechas.get(plan?.raiz);
    if (copia) {
      avisoTarea(`Se han creado ${marcha.hechas.size} de ${marcha.filas.length} tareas en «${marcha.destino}», desde la ${copia.id}.`, copia.id);
    }
  };

  buscadorTarea(cual, { alElegir: (t) => cargarPlan(t.id), crear: false });
  proy.onchange = cargarDestino;
  nombre.addEventListener("input", () => { nombreTocado = true; pintar(); });
  // lo que se cambia en todos los titulos tambien vale para el de arriba, mientras no se haya escrito otro
  for (const c of [busca, pon]) c.addEventListener("input", () => {
    if (!nombreTocado && raiz()) nombre.value = cambiar(raiz().nombre);
    pintar();
  });
  conHijas.onchange = pintar;
  conCerradas.onchange = pintar;

  const campo = (rotulo, control, extra = null) => el("div", { class: "nt-campo" },
    el("div", { class: "nt-rot" }, el("span", { text: rotulo }), extra), control);
  const opcional = () => el("span", { class: "opc", text: "opcional" });
  campos.append(
    campo("Nombre de la copia", nombre),
    el("div", { class: "nt-dos" },
      campo("Proyecto de destino", proy),
      campo("Cuelga de", el("div", { class: "nt-padre" }, padre, quitar), opcional())),
    campo("Cambiar en todos los títulos", el("div", { class: "dt-cambiar" }, busca,
      el("span", { class: "mt-flecha", "aria-hidden": "true", text: "→" }), pon), opcional()),
    el("div", { class: "nt-opciones" }, el("label", { class: "check" }, conHijas, " ", rotHijas), etiCerradas),
    aviso,
    el("div", { class: "nt-vista dt-vista" }, cabArbol, arbol, progreso),
    el("p", { class: "dt-nota tenue", text: "Se copian el título, el tipo, la descripción, la prioridad y el tiempo estimado. "
      + "No se copian las horas imputadas, a quién está asignada, las fechas, los adjuntos ni las relaciones; "
      + "las copias nacen abiertas y sin avisos por correo." }));
  d.cuerpo.append(el("div", { class: "nt" },
    el("p", { class: "nt-intro", text: "Crea una copia de una tarea, con todas las que cuelgan de ella, en el mismo proyecto o en otro." }),
    campo("Tarea que se duplica", cual), estadoPlan, campos, error));

  const ps = st.crear.proyectos;
  proy.replaceChildren(...ps.map((p) => el("option", { value: String(p.id), text: p.nombre })));
  if (ps.some((p) => p.id === st.crear.ultimo)) proy.value = String(st.crear.ultimo);
  pintar();
  cargarDestino();
  if (tarea) {
    cual.value = `${tarea.id} - ${tarea.nombre}`;
    cargarPlan(tarea.id);
  } else {
    cual.focus();
  }
}

// ================================================================ copiar

// Destino: los dias marcados (desde Copiar / Plantillas) o el dia sobre el que
// se hizo clic derecho (menuDia), sin tener que marcarlo antes.
// origen: un dia concreto (pegar lo copiado con Ctrl+C); sin el, el ultimo con horas.
async function dlgCopiarDia(destino = null, origen = null) {
  const dias = destino || [...st.marcados];
  if (!dias.length) { await avisar("Falta día", "Marca al menos un día de destino."); return; }
  estado(origen ? "Preparando…" : "Buscando el último día con horas…");
  const r = await llamar("preparar_copia_dia", dias, origen);
  if (r.error || r.vacio) { estado(""); await avisar("Copiar día", r.error || r.vacio); actualizarTotales(); return; }
  if (!(await preguntar("Copiar día",
      `¿Copiar los ${r.n} apuntes del ${r.origen}:\n\n${r.lineas.map((l) => `  · ${l}`).join("\n")}`
      + `\n\na ${r.dias} día(s) marcado(s)?\n(Se saltan las tareas que ya tengan apunte ese día.)`))) {
    actualizarTotales(); return;
  }
  estado("Copiando…");
  await informarLote(await llamar("ejecutar_copia"), {
    hecho: (n) => `Copiados ${n} apuntes.`, nada: "No se copió nada: esas tareas ya estaban." });
}

async function dlgCopiarSemana() {
  estado("Leyendo la semana anterior…");
  const r = await llamar("preparar_copia_semana", lunesReferencia());
  if (r.vacio) { await avisar("Copiar semana", r.vacio); actualizarTotales(); return; }
  if (!(await preguntar("Copiar semana anterior",
      `¿Copiar los ${r.n} apuntes de la semana del ${r.origen} a esta semana, día a día?\n\n`
      + r.lineas.map((l) => `  · ${l}`).join("\n")
      + "\n\n(Se saltan tareas ya registradas y días no laborables.)"))) {
    actualizarTotales(); return;
  }
  estado("Copiando semana…");
  await informarLote(await llamar("ejecutar_copia"), {
    hecho: (n) => `Semana copiada: ${n} apuntes.`, nada: "No se copió nada: esas tareas ya estaban." });
}

// ================================================================ plantillas

// Pide un texto corto (el nombre de una plantilla). Una sola salida: botones,
// Enter, Esc y la × pasan por fin(). (Si la X/Esc resolvieran por su cuenta,
// ganaria siempre el "cancelado".)
function pedirTexto({ titulo, texto, etiqueta = "Nombre", valor = "", si = "Guardar" }) {
  return new Promise((resolver) => {
    const campo = entrada(valor, { class: "ancho" });
    let fin = () => {};
    const d = dialogo({ titulo, ancho: 440, botones: [
      { texto: "Cancelar", accion: () => fin(null) },
      { texto: si, clase: "primario", accion: () => fin(campo.value.trim()) }] });
    const cerrarDialogo = d.cerrar;
    let hecho = false;
    fin = (v) => {
      if (hecho) return;
      hecho = true;
      cerrarDialogo();
      resolver(v);
    };
    d.cerrar = () => fin(null);
    d.cuerpo.append(nota(texto), rejilla([etiqueta, campo]));
    campo.addEventListener("keydown", (e) => { if (e.key === "Enter") fin(campo.value.trim()); });
    campo.focus();
    campo.select();
  });
}

async function pedirNombrePlantilla(dia) {
  const total = fmtHoras(dia.apuntes.reduce((s, a) => s + a.horas, 0));
  return pedirTexto({ titulo: "Guardar como plantilla", valor: `Día tipo (${total}h)`,
                      texto: `Apuntes del ${dia.nombre} ${dia.fecha} (${dia.apuntes.length}):` });
}

async function dlgGuardarPlantillaDia(dia, alGuardar) {
  const nombre = await pedirNombrePlantilla(dia);
  if (!nombre) return;
  const r = await llamar("guardar_plantilla_dia", dia.iso, nombre);
  if (r.error) { await avisar("Plantilla", r.error); return; }
  estado(`Plantilla «${nombre}» guardada (${r.n} apuntes).`);
  alGuardar?.();
}

const fechaCorta = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}`;

// Plantillas de DIA (los apuntes de un dia tipico, para los dias marcados) y
// de SEMANA (lunes a viernes, cada dia con los suyos: el de guardia, el de
// teletrabajo..., para aplicarla entera a una semana).
function dlgPlantillas() {
  const lista = el("select", { size: "8", class: "lista" });
  const vacia = nota("Todavía no tienes plantillas.\n\nDe un día: marca el día con las horas que quieras "
    + "guardar y pulsa «Guardar día marcado». De una semana entera: «Guardar esta semana».");
  const d = dialogo({ titulo: "Plantillas de apuntes", ancho: 800, botones: [
    { texto: "Aplicar", clase: "primario", id: "aplicar", izquierda: true, accion: aplicar },
    { texto: "Guardar día marcado", izquierda: true, accion: guardarMarcado },
    { texto: "Guardar esta semana", id: "semana", izquierda: true, accion: guardarSemana },
    { texto: "Eliminar", clase: "peligro", id: "borrar", izquierda: true, accion: borrar },
    cerrarBoton] });
  d.cuerpo.append(nota("Una plantilla de día guarda los apuntes de un día típico, para aplicarlos a los días "
                       + "marcados. Una de semana (📅) guarda de lunes a viernes, cada día con los suyos."), lista, vacia);
  let datos = [];
  const lunes = () => lunesReferencia();
  const elegida = () => datos[lista.selectedIndex];
  const pintarBoton = () => {
    const p = elegida();
    d.botones.aplicar.textContent = !p ? "Aplicar" : p.semana ? `Aplicar a la semana del ${fechaCorta(lunes())}` : "Aplicar a días marcados";
  };
  const pintar = (ps) => {
    datos = ps;
    lista.replaceChildren(...ps.map((p, i) => el("option", { value: String(i),
      text: `${p.semana ? "📅 " : ""}${p.nombre}  (${p.semana ? "semana: " : ""}${p.n} apuntes, ${p.total})` })));
    lista.hidden = !ps.length;
    vacia.hidden = !!ps.length;
    d.botones.aplicar.disabled = d.botones.borrar.disabled = !ps.length;
    if (ps.length) lista.selectedIndex = 0;
    pintarBoton();
  };
  d.botones.semana.title = `La semana del ${fechaCorta(lunes())}, tal como está en ProyectosTIC`;
  llamar("plantillas").then(pintar);
  lista.addEventListener("change", pintarBoton);
  lista.addEventListener("dblclick", () => aplicar(d));

  async function aplicar(dd) {
    const p = elegida();
    if (!p) return;
    if (p.semana) {
      if (!(await preguntar("Plantilla de semana",
          `¿Aplicar «${p.nombre}» (${p.n} apuntes, ${p.total}) a la semana del ${fechaCorta(lunes())}?\n`
          + "Cada día recibe los suyos. Se saltan los días no laborables y las tareas que ya tengan apunte ese día."))) return;
      dd.cerrar();
      estado("Aplicando plantilla de semana…");
      await informarLote(await llamar("aplicar_plantilla_semana", p.nombre, lunes()), {
        hecho: (n) => `Plantilla de semana aplicada: ${n} apuntes.`, nada: "No se añadió nada: esas tareas ya estaban." });
      return;
    }
    const dias = [...st.marcados].sort();
    if (!dias.length) { await avisar("Plantilla", "Marca al menos un día de destino."); return; }
    if (!(await preguntar("Plantilla", `¿Aplicar «${p.nombre}» (${p.n} apuntes) a ${dias.length} día(s)?\n`
                          + "(Se saltan las tareas que ya tengan apunte ese día.)"))) return;
    dd.cerrar();
    estado("Aplicando plantilla…");
    await informarLote(await llamar("aplicar_plantilla", p.nombre, dias), {
      hecho: (n) => `Plantilla aplicada: ${n} apuntes.`, nada: "No se añadió nada: esas tareas ya estaban." });
  }
  async function guardarMarcado() {
    const marcados = diasMarcados();
    if (marcados.length !== 1) { await avisar("Plantilla", "Marca exactamente un día (el que quieres guardar)."); return; }
    if (!marcados[0].apuntes.length) { await avisar("Plantilla", "Ese día no tiene apuntes que guardar."); return; }
    await dlgGuardarPlantillaDia(marcados[0], () => llamar("plantillas").then(pintar));
  }
  async function guardarSemana() {
    const l = lunes();
    const nombre = await pedirTexto({ titulo: "Guardar la semana como plantilla", valor: "Semana tipo",
      texto: `La semana del ${fechaCorta(l)} (lunes a viernes), cada día con sus apuntes de ProyectosTIC:` });
    if (!nombre) return;
    const r = await llamar("guardar_plantilla_semana", l, nombre);
    if (r.error) { await avisar("Plantilla de semana", r.error); return; }
    estado(`Plantilla de semana «${nombre}» guardada (${r.n} apuntes, ${r.total}).`);
    pintar(await llamar("plantillas"));
  }
  async function borrar() {
    const p = elegida();
    if (p && await preguntar("Plantilla", `¿Eliminar la plantilla «${p.nombre}»?`)) {
      pintar(await llamar("eliminar_plantilla", p.nombre));
    }
  }
}

// ================================================================ eliminar del dia

function dlgEliminarDia(dia) {
  const marcas = dia.apuntes.map((a) => {
    const c = el("input", { type: "checkbox" });
    const texto = `${a.horas_txt}  ·  ${a.tarea}${a.actividad ? `  ·  ${a.actividad}` : ""}`
                  + (a.comentario ? `  ·  «${a.comentario}»` : "");
    return { c, a, fila: el("label", { class: "check bloque" }, c, ` ${texto}`) };
  });
  const todos = el("input", { type: "checkbox", onchange: () => marcas.forEach((m) => { m.c.checked = todos.checked; }) });
  const d = dialogo({ titulo: "Eliminar apuntes del día", ancho: 600, botones: [cancelarBoton,
    { texto: "Eliminar marcados", clase: "peligro", accion: async (dd) => {
      const elegidos = marcas.filter((m) => m.c.checked);
      if (!elegidos.length) { await avisar("Eliminar apuntes", "No has marcado ningún apunte."); return; }
      dd.cerrar();
      await borrarItems(elegidos.map((m) => ({ fecha: dia.iso, id: m.a.id, destino: m.a.destino })));
    } }] });
  d.cuerpo.append(el("p", { class: "dlg-sub", text: `${dia.nombre} ${dia.fecha}` }),
                  nota("Marca lo que quieras eliminar (se puede deshacer):"),
                  ...marcas.map((m) => m.fila), el("hr"),
                  el("label", { class: "check" }, todos, ` Todos (${marcas.length})`));
}

// ================================================================ resumen del mes


// ================================================================ exportar

function dlgExportar() {
  const hoy = new Date();
  const iso = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
  const desde = entrada(iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), { type: "date" });
  const hasta = entrada(iso(hoy), { type: "date" });
  const info = nota("Se guarda con «;» y coma decimal, para abrirlo con Excel.");
  const d = dialogo({ titulo: "Exportar a CSV", ancho: 420, botones: [cancelarBoton,
    { texto: "Exportar…", clase: "primario", accion: async (dd) => {
      info.textContent = "Consultando…";
      const r = await llamar("exportar_csv", desde.value, hasta.value);
      if (r.cancelado) { info.textContent = "Cancelado."; return; }
      if (r.error) { info.textContent = ""; await avisar("Exportar", r.error); return; }
      dd.cerrar();
      estado(`Exportados ${r.n} apuntes (${r.total}) a ${r.ruta}`);
      if (await preguntar("Exportado", `${r.n} apuntes (${r.total}) exportados a:\n${r.ruta}\n\n¿Abrir el archivo ahora?`)) {
        await llamar("abrir_exportacion");
      }
    } }] });
  d.cuerpo.append(rejilla(["Desde", desde], ["Hasta", hasta]), info);
  desde.focus();
}

// ================================================================ festivos

function dlgFestivos() {
  const cajas = { nacional: true, andalucia: true, local: true, ugr: true };
  const etiquetas = { nacional: "Nacionales", andalucia: "Andalucía", local: "Locales (Granada capital)",
                      ugr: "Días propios UGR (Navidad, Semana Santa, San Pascual…)" };
  const marcas = {};
  const excluidos = new Set();          // dias UGR propuestos que el usuario desmarca
  const lista = el("div", { class: "lista-festivos" });
  const d = dialogo({ titulo: "Importar festivos", ancho: 560, botones: [cerrarBoton,
    { texto: "Importar", clase: "primario", id: "importar", accion: async (dd) => {
      const r = await llamar("importar_festivos", ...Object.keys(cajas).map((k) => marcas[k].checked), [...excluidos]);
      dd.cerrar();
      await repintarLocal();
      if (r.n) estado(`${r.n} festivos marcados.`);
    } }] });
  d.cuerpo.append(el("p", { class: "dlg-sub", text: "Marca como no laborables los festivos de:" }));
  for (const k of Object.keys(cajas)) {
    marcas[k] = el("input", { type: "checkbox", checked: true, onchange: recalc });
    d.cuerpo.append(el("label", { class: "check bloque" }, marcas[k], ` ${etiquetas[k]}`));
  }
  // Dia propio de la UGR que la propuesta no trae: fecha + nombre, a mano.
  const fecha = el("input", { type: "date", "aria-label": "Fecha" });
  const nombre = entrada("", { placeholder: "Nombre (p. ej. Cierre por obras)", class: "crece" });
  const anadir = el("button", { text: "Añadir", onclick: async () => {
    const r = await llamar("anadir_dia_ugr", fecha.value, nombre.value);
    if (r.error) { await avisar("Día propio UGR", r.error); return; }
    fecha.value = ""; nombre.value = "";
    recalc();
  } });
  d.cuerpo.append(lista,
    nota("Los días propios de la UGR son una PROPUESTA calculada (cierre de Navidad, lunes a miércoles "
         + "santo, San Pascual Bailón, viernes de la Feria del Corpus): compáralos con el calendario laboral "
         + "del PTGAS y desmarca los que no coincidan.", "ambar"),
    el("div", { class: "fila" }, el("span", { class: "tenue", text: "Otro día UGR:" }), fecha, nombre, anadir),
    nota("Los festivos en domingo se estiman trasladados al lunes; revísalos: el "
    + "traslado real lo decide la Junta cada año. Cualquiera se quita con botón derecho sobre su día."));
  async function recalc() {
    const pend = await llamar("festivos", ...Object.keys(cajas).map((k) => marcas[k].checked));
    const activos = pend.filter((f) => !excluidos.has(f.iso));
    lista.replaceChildren(pend.length
      ? el("p", { text: `Se marcarán ${activos.length} días:` })
      : el("p", { class: "tenue", text: "No hay festivos nuevos que marcar con esta selección." }),
      ...pend.map((f) => {
        const c = f.ugr ? el("input", { type: "checkbox", title: "Desmarca si no está en el calendario laboral" }) : null;
        if (c) { c.checked = !excluidos.has(f.iso); c.onchange = () => { if (c.checked) excluidos.delete(f.iso); else excluidos.add(f.iso); recalc(); }; }
        return el("label", { class: `festivo${f.ugr ? " ugr" : ""}${excluidos.has(f.iso) ? " excluido" : ""}` },
          c || el("span", { class: "hueco" }), el("span", { class: "num", text: f.fecha }), el("span", { text: f.nombre }));
      }));
    d.botones.importar.disabled = !activos.length;
  }
  recalc();
}

// ================================================================ vacaciones y teletrabajo

async function dlgAjustesDias() {
  const a = await llamar("ajustes_dias");
  const cupo = entrada(a.cupo, { type: "number", min: "0", max: "60", class: "horas" });
  const tt = entrada(a.tt, { type: "number", min: "0", max: "5", class: "horas" });
  const d = dialogo({ titulo: "Vacaciones y teletrabajo", ancho: 460, botones: [cancelarBoton,
    { texto: "Guardar", clase: "primario", accion: async (dd) => {
      const r = await llamar("guardar_ajustes_dias", cupo.value, tt.value);
      if (r.error) { await avisar("Valores", r.error); return; }
      dd.cerrar();
      await repintarLocal();
    } }] });
  d.cuerpo.append(
    el("h4", { text: "Vacaciones" }),
    rejilla([`Días de vacaciones al año (${a.anio})`, cupo]),
    nota(`Ya usados este año: ${a.usadas}. Fijos: 22, +1 a los 15/20/25/30 años. `
         + "Interinos: los que te corresponden por prorrateo (RRHH)."),
    el("h4", { text: "Teletrabajo" }),
    rejilla(["Días de teletrabajo por semana", tt]),
    nota("0 = no llevar la cuenta."));
  primero(d);
}

// ================================================================ permisos

const SIN_ACTIVIDAD = "— solo se marca en el día —";

function dlgPermisos() {
  const info = nota("");
  const cuerpo = el("div");
  const d = dialogo({ titulo: "Permisos (horas)", ancho: 660, botones: [
    { texto: `Añadir los permisos de ${new Date().getFullYear()}…`, izquierda: true,
      accion: () => dlgPermisosAnio({ manual: true, alTerminar: () => llamar("permisos").then(pintar) }) },
    cerrarBoton] });
  const cabecera = nota("");
  const destinos = el("div");
  d.cuerpo.append(cabecera, info, cuerpo, destinos);

  // Donde imputa ESTE usuario lo que se marca en local: al marcarlo, la app
  // ofrece esa tarea (sin elegir, la deduce por el nombre).
  function pintarDestinos(filas) {
    const caja = el("fieldset", { class: "permiso" }, el("legend", { text: "¿Dónde se imputa en ProyectosTIC?" }),
      nota("Lo que marcas «(local)» no se envía a ProyectosTIC. Si en tu servicio se imputa en "
           + "una tarea, elígela aquí: al marcarlo, la app te ofrecerá imputarlo en ella. "
           + "«La busca la app» la deduce por el nombre; «Ninguna» deja de ofrecerla."));
    for (const f of filas) {
      const modo = selector([{ valor: "auto", texto: "La busca la app" }, { valor: "tarea", texto: "Esta tarea:" },
                             { valor: "ninguna", texto: "Ninguna" }], f.modo);
      const tarea = entrada(f.id ? `${f.id} - ${f.nombre}` : "",
                            { placeholder: "Busca por nombre o número de tarea", class: "crece tarea-local" });
      tarea.hidden = f.modo !== "tarea";
      buscadorTarea(tarea, { alElegir: async (t) => {
        const r = await llamar("fijar_tarea_local", f.motivo, "tarea", t.id, t.nombre);
        if (r.error) { await avisar("Permisos", r.error); return; }
        estado(`${f.titulo}: se ofrecerá «${t.nombre}».`);
        pintarDestinos(r.filas);
        llamar("permisos").then(pintar).catch(() => {});      // sus actividades, al desplegable
      } });
      modo.addEventListener("change", async () => {
        if (modo.value === "tarea") { tarea.hidden = false; tarea.focus(); return; }   // se guarda al elegirla
        tarea.hidden = true;
        pintarDestinos((await llamar("fijar_tarea_local", f.motivo, modo.value)).filas);
      });
      caja.append(el("div", { class: "fila tarea-local-fila" },
        el("span", { class: "tarea-local-titulo", text: f.titulo }), modo, tarea));
    }
    destinos.replaceChildren(caja);
  }
  llamar("tareas_local").then(pintarDestinos).catch(() => {});

  function pintar(p) {
    cabecera.textContent = `Saldo desde el ${p.desde}: lo que no usas se arrastra y las horas de cada año `
                           + "se suman a lo que te queda. Las usadas se calculan solas.";
    // Desplegable (antes un campo con autocompletado: con "— solo se marca…"
    // escrito solo enseñaba esa opcion). Actividades de verdad: las del
    // Python y las de tus tareas habituales, sin repetir.
    const vistas = new Map();
    for (const a of [...p.actividades, ...(st.habituales?.filas || []).map((h) => h.actividad)]) {
      if (a && !vistas.has(a.toLowerCase())) vistas.set(a.toLowerCase(), a);
    }
    const actividades = [...vistas.values()].sort((x, y) => x.localeCompare(y, "es"));
    cuerpo.replaceChildren(...p.filas.map((f) => {
      const caja = el("fieldset", { class: "permiso" }, el("legend", { text: f.nombre }));
      caja.append(el("div", { class: "fila cifras-permiso" },
        el("span", { text: `Concedidas ${f.concedidas}` }),
        el("span", { class: "tenue", text: `Usadas ${f.usadas}` }),
        el("span", { class: f.negativo ? "rojo" : "verde", text: `Te quedan ${f.disponibles}` })));
      if (f.actividad) {
        caja.append(nota(`${f.usadas_local} marcadas en el día · ${f.usadas_pt} imputadas en `
                         + `ProyectosTic como «${f.actividad}»`));
      }
      f.concesiones.forEach((c, i) => {
        const txt = c.estado === "caducada" ? `⚠ caducada el ${c.fecha_limite}`
                  : c.estado === "por_caducar" ? `⏳ caduca pronto (${c.fecha_limite})`
                  : c.fecha_limite ? `caduca ${c.fecha_limite}` : "sin caducidad";
        caja.append(el("div", { class: "concesion" },
          el("span", { class: "num", text: c.horas }),
          el("span", { class: c.estado === "caducada" ? "rojo" : c.estado ? "ambar" : "tenue", text: txt }),
          el("button", { text: "Quitar", onclick: async () => {
            if (await preguntar("Quitar concesión", "¿Seguro que quieres quitar esta concesión?")) {
              pintar(await llamar("quitar_concesion", f.id, i));
              await repintarLocal();
            }
          } })));
      });
      const opciones = [{ valor: "", texto: SIN_ACTIVIDAD }, ...actividades.map((a) => ({ valor: a, texto: a }))];
      if (f.actividad && !vistas.has(f.actividad.toLowerCase())) opciones.push({ valor: f.actividad, texto: f.actividad });
      const act = selector(opciones, f.actividad || "");
      act.classList.add("actividad-permiso");
      act.addEventListener("change", async () => {
        const nueva = act.value;
        if (nueva === (f.actividad || "")) return;
        pintar(await llamar("fijar_actividad_permiso", f.id, nueva));
        if (nueva) leerPt();
      });
      caja.append(el("div", { class: "fila pie-permiso" },
        el("button", { text: "＋ Añadir concesión", onclick: () => pedirConcesion(f) }),
        el("span", { class: "crece" }),
        el("span", { class: "tenue", text: "Se imputa como actividad:" }), act));
      return caja;
    }));
    return p;
  }
  async function leerPt() {
    info.textContent = "Consultando las horas imputadas en ProyectosTic…";
    try {
      pintar(await api().actualizar_usadas_pt());
      info.textContent = "";
      await repintarLocal();
    } catch (e) {
      info.textContent = `No se pudieron leer las horas imputadas en ProyectosTic (${e.message || e}); `
                         + "se muestra la última lectura.";
    }
  }
  function pedirConcesion(f) {
    const horas = entrada("", { class: "horas", placeholder: "28:00" });
    const fecha = entrada("", { type: "date" });
    const dd = dialogo({ titulo: "Añadir concesión", ancho: 420, botones: [cancelarBoton,
      { texto: "Añadir", clase: "primario", accion: async (x) => {
        const r = await llamar("anadir_concesion", f.id, horas.value, fecha.value);
        if (r.error) { await avisar("No se pudo añadir", r.error); return; }
        x.cerrar();
        pintar(r);
        await repintarLocal();
      } }] });
    dd.cuerpo.append(el("p", { class: "dlg-sub", text: f.nombre }),
      rejilla(["Horas concedidas (H:MM)", horas], ["Fecha límite", fecha]),
      nota("Déjala vacía si no caduca."));
    horas.focus();
  }
  llamar("permisos").then((p) => { pintar(p); if (p.hay_actividades) leerPt(); });
}

async function dlgPermisoDia(dia, { alGuardar = null } = {}) {
  let inf = await llamar("info_permiso_dia", dia.iso);
  if (inf.lleno) {
    await avisar("Permisos", `Ese día ya tiene ${inf.ya} de permiso, que cubren toda la jornada (${inf.jornada}).`);
    return;
  }
  const tipo = selector(inf.tipos.map((t) => ({ valor: t.id, texto: t.nombre })));
  const horas = entrada("", { class: "horas", placeholder: "3:00" });
  const info = el("p", { class: "nota tenue" });
  const d = dialogo({ titulo: "Añadir permiso por horas", ancho: 520, botones: [cancelarBoton,
    { texto: "Añadir", clase: "primario", accion: guardar }] });
  d.cuerpo.append(el("p", { class: "dlg-sub", text: inf.dia }),
    rejilla(["Tipo", tipo],
            ["Horas (H:MM)", el("div", { class: "fila" }, horas,
              el("button", { text: `Día completo (${inf.dia_entero})`,
                             onclick: () => { horas.value = inf.dia_completo; horas.focus(); } }))]),
    info);
  const refrescar = () => {
    const t = inf.tipos.find((x) => x.id === tipo.value);
    if (!t) return;
    let txt = `Te quedan: ${t.disponible}   ·   Máximo hoy: ${inf.libre}   ·   día completo = ${inf.dia_entero}`;
    if (inf.distintas) txt += `\n(fichas ${inf.jornada} al día; un día de permiso cuenta como ${inf.dia_entero})`;
    if (t.actividad) txt += `\nℹ En tu servicio este permiso se imputa en ProyectosTic con la actividad `
                          + `«${t.actividad}». Si lo imputas allí, no lo marques también aquí o contará dos veces.`;
    if (t.caducadas) txt += `\n⚠ Tienes ${t.caducadas} concesión(es) caducada(s) de este permiso (siguen sumando; `
                          + "revísalas en Herramientas > Permisos).";
    else if (t.caduca) txt += `\n⏳ Una concesión de este permiso caduca el ${t.caduca}.`;
    info.textContent = txt;
    info.className = `nota ${t.caducadas || t.caduca ? "ambar" : "tenue"}`;
  };
  tipo.addEventListener("change", refrescar);
  horas.addEventListener("keydown", (e) => { if (e.key === "Enter") guardar(d); });
  refrescar();
  horas.focus();
  // Si algun permiso se imputa como actividad, el saldo depende de la red:
  // se pinta ya y se corrige al llegar la lectura nueva.
  if (inf.tipos.some((t) => t.actividad)) {
    api().actualizar_usadas_pt().then(() => llamar("info_permiso_dia", dia.iso))
      .then((nuevo) => { inf = nuevo; if (pila.includes(d)) refrescar(); }).catch(() => {});
  }
  async function guardar(dd) {
    let r = await llamar("anadir_permiso", dia.iso, tipo.value, horas.value, false);
    if (r.confirmar) {
      if (!(await preguntar("Sin cupo suficiente", r.confirmar))) return;
      r = await llamar("anadir_permiso", dia.iso, tipo.value, horas.value, true);
    }
    if (r.error) { await avisar("No se pudo añadir", r.error); return; }
    dd.cerrar();
    await repintarLocal();
    estado(`Permiso añadido: ${r.horas}.`);
    alGuardar?.();
  }
}

async function dlgPermisosAnio({ manual = false, alTerminar = null } = {}) {
  const p = await llamar("propuesta_permisos_anio");
  const filas = p.filas.map((f) => ({ f,
    horas: entrada(f.horas, { class: "horas", placeholder: "—" }),
    fecha: entrada(f.fecha_limite, { type: "date" }) }));
  const terminar = async (dd, texto) => {
    dd.cerrar();
    alTerminar?.();
    await repintarLocal();        // primero: repintar reescribe la barra de estado
    if (texto) estado(texto);
  };
  const botones = manual
    ? [cancelarBoton]
    : [{ texto: "Más tarde", accion: (dd) => dd.cerrar() },
       { texto: "No este año", accion: async (dd) => { await llamar("permisos_anio_no"); await terminar(dd, ""); } }];
  botones.push({ texto: "Añadir", clase: "primario", accion: async (dd) => {
    const r = await llamar("anadir_permisos_anio", filas.map(({ f, horas, fecha }) =>
      ({ id: f.id, nombre: f.nombre, horas: horas.value, fecha_limite: fecha.value })));
    if (r.error) { await avisar("Revisa los datos", r.error); return; }
    await terminar(dd, r.n ? `Permisos de ${p.anio} añadidos (${r.n}).` : "No se ha añadido ningún permiso.");
  } });
  const d = dialogo({ titulo: `Permisos de ${p.anio}`, ancho: 640, botones });
  const tabla = el("table", { class: "tabla-dlg" },
    el("thead", {}, el("tr", {}, ...["Permiso", "Te quedan", "Horas a añadir", "Fecha límite"].map((t) => el("th", { text: t })))),
    el("tbody", {}, ...filas.map(({ f, horas, fecha }) => el("tr", {},
      el("td", { text: f.nombre }), el("td", { class: "num", text: f.quedan }),
      el("td", {}, horas), el("td", {}, fecha)))));
  d.cuerpo.append(
    el("p", { class: "dlg-sub", text: manual ? "Añadir los permisos de este año"
                                             : `Empieza ${p.anio}: ¿añades tus permisos de este año?` }),
    nota("Las horas que añadas se suman a las que te quedan. Deja en blanco los permisos que no te correspondan."),
    tabla);
  primero(d);
}

// ================================================================ INARI

async function dlgInari() {
  const c = await llamar("inari_config");
  const activo = el("input", { type: "checkbox", checked: c.activo });
  const url = entrada(c.url, { class: "ancho" });
  const usuario = entrada(c.usuario, { class: "ancho" });
  const token = entrada("", { type: "password", class: "ancho",
                              placeholder: c.hay_token ? "(guardado; escríbelo solo para cambiarlo)" : "" });
  const sel = { proyecto: el("select"), columna: el("select"), carril: el("select"), categoria: el("select") };
  const msg = nota("");
  const poner = (s, items, elegido) => {
    s.replaceChildren(...items.map((i) => el("option", { value: String(i.id), text: `${i.id} - ${i.nombre}` })));
    if (items.some((i) => String(i.id) === String(elegido))) s.value = String(elegido);
  };
  const valor = (s) => (s.value ? Number(s.value) : null);
  const d = dialogo({ titulo: "Integraciones · INARI", ancho: 580, botones: [
    { texto: "Probar conexión", izquierda: true, accion: probar }, cancelarBoton,
    { texto: "Guardar", clase: "primario", accion: async (dd) => {
      await llamar("inari_guardar", activo.checked, url.value, usuario.value, token.value,
                   valor(sel.proyecto), valor(sel.columna), valor(sel.carril), valor(sel.categoria));
      dd.cerrar();
      estado("Configuración de INARI guardada. Se aplica al volver a abrir la app.");
    } }] });
  d.cuerpo.append(
    el("p", { class: "dlg-sub", text: "INARI (registro de días de teletrabajo en SisGes)" }),
    el("label", { class: "check bloque" }, activo, " Activar la integración con INARI"),
    rejilla(["URL jsonrpc", url], ["Usuario", usuario], ["Token", token]),
    nota("Puedes pegar «usuario:token» en el campo Usuario."), msg,
    rejilla(["Proyecto", sel.proyecto], ["Columna (por defecto)", sel.columna],
            ["Carril (por defecto)", sel.carril], ["Categoría (por defecto)", sel.categoria]),
    nota("Columna, carril y categoría son solo el valor inicial: al registrar cada slot puedes cambiarlos."));
  sel.proyecto.onchange = tablero;
  async function probar() {
    msg.textContent = "Probando conexión…";
    msg.className = "nota tenue";
    try {
      const r = await api().inari_probar(url.value, usuario.value, token.value);
      if (r.error) { msg.textContent = r.error; msg.className = "nota ambar"; return; }
      // Los campos se dejan tal cual: si se pego "usuario:token" en Usuario,
      // Guardar lo vuelve a separar en Python (el token nunca vuelve al JS).
      msg.textContent = `Conexión correcta. Hola, ${r.nombre}.`;
      msg.className = "nota verde";
      poner(sel.proyecto, r.proyectos, c.proyecto);
      await tablero();
    } catch (e) {
      msg.textContent = e.message || String(e);
      msg.className = "nota rojo";
    }
  }
  async function tablero() {
    if (!sel.proyecto.value) return;
    const t = await llamar("inari_tablero", url.value, usuario.value, token.value, sel.proyecto.value);
    poner(sel.columna, t.columnas, c.columna);
    poner(sel.carril, t.carriles, c.carril);
    poner(sel.categoria, t.categorias, c.categoria);
  }
  if (c.usuario && c.hay_token) probar();
}

async function dlgSlotInari(dia) {
  const ini = entrada("", { type: "time" });
  const fin = entrada("", { type: "time" });
  const dur = el("span", { class: "tenue" });
  const desc = entrada("", { class: "ancho" });
  const sel = { columna: el("select"), carril: el("select"), categoria: el("select") };
  const msg = nota("Cargando opciones del tablero…");
  const d = dialogo({ titulo: "Registrar slot en INARI", ancho: 520, botones: [cancelarBoton,
    { texto: "Registrar", clase: "primario", accion: registrar }] });
  d.cuerpo.append(el("p", { class: "dlg-sub", text: `${dia.nombre} ${dia.fecha} · teletrabajo` }),
    rejilla(["Inicio", ini], ["Fin", el("div", { class: "fila" }, fin, dur)], ["Descripción", desc],
            ["Columna", sel.columna], ["Carril", sel.carril], ["Categoría", sel.categoria]), msg);
  const calc = async () => {
    const h = await llamar("duracion", ini.value, fin.value);
    dur.textContent = h ? `= ${h}` : "";
  };
  ini.addEventListener("change", calc);
  fin.addEventListener("change", calc);
  desc.addEventListener("keydown", (e) => { if (e.key === "Enter") registrar(d); });
  ini.focus();
  try {
    const o = await api().inari_opciones_slot();
    for (const [k, items] of [["columna", o.columnas], ["carril", o.carriles], ["categoria", o.categorias]]) {
      sel[k].replaceChildren(...(items || []).map((i) => el("option", { value: String(i.id), text: i.nombre })));
      if ((items || []).some((i) => String(i.id) === String(o.pref[k]))) sel[k].value = String(o.pref[k]);
    }
    msg.textContent = "";
  } catch (e) {
    Object.values(sel).forEach((s) => { s.disabled = true; });
    msg.textContent = `No se pudieron cargar las opciones; se usarán los valores por defecto. ${e.message || e}`;
    msg.className = "nota ambar";
  }
  async function registrar(dd) {
    const v = (s) => (s.disabled || !s.value ? null : Number(s.value));
    msg.textContent = "Registrando en INARI…";
    const r = await llamar("inari_registrar", dia.iso, ini.value, fin.value, desc.value.trim(),
                           v(sel.columna), v(sel.carril), v(sel.categoria));
    if (r.error) { msg.textContent = ""; await avisar("Franja no válida", r.error); return; }
    dd.cerrar();
    await cargarSemana();
    estado("Slot registrado en INARI.");
  }
}

// ================================================================ ayuda

// "3.1.0" > "3.0.2": compara numero a numero
function versionMayor(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

/* tras = {desde}: se abre sola despues de actualizar y ensena solo lo nuevo
   desde la version que se tenia (sin 'desde', solo la ultima version). */
async function dlgNovedades(tras = null) {
  // NOVEDADES.md es el mismo para la app de Python (3.x) y la de Rust (4.x):
  // lo de una version posterior a la que se ejecuta no se enseña.
  const mia = st.ini?.version || "";
  let deVersion = null;
  const bloques = (await llamar("novedades")).filter((b) => {
    if (b.estilo === "version") deVersion = b.texto.replace(/^Versión\s+/, "");
    return !(mia && deVersion && versionMayor(deVersion, mia));
  });
  let visibles = bloques;
  if (tras) {
    let version = null, versiones = 0;
    visibles = bloques.filter((b) => {
      if (b.estilo === "version") { version = b.texto.replace(/^Versión\s+/, ""); versiones++; }
      return tras.desde ? version && versionMayor(version, tras.desde) : versiones === 1;
    });
    if (!visibles.length) return;
  }
  const caja = el("div", { class: "novedades" });
  for (const b of visibles) {
    caja.append(el(b.estilo === "version" ? "h4" : "p", { class: b.estilo,
      text: b.estilo === "punto" ? `•  ${b.texto}` : b.texto }));
  }
  const botones = [cerrarBoton];
  if (tras) {
    botones.unshift({ texto: "Ver todas las versiones", izquierda: true,
                      accion: (d) => { d.cerrar(); dlgNovedades(); } });
  } else if (st.ini?.github) {
    botones.unshift({ texto: "Ver todo en GitHub", izquierda: true,
                      accion: () => llamar("abrir_github", "releases") });
  }
  const version = st.ini?.version || "?";
  const d = dialogo({ titulo: tras ? `FichaCSIRC se ha actualizado a la ${version}`
                                   : `Novedades · FichaCSIRC ${version}`, ancho: 680, botones });
  d.cuerpo.append(nota(tras ? "Esto es lo nuevo. Lo tienes siempre en Ayuda → Novedades."
                            : `Tienes la versión ${version}.`), caja);
}

// Ayuda > Tecnologia utilizada: TECNOLOGIA.md, pintado igual que Novedades.
async function dlgTecnologia() {
  const bloques = await llamar("tecnologia");
  const caja = el("div", { class: "novedades" });
  for (const b of bloques) {
    caja.append(el(b.estilo === "version" ? "h4" : "p", { class: b.estilo,
      text: b.estilo === "punto" ? `•  ${b.texto}` : b.texto }));
  }
  const botones = [cerrarBoton];
  if (st.ini?.github) botones.unshift({ texto: "Ver el código en GitHub", izquierda: true,
                                         accion: () => llamar("abrir_github", "") });
  const d = dialogo({ titulo: "Tecnología utilizada", ancho: 680, botones });
  d.cuerpo.append(caja);
}

function dlgAcerca() {
  const d = dialogo({ titulo: "Acerca de FichaCSIRC", ancho: 420, botones: [cerrarBoton] });
  d.cuerpo.append(
    el("p", { class: "dlg-sub", text: `FichaCSIRC v${st.ini?.version || "?"}${st.ini?.experimento ? " · prototipo web" : ""}` }),
    el("p", { text: "Registro de horas en OpenProject (ProyectosTic, UGR)." }),
    el("p", { text: "Desarrollador: Enrique Vargas Vega" }),
    el("p", { text: "Correo: quique@ugr.es" }),
    st.ini?.github ? el("p", { class: "tenue", text: `github.com/${st.ini.github}` }) : null);
}

function dlgAtajos() {
  const filas = [["Enter", "Añadir el apunte (desde Horas o Comentario)"],
    ["Supr", "Eliminar los apuntes seleccionados"], ["Ctrl+Z", "Deshacer lo último (borrar, editar, añadir…); otra vez, lo anterior (hasta 20)"],
    ["Ctrl+F", "Buscar en tus apuntes del año (comentario, tarea, actividad o fecha)"],
    ["Ctrl+N", "Crear una tarea nueva en ProyectosTIC (si tienes permiso en algún proyecto); con la flecha de «＋ Nueva», modificar o duplicar una"],
    ["Ctrl+C / Ctrl+V", "Copiar un día y pegarlo en los marcados"],
    ["+", "Sobre un día: añadirle una de tus tareas habituales"],
    ["Doble clic en las horas", "En la ficha: cambiarlas ahí mismo"],
    ["Arrastrar", "Un apunte a otro día lo copia (con Mayús, lo mueve); una tarea habitual, la añade"],
    ["F5", "Recargar la semana"], ["Ctrl+← / →", "Semana anterior / siguiente"],
    ["Ctrl+Q", "Salir de FichaCSIRC del todo (con el icono junto al reloj, la X solo esconde la ventana)"],
    ["Ctrl+L", "Bloquear FichaCSIRC con el PIN (si no tienes PIN, te lleva a activarlo)"],
    ["Alt+1..5", "Marcar/desmarcar lunes..viernes"], ["Esc", "Cerrar el diálogo o el menú"],
    ["Doble clic", "Editar un apunte"],
    ["Botón derecho", "En un día: festivo, vacaciones, permiso, guardia, teletrabajo, plantilla… "
                      + "En Actividad: asociarla con la tarea"]];
  const d = dialogo({ titulo: "Atajos de teclado", ancho: 520, botones: [cerrarBoton] });
  d.cuerpo.append(el("table", { class: "tabla-dlg" }, el("tbody", {},
    ...filas.map(([k, t]) => el("tr", {}, el("td", {}, el("kbd", { text: k })), el("td", { text: t }))))));
}

async function dlgRecordatorio() {
  const e = await llamar("recordatorio_estado");
  if (e.experimento) {
    return avisar("Aviso diario de fichaje",
      "En el prototipo no se configura el aviso diario: usa la misma tarea programada que tu "
      + "FichaCSIRC normal y activarlo desde aquí la haría apuntar a este experimento. "
      + "Actívalo o desactívalo desde la app normal (Herramientas → Aviso diario de fichaje).");
  }
  if (!e.soportado) {
    return avisar("Aviso diario de fichaje", "El aviso diario solo está disponible en Windows, macOS y Linux con systemd.");
  }
  // Un solo formulario para activarlo, cambiarle la hora o quitarlo (el mismo
  // que abre la campana de la barra). Propone las 14:00, o la hora que tenga.
  const campana = () => { if (typeof pintarCampana === "function") pintarCampana(); };
  const hora = entrada((e.activo && e.hora) || e.por_defecto || "14:00", { type: "time" });
  const d = dialogo({ titulo: "Aviso diario de fichaje", ancho: 480, botones: [
    e.activo ? { texto: "Desactivar aviso", clase: "peligro", izquierda: true, accion: async (dd) => {
      if (!(await preguntar("Desactivar el aviso", "No volveré a avisarte de las horas que falten.\n\n"
          + "Puedes activarlo otra vez cuando quieras con la campana 🔔.", { si: "Desactivar", no: "Cancelar" }))) return;
      const r = await llamar("recordatorio_desactivar");
      if (r.error) { await avisar("No se pudo desactivar", r.error); return; }
      dd.cerrar();
      estado("Aviso diario desactivado.");
      campana();
    } } : null,
    cancelarBoton,
    { texto: e.activo ? "Guardar" : "Activar", clase: "primario", accion: async (dd) => {
      if (!hora.value) { hora.focus(); return; }
      const r = await llamar("recordatorio_activar", hora.value);
      if (r.error) { await avisar("No se pudo activar", r.error); return; }
      dd.cerrar();
      estado(`Aviso diario: los días laborables a las ${hora.value}, si te faltan horas por fichar.`);
      campana();
    } }].filter(Boolean) });
  d.cuerpo.append(
    nota(e.activo ? `El aviso está activo${e.hora ? `, a las ${e.hora}` : ""}. Solo aparece si a esa hora te faltan horas `
                    + "por fichar; con la semana al día, no sale. Cámbiale la hora aquí o desactívalo."
      : "FichaCSIRC puede avisarte cada día laborable si te faltan horas por fichar (solo aparece si hay algo pendiente)."),
    rejilla(["¿A qué hora?", hora]),
    nota("Se queda a esa hora hasta que la cambies o lo quites. Si la cambias a una hora de hoy que aún no ha "
         + "pasado, hoy vuelve a avisarte (si te faltan horas)."),
    // el aviso de verdad solo sale si faltan horas: asi se puede ver como es
    el("p", { class: "nota" },
      el("button", { class: "enlace", type: "button", text: "Probar el aviso ahora", onclick: async () => {
        const r = await llamar("recordatorio_probar");
        if (r.error) { await avisar("No se pudo abrir el aviso", r.error); return; }
        estado("Aviso de prueba abierto en su ventanita: desde la prueba no se ficha nada.");
      } }),
      el("span", { class: "tenue", text: " · para ver cómo es, aunque hoy no te falte nada." })));
  hora.focus();
}

// Version nueva. Sin forzar (al arrancar) solo dice algo si la hay; forzando
// (Ayuda > Comprobar) tambien dice "estas al dia" o por que no se pudo mirar.
async function dlgActualizacion({ forzar }) {
  let r;
  try {
    r = await api().comprobar_actualizacion(forzar);
  } catch (e) {
    if (forzar) await avisar("No se pudo comprobar", e.message || String(e));
    return;
  }
  if (r.error) { if (forzar) await avisar("No se pudo comprobar", r.error); return; }
  if (r.al_dia) { if (forzar) await avisar("Actualizaciones", `Ya tienes la última versión (v${r.version}).`); return; }
  if (!r.puede_instalar) {
    const motivo = r.experimento ? "\n\n(El prototipo no instala actualizaciones: instalaría la de "
                                   + "producción encima. Hazlo desde tu FichaCSIRC normal.)" : "";
    if (await preguntar("Actualización disponible",
        `Hay una versión nueva de FichaCSIRC (${r.version}). Tú tienes la ${r.actual}.${motivo}\n\n¿Abrir la página de descarga?`)) {
      await llamar("abrir_pagina_actualizacion");
    }
    return;
  }
  const como = r.mac ? "Se abrirá el instalador y FichaCSIRC se cerrará para que puedas sustituirla."
                     : "El instalador se abrirá en unos segundos; FichaCSIRC se cerrará sola al pulsar «Instalar».";
  if (!(await preguntar("Actualización disponible",
      `Hay una versión nueva de FichaCSIRC (${r.version}). Tú tienes la ${r.actual}.\n\n¿Descargar e instalar ahora?\n${como}`))) return;
  estado(`Descargando actualización ${r.version}…`);
  const i = await llamar("instalar_actualizacion");
  if (i.error) {
    if (await preguntar("No se pudo actualizar", `${i.error}\n\n¿Abrir la página de descarga?`)) {
      await llamar("abrir_pagina_actualizacion");
    }
    return;
  }
  if (i.mac) {
    await avisar("Instalar la actualización", "Se ha abierto el instalador.\n\nArrastra FichaCSIRC a la "
      + "carpeta Aplicaciones y, cuando lo pregunte, elige «Reemplazar».\n\n"
      + "FichaCSIRC se cerrará ahora para poder sustituirla.");
    estado("Instalador descargado. FichaCSIRC se cerrará…");
    return;
  }
  estado(`Abriendo el instalador de la ${r.version}…`);
  await avisar("Abriendo el instalador",
    `El instalador de la versión ${r.version} se está abriendo (puede tardar unos segundos: `
    + "Windows lo revisa antes de arrancarlo).\n\nCuando pulses «Instalar», FichaCSIRC se cerrará sola "
    + "y se actualizará. Si cancelas el instalador, sigues con esta versión.");
}

// Mac: la app abierta desde Descargas o desde el .dmg deja una copia por
// actualizacion (y un icono mas en Launchpad).
async function dlgAplicaciones(motivo) {
  const texto = motivo === "dmg"
    ? "Estás usando FichaCSIRC directamente desde el instalador (.dmg). Al expulsarlo dejará de funcionar."
    : "FichaCSIRC no está en la carpeta Aplicaciones, así que cada actualización deja otra copia y en "
      + "Launchpad acaban saliendo varios iconos.";
  if (await preguntar("Mueve FichaCSIRC a Aplicaciones", `${texto}\n\nArrastra FichaCSIRC a la `
      + "carpeta Aplicaciones (si ya está, elige «Reemplazar») y borra las copias que tengas en "
      + "Descargas.\n\n¿Abrir la carpeta Aplicaciones?")) {
    await llamar("abrir_aplicaciones");
  }
}
