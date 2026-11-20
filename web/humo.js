/* FichaCSIRC - pruebas de humo de la interfaz (las corre tests/test_js_humo.py).
 *
 * Se carga DESPUES de app.js en una copia de index.html abierta con ?demo en
 * un navegador sin ventana. Hace lo que haria una persona (abrir menus,
 * editar un dia, arrastrar, Ctrl+C/V, minimizar cajas, cambiar de tema...) y
 * va apuntando OK / FALLO en un <pre id="humo-resultado">; el test de Python
 * lee el DOM al final. Con ?pin solo prueba la pantalla del PIN.
 * No se empaqueta: PyInstaller copia la carpeta web entera, pero index.html
 * no lo carga, asi que en la app no hace nada. */
"use strict";
(function () {
  if (!/[?&]humo\b/.test(location.search)) return;
  const lineas = [];
  const salida = document.createElement("pre");
  salida.id = "humo-resultado";
  salida.hidden = true;
  document.body.append(salida);
  const apuntar = (t) => { lineas.push(t); salida.textContent = lineas.join("\n"); };
  window.addEventListener("error", (e) => apuntar(`FALLO error de JS: ${e.message}`));
  window.addEventListener("unhandledrejection", (e) => apuntar(`FALLO promesa: ${e.reason?.message || e.reason}`));

  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const dias = () => document.querySelectorAll(".dia");
  const cifra = (i) => dias()[i].querySelector(".cifra").textContent.trim();
  const hasta = async (cond, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (cond()) return true; await espera(50); }
    return false;
  };
  const prueba = async (nombre, fn) => {
    try { await fn(); apuntar(`OK ${nombre}`); }
    catch (e) { apuntar(`FALLO ${nombre}: ${e.message || e}`); }
  };
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
  const menuDe = (i) => {
    const t = dias()[i], r = t.getBoundingClientRect();
    t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + 40, clientY: r.top + 40 }));
    return [...document.querySelectorAll("#menu button")];
  };
  const pulsarMenu = (texto) => {
    const b = [...document.querySelectorAll("#menu button")].find((x) => x.textContent.includes(texto));
    ok(b, `no hay opción «${texto}» en el menú`);
    b.click();
  };
  const dlg = () => document.querySelector(".dlg");
  const botonDlg = (texto) => {
    const b = [...document.querySelectorAll(".dlg-pie button")].find((x) => x.textContent.trim() === texto);
    ok(b, `no hay botón «${texto}» en el diálogo`);
    b.click();
  };
  // con tope: un dialogo que no se deja cerrar colgaria el navegador en vez de fallar
  const cerrarTodo = () => {
    for (let i = 0; pila.length && i < 20; i++) pila[pila.length - 1].cerrar();
    ok(!pila.length, "queda un diálogo que no se deja cerrar");
  };
  const teclado = (key, extra = {}) => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...extra }));

  async function escenarioPin() {
    await prueba("pantalla del PIN tapa la app", async () => {
      ok(await hasta(() => document.querySelector(".bloqueo")), "no sale la pantalla del PIN");
      ok(document.querySelector(".bloqueo .bloqueo-ugr"), "sin logo de la UGR");
      ok(/Versión/.test(document.querySelector(".bloqueo").innerText), "sin versión");
      ok(dias().length === 0, "la semana se pintó antes de desbloquear");
    });
    await prueba("PIN incorrecto avisa y el bueno entra", async () => {
      const pin = document.querySelector(".pin-campo"), f = document.querySelector(".bloqueo-caja");
      pin.value = "0000"; f.requestSubmit();
      ok(await hasta(() => document.querySelector(".pin-msg").textContent.includes("incorrecto")), "no avisa del PIN incorrecto");
      pin.value = "1234"; f.requestSubmit();
      ok(await hasta(() => !document.querySelector(".bloqueo") && dias().length === 5), "no entra con el PIN bueno");
    });
    apuntar("HUMO-FIN");
  }

  async function escenarioPrincipal() {
    await prueba("semana pintada", async () => {
      ok(await hasta(() => dias().length === 5), "no hay 5 fichas");
      ok(document.querySelector(".marca h1 b")?.textContent === "CSIRC", "logo de la cabecera");
      ok(await hasta(() => document.querySelectorAll(".hab-fila").length >= 3), "sin tareas habituales");
      ok(await hasta(() => !document.getElementById("franja").hidden), "sin franja de resumen");
    });
    await prueba("menú del día: orden y destacados", async () => {
      const b = menuDe(0);
      ok(b[0].textContent.includes("Copiar día anterior") && b[0].classList.contains("destacado"), "1.ª opción");
      ok(b[1].textContent.includes("Editar día"), "2.ª opción");
      ok(b[2].textContent.includes("Eliminar apuntes") && b[2].classList.contains("destacado"), "3.ª opción");
      cerrarMenu();
    });
    await prueba("editar día: guardar y deshacer", async () => {
      const antes = cifra(0);
      menuDe(0); pulsarMenu("Editar día");
      ok(await hasta(() => dlg()), "no abre");
      const h = document.querySelectorAll(".ed-fila .horas");
      h[0].value = "4,5"; h[0].dispatchEvent(new Event("input"));
      ok(document.querySelector(".ed-total").textContent.startsWith("6,5h"), "total no recalcula");
      botonDlg("Guardar");
      ok(await hasta(() => !dlg() && cifra(0) !== antes), "no guardó");
      ok(!document.getElementById("aviso-deshacer").hidden, "sin aviso Deshacer");
      teclado("z", { ctrlKey: true });
      ok(await hasta(() => cifra(0) === antes), "Ctrl+Z no deshizo");
    });
    await prueba("buscador de tareas: sin favoritas, por número y estrella", async () => {
      const guardadas = new Map(st.tareas);
      st.tareas.clear();                      // usuario sin favoritas ni buscadas
      try {
        menuDe(0); pulsarMenu("Editar día");
        ok(await hasta(() => dlg()), "no abre");
        [...document.querySelectorAll(".dlg-pie button")].find((b) => b.textContent.includes("Añadir tarea")).click();
        const inp = document.querySelector(".ed-tarea-input");
        ok(inp, "la fila nueva no tiene buscador");
        inp.dispatchEvent(new Event("focus"));
        const caja = () => [...document.querySelectorAll(".buscador-tareas")].find((c) => !c.hidden);
        ok(await hasta(() => caja()), "no se abre la lista");
        ok(caja().textContent.includes("Tus tareas habituales"), "sin habituales");
        inp.value = "11754"; inp.dispatchEvent(new Event("input"));
        ok(await hasta(() => caja()?.textContent.includes("ATE › [2026_ATE] Servicio")), "no busca por número (o sin proyecto › padre)");
        const fila = [...caja().querySelectorAll(".bt-item")].find((x) => x.textContent.includes("11754"));
        fila.querySelector(".bt-fav").click();
        ok(await hasta(() => st.favoritas.has(11754)), "la estrella no la hace favorita");
        fila.isConnected ? fila.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
          : [...caja().querySelectorAll(".bt-item")].find((x) => x.textContent.includes("11754")).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        ok(inp.value.startsWith("11754 - "), "no queda elegida");
        ok(await hasta(() => !document.querySelector(".ed-fila.nueva .ed-act").disabled), "no carga sus actividades");
      } finally {
        cerrarTodo();
        if (!st.tareas.size) for (const [k, v] of guardadas) st.tareas.set(k, v);
      }
    });
    await prueba("buscar en todo sin escribir nada", async () => {
      dlgBuscar();
      ok(await hasta(() => dlg()), "no abre");
      [...dlg().querySelectorAll("button")].find((b) => b.textContent.includes("Buscar en todo")).click();
      ok(await hasta(() => dlg().querySelectorAll("select.lista option").length >= 2), "no lista todas");
      cerrarTodo();
    });
    await prueba("formulario: la tarea también se busca", async () => {
      const inp = document.getElementById("tarea");
      inp.dispatchEvent(new Event("focus"));
      inp.value = "Proxmox"; inp.dispatchEvent(new Event("input"));
      const caja = () => [...document.querySelectorAll(".buscador-tareas")].find((c) => !c.hidden);
      ok(await hasta(() => caja()?.querySelector(".bt-item")), "sin resultados en el formulario");
      caja().querySelector(".bt-item").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      ok(await hasta(() => inp.value.includes("Proxmox")), "no rellena el formulario");
      inp.dispatchEvent(new Event("blur"));
    });
    await prueba("deshacer en varios niveles", async () => {
      const antes = cifra(2);
      for (const h of ["2", "3"]) {                     // dos cambios seguidos en el miércoles
        dias()[2].querySelector(".linea-h.editable").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        const i = document.querySelector(".horas-en-sitio");
        i.value = h; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        ok(await hasta(() => cifra(2).startsWith(`${h}h`)), `no cambió a ${h}h`);
      }
      teclado("z", { ctrlKey: true });
      ok(await hasta(() => cifra(2).startsWith("2h")), "el primer Ctrl+Z no volvió a 2h");
      ok(!$("b-deshacer").hidden, "tras el primero ya no se puede seguir deshaciendo");
      ok($("b-deshacer").closest(".cabeza-dias"), "Deshacer no está arriba, en la caja Días");
      teclado("z", { ctrlKey: true });
      ok(await hasta(() => cifra(2) === antes), "el segundo Ctrl+Z no volvió al principio");
    });
    await prueba("menú del día: «(local)», aviso y no volver a preguntar", async () => {
      const b = menuDe(3);
      ok(b.some((x) => x.textContent === "Marcar como baja (local)"), "sin «(local)»");
      ok(b.some((x) => x.textContent.startsWith("Añadir permiso por horas… (local)")), "permiso sin «(local)»");
      pulsarMenu("Marcar como baja (local)");
      ok(await hasta(() => dlg()?.textContent.includes("solo en tu FichaCSIRC")), "no avisa de que es local");
      ok(dlg().textContent.includes("[ATE] Permisos"), "no ofrece la tarea de permisos");
      // Imputar en esa tarea: Editar dia con la tarea ya puesta
      botonDlg("Imputar en esa tarea");
      ok(await hasta(() => document.querySelector(".ed-tarea-input")?.value.startsWith("13001 - ")), "no abre Editar día con la tarea");
      cerrarTodo();
      // ahora sí, solo aquí y sin volver a preguntar
      menuDe(3); pulsarMenu("Marcar como baja (local)");
      ok(await hasta(() => dlg()), "no vuelve a avisar");
      dlg().querySelector('.check input[type="checkbox"]').click();
      botonDlg("Marcar solo aquí");
      ok(await hasta(() => cifra(3).toLowerCase().includes("baja")), "no marcó la baja");
      ok(await hasta(() => (st.ini.avisos_local_no || []).includes("baja")), "no recuerda «no volver a preguntar»");
      menuDe(3); pulsarMenu("Quitar marca");
      ok(await hasta(() => !cifra(3).toLowerCase().includes("baja")), "no quita la marca");
      menuDe(3); pulsarMenu("Marcar como baja (local)");
      ok(await hasta(() => cifra(3).toLowerCase().includes("baja")), "volvió a preguntar o no marcó");
      ok(!dlg(), "volvió a preguntar");
      menuDe(3); pulsarMenu("Quitar marca");
      await hasta(() => !cifra(3).toLowerCase().includes("baja"));
    });
    await prueba("guardia y teletrabajo también son «(local)» y avisan", async () => {
      const b = menuDe(3);
      ok(b.some((x) => x.textContent === "Marcar día de guardia (local)"), "guardia sin «(local)»");
      ok(b.some((x) => x.textContent === "Quitar teletrabajo"), "quitar teletrabajo no debe ser «(local)»");
      pulsarMenu("Marcar día de guardia (local)");
      ok(await hasta(() => dlg()?.textContent.includes("solo en tu FichaCSIRC")), "guardia no avisa");
      ok(dlg().textContent.includes("[ATE] Guardias"), "no ofrece la tarea de guardias");
      ok(dlg().textContent.includes("como día de guardia"), "título raro");
      ok(!/null|undefined/.test(dlg().textContent), "escribe null/undefined");
      botonDlg("Marcar solo aquí");
      ok(await hasta(() => dias()[3].textContent.includes("Guardia")), "no marcó la guardia");
      menuDe(3); pulsarMenu("Quitar guardia");                  // quitar no pregunta
      ok(await hasta(() => !dias()[3].textContent.includes("Guardia")), "no quitó la guardia");
      ok(!dlg(), "quitar la guardia preguntó");
      // el jueves de la demo ya tiene teletrabajo: el viernes
      ok(menuDe(4).some((x) => x.textContent === "Marcar teletrabajo (local)"), "teletrabajo sin «(local)»");
      pulsarMenu("Marcar teletrabajo (local)");
      // en la demo el cupo semanal ya esta cubierto: primero esa pregunta
      ok(await hasta(() => !document.getElementById("modal").hidden), "no pregunta por el cupo");
      document.getElementById("modal-si").click();
      ok(await hasta(() => dlg()), "teletrabajo no avisa");
      ok(!dlg().textContent.includes("Tienes en ProyectosTIC"), "sin tarea de teletrabajo no debe ofrecer ninguna");
      botonDlg("Cancelar");
      ok(await hasta(() => !dlg()), "Cancelar no cierra");
      ok(!dias()[4].textContent.includes("Teletrabajo"), "Cancelar marcó el teletrabajo");
    });
    await prueba("Permisos: la actividad es un desplegable con todas", async () => {
      dlgPermisos();
      ok(await hasta(() => dlg()?.querySelector("select.actividad-permiso")), "la actividad no es un desplegable");
      const s = dlg().querySelector("select.actividad-permiso");
      ok(s.options.length >= 3, `solo ${s.options.length} opciones`);
      ok([...s.options].some((o) => o.value === "Asuntos propios"), "no ofrece «Asuntos propios»");
      cerrarTodo();
    });
    await prueba("Permisos: elegir dónde se imputa lo local", async () => {
      dlgPermisos();
      ok(await hasta(() => dlg()?.querySelectorAll(".tarea-local-fila").length === 5), "sin las 5 filas");
      const fila = () => [...dlg().querySelectorAll(".tarea-local-fila")].find((f) => f.textContent.includes("Teletrabajo"));
      const sel = fila().querySelector("select");
      sel.value = "ninguna"; sel.dispatchEvent(new Event("change"));
      ok(await hasta(() => fila().querySelector("select").value === "ninguna"), "no guarda «Ninguna»");
      cerrarTodo();
    });
    await prueba("sin conexión: dice por qué y qué hacer", async () => {
      pintarAvisoConexion({ conexion: "error", conexion_detalle: { tipo: "clave", titulo: "ProyectosTIC no acepta tu API key", texto: "Ha caducado." } });
      const a = document.getElementById("aviso-conexion");
      ok(!a.hidden && a.textContent.includes("no acepta tu API key"), "no se ve el motivo");
      ok([...a.querySelectorAll("button")].some((b) => b.textContent === "Abrir el asistente"), "sin botón al asistente");
      pintarAvisoConexion({ conexion: "ok" });
      ok(a.hidden, "con conexión no se esconde");
    });
    await prueba("cierre de mes: avisa y la X lo calla", async () => {
      const a = document.getElementById("aviso-mes");
      ok(await hasta(() => !a.hidden), "no avisa del cierre de mes");
      ok(a.querySelector(".dias-mes button"), "sin enlaces a los días");
      ok([...a.querySelectorAll("button")].some((b) => b.textContent === "Completar ahora"), "sin «Completar ahora»");
      a.querySelector(".cerrar-aviso").click();
      ok(a.hidden, "la X no lo cierra");
      await avisarCierreMes();
      ok(a.hidden, "vuelve a salir tras cerrarlo");
    });
    await prueba("etiquetas: «local» con borde, en ProyectosTIC rellena", async () => {
      const c = chipsMarcas({ guardia: true, guardia_pt: false, teletrabajo: false, teletrabajo_pt: true, permiso: "", permiso_pt: "" });
      ok(c.length === 2, `salen ${c.length} etiquetas`);
      ok(c[0].classList.contains("local") && c[0].textContent.includes("local"), "la guardia local no se distingue");
      ok(!c[1].classList.contains("local"), "el teletrabajo imputado sale como local");
    });
    await prueba("aviso local de un festivo: sin «null»", async () => {
      menuDe(3); pulsarMenu("Marcar como festivo (local)");
      ok(await hasta(() => dlg()), "no avisa");
      ok(!/null|undefined/.test(dlg().textContent), `el aviso dice: ${dlg().textContent.slice(0, 120)}`);
      botonDlg("Cancelar");
      ok(await hasta(() => !dlg()), "Cancelar no cierra");
    });
    await prueba("menú del día: «Añadir otra tarea…» abre su menú", async () => {
      menuDe(4);
      const otra = [...document.querySelectorAll("#menu button")].find((x) => x.textContent.includes("Añadir otra tarea"));
      if (!otra) { cerrarMenu(); return; }              // el viernes ya esta completo: no sale
      otra.click();                                       // .click() hace burbujear el clic como uno de verdad
      ok(await hasta(() => document.querySelector("#menu .titulo-menu")?.textContent.startsWith("Añadir al")), "el menú se cierra solo");
      ok(!document.getElementById("menu").hidden, "el menú se cerró");
      cerrarMenu();
    });
    await prueba("horas editables en la ficha", async () => {
      const antes = cifra(1);
      const s = dias()[1].querySelector(".linea-h.editable");
      s.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const i = document.querySelector(".horas-en-sitio");
      ok(i, "no aparece el campo");
      i.value = "4"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      ok(await hasta(() => cifra(1) !== antes), "no cambió");
    });
    await prueba("+ rápido añade al viernes", async () => {
      dias()[4].querySelector(".b-mas-dia").click();
      ok(await hasta(() => document.querySelector("#menu .titulo-menu")?.textContent.includes("viernes")), "menú del +");
      const bs = [...document.querySelectorAll("#menu button")];
      ok(bs[0].textContent.includes("Copiar día anterior"), "sin «Copiar día anterior» arriba");
      ok(bs.some((b) => b.textContent.startsWith("▤ Plantilla")), "sin plantillas en el +");
      bs.find((b) => b.textContent.startsWith("+ ")).click();
      ok(await hasta(() => dias()[4].querySelectorAll(".ap-tarjeta").length === 1), "no añadió");
    });
    await prueba("completar con…", async () => {
      menuDe(4); pulsarMenu("Completar con [ASG] Proxmox");   // la otra ya está ese día (pediría confirmar)
      ok(await hasta(() => cifra(4).includes("✔")), "el viernes no quedó completo");
    });
    await prueba("arrastrar copia (y con Mayús mueve)", async () => {
      const n = dias()[3].querySelectorAll(".ap-tarjeta").length;
      const ap = dias()[2].querySelector('.ap-tarjeta[draggable="true"]');
      const dt = new DataTransfer();
      ap.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      dias()[3].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      ok(dias()[3].classList.contains("soltar"), "sin marca de soltar");
      dias()[3].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      ap.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
      ok(await hasta(() => dias()[3].querySelectorAll(".ap-tarjeta").length === n + 1), "no copió");
      ok(dias()[2].querySelectorAll(".ap-tarjeta").length === 1, "copiar borró el origen");
    });
    await prueba("Ctrl+C / Ctrl+V de un día", async () => {
      // sin ventana no hay foco de teclado fiable: se usa el dia marcado
      st.marcados = new Set([st.dias[0].iso]); pintarMarcados();
      teclado("c", { ctrlKey: true });
      ok(st.portapapeles, `no copió (pila=${pila.length}, modal oculto=${document.getElementById("modal").hidden}, marcados=${st.marcados.size}, apuntes dia0=${st.dias[0].apuntes.length}, bloqueo=${!!document.querySelector(".bloqueo")})`);
      const n = dias()[3].querySelectorAll(".ap-tarjeta").length;
      st.marcados = new Set([st.dias[3].iso]); pintarMarcados();
      teclado("v", { ctrlKey: true });
      ok(await hasta(() => !document.getElementById("modal").hidden), "no pregunta");
      document.getElementById("modal-si").click();
      ok(await hasta(() => dias()[3].querySelectorAll(".ap-tarjeta").length > n), "no pegó");
    });
    await prueba("cajas: minimizar, cerrar y menú Ver", async () => {
      document.querySelector('[data-panel="form"] .b-panel[data-accion="min"]').click();
      ok(document.querySelector('[data-panel="form"]').classList.contains("minimizado"), "no minimiza");
      document.querySelector('[data-panel="apuntes"] .b-panel:not([data-accion])').click();
      ok(document.querySelector(".zona-trabajo").classList.contains("una-columna"), "no pasa a una columna");
      document.querySelector('.menubar [data-menu="ver"]').click();
      pulsarMenu("Apuntes de la semana");
      ok(!document.querySelector('[data-panel="apuntes"]').classList.contains("cerrado"), "Ver no la repone");
      document.querySelector('[data-panel="form"] h2').click();
      ok(!document.querySelector('[data-panel="form"]').classList.contains("minimizado"), "el título no la abre");
    });
    await prueba("tamaño de letra y tema", async () => {
      teclado("+", { ctrlKey: true });
      ok(document.documentElement.style.zoom === "1.1", "Ctrl+ no amplía");
      teclado("0", { ctrlKey: true });
      ok(document.documentElement.style.zoom === "", "Ctrl+0 no restaura");
      const claro = getComputedStyle(document.body).backgroundColor;
      aplicarTema("oscuro");
      ok(getComputedStyle(document.body).backgroundColor !== claro, "el tema oscuro no cambia el fondo");
      aplicarTema("claro");
    });
    await prueba("estadísticas en la propia ventana", async () => {
      ok(!document.querySelector('.selector-vista [data-vista="estad"]'), "Estadísticas sigue junto a Semana y Mes");
      $("b-estad").click();
      ok($("b-estad").classList.contains("activo"), "el botón no queda resaltado");
      ok(await hasta(() => !$("estadisticas").hidden && $("estadisticas").textContent.includes("Tareas más realizadas")), "no se ve el panel");
      ok(await hasta(() => $("estadisticas").querySelector(".pills-periodo button.activo")?.textContent === "Anual"), "no se abre en la vista anual");
      ok(!$("b-resumen"), "sigue el botón Resumen (ahora es el «cómo va» de Estadísticas)");
      ok(await hasta(() => $("estadisticas").querySelector(".estad-comova .comova-estado")), "no se ve «cómo va»");
      // un dia por completar: a su semana, con el dia marcado
      $("estadisticas").querySelector(".chip-dia").click();
      ok(await hasta(() => $("estadisticas").hidden && document.querySelector(".dia.marcado")), "el día por completar no lleva al día");
      $("b-estad").click();
      ok(await hasta(() => !$("estadisticas").hidden), "no vuelve a Estadísticas");
      ok(getComputedStyle($("seccion-dias")).display === "none", "las fichas siguen a la vista");
      ok(!dlg(), "salió en una ventana flotante");
      $("b-sig").click();
      ok(await hasta(() => $("titulo-semana").textContent.length > 0), "las flechas no mueven el periodo");
      ok(!$("estadisticas").hidden, "las flechas sacan de Estadísticas");
      // "Hoy": a la semana de hoy, con su ficha marcada
      $("b-hoy").click();
      ok(await hasta(() => $("estadisticas").hidden && dias().length === 5), "Hoy no vuelve a la semana");
      ok(await hasta(() => document.querySelector(".dia.hoy.marcado")), "Hoy no marca la ficha de hoy");
      ok(document.querySelector('.selector-vista [data-vista="semana"]').classList.contains("activo"), "no queda en Semana");
      ok(!$("b-estad").classList.contains("activo"), "el botón sigue resaltado fuera del panel");
      // pulsado dos veces: entra y vuelve a las fichas
      $("b-estad").click();
      ok(await hasta(() => !$("estadisticas").hidden), "no entra");
      $("b-estad").click();
      ok(await hasta(() => $("estadisticas").hidden && dias().length === 5), "pulsado otra vez no vuelve a las fichas");
    });
    await prueba("por completar: marcar días y completarlos en bloque", async () => {
      ok(await hasta(() => $("b-pend").querySelector(".n-pend").textContent !== ""), "el botón no dice cuántos faltan");
      $("b-pend").click();
      ok($("b-pend").classList.contains("activo"), "el botón no queda resaltado");
      ok(await hasta(() => !$("estadisticas").hidden && $("estadisticas").querySelector(".pend-dia")), "no se ve la lista de días");
      ok(getComputedStyle($("seccion-dias")).display === "none", "las fichas siguen a la vista");
      const p = $("estadisticas");
      // fichas de los meses: la del año y 12 meses; la elegida filtra la lista
      ok(p.querySelectorAll(".pend-ficha").length === 13, "no salen las 13 fichas (año y meses)");
      p.querySelector(".pend-ficha.anual").click();
      const todo = p.querySelectorAll(".pend-dia").length;
      ok(p.querySelector(".pend-ficha.anual.activa") && todo === Number($("b-pend").querySelector(".n-pend").textContent),
         "la ficha del año no muestra todos los días");
      const mesPend = [...p.querySelectorAll("button.pend-ficha.pendiente:not(.anual)")].pop();
      mesPend.click();
      ok(mesPend.isConnected === false && p.querySelector(".pend-ficha.activa:not(.anual)"), "la ficha del mes no queda elegida");
      ok(p.querySelectorAll(".pend-mes").length === 1 && p.querySelectorAll(".pend-dia").length < todo, "la ficha del mes no filtra la lista");
      ok(!p.querySelector("div.pend-ficha.futuro, div.pend-ficha.completo")?.onclick, "un mes completo o futuro se puede abrir");
      const antes = p.querySelectorAll(".pend-dia").length;
      const acciones = [...p.querySelectorAll(".pend-barra button")];
      ok(acciones.length === 3 && acciones.every((b) => b.disabled), "las acciones no empiezan apagadas");
      // Mayus+clic: un rango
      const cs = [...p.querySelectorAll("input[data-iso]")];
      cs[0].click();
      cs[2].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
      ok(cs.slice(0, 3).every((c) => c.checked), "Mayús+clic no marca el rango");
      ok(acciones.every((b) => !b.disabled), "las acciones no se encienden");
      ok(/3 días marcados/.test(p.querySelector(".pend-marcados").textContent), "no dice cuántos hay marcados");
      // completar: resumen antes y fuera de la lista despues
      acciones[0].click();
      ok(await hasta(() => dlg()?.textContent.includes("Se añadirán")), "no sale el resumen antes de completar");
      ok(!/\bnull\b|undefined/.test(dlg().textContent), "escribe null/undefined");
      ok(await hasta(() => !dlg().querySelector(".dlg-pie .primario").disabled), "no deja completar con una tarea habitual");
      dlg().querySelector(".dlg-pie .primario").click();
      ok(await hasta(() => !dlg() && p.querySelectorAll(".pend-dia").length === antes - 3), "los días completados siguen en la lista");
      ok(/Completados 3 días/.test($("estado").textContent), `no dice lo hecho: ${$("estado").textContent}`);
      // el boton Todos y las otras dos acciones abren su dialogo
      p.querySelector(".pend-barra input").click();
      ok(p.querySelectorAll("input[data-iso]:checked").length === p.querySelectorAll(".pend-dia").length, "Todos no los marca todos");
      for (const [i, titulo] of [[1, "Aplicar plantilla"], [2, "Copiar un día"]]) {
        p.querySelectorAll(".pend-barra button")[i].click();
        ok(await hasta(() => dlg()?.querySelector("h3")?.textContent === titulo), `no abre «${titulo}»`);
        dlg().querySelector(".dlg-x").click();
        ok(await hasta(() => !dlg()), `«${titulo}» no se cierra`);
      }
      // otra pulsacion: a las fichas
      $("b-pend").click();
      ok(await hasta(() => $("estadisticas").hidden && dias().length === 5), "pulsado otra vez no vuelve a las fichas");
      ok(!$("b-pend").classList.contains("activo"), "el botón sigue resaltado fuera del panel");
    });
    await prueba("por completar: marcar el día, te pasas, repartir y buscar", async () => {
      $("b-pend").click();
      const p = $("estadisticas");
      ok(await hasta(() => p.querySelector(".pend-dia")), "no se ve la lista");
      p.querySelector(".pend-ficha.anual").click();
      // ⋯ de un dia: marcarlo como vacaciones lo saca de la lista
      const n0 = p.querySelectorAll(".pend-dia").length;
      p.querySelector(".pend-mas").click();
      ok(!$("menu").hidden, "el ⋯ no abre el menú");
      pulsarMenu("Marcar como vacaciones");
      ok(await hasta(() => dlg()), "no avisa de que es solo en este equipo");
      botonDlg("Marcar solo aquí");
      ok(await hasta(() => p.querySelectorAll(".pend-dia").length === n0 - 1), "el día marcado sigue en la lista");
      // Te pasas: el dia con el apunte repetido
      [...p.querySelectorAll(".pend-modo button")].find((b) => b.textContent.startsWith("Te pasas")).click();
      ok(await hasta(() => p.querySelector(".pend-dia.exceso")), "no salen los días en que te pasas");
      ok(p.querySelector(".chip-marca.repetido"), "no marca el apunte repetido");
      ok(p.querySelector(".pend-fichas").hidden && p.querySelector(".pend-barra").hidden, "en «Te pasas» siguen las fichas o las acciones");
      [...p.querySelectorAll(".pend-modo button")].find((b) => b.textContent.startsWith("Faltan")).click();
      ok(await hasta(() => !p.querySelector(".pend-fichas").hidden), "no vuelve a «Faltan»");
      // completar repartido entre varias tareas
      p.querySelector(".pend-ficha.anual").click();
      const cs = [...p.querySelectorAll("input[data-iso]")];
      const n1 = cs.length;
      cs[0].click(); cs[1].click();
      p.querySelector(".pend-barra .primario").click();
      ok(await hasta(() => dlg()?.querySelector(".pend-modos")), "no se puede elegir repartir");
      dlg().querySelectorAll(".pend-modos input")[1].click();
      ok(await hasta(() => dlg().querySelectorAll(".pend-reparto-fila").length >= 2), "no propone el reparto de las habituales");
      const pcts = [...dlg().querySelectorAll(".pend-reparto-fila input")].map((i) => Number(i.value));
      ok(pcts.reduce((a, b) => a + b, 0) === 100, `el reparto propuesto no suma 100 (${pcts})`);
      ok(/repartidas entre/.test(dlg().querySelector(".pend-resumen").textContent), "el resumen no dice el reparto");
      ok(!/\bnull\b|undefined|NaN/.test(dlg().textContent), "escribe null/undefined/NaN");
      dlg().querySelector(".dlg-pie .primario").click();
      ok(await hasta(() => !dlg() && p.querySelectorAll(".pend-dia").length === n1 - 2), "no completa repartido");
      ok(/Completados 2 días con \d tareas/.test($("estado").textContent), `no dice lo hecho: ${$("estado").textContent}`);
      $("b-pend").click();
      ok(await hasta(() => $("estadisticas").hidden), "no vuelve a las fichas");
      // Ctrl+F: buscar en mis apuntes, y el resultado lleva al dia
      teclado("f", { ctrlKey: true });
      ok(await hasta(() => dlg()?.querySelector("h3")?.textContent === "Buscar en mis apuntes"), "Ctrl+F no abre la búsqueda");
      const caja = dlg().querySelector("input[type=search]");
      caja.value = "certificado ssl";
      caja.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      ok(await hasta(() => dlg()?.querySelector(".busca-res")), "no encuentra el apunte");
      dlg().querySelector(".busca-res").click();
      ok(await hasta(() => !dlg() && document.querySelector(".dia.marcado")), "el resultado no lleva al día");
      $("b-hoy").click();
      ok(await hasta(() => document.querySelector(".dia.hoy")), "no vuelve a hoy");
    });
    await prueba("quitar el apunte que sobra, informe, plantilla de semana y bandeja", async () => {
      // Te pasas > Quitar apunte: el que deja el dia justo, y el dia sale de la lista
      $("b-pend").click();
      const p = $("estadisticas");
      const bPasas = () => [...p.querySelectorAll(".pend-modo button")].find((x) => x.textContent.startsWith("Te pasas"));
      ok(await hasta(bPasas), "no se ve el panel");
      bPasas().click();
      ok(await hasta(() => p.querySelector(".pend-quitar")), "sin «Quitar apunte» en los días en que te pasas");
      p.querySelector(".pend-quitar").click();
      ok(!$("menu").hidden, "«Quitar apunte» no abre el menú");
      pulsarMenu("deja el día justo");
      ok(await hasta(() => !$("modal").hidden), "no pide confirmación antes de quitar");
      $("modal-si").click();
      ok(await hasta(() => !p.querySelector(".pend-dia.exceso")), "el día sigue en «Te pasas» tras quitar el apunte");
      ok(/Quitadas 2h/.test($("estado").textContent), `no dice lo quitado: ${$("estado").textContent}`);
      $("b-pend").click();
      ok(await hasta(() => $("estadisticas").hidden), "no vuelve a las fichas");
      // Estadisticas > Informe: una pagina suelta, sin scripts y con su boton de imprimir
      $("b-estad").click();
      ok(await hasta(() => { const b = [...$("estadisticas").querySelectorAll("button")].find((x) => x.textContent.includes("Informe")); return b && !b.disabled; }),
         "sin botón de informe");
      [...$("estadisticas").querySelectorAll("button")].find((x) => x.textContent.includes("Informe")).click();
      ok(await hasta(() => window.__informe), "no prepara el informe");
      const inf = window.__informe;
      ok(inf.startsWith("<!doctype html>") && inf.includes("Horas por tarea") && inf.includes("Persona de Prueba"), "al informe le falta contenido");
      ok(!/<script/i.test(inf) && inf.includes('onclick="window.print()"'), "el informe lleva scripts o le falta Imprimir");
      ok(!/\bnull\b|undefined|NaN/.test(inf.replace(/<style>[\s\S]*?<\/style>/, "")), "el informe escribe null/undefined/NaN");
      $("b-estad").click();
      ok(await hasta(() => $("estadisticas").hidden && dias().length === 5), "no vuelve a las fichas desde Estadísticas");
      // Plantillas: guardar la semana y aplicarla
      dlgPlantillas();
      ok(await hasta(() => dlg()), "no abre Plantillas");
      botonDlg("Guardar esta semana");
      ok(await hasta(() => document.querySelectorAll(".dlg").length === 2), "no pide el nombre de la plantilla de semana");
      botonDlg("Guardar");
      ok(await hasta(() => [...document.querySelectorAll(".dlg select.lista option")].some((o) => o.textContent.startsWith("📅 Semana tipo"))),
         "la plantilla de semana no sale en la lista");
      const lista = dlg().querySelector("select.lista");
      lista.selectedIndex = [...lista.options].findIndex((o) => o.textContent.startsWith("📅"));
      lista.dispatchEvent(new Event("change"));
      const bAplicar = [...document.querySelectorAll(".dlg-pie button")].find((x) => x.textContent.startsWith("Aplicar a la semana del"));
      ok(bAplicar, "el botón no dice a qué semana se aplica");
      bAplicar.click();
      ok(await hasta(() => !$("modal").hidden), "no pregunta antes de aplicar la semana");
      $("modal-si").click();
      ok(await hasta(() => /Plantilla de semana aplicada: 3 apuntes/.test($("estado").textContent)), `no dice lo aplicado: ${$("estado").textContent}`);
      ok(!dlg(), "el diálogo de plantillas no se cierra");
      // lo fichado desde el icono de la bandeja llega a la ventana, con su Deshacer
      await alFicharFuera({ creados: 1, horas: "7h", puede_deshacer: true, quedan: 1 }, "Hoy: 7h en «Mantenimientos».");
      ok(!$("aviso-deshacer").hidden && $("aviso-deshacer").textContent.includes("Hoy: 7h"), "lo fichado desde la bandeja no se ve en la ventana");
      ocultarAviso();
    });
    await prueba("vista mensual", async () => {
      document.querySelector('.selector-vista [data-vista="mes"]').click();
      ok(await hasta(() => document.querySelectorAll(".celda").length >= 20), "sin celdas");
      ok(document.querySelector(".celda .b-mas-dia"), "celda sin +");
      document.querySelector('.selector-vista [data-vista="semana"]').click();
      ok(await hasta(() => dias().length === 5), "no vuelve a la semana");
    });
    const dialogos = [["plantillas", dlgPlantillas], ["permisos", dlgPermisos], ["diagnóstico", dlgDiagnostico],
      ["exportar", dlgExportar], ["festivos", dlgFestivos], ["ajustes de días", dlgAjustesDias],
      ["INARI", dlgInari], ["buscar tarea", dlgBuscar], ["PIN", dlgPin], ["bandeja", dlgBandeja], ["copias", dlgCopias],
      ["novedades", dlgNovedades], ["tecnología", dlgTecnologia], ["atajos", dlgAtajos], ["acerca de", dlgAcerca]];
    for (const [nombre, fn] of dialogos) {
      await prueba(`diálogo ${nombre} abre y cierra`, async () => {
        fn();
        ok(await hasta(() => dlg()), "no abre");
        await espera(300);                 // que terminen sus llamadas a la API
        ok(!/\bnull\b|undefined/.test(dlg().textContent), "escribe null/undefined");
        if (nombre === "festivos") ok(await hasta(() => document.querySelector(".festivo.ugr input")), "sin días UGR revisables");
        if (nombre === "novedades") {
          ok(/2\.9\.2/.test(dlg().textContent), "no enseña las versiones que hay");
          ok(!/9\.0\.0|aún no tienes/.test(dlg().textContent), "enseña lo de una versión posterior a la instalada");
        }
        // los párrafos con viñeta (p.punto) a todo lo ancho: una regla .punto de
        // la leyenda los dejaba en 8px y las palabras salían apiladas
        for (const p of dlg().querySelectorAll("p.punto")) ok(p.getBoundingClientRect().width > 200, `«${nombre}»: texto aplastado`);
        cerrarTodo();
        ok(!dlg(), "no cierra");
      });
    }
    await prueba("salir: botón a la vista en la cabecera, en Archivo y con Ctrl+Q", async () => {
      const b = $("b-salir");
      ok(b && b.getBoundingClientRect().width > 40 && /Salir/.test(b.textContent), "sin botón Salir en la cabecera");
      let veces = 0;
      const antes = window.pywebview.api.cerrar;
      window.pywebview.api.cerrar = () => { veces++; return Promise.resolve({ ok: true }); };
      try {
        b.click();
        ok(await hasta(() => veces === 1), "el botón no cierra la app");
        document.querySelector('.menubar [data-menu="archivo"]').click();
        pulsarMenu("Salir de FichaCSIRC");
        ok(await hasta(() => veces === 2), "Archivo → Salir no cierra la app");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "q", ctrlKey: true, bubbles: true }));
        ok(await hasta(() => veces === 3), "Ctrl+Q no cierra la app");
      } finally {
        window.pywebview.api.cerrar = antes;
      }
    });
    await prueba("comentario: al entrar en el campo ofrece los usados con la tarea; se eligen con el teclado o el ratón", async () => {
      const campo = $("comentario"), lista = () => $("lista-comentarios"), filas = () => lista().querySelectorAll(".bt-item");
      const a = window.pywebview.api, antes = a.comentarios_tareas, valorAntes = campo.value, autoAntes = st.comAuto;
      const wp = resolverTarea();
      ok(wp != null, "sin tarea elegida en el formulario");
      let veces = 0;
      a.comentarios_tareas = () => {
        veces++;
        return Promise.resolve({ por_tarea: { [wp]: ["Revisión de copias", "Parches de seguridad", "Certificados"],
                                              999999: ["De otra tarea"] } });
      };
      comTareas.mapa = null;
      const escribir = (t) => { campo.value = t; campo.dispatchEvent(new Event("input", { bubbles: true })); };
      const tecla = (key) => {
        const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        campo.dispatchEvent(e);
        return e;
      };
      try {
        campo.value = ""; st.comAuto = "";
        campo.focus();
        if (!document.hasFocus()) campo.dispatchEvent(new FocusEvent("focus"));   // ventana sin foco: focus() no avisa
        ok(await hasta(() => !lista().hidden && filas().length === 3), "no ofrece los comentarios de la tarea");
        ok(!/De otra tarea/.test(lista().textContent), "ofrece comentarios de otra tarea");
        escribir("revision");                               // filtra, sin tildes
        ok(filas().length === 1 && /Revisión de copias/.test(lista().textContent), "no filtra al escribir");
        escribir("");
        tecla("ArrowDown"); tecla("ArrowDown");             // teclado
        const intro = tecla("Enter");
        ok(campo.value === "Parches de seguridad" && lista().hidden, `con el teclado queda «${campo.value}»`);
        ok(intro.defaultPrevented, "Intro sobre una sugerencia añadiría el apunte");
        escribir("");
        ok(!lista().hidden && filas().length === 3, "no vuelve a ofrecerlos al vaciar el campo");
        filas()[2].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));   // raton
        ok(campo.value === "Certificados" && lista().hidden, `con el ratón queda «${campo.value}»`);
        // el que la app pone sola (el último usado) ni filtra la lista ni se repite en ella
        st.comAuto = "Revisión de copias";
        escribir("Revisión de copias");
        ok(!lista().hidden && filas().length === 2 && !/Revisión/.test(lista().textContent), "el comentario sugerido filtra o se repite");
        tecla("Escape");
        ok(lista().hidden, "Escape no cierra la lista");
        ok(veces === 1, `pidió los comentarios ${veces} veces`);
        // lo que se añade desde el formulario pasa a ser el primero
        recordarComentario(wp, "Uno nuevo");
        ok(comTareas.mapa[wp][0] === "Uno nuevo" && comTareas.mapa[wp].length === 4, "no recuerda el comentario recién usado");
      } finally {
        a.comentarios_tareas = antes;
        comTareas.mapa = null;
        campo.value = valorAntes; st.comAuto = autoAntes;
        campo.blur();
      }
    });
    await prueba("PIN: el tiempo de bloqueo se cambia sin cambiar el PIN, y la ventana dice que se ha guardado", async () => {
      const a = window.pywebview.api, antes = { estado: a.pin_estado, auto: a.pin_auto }, pinAntes = st.ini.pin;
      const pedidos = [];
      a.pin_estado = () => Promise.resolve({ activo: true, desbloqueada: true, auto_min: 15 });
      a.pin_auto = (m) => { pedidos.push(String(m)); return Promise.resolve({ ok: true }); };
      try {
        st.ini.pin = { activo: true, desbloqueada: true, auto_min: 15 };
        dlgPin();
        ok(await hasta(() => dlg() && dlg().querySelector("select")), "no abre la ventana del PIN");
        const sel = dlg().querySelector("select"), pin = dlg().querySelector('input[type="password"]');
        ok(sel.value === "15", `no enseña el tiempo guardado: ${sel.value}`);
        ok(sel.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING, "el tiempo no va antes de los campos del PIN");
        sel.value = "30";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        ok(await hasta(() => pedidos.length === 1 && pedidos[0] === "30"), "no guarda el tiempo al elegirlo");
        ok(await hasta(() => /Guardado/.test(dlg().querySelector(".pin-guardado").textContent)), "la ventana no dice que se ha guardado");
        ok(st.ini.pin.auto_min === 30, "la app no se entera del tiempo nuevo");
        // «Cambiar PIN» sin escribir nada no pide el PIN: explica que el tiempo ya esta guardado
        botonDlg("Cambiar PIN");
        ok(await hasta(() => !$("modal").hidden && /no hace falta cambiar el PIN/.test($("modal-texto").textContent)),
           "«Cambiar PIN» en blanco no lo explica");
        $("modal-si").click();
        ok(await hasta(() => $("modal").hidden), "el aviso no se cierra");
        cerrarTodo();
        ok(await hasta(() => !dlg()), "no se cierra");
      } finally {
        a.pin_estado = antes.estado; a.pin_auto = antes.auto;
        st.ini.pin = pinAntes;
        vigilarInactividad();
      }
    });
    await prueba("bloquear: botón siempre a la vista junto a Salir; sin PIN lleva a activarlo, con PIN bloquea (también Ctrl+L y Archivo)", async () => {
      const b = $("b-bloquear");
      const caja = b.getBoundingClientRect(), salir = $("b-salir").getBoundingClientRect();
      ok(!b.hidden && caja.width > 30, "el botón Bloquear no se ve");
      ok(caja.right <= salir.left && Math.abs(caja.top - salir.top) < 2, "Bloquear no está a la izquierda de Salir, en su línea");
      const ctrlL = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "l", ctrlKey: true, bubbles: true }));
      const archivo = (texto) => { document.querySelector('.menubar [data-menu="archivo"]').click(); pulsarMenu(texto); };
      let veces = 0;
      const antes = window.pywebview.api.pin_bloquear, pinAntes = st.ini.pin;
      window.pywebview.api.pin_bloquear = () => { veces++; return Promise.resolve({ bloqueada: false }); };
      try {
        // sin PIN: las tres entradas abren «PIN de acceso» explicando para que
        ok(!st.ini.pin?.activo && /activarlo/.test(b.title), "sin PIN, el botón no avisa de que hay que activarlo");
        for (const [como, pulsar] of [["el botón", () => b.click()], ["Ctrl+L", ctrlL],
                                      ["Archivo", () => archivo("Bloquear con un PIN")]]) {
          pulsar();
          ok(await hasta(() => dlg() && /Para bloquear FichaCSIRC hace falta un PIN/.test(dlg().textContent)),
             `sin PIN, ${como} no lleva a activarlo`);
          ok([...document.querySelectorAll(".dlg-pie button")].some((x) => x.textContent.trim() === "Activar PIN"), "sin botón Activar PIN");
          botonDlg("Cancelar");
          ok(await hasta(() => !dlg()), "la ventana del PIN no se cierra");
        }
        ok(veces === 0, "sin PIN se llamó a bloquear");
        // con PIN: las tres bloquean
        st.ini.pin = { activo: true, desbloqueada: true, auto_min: 0 };
        vigilarInactividad();                 // lo que hace la ventana del PIN al activarlo
        ok(/pide el PIN/.test(b.title), "con PIN, el botón no dice que lo pide");
        b.click();
        ok(await hasta(() => veces === 1), "el botón no bloquea");
        ctrlL();
        ok(await hasta(() => veces === 2), "Ctrl+L no bloquea");
        archivo("Bloquear con el PIN");
        ok(await hasta(() => veces === 3), "Archivo → Bloquear no bloquea");
        ok(!dlg(), "con PIN no debe abrir la ventana del PIN");
      } finally {
        window.pywebview.api.pin_bloquear = antes;
        st.ini.pin = pinAntes;
        vigilarInactividad();
      }
    });
    await prueba("campana: «Probar el aviso ahora» abre la ventanita de prueba", async () => {
      const a = window.pywebview.api, antes = a.recordatorio_probar;
      let veces = 0;
      a.recordatorio_probar = () => { veces++; return Promise.resolve({ ok: true }); };
      try {
        dlgRecordatorio();
        ok(await hasta(() => dlg() && /Probar el aviso ahora/.test(dlg().textContent)), "la ventana de la campana no ofrece probar el aviso");
        ok(/Solo aparece si|solo aparece si/.test(dlg().textContent), "no dice que el aviso solo sale si faltan horas");
        [...dlg().querySelectorAll("button.enlace")].find((b) => /Probar el aviso/.test(b.textContent)).click();
        ok(await hasta(() => veces === 1), "el botón no abre el aviso de prueba");
        ok(dlg(), "probar el aviso no debe cerrar la ventana de la campana");
      } finally {
        a.recordatorio_probar = antes;
        cerrarTodo();
      }
    });
    await prueba("campana del aviso diario: el globo lo activa a las 14:00, se cambia la hora y se quita", async () => {
      const b = $("b-aviso");
      ok(await hasta(() => !b.hidden), "sin campana en la barra");
      $("globo-aviso")?.remove();
      ok(/Activar aviso/.test(b.textContent), `apagada dice: ${b.textContent}`);
      // la primera vez lo ofrece un globo bajo la campana
      globoAviso({ por_defecto: "14:00" });
      ok($("globo-aviso"), "no sale el globo");
      // con una franja de aviso debajo, no tapa sus enlaces («Completar ahora»)
      const franja = $("aviso-semana"), estaba = franja.hidden, hijos = [...franja.childNodes];
      franja.replaceChildren(el("span", { class: "aviso-semana-texto", text: "La semana pasada te quedaron días sin completar." }),
                             el("button", { class: "enlace", text: "Completar ahora" }),
                             el("button", { class: "cerrar-aviso", text: "×" }));
      franja.hidden = false;
      const rg = $("globo-aviso").getBoundingClientRect();
      const tapados = [...document.querySelectorAll(".aviso-semana:not([hidden]) button, .aviso-conexion:not([hidden]) button")]
        .filter((x) => {
          const r = x.getBoundingClientRect();
          return r.width && !(r.right <= rg.left || r.left >= rg.right || r.bottom <= rg.top || r.top >= rg.bottom);
        }).map((x) => x.textContent.trim());
      franja.replaceChildren(...hijos);
      franja.hidden = estaba;
      ok(!tapados.length, `el globo tapa: ${tapados.join(", ")}`);
      // cuelga del boton (no de la ventana): lo sigue al desplazar o cambiar de tamaño
      ok($("globo-aviso").parentElement === $("ancla-aviso") && $("ancla-aviso").contains(b),
         "el globo no cuelga de la campana");
      ok(!$("b-exportar"), "Exportar CSV sigue en la barra (va en el menú Archivo)");
      [...$("globo-aviso").querySelectorAll("button")].find((x) => x.textContent.startsWith("Activar")).click();
      ok(await hasta(() => b.textContent.includes("14:00")), `tras activar: ${b.textContent}`);
      ok(!$("globo-aviso"), "el globo no se va");
      // ya ofrecido: no vuelve a salir
      await pintarCampana({ ofrecer: true });
      ok(!$("globo-aviso"), "el globo vuelve a salir");
      // la campana abre el formulario: otra hora, y el boton la dice
      b.click();
      ok(await hasta(() => dlg()), "la campana no abre el formulario");
      ok(dlg().querySelector("input[type=time]").value === "14:00", "no trae la hora que tiene");
      dlg().querySelector("input[type=time]").value = "13:30";
      botonDlg("Guardar");
      ok(await hasta(() => b.textContent.includes("13:30")), `tras cambiar la hora: ${b.textContent}`);
      ok(!dlg(), "el formulario no se cierra");
      // y se quita
      b.click();
      ok(await hasta(() => dlg()), "no abre");
      botonDlg("Desactivar aviso");
      ok(await hasta(() => !$("modal").hidden), "no pregunta antes de desactivar");
      $("modal-si").click();
      ok(await hasta(() => /Activar aviso/.test(b.textContent)), `tras quitar: ${b.textContent}`);
      cerrarTodo();
    });
    await prueba("nueva tarea: se crea en ProyectosTIC y queda en el formulario", async () => {
      ok(await hasta(() => !$("b-nueva").hidden), "no ofrece «＋ Nueva» a quien puede crear");
      $("b-nueva").click();
      ok(await hasta(() => document.querySelector(".nt-tipo")), "no pinta los tipos del proyecto");
      ok(!/\bnull\b|undefined/.test(dlg().textContent), "escribe null/undefined");
      const crear = () => document.querySelector(".dlg-pie button.primario");
      // sin titulo no crea: lo dice
      crear().click();
      ok(await hasta(() => !document.querySelector(".nt-error").hidden), "sin título no avisa");
      const tit = document.querySelector(".nt-titulo");
      tit.value = "Tarea de humo"; tit.dispatchEvent(new Event("input"));
      ok(document.querySelector(".nt-error").hidden, "el aviso del título no se quita al escribirlo");
      ok(document.querySelector(".nt-vista").textContent.includes("Tarea de humo"), "la vista previa no sigue al título");
      // otro proyecto: ahi no deja asignarse, y el tipo Incidencia pide un campo que la app no rellena
      const proy = document.querySelector(".nt-dos select");
      proy.value = "3"; proy.dispatchEvent(new Event("change"));
      ok(await hasta(() => document.querySelector(".nt-opciones input").disabled), "deja asignarse donde no se puede");
      ok(document.querySelector(".nt-vista").textContent.includes("Sin asignar"), "la vista previa la da por asignada");
      const tipo = (n) => [...document.querySelectorAll(".nt-tipo")].find((b) => b.textContent.includes(n));
      tipo("Incidencia").click();
      ok(await hasta(() => !document.querySelector(".nt-aviso").hidden && crear().disabled), "no avisa de lo que pide ProyectosTIC");
      ok(document.querySelector(".nt-aviso").textContent.includes("Servicio afectado"), "no dice qué falta");
      tipo("Tarea").click();
      ok(await hasta(() => document.querySelector(".nt-aviso").hidden && !crear().disabled), "con otro tipo no vuelve a dejar crear");
      // cuelga de una tarea del proyecto
      const padre = document.querySelector(".nt-padre input");
      padre.dispatchEvent(new Event("focus"));
      const caja = () => [...document.querySelectorAll(".buscador-tareas")].find((c) => !c.hidden);
      ok(await hasta(() => caja()?.textContent.includes("15002")), "no lista las tareas del proyecto");
      ok(!caja().querySelector(".bt-fav, .bt-crear"), "la lista de padres lleva estrella o «crear»");
      [...caja().querySelectorAll(".bt-item")].find((x) => x.textContent.includes("15002"))
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      ok(document.querySelector(".nt-ruta").textContent.includes("› [2026_AUL] Mantenimientos"), "la vista previa no dice de cuál cuelga");
      crear().click();
      ok(await hasta(() => !dlg()), "no se cierra al crear");
      ok(await hasta(() => $("tarea").value.endsWith("- Tarea de humo")), `formulario: ${$("tarea").value}`);
      ok(await hasta(() => !$("aviso-deshacer").hidden && /creada en ProyectosTIC/.test($("aviso-deshacer").textContent)), "no dice que se ha creado");
      ok(st.crear.ultimo === 3, "no recuerda el proyecto para la próxima");
      ocultarAviso();
    });
    await prueba("nueva tarea: desde el buscador, y lo que rechaza ProyectosTIC", async () => {
      const inp = $("tarea");
      inp.dispatchEvent(new Event("focus"));
      inp.value = "Algo que no existe"; inp.dispatchEvent(new Event("input"));
      const caja = () => [...document.querySelectorAll(".buscador-tareas")].find((c) => !c.hidden);
      ok(await hasta(() => caja()?.querySelector(".bt-crear")), "el buscador no ofrece crearla");
      caja().querySelector(".bt-crear").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      ok(await hasta(() => document.querySelector(".nt-titulo")?.value === "Algo que no existe"), "no lleva lo escrito al título");
      ok(await hasta(() => document.querySelector(".nt-tipo")), "sin tipos");
      ok(document.querySelector(".nt-dos select").value === "3", "no propone el proyecto de la última vez");
      const tit = document.querySelector(".nt-titulo");
      tit.value = "Esta la rechaza"; tit.dispatchEvent(new Event("input"));
      botonDlg("Crear tarea");
      ok(await hasta(() => document.querySelector(".nt-error").textContent.includes("ya está en uso")), "no dice por qué la rechaza");
      ok(dlg(), "se cierra aunque no se haya creado");
      // con una descripcion escrita, cerrar pregunta antes
      const desc = document.querySelector(".nt-desc");
      desc.value = "Algo escrito";
      teclado("Escape");
      ok(await hasta(() => !$("modal").hidden), "cierra sin preguntar con una descripción escrita");
      $("modal-no").click();
      await espera(50);
      ok(dlg(), "«Seguir escribiendo» cierra el diálogo");
      desc.value = "";
      cerrarTodo();
      inp.dispatchEvent(new Event("blur"));
      // desde Buscar tarea tambien se ofrece
      dlgBuscar();
      ok(await hasta(() => dlg()), "no abre Buscar tarea");
      ok([...document.querySelectorAll(".dlg-pie button")].some((b) => b.textContent.includes("Nueva tarea") && !b.hidden), "Buscar tarea no ofrece crearla");
      cerrarTodo();
    });
    await prueba("sin errores de JS por el camino", async () => {
      ok(!lineas.some((l) => l.startsWith("FALLO error") || l.startsWith("FALLO promesa")), "hubo errores");
    });
    apuntar("HUMO-FIN");
  }

  // El asistente: cada paso se pinta sin errores, sin textos "null" y dice
  // que todo se guarda solo en este equipo.
  async function escenarioAsistente() {
    // Una sola pasada (repintar "Tareas" dos veces deja, en Edge sin ventana,
    // una carga a medias que no deja terminar al navegador).
    await prueba("asistente: todos los pasos, sin «null» y «Solo en este equipo»", async () => {
      ok(await hasta(() => typeof W !== "undefined" && W.ini), "no carga");
      for (let i = 0; i < PASOS.length; i++) {
        W.paso = i;
        mostrar();
        await espera(150);
        const c = document.getElementById("contenido");
        ok(c.querySelector("h2"), `paso ${i + 1} sin título`);
        ok(!/null|undefined/.test(c.textContent), `paso ${i + 1} escribe null/undefined`);
        if (i === 0) ok(c.querySelector(".nota-local")?.textContent.includes("solo en este equipo"), "bienvenida sin aviso local");
        if (i >= 1 && i <= 4) ok(c.querySelector(".chip-local"), `paso ${i + 1} sin «Solo en este equipo»`);
      }
    });
    apuntar("HUMO-FIN");
  }

  // La ventanita del aviso diario: hoy el primero, sin la lista repetida,
  // fichar un dia o todos, y la campana para cambiar la hora o quitarlo.
  // "Probar el aviso" (?prueba=ejemplo): se ve como el de verdad, lo dice y no ficha
  async function escenarioAvisoPrueba() {
    await prueba("aviso de prueba: dice que es una prueba y no deja fichar", async () => {
      ok(await hasta(() => document.querySelectorAll(".aviso-dia").length === 3), "no pinta los días");
      const franja = $("prueba-aviso");
      ok(!franja.hidden && /Esto es una prueba/.test(franja.textContent) && /de ejemplo/.test(franja.textContent)
         && /no se ficha/.test(franja.textContent), `franja: ${franja.textContent}`);
      const botones = [...document.querySelectorAll(".aviso-dia button"), $("b-todo")];
      ok(botones.length === 4 && botones.every((b) => b.disabled), "en la prueba se puede fichar");
      ok(/Te faltan 19,5h/.test($("titulo-aviso").textContent), "no se ve como el aviso de verdad");
      ok(!$("b-si").disabled && !$("b-no").disabled, "no se puede cerrar ni abrir la app");
    });
    await prueba("sin errores de JS por el camino", async () => {
      ok(!lineas.some((l) => l.startsWith("FALLO error") || l.startsWith("FALLO promesa")), "hubo errores");
    });
    apuntar("HUMO-FIN");
  }

  async function escenarioAviso() {
    if (/[?&]prueba\b/.test(location.search)) return escenarioAvisoPrueba();
    const renglones = () => [...document.querySelectorAll(".aviso-dia")];
    await prueba("aviso: el total en el título, hoy el primero y todo con coma", async () => {
      ok(await hasta(() => renglones().length === 3), "no pinta los tres días");
      ok($("prueba-aviso").hidden, "el aviso de verdad dice que es una prueba");
      ok([...document.querySelectorAll(".aviso-dia button")].every((b) => !b.disabled), "en el aviso de verdad no se puede fichar");
      ok(/Te faltan 19,5h por fichar esta semana/.test($("titulo-aviso").textContent), `título: ${$("titulo-aviso").textContent}`);
      ok(renglones()[0].classList.contains("hoy") && renglones()[0].textContent.includes("Hoy"), "hoy no va el primero");
      ok(renglones().every((r) => /faltan 6,5h/.test(r.textContent)), "no dice lo que falta cada día");
      const textos = $("titulo-aviso").textContent + renglones().map((r) => r.querySelector(".aviso-dia-nombre").textContent).join(" ");
      ok(!/\d\.\d/.test(textos), `decimales con punto: ${textos}`);
      ok(!/null|undefined/.test(document.body.textContent), "escribe null/undefined");
      ok(!$("todo-aviso").hidden && $("b-todo").textContent === "Fichar todo (19,5h)", `fichar todo: ${$("b-todo").textContent}`);
    });
    await prueba("aviso: la campana cambia la hora y lo desactiva", async () => {
      const b = $("b-campana");
      ok(await hasta(() => !b.hidden && b.textContent.includes("14:00")), `campana: ${b.textContent}`);
      b.click();
      ok(await hasta(() => !$("ajuste").hidden), "no abre el ajuste");
      ok($("ajuste-hora").value === "14:00", `hora que trae: ${$("ajuste-hora").value}`);
      $("ajuste-hora").value = "13:30";
      $("ajuste-si").click();
      ok(await hasta(() => !$("modal").hidden), "no confirma el cambio");
      $("modal-si").click();
      ok(await hasta(() => b.textContent.includes("13:30")), `tras cambiar: ${b.textContent}`);
      ok($("ajuste").hidden, "el ajuste no se cierra");
      b.click();
      ok(await hasta(() => !$("ajuste").hidden && !$("ajuste-quitar").hidden), "sin «Desactivar aviso»");
      $("ajuste-quitar").click();
      ok(await hasta(() => !$("modal").hidden), "no pregunta antes de desactivar");
      $("modal-si").click();
      ok(await hasta(() => b.textContent.includes("desactivado")), `tras quitar: ${b.textContent}`);
    });
    await prueba("aviso: fichar hoy y luego todo lo demás", async () => {
      document.querySelector(".aviso-dia.hoy button").click();
      ok(await hasta(() => renglones().length === 2), "no quita el día fichado");
      ok(/Te faltan 13h/.test($("titulo-aviso").textContent), `título: ${$("titulo-aviso").textContent}`);
      $("b-todo").click();
      ok(await hasta(() => !$("modal").hidden), "«Fichar todo» no pregunta");
      ok(/13h en 2 días/.test($("modal-texto").textContent), `pregunta: ${$("modal-texto").textContent}`);
      $("modal-si").click();
      ok(await hasta(() => !$("hecho").hidden), "no dice que está todo fichado");
      ok($("todo-aviso").hidden && $("dias-aviso").hidden, "siguen los renglones");
    });
    await prueba("sin errores de JS por el camino", async () => {
      ok(!lineas.some((l) => l.startsWith("FALLO error") || l.startsWith("FALLO promesa")), "hubo errores");
    });
    apuntar("HUMO-FIN");
  }

  cuandoListo(() => setTimeout(() => (document.body.classList.contains("asistente") ? escenarioAsistente()
    : document.body.classList.contains("aviso") ? escenarioAviso()
    : /[?&]pin\b/.test(location.search) ? escenarioPin() : escenarioPrincipal()), 50));
})();
