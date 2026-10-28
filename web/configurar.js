/* FichaCSIRC - asistente de configuracion (equivale a configurar_gui.py).
 *
 * Pasos: bienvenida, conexion, jornada, tareas favoritas y resumen. Lo valida y
 * lo guarda Python (Api.cfg_*): aqui solo se pinta y se recogen los datos.
 * La API key NO llega a esta pagina: si el campo se deja vacio se conserva la
 * guardada. Se abre solo la primera vez (sin config.json) o desde Herramientas.
 */
"use strict";

const W = {
  ini: null,
  paso: 0,
  d: {},                 // datos que se van rellenando
  probada: null,         // "url|key" de la ultima conexion correcta
  proyectos: null,
  tareas: [],
};

const PASOS = [
  { titulo: "Bienvenida", pintar: pBienvenida },
  { titulo: "Conexión", pintar: pConexion, validar: vConexion },
  { titulo: "Jornada", pintar: pJornada, validar: vJornada },
  { titulo: "Tareas", pintar: pTareas },
  { titulo: "Resumen", pintar: pResumen },
];

const caja = () => $("contenido");
const fila = (etiqueta, control, ayuda) => el("div", { class: "campo-asistente" },
  el("label", { text: etiqueta }), control, ayuda ? el("span", { class: "tenue", text: ayuda }) : null);
function entrada(valor, props = {}) {
  const i = el("input", props);
  i.value = valor ?? "";
  return i;
}

// ------------------------------------------------------------------ pasos

function pBienvenida() {
  caja().append(
    el("h2", { text: "Bienvenido al asistente de FichaCSIRC" }),
    el("p", { text: "Te guiará para configurar el registro de horas en OpenProject (ProyectosTic):" }),
    el("ul", {},
      el("li", { text: "la dirección y tu clave de acceso (API key);" }),
      el("li", { text: "tu jornada (horas normales, desayuno y verano);" }),
      el("li", { text: "tus tareas favoritas y la actividad por defecto." })),
    W.ini.primera_vez ? el("p", { class: "tenue", text: "Es la primera vez que abres FichaCSIRC: hace falta "
      + "configurarlo antes de registrar horas." }) : null,
    W.ini.aviso ? el("p", { class: "nota ambar", text: `Tu configuración no se pudo leer (${W.ini.aviso}). `
      + "Al terminar el asistente se guardará una nueva." }) : null,
    W.ini.experimento ? el("p", { class: "nota tenue", text: "Prototipo: se guarda en la configuración del "
      + "experimento, no en la de tu FichaCSIRC normal." }) : null,
    el("p", { text: "Pulsa «Siguiente» para empezar." }));
}

function pConexion() {
  const url = entrada(W.d.url, { class: "ancho", id: "c-url" });
  const key = entrada(W.d.key, { type: "password", class: "ancho", id: "c-key",
    placeholder: W.ini.hay_key ? "(guardada; escríbela solo para cambiarla)" : "" });
  const msg = el("p", { id: "c-msg", class: "nota" });
  const guardar = () => { W.d.url = url.value.trim(); W.d.key = key.value.trim(); };
  url.addEventListener("input", guardar);
  key.addEventListener("input", guardar);
  caja().append(
    el("h2", { text: "Conexión con ProyectosTic" }),
    fila("URL de OpenProject", url),
    fila("API key", key, "Se saca en: avatar (arriba a la derecha) › Mi cuenta › Tokens de acceso › API"),
    el("button", { text: "Probar conexión", onclick: () => probar(msg) }), msg);
  url.focus();
}

async function probar(msg) {
  msg.textContent = "Probando…";
  msg.className = "nota tenue";
  const r = await llamar("cfg_probar", W.d.url, W.d.key);
  if (r.error) {
    msg.textContent = r.error;
    msg.className = "nota rojo";
    return false;
  }
  W.probada = `${W.d.url}|${W.d.key}`;
  W.proyectos = null;                       // con otra cuenta, otros proyectos
  msg.textContent = `Conexión correcta. Hola, ${r.nombre}.`;
  msg.className = "nota verde";
  return true;
}

async function vConexion() {
  if (!W.d.url || (!W.d.key && !W.ini.hay_key)) {
    await avisar("Faltan datos", "Escribe la URL y la API key.");
    return false;
  }
  if (W.probada === `${W.d.url}|${W.d.key}`) return true;
  if (await probar($("c-msg"))) return true;
  return preguntar("Sin conexión", `${$("c-msg").textContent}\n\n¿Continuar de todas formas?`);
}

