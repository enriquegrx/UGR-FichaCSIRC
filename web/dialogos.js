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
function dlgEditarDia(dia, { nueva = false } = {}) {
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

  function nuevaFila() {
    const tarea = el("select", { class: "ed-tarea-sel", "aria-label": "Tarea" },
      el("option", { value: "", text: "Elige una tarea…" }),
      ...[...st.tareas].map(([texto, id]) => el("option", { value: String(id), text: texto })));
    const f = { nueva: true, tarea, horas: campoHoras(""), borrar: false,
                act: el("select", { class: "ed-act", disabled: true }, el("option", { text: "…" })),
                comentario: "" };
    tarea.onchange = async () => {
      const sel = selectorActividad(tarea.value, "");
      f.act.replaceWith(sel);
      f.act = sel;
      const r = await sel.cargar();
      f.comentario = r.comentario || "";
      f.horas.focus();
    };
    f.fila = el("div", { class: "ed-fila nueva" },
      el("span", { class: "ed-h" }, f.horas, " h"), tarea, f.act, botonBorrar(f));
    filas.push(f);
    lista.append(f.fila);
    tarea.focus();
    recalcular();
  }

  async function guardar(dd) {
    const cambios = { editar: [], borrar: [], anadir: [] };
    for (const f of filas) {
      if (f.nueva) {
        if (!f.tarea.value && !f.horas.value.trim()) continue;      // fila vacia: se ignora
        if (!f.tarea.value) { await avisar("Falta tarea", "Elige la tarea de la fila nueva."); f.tarea.focus(); return; }
        cambios.anadir.push({ wp_id: f.tarea.value, horas: f.horas.value,
                              actividad: f.act.value || "", comentario: f.comentario });
      } else if (f.borrar) {
        cambios.borrar.push({ id: f.a.id, destino: f.a.destino || "op" });
      } else if (f.a.destino !== "inari") {
        cambios.editar.push({ id: f.a.id, horas: f.horas.value, actividad: f.act.value || f.a.actividad });
      }
    }
    for (const f of filas.filter((x) => !x.borrar && !x.horas.disabled)) {
      const h = numero(f.horas.value);
      if ((f.nueva && !f.tarea.value) || (h > 0 && h <= 24)) continue;
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

  if (!dia.apuntes.length || nueva) nuevaFila();
  else filas[0].horas.focus();
  recalcular();
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
    estado("PIN activado: se pedirá al abrir FichaCSIRC.");
  }
}

async function dlgPin() {
  const { activo } = await llamar("pin_estado");
  const campo = (etiqueta) => entrada("", { type: "password", inputmode: "numeric", maxlength: "8",
                                            autocomplete: "off", class: "horas", "aria-label": etiqueta });
  const actual = campo("PIN actual"), nuevo = campo("PIN nuevo"), repetido = campo("Repite el PIN nuevo");
  const botones = [cancelarBoton,
    { texto: activo ? "Cambiar PIN" : "Activar PIN", clase: "primario", accion: fijar }];
  if (activo) botones.unshift({ texto: "Quitar PIN", clase: "peligro", izquierda: true, accion: quitar });
  const d = dialogo({ titulo: "PIN de acceso", ancho: 520, botones });
  d.cuerpo.append(
    nota(activo ? "FichaCSIRC pide el PIN al abrirse. Para cambiarlo o quitarlo, escribe antes el actual."
                : "Con un PIN, FichaCSIRC lo pedirá cada vez que se abra (también el asistente de configuración)."),
    rejilla(...(activo ? [["PIN actual", actual]] : []),
            ["PIN nuevo", nuevo], ["Repítelo", repetido]),
    nota("De 4 a 8 cifras. Si lo olvidas, la única salida es borrar la configuración de este equipo "
         + "y volver a configurar FichaCSIRC (tus horas en ProyectosTIC no se pierden)."));
  (activo ? actual : nuevo).focus();
  for (const i of [actual, nuevo, repetido]) i.addEventListener("keydown", (e) => { if (e.key === "Enter") fijar(d); });

  async function fijar(dd) {
    const r = await llamar("pin_fijar", nuevo.value, repetido.value, actual.value);
    if (r.error) { await avisar("PIN de acceso", r.error); return; }
    dd.cerrar();
    estado(activo ? "PIN cambiado." : "PIN activado: se pedirá al abrir FichaCSIRC.");
  }
  async function quitar(dd) {
    const r = await llamar("pin_quitar", actual.value);
    if (r.error) { await avisar("PIN de acceso", r.error); actual.focus(); return; }
    dd.cerrar();
    estado("PIN quitado: FichaCSIRC ya no lo pedirá.");
  }
}

// ================================================================ buscar tarea

function dlgBuscar() {
  let tareas = [], filtradas = [], seq = 0;
  const proy = el("select", {}, el("option", { value: "", text: "Cargando proyectos…" }));
  const filtro = entrada("", { placeholder: "Filtra la lista o busca en todos (Enter)", class: "ancho" });
  const lista = el("select", { multiple: true, size: "14", class: "lista" });
  const info = nota("Cargando proyectos…");
  const fav = el("input", { type: "checkbox" });
  const d = dialogo({ titulo: "Buscar tarea", ancho: 640, botones: [cancelarBoton,
    { texto: "Elegir", clase: "primario", accion: elegir }] });
  d.cuerpo.append(
    rejilla(["Proyecto", proy],
            ["Filtro", el("div", { class: "fila" }, filtro,
              el("button", { text: "Buscar en todo", onclick: buscarTodo }))]),
    lista, info,
    el("label", { class: "check" }, fav, " Añadir también a favoritas (se guarda en la configuración)"));

  const pintar = () => {
    const f = filtro.value.trim().toLowerCase();
    filtradas = tareas.filter((t) => t.nombre.toLowerCase().includes(f) || String(t.id).includes(f));
    lista.replaceChildren(...filtradas.map((t, i) => el("option", { value: String(i), text: `${t.id} - ${t.nombre}` })));
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
    if (texto.length < 3) { info.textContent = "Escribe al menos 3 letras y pulsa «Buscar en todo» (o Enter)."; return; }
    const mio = ++seq;
    info.textContent = `Buscando «${texto}» en todos los proyectos…`;
    const r = await llamar("buscar_tareas", texto);
    if (mio !== seq) return;
    if (r.error) { info.textContent = r.error; return; }
    tareas = r.tareas;
    filtro.value = "";
    pintar();
    info.textContent = tareas.length ? `${tareas.length} tareas encontradas en todos tus proyectos.`
                                     : `Nada con «${texto}» en tus proyectos.`;
  }
  async function elegir(dd) {
    const elegidas = [...lista.selectedOptions].map((o) => filtradas[Number(o.value)]);
    if (!elegidas.length) { info.textContent = "Elige al menos una tarea de la lista."; return; }
    ponerTareas(await llamar("elegir_tareas", elegidas, fav.checked));
    $("tarea").value = `${elegidas[0].id} - ${elegidas[0].nombre}`;
    dd.cerrar();
    await elegirTarea();
    estado(fav.checked ? `${elegidas.length} tarea(s) guardada(s) como favoritas.`
                       : `${elegidas.length} tarea(s) añadida(s) al desplegable.`);
  }
  filtro.focus();
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

async function pedirNombrePlantilla(dia) {
  const total = fmtHoras(dia.apuntes.reduce((s, a) => s + a.horas, 0));
  return new Promise((resolver) => {
    const nombre = entrada(`Día tipo (${total}h)`, { class: "ancho" });
    // Una sola salida: botones, Enter, Esc y la × pasan por fin(). (Si la X/Esc
    // resolvieran por su cuenta, ganaria siempre el "cancelado".)
    let fin = () => {};
    const d = dialogo({ titulo: "Guardar como plantilla", ancho: 440, botones: [
      { texto: "Cancelar", accion: () => fin(null) },
      { texto: "Guardar", clase: "primario", accion: () => fin(nombre.value.trim()) }] });
    const cerrarDialogo = d.cerrar;
    let hecho = false;
    fin = (valor) => {
      if (hecho) return;
      hecho = true;
      cerrarDialogo();
      resolver(valor);
    };
    d.cerrar = () => fin(null);
    d.cuerpo.append(nota(`Apuntes del ${dia.nombre} ${dia.fecha} (${dia.apuntes.length}):`),
                    rejilla(["Nombre", nombre]));
    nombre.addEventListener("keydown", (e) => { if (e.key === "Enter") fin(nombre.value.trim()); });
    nombre.focus();
    nombre.select();
  });
}

async function dlgGuardarPlantillaDia(dia, alGuardar) {
  const nombre = await pedirNombrePlantilla(dia);
  if (!nombre) return;
  const r = await llamar("guardar_plantilla_dia", dia.iso, nombre);
  if (r.error) { await avisar("Plantilla", r.error); return; }
  estado(`Plantilla «${nombre}» guardada (${r.n} apuntes).`);
  alGuardar?.();
}

function dlgPlantillas() {
  const lista = el("select", { size: "8", class: "lista" });
  const vacia = nota("Todavía no tienes plantillas.\n\nPara crear una: marca el día con las horas "
    + "que quieras guardar y pulsa «Guardar día marcado como plantilla». También con botón "
    + "derecho sobre el día → Guardar este día como plantilla.");
  const d = dialogo({ titulo: "Plantillas de apuntes", ancho: 560, botones: [
    { texto: "Aplicar a días marcados", clase: "primario", id: "aplicar", izquierda: true, accion: aplicar },
    { texto: "Guardar día marcado como plantilla", izquierda: true, accion: guardarMarcado },
    { texto: "Eliminar", clase: "peligro", id: "borrar", izquierda: true, accion: borrar },
    cerrarBoton] });
  d.cuerpo.append(nota("Una plantilla guarda los apuntes de un día típico para aplicarlos de golpe "
                       + "a los días marcados."), lista, vacia);
  let datos = [];
  const pintar = (ps) => {
    datos = ps;
    lista.replaceChildren(...ps.map((p, i) => el("option", { value: String(i), text: `${p.nombre}  (${p.n} apuntes, ${p.total})` })));
    lista.hidden = !ps.length;
    vacia.hidden = !!ps.length;
    d.botones.aplicar.disabled = d.botones.borrar.disabled = !ps.length;
    if (ps.length) lista.selectedIndex = 0;
  };
  llamar("plantillas").then(pintar);
  lista.addEventListener("dblclick", () => aplicar(d));

  async function aplicar(dd) {
    const p = datos[lista.selectedIndex];
    if (!p) return;
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
  async function borrar() {
    const p = datos[lista.selectedIndex];
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

function dlgResumen() {
  // el mes visible; en la vista semana, el que domina la semana (su jueves)
  const ref = st.vista === "mes" ? `${st.mesSel.anio}-${String(st.mesSel.mes).padStart(2, "0")}-15`
                                 : sumarDias(st.lunes, 3);
  const est = { anio: Number(ref.slice(0, 4)), mes: Number(ref.slice(5, 7)), seq: 0 };
  const titulo = el("strong", { class: "mes", text: "…" });
  const barra = el("div", { class: "barra grande" }, el("i"));
  const cifra = (t) => { const v = el("strong", { text: "…" }); return [el("span", { class: "tenue", text: t }), v]; };
  const [lr, vr] = cifra("Registrado"), [lh, vh] = cifra("Objetivo hasta hoy"), [lm, vm] = cifra("Objetivo del mes");
  const est_ = el("p", { class: "estado-mes", text: "Consultando el mes…" });
  const tt = nota("");
  const inc = el("div", { class: "incompletos" });
  const d = dialogo({ titulo: "Resumen del mes", ancho: 440, botones: [cerrarBoton] });
  d.cuerpo.append(
    el("div", { class: "nav-mes" },
      el("button", { text: "←", title: "Mes anterior", onclick: () => mover(-1) }), titulo,
      el("button", { text: "→", title: "Mes siguiente", onclick: () => mover(1) })),
    barra, el("div", { class: "cifras" }, lr, vr, lh, vh, lm, vm), est_, tt, inc);
  const cargar = async () => {
    const mio = ++est.seq;
    vr.textContent = vh.textContent = vm.textContent = "…";
    est_.textContent = "Consultando el mes…";
    est_.className = "estado-mes";
    inc.replaceChildren();
    tt.textContent = "";
    const r = await llamar("resumen_mes", est.anio, est.mes);
    if (mio !== est.seq) return;
    titulo.textContent = r.titulo;
    vr.textContent = r.registrado; vh.textContent = r.objetivo_hoy; vm.textContent = r.objetivo_mes;
    est_.textContent = r.estado;
    est_.className = `estado-mes ${r.al_dia ? "ok" : "aviso"}`;
    barra.className = `barra grande ${r.al_dia ? "completo" : "parcial"}`;
    barra.firstChild.style.width = `${r.frac * 100}%`;
    tt.textContent = r.teletrabajo;
    if (r.incompletos.length) {
      inc.append(nota("Días incompletos (clic para ir):"),
        ...r.incompletos.map((x) => el("button", { class: "fila-dia", onclick: () => { d.cerrar(); irADia(x.iso); } },
          el("span", { text: x.dia }), el("span", { class: "num", text: x.horas }))));
    }
  };
  const mover = (delta) => {
    const m = est.mes + delta;
    est.anio += Math.floor((m - 1) / 12);
    est.mes = ((m - 1) % 12 + 12) % 12 + 1;
    titulo.textContent = "…";
    cargar();
  };
  cargar();
}

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
  const lista = el("div", { class: "lista-festivos" });
  const d = dialogo({ titulo: "Importar festivos", ancho: 520, botones: [cerrarBoton,
    { texto: "Importar", clase: "primario", id: "importar", accion: async (dd) => {
      const r = await llamar("importar_festivos", ...Object.keys(cajas).map((k) => marcas[k].checked));
      dd.cerrar();
      await repintarLocal();
      if (r.n) estado(`${r.n} festivos marcados.`);
    } }] });
  d.cuerpo.append(el("p", { class: "dlg-sub", text: "Marca como no laborables los festivos de:" }));
  for (const k of Object.keys(cajas)) {
    marcas[k] = el("input", { type: "checkbox", checked: true, onchange: recalc });
    d.cuerpo.append(el("label", { class: "check bloque" }, marcas[k], ` ${etiquetas[k]}`));
  }
  d.cuerpo.append(lista, nota("Los festivos en domingo se estiman trasladados al lunes; revísalos: el "
    + "traslado real lo decide la Junta cada año. Cualquiera se quita con botón derecho sobre su día."));
  async function recalc() {
    const pend = await llamar("festivos", ...Object.keys(cajas).map((k) => marcas[k].checked));
    lista.replaceChildren(pend.length
      ? el("p", { text: `Se marcarán ${pend.length} días:` })
      : el("p", { class: "tenue", text: "No hay festivos nuevos que marcar con esta selección." }),
      ...pend.map((f) => el("div", { class: "festivo" }, el("span", { class: "num", text: f.fecha }),
                                                         el("span", { text: f.nombre }))));
    d.botones.importar.disabled = !pend.length;
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
  const listaAct = el("datalist", { id: "permisos-actividades" });
  const d = dialogo({ titulo: "Permisos (horas)", ancho: 660, botones: [
    { texto: `Añadir los permisos de ${new Date().getFullYear()}…`, izquierda: true,
      accion: () => dlgPermisosAnio({ manual: true, alTerminar: () => llamar("permisos").then(pintar) }) },
    cerrarBoton] });
  const cabecera = nota("");
  d.cuerpo.append(cabecera, info, listaAct, cuerpo);

  function pintar(p) {
    cabecera.textContent = `Saldo desde el ${p.desde}: lo que no usas se arrastra y las horas de cada año `
                           + "se suman a lo que te queda. Las usadas se calculan solas.";
    listaAct.replaceChildren(...[SIN_ACTIVIDAD, ...p.actividades].map((a) => el("option", { value: a })));
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
      const act = entrada(f.actividad || SIN_ACTIVIDAD, { list: "permisos-actividades", class: "actividad-permiso" });
      const fijar = async () => {
        const nueva = act.value.trim() === SIN_ACTIVIDAD ? "" : act.value.trim();
        if (nueva === (f.actividad || "")) return;
        pintar(await llamar("fijar_actividad_permiso", f.id, nueva));
        if (nueva) leerPt();
      };
      act.addEventListener("change", fijar);
      act.addEventListener("focus", () => act.select());
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

async function dlgPermisoDia(dia) {
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
  const bloques = await llamar("novedades");
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
    ["Supr", "Eliminar los apuntes seleccionados"], ["Ctrl+Z", "Deshacer lo último (borrar, editar, añadir…)"],
    ["Ctrl+C / Ctrl+V", "Copiar un día y pegarlo en los marcados"],
    ["+", "Sobre un día: añadirle una de tus tareas habituales"],
    ["Doble clic en las horas", "En la ficha: cambiarlas ahí mismo"],
    ["Arrastrar", "Un apunte a otro día lo copia (con Mayús, lo mueve); una tarea habitual, la añade"],
    ["F5", "Recargar la semana"], ["Ctrl+← / →", "Semana anterior / siguiente"],
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
    return avisar("Aviso diario de fichaje", "El aviso diario solo está disponible en Windows y macOS.");
  }
  if (e.activo) {
    if (await preguntar("Aviso diario",
        "El aviso diario de fichaje está ACTIVO (lunes a viernes).\n\n¿Quieres desactivarlo?")) {
      const r = await llamar("recordatorio_desactivar");
      await avisar("Aviso diario", r.error || "Aviso desactivado.");
    }
    return;
  }
  const hora = entrada("16:00", { type: "time" });
  const d = dialogo({ titulo: "Aviso diario de fichaje", ancho: 460, botones: [cancelarBoton,
    { texto: "Activar", clase: "primario", accion: async (dd) => {
      const r = await llamar("recordatorio_activar", hora.value);
      if (r.error) { await avisar("No se pudo activar", r.error); return; }
      dd.cerrar();
      await avisar("Aviso diario", `Listo. Te avisaré los días laborables a las ${hora.value} si te faltan horas por fichar.`);
    } }] });
  d.cuerpo.append(nota("FichaCSIRC puede avisarte cada día laborable si te faltan horas por fichar "
                       + "(solo aparece si hay algo pendiente)."),
                  rejilla(["¿A qué hora?", hora]));
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
                     : "FichaCSIRC se cerrará al iniciar el instalador.";
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
  }
  estado("Instalador descargado. FichaCSIRC se cerrará…");
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
