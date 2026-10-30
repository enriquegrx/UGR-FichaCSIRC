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
  const cerrarTodo = () => { while (pila.length) pila[pila.length - 1].cerrar(); };
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
      ok(document.querySelector("#menu .titulo-menu")?.textContent.includes("viernes"), "menú del +");
      document.querySelector("#menu button").click();
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
      ok(st.portapapeles, "no copió");
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
    await prueba("vista mensual", async () => {
      document.querySelector('.selector-vista [data-vista="mes"]').click();
      ok(await hasta(() => document.querySelectorAll(".celda").length >= 20), "sin celdas");
      ok(document.querySelector(".celda .b-mas-dia"), "celda sin +");
      document.querySelector('.selector-vista [data-vista="semana"]').click();
      ok(await hasta(() => dias().length === 5), "no vuelve a la semana");
    });
    const dialogos = [["plantillas", dlgPlantillas], ["permisos", dlgPermisos], ["resumen del mes", dlgResumen],
      ["exportar", dlgExportar], ["festivos", dlgFestivos], ["ajustes de días", dlgAjustesDias],
      ["INARI", dlgInari], ["buscar tarea", dlgBuscar], ["PIN", dlgPin], ["bandeja", dlgBandeja],
      ["novedades", dlgNovedades], ["tecnología", dlgTecnologia], ["atajos", dlgAtajos], ["acerca de", dlgAcerca]];
    for (const [nombre, fn] of dialogos) {
      await prueba(`diálogo ${nombre} abre y cierra`, async () => {
        fn();
        ok(await hasta(() => dlg()), "no abre");
        await espera(300);                 // que terminen sus llamadas a la API
        if (nombre === "festivos") ok(await hasta(() => document.querySelector(".festivo.ugr input")), "sin días UGR revisables");
        cerrarTodo();
        ok(!dlg(), "no cierra");
      });
    }
    await prueba("aviso diario (en la demo, un aviso)", async () => {
      dlgRecordatorio();
      ok(await hasta(() => !document.getElementById("modal").hidden), "no sale nada");
      document.getElementById("modal-si").click();
    });
    await prueba("sin errores de JS por el camino", async () => {
      ok(!lineas.some((l) => l.startsWith("FALLO error") || l.startsWith("FALLO promesa")), "hubo errores");
    });
    apuntar("HUMO-FIN");
  }

  cuandoListo(() => setTimeout(() => (/[?&]pin\b/.test(location.search) ? escenarioPin() : escenarioPrincipal()), 50));
})();