function pJornada() {
  const d = W.d;
  const jor = entrada(d.jornada, { class: "horas", inputmode: "decimal" });
  const tdes = el("input", { type: "checkbox", checked: d.desayuno_si });
  const des = entrada(d.desayuno, { class: "horas", inputmode: "decimal" });
  const vivo = el("p", { class: "nota azul" });
  const tver = el("input", { type: "checkbox", checked: d.verano_si });
  const ver = entrada(d.verano, { class: "horas", inputmode: "decimal" });
  const vini = entrada(d.verano_inicio, { class: "horas", placeholder: "DD/MM" });
  const vfin = entrada(d.verano_fin, { class: "horas", placeholder: "DD/MM" });
  let seq = 0;
  const recalcular = async () => {
    Object.assign(d, { jornada: jor.value, desayuno_si: tdes.checked, desayuno: des.value,
      verano_si: tver.checked, verano: ver.value, verano_inicio: vini.value, verano_fin: vfin.value });
    des.disabled = !tdes.checked;
    for (const c of [ver, vini, vfin]) c.disabled = !tver.checked;
    const mio = ++seq;
    const r = await llamar("cfg_validar_jornada", d);
    if (mio !== seq) return;
    vivo.textContent = r.error || r.texto;
    vivo.className = `nota ${r.error ? "ambar" : "azul"}`;
  };
  for (const c of [jor, des, ver, vini, vfin]) c.addEventListener("input", recalcular);
  for (const c of [tdes, tver]) c.addEventListener("change", recalcular);
  caja().append(
    el("h2", { text: "Tu jornada (lunes a viernes)" }),
    fila("Horas por día", jor, "tu jornada OFICIAL, p. ej. 7"),
    el("label", { class: "check bloque" }, tdes, " Descontar desayuno (no se ficha)"),
    fila("Desayuno (horas)", des, "p. ej. 0,5"),
    vivo,
    el("label", { class: "check bloque separado" }, tver, " Tengo horario de verano distinto"),
    fila("Horas por día (verano)", ver, "puedes poner medias horas, p. ej. 4,5"),
    fila("Inicio del verano", vini, "DD/MM"),
    fila("Fin del verano", vfin, "DD/MM"));
  recalcular();
  jor.focus();
}

async function vJornada() {
  const r = await llamar("cfg_validar_jornada", W.d);
  if (r.error) { await avisar("Revisa la jornada", r.error); return false; }
  return true;
}

function pTareas() {
  const proy = el("select", {}, el("option", { value: "", text: "Cargando proyectos…" }));
  const tareas = el("select", { multiple: true, size: "10", class: "lista" });
  const favs = el("select", { size: "10", class: "lista" });
  const msg = el("p", { class: "nota tenue" });
  const act = el("select", {}, ...W.ini.actividades.map((a) => el("option", { value: a, text: a })));
  act.value = W.d.actividad;
  act.addEventListener("change", () => { W.d.actividad = act.value; });
  const pintarFavs = () => {
    favs.replaceChildren(...W.d.favoritos.map((f, i) => el("option", { value: String(i), text: `${f.id} - ${f.nombre}` })));
  };
  const pintarTareas = () => {
    tareas.replaceChildren(...W.tareas.map((t, i) => el("option", { value: String(i), text: `${t.id} - ${t.nombre}` })));
  };
  const cargarTareas = async () => {
    if (!proy.value) return;
    msg.textContent = "Cargando tareas…";
    const r = await llamar("cfg_tareas", W.d.url, W.d.key, proy.value);
    if (r.error) { msg.textContent = r.error; W.tareas = []; pintarTareas(); return; }
    W.tareas = r.tareas;
    pintarTareas();
    msg.textContent = `${W.tareas.length} tareas. Marca las que uses (Ctrl o Mayús: varias).`;
  };
  proy.addEventListener("change", cargarTareas);
  tareas.addEventListener("dblclick", () => anadirFavs());
  const anadirFavs = () => {
    const ids = new Set(W.d.favoritos.map((f) => String(f.id)));
    for (const o of tareas.selectedOptions) {
      const t = W.tareas[Number(o.value)];
      if (!ids.has(String(t.id))) { W.d.favoritos.push({ id: t.id, nombre: t.nombre }); ids.add(String(t.id)); }
    }
    pintarFavs();
  };
  caja().append(
    el("h2", { text: "Tareas favoritas y actividad" }),
    fila("Proyecto", proy),
    el("div", { class: "dos-listas" },
      el("div", {}, el("h4", { text: "Tareas del proyecto" }), tareas,
        el("button", { text: "Añadir marcadas a favoritas »", onclick: anadirFavs })),
      el("div", {}, el("h4", { text: "Favoritas" }), favs,
        el("button", { text: "Quitar seleccionada", onclick: () => {
          if (favs.selectedIndex >= 0) { W.d.favoritos.splice(favs.selectedIndex, 1); pintarFavs(); }
        } }))),
    msg,
    fila("Actividad por defecto", act));
  pintarFavs();
  (async () => {
    if (!W.proyectos) {
      const r = await llamar("cfg_proyectos", W.d.url, W.d.key);
      if (r.error) { msg.textContent = r.error; proy.replaceChildren(el("option", { value: "", text: "—" })); return; }
      W.proyectos = r.proyectos;
    }
    proy.replaceChildren(el("option", { value: "", text: "— elige un proyecto —" }),
      ...W.proyectos.map((p) => el("option", { value: String(p.id), text: `${p.id} - ${p.nombre}` })));
    msg.textContent = `${W.proyectos.length} proyectos. Elige uno para ver sus tareas.`;
  })();
}

function pResumen() {
  const d = W.d;
  const lineas = [
    ["OpenProject", d.url],
    ["API key", d.key ? "nueva (se guardará)" : (W.ini.hay_key ? "la guardada" : "—")],
    ["Jornada", `${d.jornada} h/día${d.desayuno_si ? ` (fichas ${(parseFloat(String(d.jornada).replace(",", ".")) - parseFloat(String(d.desayuno).replace(",", "."))).toString().replace(".", ",")} h: ${d.desayuno} h de desayuno)` : ""}`],
    ["Horario de verano", d.verano_si ? `${d.verano} h/día, del ${d.verano_inicio} al ${d.verano_fin}` : "No"],
    ["Actividad por defecto", d.actividad],
    ["Tareas favoritas", String(d.favoritos.length)],
  ];
  const MAX = 10;   // no alargar el resumen sin fin si hay muchas favoritas
  caja().append(
    el("h2", { text: "Resumen" }),
    el("table", { class: "tabla-dlg" }, el("tbody", {},
      ...lineas.map(([k, v]) => el("tr", {}, el("td", { class: "tenue", text: k }), el("td", { text: v }))))),
    el("ul", { class: "favs-resumen" },
      ...d.favoritos.slice(0, MAX).map((f) => el("li", { text: `${f.id}  ${f.nombre}` })),
      d.favoritos.length > MAX ? el("li", { class: "tenue", text: `… y ${d.favoritos.length - MAX} más` }) : null),
    el("p", { class: "tenue", text: "Pulsa «Finalizar» para guardar." }));
}

// ------------------------------------------------------------------ navegacion

function mostrar() {
  caja().replaceChildren();
  PASOS[W.paso].pintar();
  $("pasos").replaceChildren(...PASOS.map((p, i) => el("li", {
    class: i === W.paso ? "actual" : (i < W.paso ? "hecho" : ""), text: p.titulo })));
  $("paso-n").textContent = `Paso ${W.paso + 1} de ${PASOS.length}`;
  const ultimo = W.paso === PASOS.length - 1;
  $("b-atras").disabled = W.paso === 0;
  $("b-siguiente").hidden = ultimo;
  $("b-finalizar").hidden = !ultimo;
}

async function siguiente() {
  const v = PASOS[W.paso].validar;
  if (v && !(await v())) return;
  if (W.paso < PASOS.length - 1) { W.paso++; mostrar(); }
}

async function finalizar() {
  $("b-finalizar").disabled = true;
  try {
    const r = await llamar("cfg_guardar", W.d);
    if (r.error) { await avisar("No se pudo guardar", r.error); return; }
    if (W.ini.primera_vez) await avisar("Configuración guardada", "Listo. Ya puedes registrar horas.");
    location.href = "index.html";
  } finally {
    $("b-finalizar").disabled = false;
  }
}

async function cancelar() {
  if (!(await preguntar("Cancelar", "¿Cerrar el asistente sin guardar la configuración?"))) return;
  if (W.ini.primera_vez) await llamar("cerrar");     // sin config no hay a donde volver
  else location.href = "index.html";
}

async function arrancarAsistente() {
  const ini = W.ini = await llamar("cfg_cargar");
  if (ini.logo) { $("logo").src = ini.logo; $("logo").hidden = false; }
  document.querySelector(".etiqueta-prototipo").hidden = !ini.experimento;
  W.d = { url: ini.url, key: "", jornada: ini.jornada, desayuno_si: ini.desayuno_si,
          desayuno: ini.desayuno, verano_si: ini.verano_si, verano: ini.verano,
          verano_inicio: ini.verano_inicio, verano_fin: ini.verano_fin,
          actividad: ini.actividad, favoritos: ini.favoritos };
  mostrar();
}

$("b-atras").onclick = () => { if (W.paso > 0) { W.paso--; mostrar(); } };
$("b-siguiente").onclick = siguiente;
$("b-finalizar").onclick = finalizar;
$("b-cancelar").onclick = cancelar;
document.addEventListener("keydown", (e) => {
  if (!$("modal").hidden) return;
  if (e.key === "Enter" && e.target.tagName === "INPUT") {
    e.preventDefault();
    if (!$("b-siguiente").hidden) siguiente(); else finalizar();
  }
});

cuandoListo(arrancarAsistente);
