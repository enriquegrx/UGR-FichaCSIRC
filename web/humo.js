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
  // los proyectos del arbol, recogidos: como quien lo abre por primera vez
  const recoger = async () => {
    clearTimeout(desplegados.espera);
    desplegados.ids.clear();
    await api().proyectos_desplegados_guardar([]);
  };

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
      // copiar y pegar van juntos, arriba: el dia anterior, este dia y (con algo copiado) pegar
      ok(b[1].textContent.includes("Copiar este día"), `2.ª opción: ${b[1].textContent}`);
      ok(b[2].textContent.includes("Editar día"), `3.ª opción: ${b[2].textContent}`);
      ok(b[3].textContent.includes("Eliminar apuntes") && b[3].classList.contains("destacado"), "4.ª opción");
      cerrarMenu();
      const copiado = st.portapapeles;
      st.portapapeles = { iso: "2000-01-01", texto: "Lunes 1/1", apuntes: [] };
      try {
        const c = menuDe(0).map((x) => x.textContent);
        ok(c[2].startsWith("Pegar aquí lo del lunes 1/1") && c[3].includes("Editar día"), `pegar no va con los de copiar: ${c.slice(0, 4).join(" | ")}`);
        ok([...document.querySelectorAll("#menu > *")].slice(1, 4).every((x) => x.tagName === "BUTTON"),
           "copiar y pegar salen separados por una raya");
      } finally { st.portapapeles = copiado; cerrarMenu(); }
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
      // la primera habitual, tambien con otra actividad: dos filas de la misma tarea
      const repetida = { ...st.habituales.filas[0], actividad: "Otra actividad" };
      st.habituales.filas.push(repetida);
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
        const con = (n) => [...caja().querySelectorAll(".bt-item")].filter((x) => x.querySelector(".bt-id")?.textContent === String(n));
        ok(con(repetida.wp_id).length === 1, `la habitual con dos actividades sale ${con(repetida.wp_id).length} veces`);
        // debajo, tus proyectos: se despliegan y se elige del arbol, como en el formulario
        ok(await hasta(() => caja()?.querySelector(".bt-proy")), "en Editar día no salen los proyectos");
        [...caja().querySelectorAll(".bt-proy")].find((x) => x.textContent.includes("Aulas"))
          .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        ok(await hasta(() => con(15004).length === 1), "en Editar día el proyecto no se despliega");
        con(15004)[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        ok(inp.value.startsWith("15004 - "), `no elige del árbol: ${inp.value}`);
        ok(await hasta(() => !document.querySelector(".ed-fila.nueva .ed-act").disabled), "no carga las actividades de la del árbol");
        await espera(400);                  // al elegir, el foco pasa a las horas y la lista se cierra sola
        inp.dispatchEvent(new Event("focus"));
        inp.value = "11754"; inp.dispatchEvent(new Event("input"));
        ok(await hasta(() => caja()?.textContent.includes("ATE › [2026_ATE] Servicio")), `no busca por número (o sin proyecto › padre): ${caja()?.textContent}`);
        const fila = [...caja().querySelectorAll(".bt-item")].find((x) => x.textContent.includes("11754"));
        fila.querySelector(".bt-fav").click();
        ok(await hasta(() => st.favoritas.has(11754)), "la estrella no la hace favorita");
        fila.isConnected ? fila.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
          : [...caja().querySelectorAll(".bt-item")].find((x) => x.textContent.includes("11754")).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        ok(inp.value.startsWith("11754 - "), "no queda elegida");
        ok(await hasta(() => !document.querySelector(".ed-fila.nueva .ed-act").disabled), "no carga sus actividades");
      } finally {
        cerrarTodo();
        st.habituales.filas.splice(st.habituales.filas.indexOf(repetida), 1);
        if (!st.tareas.size) for (const [k, v] of guardadas) st.tareas.set(k, v);
      }
    });
    await prueba("buscar tarea: todos mis proyectos en árbol, se despliegan y se busca en todos", async () => {
      await recoger();
      const antes = $("tarea").value;
      dlgBuscar();
      const filas = () => [...(dlg()?.querySelectorAll(".bq-lista .bt-item") || [])];
      const proys = () => filas().filter((x) => x.classList.contains("bt-proy"));
      const proyecto = (n) => proys().find((x) => x.textContent.includes(n));
      const tarea = (n) => filas().find((x) => x.querySelector(".bt-id")?.textContent === String(n));
      const clic = (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      ok(await hasta(() => proys().length === 3), `no salen los proyectos: ${proys().length}`);
      ok(!/Buscar en todo/.test(dlg().textContent) && dlg().querySelector("select").value === "", "sigue la lista plana de «Buscar en todo»");
      // se abre con el proyecto de la tarea del formulario desplegado; los demas, recogidos
      ok(await hasta(() => proyecto("Sistemas de Gestión").getAttribute("aria-expanded") === "true" && tarea(14000)), "no despliega el proyecto de la tarea del formulario");
      ok(proyecto("Aulas").getAttribute("aria-expanded") === "false" && !tarea(15001), "despliega proyectos que nadie ha pedido");
      // pulsar un proyecto lo despliega, con sus tareas en arbol debajo; otra vez, lo recoge
      clic(proyecto("Sistemas de Gestión"));
      ok(!tarea(14000), "pulsar el proyecto desplegado no lo recoge");
      clic(proyecto("Aulas"));
      ok(await hasta(() => tarea(15004)), "pulsar un proyecto no lo despliega");
      ok(tarea(15001).getAttribute("aria-level") === "2" && tarea(15004).getAttribute("aria-level") === "4", "las tareas no cuelgan de su proyecto");
      ok(/7 tareas/.test(proyecto("Aulas").textContent), `el proyecto no dice cuántas tiene: ${proyecto("Aulas").textContent}`);
      // un proyecto que no deja ver sus tareas lo dice en su sitio
      clic(proyecto("ATE"));
      ok(await hasta(() => /No tienes permiso/.test(dlg().querySelector(".bq-lista").textContent)), "no dice que no deja ver las de ATE");
      clic(proyecto("ATE"));
      // una tarea con otras debajo se recoge y se despliega con su flecha; el clic en la fila la marca
      clic(tarea(15002).querySelector(".bt-giro"));
      ok(!tarea(15004) && tarea(15003) && tarea(15002).getAttribute("aria-expanded") === "false", "la flecha no recoge las que cuelgan");
      ok(!tarea(15002).classList.contains("marcada"), "la flecha marca la tarea");
      clic(tarea(15002).querySelector(".bt-giro"));
      ok(tarea(15004), "la flecha no las vuelve a desplegar");
      ok(!tarea(15004).querySelector(".bt-giro") && tarea(15004).querySelector(".bt-codo"), "una tarea sin nada debajo lleva flecha");
      // el filtro busca en todos: quedan los proyectos con algo, desplegados
      const filtro = dlg().querySelector("input.ancho");
      const escribir = (t) => { filtro.value = t; filtro.dispatchEvent(new Event("input")); };
      escribir("manten");
      ok(await hasta(() => tarea(15002) && proys().length === 2), `no busca en todos los proyectos: ${proys().map((x) => x.textContent).join(" | ")}`);
      ok(!tarea(15004) && tarea(15001).classList.contains("bt-contexto"), "el filtro no deja solo las que encajan y las de encima");
      // al borrarlo se vuelve al arbol, como estaba
      escribir("");
      ok(proys().length === 3 && tarea(15004) && !tarea(14000), "al borrar el filtro no vuelve al árbol");
      // nada entre las abiertas: se ofrece mirar tambien las cerradas, y de ahi se vuelve
      escribir("auditor");
      ok(await hasta(() => dlg().querySelector(".bq-fuera")), `no ofrece buscar entre las cerradas: ${dlg().querySelector(".bq-lista").textContent}`);
      dlg().querySelector(".bq-fuera").click();
      ok(await hasta(() => tarea(13990)), "no busca fuera del árbol");
      ok(tarea(13990).querySelector(".bt-ruta").textContent.includes("›"), "lo de fuera no dice el proyecto y de cuál cuelga");
      escribir("");
      ok(proys().length === 3 && !tarea(13990), "de la búsqueda entre las cerradas no se vuelve");
      ok(!/null|undefined/.test(dlg().textContent), `escribe null/undefined: ${dlg().textContent}`);
      // se elige una del arbol
      clic(tarea(15005));
      botonDlg("Elegir");
      ok(await hasta(() => !dlg()), "no se cierra al elegir");
      ok(await hasta(() => $("tarea").value.startsWith("15005 - ")), `formulario: ${$("tarea").value}`);
      $("tarea").value = antes;
      await elegirTarea();
    });
    await prueba("proyectos visibles: se ocultan desde el árbol, se deshace y se eligen en Herramientas", async () => {
      await recoger();
      ok(MENUS.herramientas().some((x) => x.texto === "Proyectos visibles…"), "Herramientas no ofrece «Proyectos visibles…»");
      dlgBuscar();
      const filas = () => [...(dlg()?.querySelectorAll(".bq-lista .bt-item") || [])];
      const proys = () => filas().filter((x) => x.classList.contains("bt-proy"));
      const proyecto = (n) => proys().find((x) => x.textContent.includes(n));
      const pie = () => dlg()?.querySelector(".bq-lista .bt-pie");
      const delPie = (t) => [...pie().querySelectorAll("button")].find((b) => b.textContent.includes(t));
      const opciones = () => [...dlg().querySelectorAll("select option")].map((o) => o.textContent).join(" | ");
      ok(await hasta(() => proys().length === 3), `no salen los proyectos: ${proys().length}`);
      ok(!pie(), "habla de proyectos ocultos sin haber ninguno");
      // «No mostrar» lo quita del arbol y del desplegable de arriba, y lo dice al pie con «Deshacer»
      proyecto("ATE").querySelector(".bt-ocultar").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      ok(await hasta(() => proys().length === 2 && pie()), "«No mostrar» no quita el proyecto");
      ok(!proyecto("ATE") && !opciones().includes("ATE") && opciones().includes("Todos mis proyectos (2)"), `sigue en el desplegable: ${opciones()}`);
      ok(pie().textContent.includes("«ATE» ya no se muestra") && delPie("Deshacer"), `el pie no deja deshacer: ${pie().textContent}`);
      ok(JSON.stringify(await api().proyectos_ocultos()) === "[2]", "no lo guarda en la configuración");
      delPie("Deshacer").click();
      ok(await hasta(() => proys().length === 3 && !pie()), "«Deshacer» no lo vuelve a mostrar");
      // oculto otra vez, y al volver a abrir sigue oculto: el pie dice cuantos hay
      proyecto("ATE").querySelector(".bt-ocultar").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      ok(await hasta(() => proys().length === 2), "no se oculta la segunda vez");
      cerrarTodo();
      dlgBuscar();
      ok(await hasta(() => proys().length === 2 && pie()), "al volver a abrir Buscar tarea sale el oculto");
      ok(pie().textContent.includes("1 proyecto oculto") && !delPie("Deshacer"), `pie: ${pie().textContent}`);
      // el filtro no busca en los ocultos... (ATE no deja ver sus tareas; se oculta Aulas para verlo)
      proyecto("Aulas").querySelector(".bt-ocultar").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      ok(await hasta(() => proys().length === 1), "no oculta el segundo");
      const filtro = dlg().querySelector("input.ancho");
      filtro.value = "megafon"; filtro.dispatchEvent(new Event("input"));
      ok(await hasta(() => dlg().querySelector(".bq-fuera")), "busca en un proyecto oculto");
      ok(!filas().some((x) => x.textContent.includes("15004")), "enseña tareas de un proyecto oculto");
      filtro.value = ""; filtro.dispatchEvent(new Event("input"));
      // ...ni salen en el campo Tarea del formulario, que tambien dice cuantos hay ocultos
      cerrarTodo();
      const inp = $("tarea");
      await espera(200);
      inp.dispatchEvent(new Event("focus"));
      const caja = () => [...document.querySelectorAll(".buscador-tareas")].find((c) => !c.hidden);
      ok(await hasta(() => caja()?.querySelector(".bt-pie")), `el campo Tarea no dice que hay ocultos: ${caja()?.textContent}`);
      ok(caja().querySelectorAll(".bt-proy").length === 1 && caja().querySelector(".bt-pie").textContent.includes("2 proyectos ocultos"),
         `el campo Tarea enseña los ocultos: ${caja().textContent}`);
      // desde ahi tambien se oculta: sin ninguno a la vista queda el pie para recuperarlos
      caja().querySelector(".bt-proy .bt-ocultar").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      ok(await hasta(() => caja() && !caja().querySelector(".bt-proy") && caja().querySelector(".bt-pie")), "el campo Tarea no deja ocultar");
      ok(/Sistemas de Gestión» ya no se muestra/.test(caja().querySelector(".bt-pie").textContent), `pie del campo: ${caja().querySelector(".bt-pie").textContent}`);
      inp.dispatchEvent(new Event("blur"));
      await espera(200);
      // Herramientas > Proyectos visibles: casillas, y «Marcar todos» los devuelve
      dlgProyectosVisibles();
      const casillas = () => [...(dlg()?.querySelectorAll(".pv-lista input[type=checkbox]") || [])];
      ok(await hasta(() => casillas().length === 3), `no lista los proyectos: ${casillas().length}`);
      ok(casillas().every((c) => !c.checked) && dlg().textContent.includes("0 de 3 a la vista"), `no trae lo guardado: ${dlg().textContent}`);
      ok(!/null|undefined/.test(dlg().textContent), `escribe null/undefined: ${dlg().textContent}`);
      casillas()[2].click();
      ok(dlg().textContent.includes("1 de 3 a la vista"), "no cuenta los marcados");
      botonDlg("Guardar");
      ok(await hasta(() => !dlg()), "no se cierra al guardar");
      ok(JSON.stringify(await api().proyectos_ocultos()) === "[1,2]", `guardado: ${JSON.stringify(await api().proyectos_ocultos())}`);
      dlgProyectosVisibles();
      ok(await hasta(() => casillas().length === 3), "no vuelve a abrir");
      botonDlg("Marcar todos");
      botonDlg("Guardar");
      ok(await hasta(() => !dlg()), "no se cierra al guardar todos");
      ok(JSON.stringify(await api().proyectos_ocultos()) === "[]", "«Marcar todos» no los devuelve");
      // y Buscar tarea los vuelve a enseñar
      dlgBuscar();
      ok(await hasta(() => proys().length === 3 && !pie()), "tras marcarlos todos no vuelven al árbol");
      cerrarTodo();
    });
    await prueba("buscar tarea: las del proyecto en árbol, se filtra, se marcan varias y se eligen", async () => {
      const antes = $("tarea").value;
      dlgBuscar();
      ok(await hasta(() => dlg()?.querySelectorAll("select option").length > 2), "no carga los proyectos");
      const proy = dlg().querySelector("select");
      proy.value = "3"; proy.dispatchEvent(new Event("change"));
      const filas = () => [...dlg().querySelectorAll(".bq-lista .bt-item")];
      const ramas = () => filas().map((x) => `${x.getAttribute("aria-level")}:${x.querySelector(".bt-id").textContent}`).join(" ");
      ok(await hasta(() => filas().length), "no lista las tareas del proyecto");
      ok(ramas() === "1:15001 2:15002 3:15004 3:15005 2:15003 1:15010 2:15011", `árbol: ${ramas()}`);
      const fila = (n) => filas().find((x) => x.textContent.includes(n));
      ok(parseFloat(getComputedStyle(fila("15004")).paddingLeft) > parseFloat(getComputedStyle(fila("15002")).paddingLeft),
         "las hijas no van metidas bajo su madre");
      ok(/Cuelga de \[2026_AUL\] Proyectos/.test(fila("15010").textContent), "no dice de cuál cuelga la que tiene la madre cerrada");
      ok(!/null|undefined/.test(dlg().textContent), "escribe null/undefined");
      // al filtrar (sin tildes) quedan las que encajan y las de encima, de contexto
      const filtro = dlg().querySelector("input.ancho");
      filtro.value = "megafonia"; filtro.dispatchEvent(new Event("input"));
      ok(ramas() === "1:15001 2:15002 3:15004", `árbol filtrado: ${ramas()}`);
      ok(fila("15002").classList.contains("bt-contexto") && !fila("15004").classList.contains("bt-contexto"), "no distingue las de contexto");
      filtro.value = ""; filtro.dispatchEvent(new Event("input"));
      // clic marca una; Ctrl+clic añade otra; Mayus+clic, el tramo
      const clic = (n, extra = {}) => fila(n).dispatchEvent(new MouseEvent("click", { bubbles: true, ...extra }));
      const marcadas = () => filas().filter((x) => x.classList.contains("marcada")).map((x) => x.querySelector(".bt-id").textContent).join(" ");
      clic("15004");
      clic("15011", { ctrlKey: true });
      ok(marcadas() === "15004 15011", `Ctrl+clic: ${marcadas()}`);
      clic("15002");
      clic("15005", { shiftKey: true });
      ok(marcadas() === "15002 15004 15005", `Mayús+clic: ${marcadas()}`);
      ok(fila("15004").getAttribute("aria-selected") === "true" && fila("15003").getAttribute("aria-selected") === "false", "aria-selected no sigue a las marcadas");
      // con el teclado: flecha abajo desde el filtro
      clic("15001");
      dlg().querySelector(".bq-lista").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      ok(marcadas() === "15002", `flecha abajo: ${marcadas()}`);
      clic("15005", { ctrlKey: true });
      botonDlg("Elegir");
      ok(await hasta(() => !dlg()), "no se cierra al elegir");
      ok(await hasta(() => $("tarea").value.startsWith("15002 - ")), `formulario: ${$("tarea").value}`);
      ok(textoDeTarea(15005), "la segunda elegida no queda en el desplegable");
      $("tarea").value = antes;
      await elegirTarea();
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
    await prueba("formulario: con la tarea puesta salen las de siempre y tus proyectos, que se despliegan", async () => {
      await recoger();
      const inp = $("tarea"), antes = inp.value;
      ok(/^\d+ - /.test(antes), `sin tarea en el formulario: ${antes}`);
      await espera(200);                    // el blur de la prueba anterior cierra la lista un poco despues
      inp.dispatchEvent(new Event("focus"));
      const caja = () => [...document.querySelectorAll(".buscador-tareas")].find((c) => !c.hidden);
      ok(await hasta(() => caja()?.textContent.includes("Tus proyectos")), `no salen los proyectos: ${caja()?.textContent}`);
      ok(!/Sin resultados|Crear la tarea/.test(caja().textContent) && caja().textContent.includes("Tus tareas habituales"),
         `con la tarea puesta busca su texto: ${caja().textContent}`);
      const proyecto = (n) => [...caja().querySelectorAll(".bt-proy")].find((x) => x.textContent.includes(n));
      const pulsar = (x) => x.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      ok(caja().querySelectorAll(".bt-proy").length === 3 && !caja().textContent.includes("15004"), "los proyectos no salen recogidos");
      pulsar(proyecto("Aulas"));
      ok(await hasta(() => caja()?.textContent.includes("15004")), "pulsar un proyecto no enseña sus tareas");
      ok(proyecto("Aulas").getAttribute("aria-expanded") === "true", "no dice que está desplegado");
      const fila = (n) => [...caja().querySelectorAll(".bt-item")].find((x) => x.querySelector(".bt-id")?.textContent === String(n));
      ok(parseFloat(getComputedStyle(fila(15004)).paddingLeft) > parseFloat(getComputedStyle(fila(15002)).paddingLeft)
         && parseFloat(getComputedStyle(fila(15001)).paddingLeft) > parseFloat(getComputedStyle(proyecto("Aulas")).paddingLeft),
         "las tareas no van en árbol bajo su proyecto");
      pulsar(proyecto("Aulas"));
      ok(!caja().textContent.includes("15004"), "pulsar otra vez no lo recoge");
      pulsar(proyecto("Aulas"));
      ok(await hasta(() => fila(15005)), "no vuelve a desplegarse");
      pulsar(fila(15005));
      ok(await hasta(() => inp.value.startsWith("15005 - ")), `no pone la tarea en el formulario: ${inp.value}`);
      // al escribir se busca, y los proyectos dejan sitio a los resultados
      inp.dispatchEvent(new Event("focus"));
      inp.value = "Proxmox"; inp.dispatchEvent(new Event("input"));
      ok(await hasta(() => caja()?.querySelector(".bt-item") && !caja().querySelector(".bt-proy")), "al escribir siguen los proyectos");
      inp.dispatchEvent(new Event("blur"));
      inp.value = antes;
      await elegirTarea();
    });
    await prueba("árbol de tareas: recuerda los proyectos desplegados, lleva estrella y se actualiza", async () => {
      await recoger();
      const inp = $("tarea"), antes = inp.value;
      const caja = () => [...document.querySelectorAll(".buscador-tareas")].find((c) => !c.hidden);
      const proyecto = (n) => [...(caja()?.querySelectorAll(".bt-proy") || [])].find((x) => x.textContent.includes(n));
      const fila = (n) => [...(caja()?.querySelectorAll(".bt-item.bt-desp") || [])].find((x) => x.dataset.id === String(n));
      const pulsar = (x) => x.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      const original = api().tareas_de_proyecto;
      try {
        await espera(200);
        inp.dispatchEvent(new Event("focus"));
        ok(await hasta(() => proyecto("Aulas")), "no salen los proyectos");
        ok(!fila(15004), "sale desplegado sin que nadie lo haya pedido");
        pulsar(proyecto("Aulas"));
        ok(await hasta(() => fila(15004)), "no se despliega");
        // queda apuntado en la configuracion (con un respiro)
        await espera(800);
        ok(JSON.stringify(await api().proyectos_desplegados()) === "[3]", `no lo guarda: ${JSON.stringify(await api().proyectos_desplegados())}`);
        inp.dispatchEvent(new Event("blur"));
        await espera(200);
        // como al volver a abrir la app: lo leido de la configuracion manda
        desplegados.ids.clear(); desplegados.leyendo = null; desplegados.tocados = false;
        olvidarMisProyectos();
        inp.dispatchEvent(new Event("focus"));
        ok(await hasta(() => fila(15004)), "al volver no recuerda el proyecto desplegado");
        ok(proyecto("Aulas").getAttribute("aria-expanded") === "true" && proyecto("ATE").getAttribute("aria-expanded") === "false",
           "despliega los que no tocaban");

        // la estrella de una tarea del arbol: la hace favorita sin elegirla, y la lista sigue abierta
        pulsar(proyecto("Sistemas de Gestión"));
        ok(await hasta(() => fila(14000)), "no despliega el segundo");
        // (la 15003 no es habitual ni favorita ni se ha usado: arriba no esta hasta que se marca)
        const deArriba = (n) => [...caja().querySelectorAll(".bt-item:not(.bt-desp)")].find((x) => x.querySelector(".bt-id")?.textContent === String(n));
        const flecha = (key) => inp.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        ok(!st.favoritas.has(15003) && !deArriba(15003), "la 15003 ya está entre las de arriba: la prueba no vale");
        ok(fila(15003).querySelector(".bt-fav-fin")?.textContent === "☆", "la del árbol no lleva estrella");
        const valor = inp.value;
        // (pulsar devuelve false si alguien frena el mousedown: sin eso el campo perderia el foco)
        ok(!pulsar(fila(15003).querySelector(".bt-fav")), "pulsar la estrella le quita el foco al campo");
        ok(inp.value === valor && caja(), "pulsar la estrella elige la tarea");
        flecha("ArrowUp");                    // el teclado, en una fila de debajo
        ok(caja().querySelector(".bt-item.activo"), "la flecha no lleva el teclado a ninguna fila");
        fila(15003).querySelector(".bt-fav").click();
        ok(await hasta(() => st.favoritas.has(15003)), "la estrella del árbol no la hace favorita");
        ok(await hasta(() => fila(15003)?.querySelector(".bt-fav.si")?.textContent === "★"), "no se ve que ya es favorita");
        ok(deArriba(15003), "la favorita nueva no sale arriba");
        // las filas se han corrido: el teclado no se queda en otra (Intro la elegiria)
        ok(!caja().querySelector(".bt-item.activo"), "tras la estrella, el teclado se queda en una fila que ya es otra");
        // y la de las filas de arriba (habituales, favoritas): tampoco elige la tarea
        ok(!pulsar(deArriba(15003).querySelector(".bt-fav")), "la estrella de las de arriba le quita el foco al campo");
        ok(inp.value === valor, "la estrella de las de arriba elige la tarea");
        deArriba(15003).querySelector(".bt-fav").click();
        ok(await hasta(() => !st.favoritas.has(15003)), "no deja de ser favorita");

        // «Actualizar»: lo creado en ProyectosTIC sale sin esperar a que caduque lo guardado
        api().tareas_de_proyecto = (pid) => original(pid).then((r) => (pid === "3"
          ? { tareas: [...r.tareas, { id: 15099, nombre: "[AUL] Recién creada" }] } : r));
        pulsar(proyecto("Aulas")); pulsar(proyecto("Aulas"));        // recoger y desplegar no la trae
        await espera(300);
        ok(fila(15004) && !fila(15099), "desplegar otra vez vuelve a pedir las tareas");
        flecha("ArrowUp");
        ok(caja().querySelector(".bt-item.activo"), "la flecha no lleva el teclado a ninguna fila");
        const boton = caja().querySelector(".bt-grupo .bt-actualizar");
        ok(boton, "«Tus proyectos» no lleva «Actualizar»");
        ok(!pulsar(boton) && caja(), "pulsar «Actualizar» le quita el foco al campo (y se cerraría la lista)");
        boton.click();
        ok(caja().querySelector(".bt-actualizando"), "no dice que está actualizando");
        ok(await hasta(() => fila(15099)), "«Actualizar» no trae la tarea nueva");
        ok(!caja().querySelector(".bt-item.activo"), "tras actualizar, el teclado se queda en una fila que ya es otra");
        ok(proyecto("Aulas").getAttribute("aria-expanded") === "true" && caja().querySelector(".bt-actualizar"), "tras actualizar no queda como estaba");
        inp.dispatchEvent(new Event("blur"));
        await espera(200);

        // Buscar tarea se abre con los mismos desplegados (y no con el de la tarea del formulario)
        dlgBuscar();
        const filas = () => [...(dlg()?.querySelectorAll(".bq-lista .bt-item") || [])];
        const proyD = (n) => filas().find((x) => x.classList.contains("bt-proy") && x.textContent.includes(n));
        const tarea = (n) => filas().find((x) => x.querySelector(".bt-id")?.textContent === String(n));
        const clic = (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        ok(await hasta(() => tarea(15099) && tarea(14000)), "Buscar tarea no se abre con los desplegados");
        ok(proyD("ATE").getAttribute("aria-expanded") === "false", "Buscar tarea despliega de más");
        // su estrella: favorita sin marcar la fila
        clic(tarea(15004).querySelector(".bt-fav"));
        ok(await hasta(() => st.favoritas.has(15004)), "la estrella de Buscar tarea no la hace favorita");
        ok(await hasta(() => tarea(15004).querySelector(".bt-fav.si")) && !tarea(15004).classList.contains("marcada"), "la estrella marca la fila");
        clic(tarea(15004).querySelector(".bt-fav"));
        ok(await hasta(() => !st.favoritas.has(15004)), "la estrella no la quita de favoritas");
        // recoger aqui tambien se recuerda
        clic(proyD("Sistemas de Gestión"));
        ok(!tarea(14000), "no se recoge");
        await espera(800);
        ok(JSON.stringify(await api().proyectos_desplegados()) === "[3]", `no recuerda lo recogido: ${JSON.stringify(await api().proyectos_desplegados())}`);
        // quien abre la app y va directo a Buscar tarea: lee por su cuenta lo recordado, y
        // con algo recordado no despliega ademas el proyecto de la tarea del formulario
        ok(String(await proyectoDeTarea(tareaDelFormulario()?.id)) === "1", "la tarea del formulario no es de Sistemas de Gestión: la prueba no vale");
        cerrarTodo();
        desplegados.ids.clear(); desplegados.leyendo = null; desplegados.tocados = false;
        dlgBuscar();
        ok(await hasta(() => tarea(15004)), "Buscar tarea no lee por su cuenta los proyectos desplegados");
        await espera(400);                    // lo que tarda en saber de que proyecto es la del formulario
        ok(proyD("Sistemas de Gestión").getAttribute("aria-expanded") === "false", "con uno recordado, despliega además el de la tarea del formulario");
        // «Actualizar» (boton y F5): tareas nuevas sin cerrar, con lo desplegado como estaba
        api().tareas_de_proyecto = (pid) => original(pid).then((r) => (pid === "3"
          ? { tareas: [...r.tareas, { id: 15098, nombre: "[AUL] Otra recién creada" }] } : r));
        botonDlg("⟳ Actualizar");
        ok(await hasta(() => tarea(15098) && !tarea(15099)), "el botón «Actualizar» no trae lo nuevo");
        api().tareas_de_proyecto = original;
        // F5 vale aunque el foco no este dentro del dialogo (tras pulsar el titulo, p. ej.)
        document.activeElement?.blur();
        ok(!dlg().contains(document.activeElement), "el foco sigue dentro del diálogo: la prueba no vale");
        ok(!teclado("F5", { cancelable: true }), "F5 con un diálogo abierto recargaría la página");
        ok(await hasta(() => tarea(15004) && !tarea(15098)), "F5 no actualiza si el foco no está en el diálogo");
        ok(proyD("Aulas").getAttribute("aria-expanded") === "true" && !/null|undefined/.test(dlg().textContent), "tras actualizar no queda como estaba");
      } finally {
        api().tareas_de_proyecto = original;
        cerrarTodo();
        olvidarMisProyectos();
        await recoger();
        inp.dispatchEvent(new Event("blur"));
        inp.value = antes;
        await elegirTarea();
      }
    });
    await prueba("buscar tarea: ni el filtro cambia lo recordado ni la estrella quita el foco, y «Actualizar» deja la lista como estaba", async () => {
      await recoger();
      const tareasDe = api().tareas_de_proyecto, ocultosDe = api().proyectos_ocultos, buscarDe = api().buscar_tareas;
      const lista = () => dlg().querySelector(".bq-lista");
      const filas = () => [...(dlg()?.querySelectorAll(".bq-lista .bt-item") || [])];
      const proyD = (n) => filas().find((x) => x.classList.contains("bt-proy") && x.textContent.includes(n));
      const tarea = (n) => filas().find((x) => x.querySelector(".bt-id")?.textContent === String(n));
      const clic = (x, extra = {}) => x.dispatchEvent(new MouseEvent("click", { bubbles: true, ...extra }));
      const baja = (x) => x.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      const marcadas = () => [...new Set([...lista().querySelectorAll(".marcada .bt-id")].map((x) => x.textContent))].sort().join(",");
      const cursor = () => lista().querySelector(".bt-item.cursor .bt-id")?.textContent;
      const actualizar = async () => {
        const b = [...dlg().querySelectorAll(".dlg-pie button")].find((x) => x.textContent.trim() === "⟳ Actualizar");
        b.click();
        ok(await hasta(() => !b.disabled), "«Actualizar» no termina");
      };
      let ojo = null;
      try {
        dlgBuscar();
        ok(await hasta(() => proyD("Aulas")), "no salen los proyectos");
        await espera(400);                    // sin nada recordado, se abre solo el de la tarea del formulario
        clic(proyD("Aulas"));
        ok(await hasta(() => tarea(15011)), "no se despliega");
        const filtro = dlg().querySelector("input.ancho"), proy = dlg().querySelector("select");
        const escribir = (t) => { filtro.value = t; filtro.dispatchEvent(new Event("input")); };
        const recordados = () => [...desplegados.ids].sort().join(",");

        // con filtro todos salen abiertos: pulsar uno no cambia nada, tampoco lo recordado
        escribir("megafon");
        ok(await hasta(() => tarea(15004) && !tarea(15011) && !proyD("ATE")), "el filtro no filtra");
        clic(proyD("Aulas"));
        ok(recordados() === "3" && tarea(15004), `con filtro, pulsar un proyecto cambia lo recordado: ${recordados()}`);
        lista().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
        ok(recordados() === "3" && tarea(15004), `con filtro, la flecha izquierda cambia lo recordado: ${recordados()}`);
        escribir("");
        ok(await hasta(() => tarea(15011)), "al borrar el filtro no vuelve el árbol");

        // la estrella y «No mostrar» no se llevan el foco: el teclado sigue yendo a la lista
        filtro.focus();
        ok(!baja(tarea(15011).querySelector(".bt-fav")) && document.activeElement === lista(), "la estrella le quita el foco a la lista");
        filtro.focus();
        ok(!baja(proyD("ATE").querySelector(".bt-ocultar")) && document.activeElement === lista(), "«No mostrar» le quita el foco a la lista");

        // «Actualizar»: lo marcado, el cursor y el sitio se quedan, y lo que habia se ve hasta tener lo nuevo
        clic(tarea(15010)); clic(tarea(15011), { ctrlKey: true });
        ok(marcadas() === "15010,15011" && cursor() === "15011", `no marca: ${marcadas()} / ${cursor()}`);
        lista().scrollTop = 60;
        const sitio = lista().scrollTop;
        ok(sitio > 0, "la lista no da para moverla: la prueba no vale");
        let leidos = 0, cargando = false;
        api().proyectos_ocultos = () => { leidos++; return ocultosDe(); };
        api().tareas_de_proyecto = (pid) => tareasDe(pid).then((r) => (pid === "3"
          ? { tareas: [...r.tareas, { id: 15097, nombre: "[AUL] Recién creada" }] } : r));
        ojo = new MutationObserver(() => { if (lista().textContent.includes("Cargando tareas")) cargando = true; });
        ojo.observe(lista(), { childList: true, subtree: true });
        await actualizar();
        ojo.disconnect();
        ok(tarea(15097), "«Actualizar» no trae lo nuevo");
        ok(!cargando, "al actualizar la lista se vacía («Cargando tareas…») en vez de seguir con lo que había");
        ok(marcadas() === "15010,15011" && cursor() === "15011", `al actualizar se pierde lo marcado o el cursor: ${marcadas()} / ${cursor()}`);
        ok(lista().scrollTop === sitio, `al actualizar la lista se mueve: ${lista().scrollTop} (estaba en ${sitio})`);
        ok(leidos === 0, "«Actualizar» vuelve a leer los proyectos ocultos (pisaría un «No mostrar» hecho entretanto)");
        api().tareas_de_proyecto = tareasDe;

        // con un proyecto elegido: al volver a todos, los desplegados no se quedan en «Cargando tareas…»
        proy.value = "1"; proy.dispatchEvent(new Event("change"));
        ok(await hasta(() => tarea(14000) && !proyD("Aulas")), "no enseña el proyecto elegido");
        await actualizar();
        proy.value = ""; proy.dispatchEvent(new Event("change"));
        ok(await hasta(() => tarea(15011)), `tras actualizar con un proyecto elegido, el desplegado se queda sin sus tareas: ${lista().textContent.slice(0, 200)}`);
        ok(!lista().textContent.includes("Cargando tareas"), "queda algún «Cargando tareas…»");

        // en la lista de las cerradas tambien se queda lo marcado; y al borrar el filtro vuelve el arbol entero
        escribir("auditor");
        ok(await hasta(() => dlg().querySelector(".bq-fuera")), "no ofrece buscar entre las cerradas");
        dlg().querySelector(".bq-fuera").click();
        ok(await hasta(() => tarea(13990)), "no busca entre las cerradas");
        clic(tarea(13990));
        let buscadas = 0;
        api().buscar_tareas = (t) => { buscadas++; return buscarDe(t); };
        await actualizar();
        ok(buscadas === 1 && tarea(13990), "«Actualizar» no vuelve a buscar entre las cerradas");
        ok(marcadas() === "13990" && cursor() === "13990", `en las cerradas, «Actualizar» borra lo marcado: ${marcadas()} / ${cursor()}`);
        escribir("");
        ok(await hasta(() => tarea(15011) && tarea(14000)), `tras actualizar en las cerradas, el árbol no vuelve entero: ${lista().textContent.slice(0, 200)}`);
        ok(!lista().textContent.includes("Cargando tareas") && !/null|undefined/.test(dlg().textContent), "queda algún «Cargando tareas…»");
      } finally {
        ojo?.disconnect();
        api().tareas_de_proyecto = tareasDe; api().proyectos_ocultos = ocultosDe; api().buscar_tareas = buscarDe;
        cerrarTodo();
        olvidarMisProyectos();
        await recoger();
      }
    });
    await prueba("campo Tarea: un segundo campo se entera de lo que pidió el primero", async () => {
      await recoger();
      const inp = $("tarea");
      const otro = el("input", { type: "text" });
      document.body.append(otro);
      buscadorTarea(otro, { alElegir() {} });
      const caja = () => [...document.querySelectorAll(".buscador-tareas")].find((c) => !c.hidden);
      try {
        // los proyectos ya estan leidos (el campo del formulario) y Aulas, desplegado
        await espera(200);
        inp.dispatchEvent(new Event("focus"));
        ok(await hasta(() => caja()?.textContent.includes("Tus proyectos")), "no salen los proyectos");
        inp.dispatchEvent(new Event("blur"));
        await espera(200);
        desplegados.ids.add("3");
        mios.tareas.delete("3");
        pedirTareasDeMiProyecto("3", () => {});      // las pide un campo...
        otro.dispatchEvent(new Event("focus"));      // ...y mientras llegan se abre otro
        ok(caja()?.textContent.includes("Cargando tareas"), `el segundo campo no espera las tareas: ${caja()?.textContent}`);
        ok(await hasta(() => caja()?.textContent.includes("15004")), "el segundo campo se queda en «Cargando tareas…»");
        // igual con «Actualizar» pulsado en otro campo
        actualizarMisProyectos(() => {});
        ok(caja().querySelector(".bt-actualizando"), "el segundo campo no dice que se está actualizando");
        ok(await hasta(() => caja().querySelector(".bt-actualizar") && caja().textContent.includes("15004")), "el segundo campo se queda en «Actualizando…»");
      } finally {
        otro.dispatchEvent(new Event("blur"));
        otro.remove();
        await espera(200);
        olvidarMisProyectos();
        await recoger();
      }
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
      const mesesPend = [...p.querySelectorAll("button.pend-ficha.pendiente:not(.anual)")];
      const mesPend = mesesPend.pop();
      mesPend.click();
      ok(mesPend.isConnected === false && p.querySelector(".pend-ficha.activa:not(.anual)"), "la ficha del mes no queda elegida");
      // la demo deja por completar los 21 dias anteriores: del 22 en adelante caen todos
      // en el mismo mes y no hay nada que quitar de la lista
      const delMes = p.querySelectorAll(".pend-dia").length;
      ok(p.querySelectorAll(".pend-mes").length === 1 && (mesesPend.length ? delMes < todo : delMes === todo),
         "la ficha del mes no filtra la lista");
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
      ok(await hasta(() => !$("b-tareas").hidden), "no ofrece el botón «Tareas» a quien puede crear");
      ok(!$("form").querySelector("#b-tareas") && $("b-buscar").textContent === "Buscar tarea…" && /^Añadir apunte/.test($("b-anadir").textContent),
         "Añadir apunte mezcla tareas y apuntes");
      // el menu del boton: crear, modificar y duplicar
      const delMenu = () => [...document.querySelectorAll("#menu button")].map((b) => b.textContent.split("\t")[0]).join("|");
      const abrirNueva = async () => {
        $("b-tareas").click();
        const op = [...document.querySelectorAll("#menu button")].find((b) => b.textContent.startsWith("Nueva tarea"));
        ok(op, `el menú de «Tareas» no ofrece crear: ${delMenu()}`);
        op.click();
      };
      $("b-tareas").click();
      ok(delMenu() === "Nueva tarea…|Modificar una tarea…|Duplicar una tarea con las que cuelgan de ella…", `menú de «Tareas»: ${delMenu()}`);
      cerrarMenu();
      // la insignia de la cabecera y su galleta: los dos niveles, con el tuyo marcado
      const modo = $("modo");
      ok(!modo.hidden && modo.classList.contains("dios") && modo.firstChild.nextSibling.textContent === "Nivel dios",
         `la cabecera no dice el nivel: ${modo.textContent}`);
      ok(modo.querySelectorAll(".modo-nivel").length === 2 && modo.querySelector(".modo-nivel.mio").textContent.includes("2 proyectos"),
         `la galleta no explica los niveles: ${modo.querySelector(".modo-galleta").textContent}`);
      // y dice en que proyectos deja crear, solo en el nivel dios
      const donde = [...modo.querySelectorAll(".modo-nivel.mio .modo-proyectos li")].map((x) => x.textContent).join(" | ");
      ok(donde === "Sistemas de Gestión | Aulas y Teledocencia", `la galleta no dice en qué proyectos: ${donde}`);
      ok(modo.querySelectorAll(".modo-proyectos").length === 1, "la lista de proyectos sale también en el otro nivel");
      // quien no puede crear pero si modificar: nivel loser, sin «＋ Nueva», y Modificar en Archivo
      const suyo = st.crear;
      try {
        st.crear = { proyectos: [], modificar: [{ id: 3, nombre: "Aulas y Teledocencia" }], plantillas: [] };
        pintarPermisoCrear();
        ok(!$("b-tareas").hidden, "no ofrece el botón «Tareas» a quien solo puede modificar");
        $("b-tareas").click();
        ok(delMenu() === "Modificar una tarea…", `a quien solo puede modificar, el menú de «Tareas» le ofrece: ${delMenu()}`);
        cerrarMenu();
        ok(!modo.classList.contains("dios") && /Nivel loser/.test(modo.textContent), "da el nivel dios a quien solo puede modificar");
        const loser = modo.querySelector(".modo-nivel.mio");
        ok(/puedes modificar tareas.*en 1 proyecto/.test(loser.textContent) && loser.querySelector(".modo-proyectos li").textContent === "Aulas y Teledocencia",
           `la galleta no dice dónde puede modificar: ${loser.textContent}`);
        const archivo = MENUS.archivo().filter(Boolean).map((x) => x.texto || "").join("|");
        ok(archivo.includes("Modificar una tarea") && !archivo.includes("Duplicar una tarea"), `Archivo: ${archivo}`);
        st.crear = { proyectos: [], modificar: [], plantillas: [] };
        pintarPermisoCrear();
        ok($("b-tareas").hidden, "ofrece el botón «Tareas» a quien no puede nada");
        ok(!modo.querySelector(".modo-proyectos") && !MENUS.archivo().filter(Boolean).some((x) => (x.texto || "").includes("Modificar una tarea")),
           "ofrece Modificar a quien no puede nada");
      } finally {
        st.crear = suyo;
        pintarPermisoCrear();
      }
      // la primera vez, el dialogo se abre en el proyecto de la tarea del formulario
      const antes = $("tarea").value, deAulas = "15004 - Revisión de megafonía del Aulario";
      st.tareas.set(deAulas, 15004);
      $("tarea").value = deAulas;
      await abrirNueva();
      ok(await hasta(() => document.querySelector(".nt-tipo")), "no pinta los tipos del proyecto");
      ok(document.querySelector(".nt-dos select").value === "3",
         `no se abre en el proyecto de la tarea del formulario: ${document.querySelector(".nt-dos select").value}`);
      cerrarTodo();
      st.tareas.delete(deAulas);
      $("tarea").value = antes;
      ok(getComputedStyle(modo.querySelector(".modo-galleta")).display === "none", "la galleta sale sin pasar el ratón");
      ok(!/null|undefined/.test(modo.textContent), "la insignia escribe null/undefined");
      await abrirNueva();
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
      // en arbol: cada una bajo la que cuelga, y metida un nivel mas
      const ramas = () => [...caja().querySelectorAll(".bt-item")].map((x) =>
        `${x.getAttribute("aria-level")}:${x.querySelector(".bt-id").textContent}`).join(" ");
      ok(ramas() === "1:15001 2:15002 3:15004 3:15005 2:15003 1:15010 2:15011", `árbol: ${ramas()}`);
      const fila = (n) => [...caja().querySelectorAll(".bt-item")].find((x) => x.textContent.includes(n));
      ok(parseFloat(getComputedStyle(fila("15004")).paddingLeft) > parseFloat(getComputedStyle(fila("15002")).paddingLeft),
         "las hijas no van metidas bajo su madre");
      ok(/Cuelga de \[2026_AUL\] Proyectos/.test(fila("15010").textContent), "no dice de cuál cuelga la que tiene la madre cerrada");
      ok(!fila("15004").querySelector(".bt-ruta"), "repite la madre, que ya está encima");
      // al buscar quedan las que encajan y, de contexto, las de encima
      padre.value = "megaf"; padre.dispatchEvent(new Event("input"));
      ok(ramas() === "1:15001 2:15002 3:15004", `árbol filtrado: ${ramas()}`);
      ok(fila("15002").classList.contains("bt-contexto") && !fila("15004").classList.contains("bt-contexto"), "no distingue las de contexto");
      padre.value = ""; padre.dispatchEvent(new Event("input"));
      fila("15004").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      ok(document.querySelector(".nt-ruta").textContent.includes("› [2026_AUL] Servicio › [2026_AUL] Mantenimientos › Revisión de megafonía"),
         `la vista previa no dice de cuál cuelga: ${document.querySelector(".nt-ruta").textContent}`);
      crear().click();
      ok(await hasta(() => !dlg()), "no se cierra al crear");
      ok(await hasta(() => $("tarea").value.endsWith("- Tarea de humo")), `formulario: ${$("tarea").value}`);
      ok(await hasta(() => !$("aviso-deshacer").hidden && /creada en ProyectosTIC/.test($("aviso-deshacer").textContent)), "no dice que se ha creado");
      ok(st.crear.ultimo === 3, "no recuerda el proyecto para la próxima");
      ocultarAviso();
    });
    await prueba("nueva tarea: el campo del apunte no la crea, y lo que rechaza ProyectosTIC", async () => {
      // el campo Tarea es para el apunte de cada dia: crear va en el boton «Tareas»
      const inp = $("tarea"), antes = inp.value;
      inp.dispatchEvent(new Event("focus"));
      inp.value = "Algo que no existe"; inp.dispatchEvent(new Event("input"));
      const caja = () => [...document.querySelectorAll(".buscador-tareas")].find((c) => !c.hidden);
      ok(await hasta(() => /Nada más con eso/.test(caja()?.textContent || "")), `no dice que no hay nada: ${caja()?.textContent}`);
      ok(!/Crear la tarea/.test(caja().textContent), "el campo del apunte ofrece crear una tarea");
      inp.dispatchEvent(new Event("blur"));
      inp.value = antes;
      dlgNuevaTarea({ titulo: "Algo que no existe" });
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
    await prueba("nueva tarea: plantillas y tiempo estimado", async () => {
      dlgNuevaTarea();
      ok(await hasta(() => document.querySelector(".nt-plantilla .usar")), "no salen las plantillas de tarea");
      ok(!/null|undefined/.test(dlg().textContent), `escribe null/undefined: ${dlg().textContent}`);
      document.querySelector(".nt-plantilla .usar").click();
      const tit = document.querySelector(".nt-titulo"), est = document.querySelector(".nt-est");
      ok(await hasta(() => document.querySelector(".nt-padre input").value.startsWith("15003")), "la plantilla no pone de cuál cuelga");
      ok(tit.value === "Incidencia de Iris con ticket: *" && document.querySelector(".nt-dos select").value === "3" && est.value === "1",
         `la plantilla no rellena: ${tit.value} / ${est.value}`);
      ok(document.querySelector(".nt-vista").textContent.includes("1 h estimada"), "la vista previa no dice el tiempo estimado");
      ok(tit.selectionStart === tit.value.indexOf("*") && tit.selectionEnd === tit.selectionStart + 1, "no deja marcado el * para escribir encima");
      // con el * sin cambiar, avisa antes de crear
      botonDlg("Crear tarea");
      ok(await hasta(() => !$("modal").hidden && $("modal-texto").textContent.includes("*")), "crea con el * de la plantilla sin avisar");
      $("modal-no").click();
      await espera(50);
      ok(dlg(), "«Cambiar el título» cierra el diálogo");
      tit.value = "Incidencia de Iris con ticket: 4711"; tit.dispatchEvent(new Event("input"));
      // un tiempo estimado que no es un numero no pasa
      est.value = "un rato"; est.dispatchEvent(new Event("input"));
      botonDlg("Crear tarea");
      ok(await hasta(() => document.querySelector(".nt-error").textContent.includes("estimado")), "acepta un tiempo estimado que no es un número");
      est.value = "1,5"; est.dispatchEvent(new Event("input"));
      ok(document.querySelector(".nt-error").hidden, "el aviso del tiempo estimado no se quita al corregirlo");
      // lo que hay, guardado como plantilla nueva
      botonDlg("Guardar como plantilla…");
      ok(await hasta(() => pila.length === 2), "no pide el nombre de la plantilla");
      const arriba = () => [...document.querySelectorAll(".dlg")].pop();
      arriba().querySelector("input").value = "Iris de hora y media";
      [...arriba().querySelectorAll(".dlg-pie button")].find((b) => b.textContent === "Guardar").click();
      ok(await hasta(() => document.querySelectorAll(".nt-plantilla").length === 2), "no guarda la plantilla");
      ok(document.querySelector(".nt-plantilla.puesta .usar").textContent === "Iris de hora y media", "no deja puesta la plantilla guardada");
      const guardada = st.crear.plantillas[1];
      ok(guardada.estimado === 1.5 && guardada.titulo.endsWith("4711") && guardada.padre.id === 15003 && guardada.proyecto === 3,
         `guardada: ${JSON.stringify(guardada)}`);
      // borrarla pregunta antes
      document.querySelector(".nt-plantilla.puesta .borrar").click();
      ok(await hasta(() => !$("modal").hidden), "borra la plantilla sin preguntar");
      $("modal-si").click();
      ok(await hasta(() => document.querySelectorAll(".nt-plantilla").length === 1), "no borra la plantilla");
      botonDlg("Crear tarea");
      ok(await hasta(() => !dlg()), "no se cierra al crear");
      ok(await hasta(() => $("tarea").value.endsWith("ticket: 4711")), `formulario: ${$("tarea").value}`);
      ocultarAviso();
    });
    await prueba("modificar tarea: solo lo que cambia, y lo que no deja ProyectosTIC", async () => {
      // desde el boton «Tareas», con la tarea que hay en el formulario
      ok(!$("b-tareas").hidden, "no ofrece modificar ni duplicar a quien puede crear");
      $("b-tareas").click();
      const opcion = [...document.querySelectorAll("#menu button")].find((b) => b.textContent.startsWith("Modificar"));
      ok(opcion, "el menú de «Tareas» no ofrece modificar");
      opcion.click();
      ok(await hasta(() => document.querySelector(".mt-ficha")?.textContent.includes(`#${tareaDelFormulario().id}`)), "no abre con la tarea del formulario");
      cerrarTodo();
      dlgModificarTarea({ tarea: { id: 15004, nombre: "Revisión de megafonía del Aulario" } });
      const guardar = () => document.querySelector(".dlg-pie button.primario");
      ok(await hasta(() => document.querySelector(".mt-ficha").textContent.includes("#15004")), "no lee la tarea");
      ok(!/null|undefined/.test(dlg().textContent), `escribe null/undefined: ${dlg().textContent}`);
      const tit = document.querySelector(".nt-titulo"), padre = document.querySelector(".nt-padre input");
      ok(tit.value === "Revisión de megafonía del Aulario" && padre.value.startsWith("15002"), "no trae lo que hay en ProyectosTIC");
      ok(guardar().disabled && document.querySelector(".mt-cambios").textContent.includes("Sin cambios"), "deja guardar sin cambios");
      // de cuales puede colgar: ni de ella misma ni de las suyas; con la actual puesta se ve la lista entera
      padre.dispatchEvent(new Event("focus"));
      const caja = () => [...document.querySelectorAll(".buscador-tareas")].find((c) => !c.hidden);
      ok(await hasta(() => caja()?.textContent.includes("15003")), `no lista de cuáles puede colgar: ${caja()?.textContent}`);
      ok(!caja().textContent.includes("15004"), "se ofrece a sí misma de madre");
      [...caja().querySelectorAll(".bt-item")].find((x) => x.textContent.includes("15003"))
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      ok(document.querySelector(".mt-cambios").textContent.includes("Atención a usuarios") && !guardar().disabled, "no enseña el cambio de madre");
      tit.value = "Revisión de megafonía"; tit.dispatchEvent(new Event("input"));
      const est = document.querySelector(".nt-est");
      est.value = "2"; est.dispatchEvent(new Event("input"));
      ok(document.querySelectorAll(".mt-cambio").length === 3, `cambios: ${document.querySelector(".mt-cambios").textContent}`);
      // cerrar con cambios pregunta antes
      teclado("Escape");
      ok(await hasta(() => !$("modal").hidden), "cierra con cambios sin preguntar");
      $("modal-no").click();
      await espera(50);
      ok(dlg(), "«Seguir aquí» cierra el diálogo");
      guardar().click();
      ok(await hasta(() => !dlg()), "no se cierra al guardar");
      ok(await hasta(() => /15004 modificada/.test($("aviso-deshacer").textContent)), "no dice que se ha modificado");
      const ya = await api().tarea_datos(15004);
      ok(ya.titulo === "Revisión de megafonía" && ya.padre.id === 15003 && ya.estimado === 2, `quedó: ${JSON.stringify(ya)}`);
      ocultarAviso();
      // la que ProyectosTIC no deja tocar: se dice, y no se puede guardar
      dlgModificarTarea({ tarea: { id: 15010, nombre: "[AUL] Renovación de proyectores" } });
      ok(await hasta(() => !document.querySelector(".nt-aviso").hidden), "no dice que no se puede modificar");
      ok(document.querySelector(".nt-titulo").disabled && guardar().disabled, "deja tocar una tarea que no se puede modificar");
      cerrarTodo();
      // o solo un campo (en la demo, el tiempo estimado de la 15001)
      dlgModificarTarea({ tarea: { id: 15001, nombre: "[2026_AUL] Servicio" } });
      ok(await hasta(() => document.querySelector(".nt-aviso").textContent.includes("tiempo estimado")), "no dice qué campo no deja cambiar");
      ok(document.querySelector(".nt-est").disabled && !document.querySelector(".nt-titulo").disabled, "no bloquea solo ese campo");
      cerrarTodo();
    });
    await prueba("duplicar tarea: el árbol entero, en otro proyecto y con otro nombre", async () => {
      dlgDuplicarTarea({ tarea: { id: 15001, nombre: "[2026_AUL] Servicio" } });
      const ir = () => document.querySelector(".dlg-pie button.primario");
      const filas = () => [...document.querySelectorAll(".dt-fila")].map((f) =>
        `${f.getAttribute("aria-level")}:${f.querySelector(".dt-titulo").textContent}`);
      const proy = () => document.querySelector(".nt-dos select");
      const elegirProyecto = (id) => { proy().value = id; proy().dispatchEvent(new Event("change")); };
      ok(await hasta(() => filas().length === 6 && !ir().disabled), `árbol: ${filas().join(" | ")}`);
      ok(!/null|undefined/.test(dlg().textContent), `escribe null/undefined: ${dlg().textContent}`);
      ok(ir().textContent === "Duplicar las 6 tareas", ir().textContent);
      // sin las cerradas; y sin las que cuelgan, ella sola
      const [conHijas, conCerradas] = document.querySelectorAll(".nt-opciones input");
      conCerradas.click();
      ok(filas().length === 5 && !filas().some((f) => f.includes("Inventario")), "sigue copiando la cerrada");
      conHijas.click();
      ok(filas().length === 1 && ir().textContent === "Duplicar la tarea", "sin las que cuelgan no se queda ella sola");
      conHijas.click(); conCerradas.click();
      // cambiar un texto en todos los titulos: tambien en el de arriba
      const [busca, pon] = document.querySelectorAll(".dt-cambiar input");
      const cambiar = (de, a) => { busca.value = de; busca.dispatchEvent(new Event("input")); pon.value = a; pon.dispatchEvent(new Event("input")); };
      cambiar("2026", "2027");
      ok(document.querySelector(".nt-titulo").value === "[2027_AUL] Servicio", "no cambia el nombre de la copia");
      ok(filas().includes("2:[2027_AUL] Mantenimientos") && filas().includes("3:Inventario de aulas de 2025"), filas().join(" | "));
      // en otro proyecto
      elegirProyecto("1");
      ok(await hasta(() => !ir().disabled && document.querySelector(".dt-vista .nt-vista-rot").textContent.includes("Sistemas de Gestión")),
         "no cambia el destino");
      // una falla (la demo rechaza a la primera las de "a la segunda"): se para ahi, lo creado se queda y se sigue
      cambiar("megafonía", "megafonía a la segunda");
      ir().click();
      ok(await hasta(() => !$("modal").hidden && /6 tareas nuevas en «Sistemas de Gestión»/.test($("modal-texto").textContent)),
         "no pregunta antes de crear");
      $("modal-si").click();
      ok(await hasta(() => !document.querySelector(".nt-error").hidden && /^Seguir/.test(ir().textContent), 8000), "no se para en la que falla");
      ok(document.querySelector(".dt-fila.fallo") && document.querySelectorAll(".dt-fila.hecha").length === 5, "no marca las creadas y la que falló");
      ok(/Se han creado 5 de 6/.test(document.querySelector(".nt-error").textContent), document.querySelector(".nt-error").textContent);
      ok(!/null|undefined/.test(dlg().textContent), `escribe null/undefined: ${dlg().textContent}`);
      ok(document.querySelector(".dt-campos").inert, "deja cambiar el destino con el árbol a medias");
      ir().click();
      ok(await hasta(() => !dlg(), 8000), "no termina al seguir");
      ok(await hasta(() => /6 tareas creadas en «Sistemas de Gestión»/.test($("aviso-deshacer").textContent)), $("aviso-deshacer").textContent);
      ocultarAviso();
      // un tipo para el que ProyectosTIC pide un campo propio: no deja empezar
      dlgDuplicarTarea({ tarea: { id: 15010, nombre: "[AUL] Renovación de proyectores" } });
      ok(await hasta(() => filas().length === 2), `árbol: ${filas().join(" | ")}`);
      elegirProyecto("3");
      ok(await hasta(() => !document.querySelector(".nt-aviso").hidden && document.querySelector(".nt-aviso").textContent.includes("Servicio afectado")
                           && ir().disabled), "deja duplicar lo que ProyectosTIC no va a aceptar");
      // y uno que el destino no tiene: se crea con el de por defecto, y se dice
      elegirProyecto("1");
      ok(await hasta(() => document.querySelector(".nt-aviso").textContent.includes("no hay tipo «Incidencia»") && !ir().disabled),
         `no avisa del tipo que falta: ${document.querySelector(".nt-aviso").textContent}`);
      ok(document.querySelector(".dt-fila .chip-permiso")?.textContent === "era Incidencia", "no marca la tarea que cambia de tipo");
      cerrarTodo();
    });
    // ---- seis fallos: doble Intro, Intro en el campo Tarea, cambio de dia, formulario
    // que se vaciaba, contador de Por completar y permisos sin conexion
    const intro = (campo, extra = {}) => campo.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...extra }));
    const listaTarea = () => [...document.querySelectorAll(".buscador-tareas")].find((c) => !c.hidden);
    const aLaSemanaDeHoy = async () => {
      cerrarTodo();
      if (st.estad) { salirEstadisticas(); pintarSelectorVista(); }
      if (st.vista !== "semana") { cambiarVista("semana"); await espera(400); }
      navegar(0);
      ok(await hasta(() => st.lunes === lunesDe(hoyIso()) && dias().length === 5 && st.dias[0]?.iso === st.lunes),
         "no vuelve a la semana de hoy");
      await espera(300);
    };
    await prueba("editar día y editar apunte: un segundo Intro mientras se guarda no lo envía dos veces", async () => {
      await aLaSemanaDeHoy();
      const a = api(), guardarDia = a.guardar_dia, editar = a.editar;
      let dia = 0, uno = 0;
      a.guardar_dia = (...x) => { dia++; return guardarDia(...x); };
      a.editar = (...x) => { uno++; return editar(...x); };
      const deProxmox = () => st.dias[0].apuntes.filter((x) => String(x.wp_id) === "12065").length;
      const antes = deProxmox();
      try {
        menuDe(0); pulsarMenu("Editar día");
        ok(await hasta(() => dlg()), "no abre Editar día");
        [...document.querySelectorAll(".dlg-pie button")].find((b) => b.textContent.includes("Añadir tarea")).click();
        const inp = [...document.querySelectorAll(".ed-tarea-input")].pop();
        inp.dispatchEvent(new Event("focus"));
        inp.value = "Proxmox"; inp.dispatchEvent(new Event("input"));
        // Intro con la busqueda en camino: no guarda el dia; al llegar, elige la unica que hay
        ok(intro(inp) === false, "Intro en la tarea de la fila nueva no se queda en el buscador");
        ok(await hasta(() => inp.value.startsWith("12065 - ")), `Intro no elige la única tarea que se ve: ${inp.value}`);
        ok(dia === 0 && dlg(), "Intro en el buscador guardó el día");
        const h = [...document.querySelectorAll(".ed-fila.nueva .horas")].pop();
        ok(await hasta(() => !document.querySelector(".ed-fila.nueva .ed-act").disabled), "no carga las actividades");
        h.value = "1"; h.dispatchEvent(new Event("input"));
        intro(h); intro(h); intro(h, { repeat: true });
        ok(await hasta(() => !dlg() && deProxmox() === antes + 1), `no guardó una sola vez: ${deProxmox() - antes} apuntes nuevos`);
        await espera(400);
        ok(dia === 1, `el día se envió ${dia} veces`);
        ok(deProxmox() === antes + 1, `quedaron ${deProxmox() - antes} apuntes nuevos`);
        teclado("z", { ctrlKey: true });
        ok(await hasta(() => deProxmox() === antes), "Ctrl+Z no quitó el apunte de la prueba");
        // un apunte suelto: igual (el segundo Intro repetia el cambio y apilaba otro Deshacer)
        const d = st.dias[0];
        dlgEditar(d, d.apuntes[0]);
        ok(await hasta(() => dlg()), "no abre Editar apunte");
        const horas = dlg().querySelector("input.horas");
        intro(horas); intro(horas);
        ok(await hasta(() => !dlg()), "Intro no guarda el apunte");
        await espera(400);
        ok(uno === 1, `el apunte se envió ${uno} veces`);
      } finally {
        a.guardar_dia = guardarDia; a.editar = editar;
        cerrarTodo();
        await espera(300);
      }
    });
    await prueba("campo Tarea: Intro elige lo que se ve (una, varias o por número) y con la tarea ya puesta sigue añadiendo", async () => {
      await aLaSemanaDeHoy();
      const inp = $("tarea"), antes = inp.value, a = api(), comprobar = a.comprobar;
      let altas = 0;
      a.comprobar = (...x) => { altas++; return comprobar(...x); };
      const escribir = (t) => { inp.value = t; inp.dispatchEvent(new Event("input")); };
      try {
        ok(/^\d+ - /.test(antes), `sin tarea en el formulario: ${antes}`);
        // con la tarea puesta y sin tocar, Intro es el de «Añadir apunte» (lista abierta o no)
        inp.dispatchEvent(new Event("focus"));
        ok(await hasta(() => listaTarea()), "no se abre la lista");
        ok(intro(inp) === true, "con la tarea puesta, Intro ya no llega al formulario");
        // una sola tarea con eso: Intro la elige, aunque la busqueda aun este en camino
        escribir("Proxmox");
        ok(intro(inp) === false, "Intro con texto a medias se va al formulario");
        ok(inp.value === "Proxmox" && $("modal").hidden, "no espera a la búsqueda");
        ok(await hasta(() => inp.value.startsWith("12065 - ")), `no elige la única tarea: ${inp.value}`);
        ok(await hasta(() => !listaTarea()), "la lista no se cierra al elegir");
        ok(intro(inp) === true, "ya elegida, Intro no llega al formulario");
        // varias: marca la primera y no elige; el segundo Intro, si
        inp.dispatchEvent(new Event("focus"));
        escribir("Mantenimientos");
        ok(intro(inp) === false, "Intro con varias tareas se va al formulario");
        ok(await hasta(() => listaTarea()?.querySelector(".bt-item.activo")), "con varias no marca la primera");
        ok(listaTarea().querySelectorAll(".bt-item").length > 1 && inp.value === "Mantenimientos", "con varias eligió sin preguntar");
        const primera = listaTarea().querySelector(".bt-item").dataset.id;
        ok(listaTarea().querySelector(".bt-item.activo").dataset.id === primera, "la marcada no es la primera");
        ok(intro(inp) === false && inp.value.startsWith(`${primera} - `), `el segundo Intro no elige la marcada: ${inp.value}`);
        // por numero: la de ese numero, sin esperar a nadie
        const [, id0] = [...st.tareas].find(([, id]) => String(id) !== primera);
        inp.dispatchEvent(new Event("focus"));
        escribir(String(id0));
        ok(intro(inp) === false && inp.value.startsWith(`${id0} - `), `por número no elige: ${inp.value}`);
        // nada con eso: ni elige ni salta «Falta tarea»
        inp.dispatchEvent(new Event("focus"));
        escribir("zzzz no existe");
        ok(intro(inp) === false, "sin resultados, Intro se va al formulario");
        await espera(800);
        ok(inp.value === "zzzz no existe" && $("modal").hidden, "sin resultados hizo algo");
        ok(altas === 0, "algún Intro intentó añadir el apunte");
        // y si aun asi se pulsa «Añadir apunte»: el aviso dice que hacer y deja el cursor en el campo
        inp.dispatchEvent(new Event("blur"));
        await espera(200);
        const p = anadir();
        ok(await hasta(() => !$("modal").hidden), "no avisa de que falta la tarea");
        ok(/lista del campo Tarea/.test($("modal-texto").textContent) && !/tus favoritas/.test($("modal-texto").textContent),
           `aviso antiguo: ${$("modal-texto").textContent}`);
        $("modal-si").click();
        await p;
        ok(document.activeElement === inp, "tras el aviso el cursor no queda en el campo Tarea");
      } finally {
        a.comprobar = comprobar;
        if (!$("modal").hidden) $("modal-si").click();
        inp.dispatchEvent(new Event("blur"));
        inp.blur();
        await espera(200);
        inp.value = antes;
        await elegirTarea();
      }
    });
    await prueba("app abierta de un día para otro: «Hoy» va a la semana nueva y se vuelven a pedir los avisos", async () => {
      await aLaSemanaDeHoy();
      const a = api(), real = window.hoyIso, lunesReal = st.lunes;
      const semana = a.semana, sem = a.semana_anterior_pendiente, mes = a.mes_pendiente, pend = a.por_completar;
      const n = { semana: 0, sem: 0, mes: 0, pend: 0 };
      a.semana = (...x) => { n.semana++; return semana(...x); };
      a.semana_anterior_pendiente = (...x) => { n.sem++; return sem(...x); };
      a.mes_pendiente = (...x) => { n.mes++; return mes(...x); };
      a.por_completar = (...x) => { n.pend++; return pend(...x); };
      try {
        ok(st.hoyLunes === lunesReal && st.hoyDia === real(), "el día de arranque no está apuntado");
        // sin cambio de dia, volver a la ventana no recarga nada
        window.dispatchEvent(new Event("focus"));
        await espera(300);
        ok(n.semana === 0 && n.sem === 0 && n.mes === 0, "recarga al volver a la ventana sin haber cambiado el día");
        // pasa una semana con la app en la bandeja; se vuelve a la ventana
        window.hoyIso = () => sumarDias(real(), 7);
        // con el PIN pedido no se pide nada (el motor no contesta): se deja para al desbloquear
        const tapa = el("div", { class: "bloqueo" });
        tapa.hidden = true;
        document.body.append(tapa);
        window.dispatchEvent(new Event("focus"));
        tapa.remove();
        await espera(300);
        ok(n.semana === 0 && n.sem === 0 && st.hoyDia === real(), "con el PIN pedido intenta recargar");
        // «Copiar semana anterior» en vista Mes sin dias marcados: la semana de hoy, sin esperar a nadie
        const vista = st.vista, marcados = st.marcados;
        st.vista = "mes"; st.marcados = new Set();
        const ref = lunesReferencia();
        st.vista = vista; st.marcados = marcados;
        ok(ref === sumarDias(lunesReal, 7), `la semana de referencia es ${ref}`);
        window.dispatchEvent(new Event("focus"));
        ok(st.hoyLunes === sumarDias(lunesReal, 7), `«hoy» sigue en la semana vieja: ${st.hoyLunes}`);
        ok(await hasta(() => n.semana === 1 && n.sem === 1 && n.mes === 1), `no recarga ni vuelve a pedir los avisos: ${JSON.stringify(n)}`);
        ok(await hasta(() => n.pend >= 1), "no vuelve a contar lo que queda por completar");
        ok(st.lunes === lunesReal, "cambia de semana sin que nadie lo pida");
        $("b-hoy").click();
        ok(st.lunes === sumarDias(lunesReal, 7), `«Hoy» lleva a ${st.lunes}`);
        ok(await hasta(() => st.dias[0]?.iso === sumarDias(lunesReal, 7)), "no pinta la semana nueva");
        // «Fichar hoy» de la bandeja llama a navegar(0) sin pasar por la ventana
        const antes = { ...n };
        window.hoyIso = () => sumarDias(real(), 14);
        navegar(0);
        ok(st.lunes === sumarDias(lunesReal, 14), `«Fichar hoy» lleva a ${st.lunes}`);
        ok(await hasta(() => n.sem === antes.sem + 1 && n.mes === antes.mes + 1), "«Fichar hoy» no vuelve a pedir los avisos");
        ok(await hasta(() => st.dias[0]?.iso === sumarDias(lunesReal, 14)), "no pinta la semana de «Fichar hoy»");
        await espera(300);
        ok(n.semana === antes.semana + 1, `«Fichar hoy» cargó la semana ${n.semana - antes.semana} veces`);
      } finally {
        window.hoyIso = real;
        a.semana = semana; a.semana_anterior_pendiente = sem; a.mes_pendiente = mes; a.por_completar = pend;
        await espera(300);
        navegar(0);
        ok(await hasta(() => st.lunes === lunesReal && st.hoyDia === real() && st.dias[0]?.iso === lunesReal), "no vuelve a la semana de verdad");
        await espera(1800);                  // el recuento de Por completar que queda en camino
      }
    });
    await prueba("añadir apunte: si no se crea nada, Horas y Comentario se quedan como estaban", async () => {
      await aLaSemanaDeHoy();
      const a = api(), anadirApi = a.anadir, comprobar = a.comprobar;
      const horas = $("horas"), com = $("comentario");
      const antes = { horas: horas.value, horasAuto: st.horasAuto, com: com.value, comAuto: st.comAuto, habitual: st.comHabitual,
                      marcados: new Set(st.marcados) };
      const wp = resolverTarea();
      const usados = comTareas.mapa?.[String(wp)]?.slice();
      let resultado = null, altas = 0;
      a.comprobar = () => Promise.resolve({ avisos: [] });
      a.anadir = () => { altas++; return Promise.resolve(resultado); };
      try {
        ok(wp != null, "sin tarea en el formulario");
        if (!st.marcados.size) { st.marcados = new Set([st.dias[0].iso]); pintarMarcados(); }
        const poner = () => { horas.value = "1,5"; com.value = "Lo que escribí a mano"; };
        // ProyectosTIC lo rechaza o se cae la conexion: el motor no da error, da creados 0
        poner();
        resultado = { creados: 0, saltados: 0, errores: 1, ultimo: "Sin conexión" };
        let p = anadir();
        ok(await hasta(() => !$("modal").hidden && /No se creó ningún apunte/.test($("modal-titulo")?.textContent || $("modal").textContent)),
           "no avisa de que no se creó nada");
        $("modal-si").click();
        await p;
        ok(horas.value === "1,5" && com.value === "Lo que escribí a mano", `se vació el formulario: «${horas.value}» «${com.value}»`);
        // «No» a repetir con un solo dia: tampoco se crea nada
        resultado = { creados: 0, saltados: 1, errores: 0, ultimo: "" };
        await anadir();
        ok(horas.value === "1,5" && com.value === "Lo que escribí a mano", `con todo saltado se vació: «${horas.value}» «${com.value}»`);
        // creado: entonces si, el formulario queda listo para el siguiente
        resultado = { creados: 1, saltados: 0, errores: 0, ultimo: "" };
        await anadir();
        ok(altas === 3, `se llamó a añadir ${altas} veces`);
        ok(horas.value !== "1,5" && horas.value === st.horasAuto, `tras crear, Horas sigue con lo escrito: «${horas.value}»`);
        ok(com.value === st.comAuto, "tras crear, el comentario no queda como sugerencia");
      } finally {
        a.anadir = anadirApi; a.comprobar = comprobar;
        if (!$("modal").hidden) $("modal-si").click();
        st.comHabitual = antes.habitual;
        if (comTareas.mapa && wp != null) {
          if (usados) comTareas.mapa[String(wp)] = usados; else delete comTareas.mapa[String(wp)];
        }
        st.marcados = antes.marcados; pintarMarcados();
        horas.value = antes.horas; st.horasAuto = antes.horasAuto;
        com.value = antes.com; st.comAuto = antes.comAuto;
        ocultarAviso();
        await espera(1800);
      }
    });
    await prueba("por completar: el número se entera de una marca local (festivo, vacaciones, permiso)", async () => {
      await aLaSemanaDeHoy();
      const a = api(), pend = a.por_completar, bandeja = a.bandeja_pendientes;
      let n = 0, enBandeja = 0;
      a.por_completar = (...x) => { n++; return pend(...x); };
      a.bandeja_pendientes = (...x) => { enBandeja++; return bandeja(...x); };
      try {
        await espera(1800);                  // nada en camino de antes
        n = 0; enBandeja = 0;
        // dos marcas seguidas (lo que hace el menu del dia tras marcar): una sola consulta
        await repintarLocal();
        await repintarLocal();
        ok(n === 0, "no espera a que se acaben las marcas");
        ok(await hasta(() => n === 1 && enBandeja === 1, 4000), `no vuelve a contar tras la marca: ${n} consultas, ${enBandeja} a la bandeja`);
        await espera(1800);
        ok(n === 1, `dos marcas seguidas hicieron ${n} consultas`);
      } finally {
        a.por_completar = pend; a.bandeja_pendientes = bandeja;
      }
    });
    await prueba("Permisos sin conexión: no da «0:00 imputadas» por bueno y dice que enseña la última lectura", async () => {
      const a = api(), permisos = a.permisos, leer = a.actualizar_usadas_pt;
      a.actualizar_usadas_pt = () => Promise.reject(new Error("No se pudo conectar con ProyectosTIC"));
      try {
        // con una lectura buena de antes: se queda, y se dice que es la ultima
        dlgPermisos();
        ok(await hasta(() => /se muestra la última lectura/.test(dlg()?.textContent || "")), "no dice que enseña la última lectura");
        ok(/4:30 imputadas/.test(dlg().textContent), "pierde la última lectura buena");
        cerrarTodo();
        // sin ninguna lectura todavia: lo dice en vez de enseñar 0:00
        a.permisos = async () => {
          const p = await permisos();
          p.filas = p.filas.map((f) => (f.actividad ? { ...f, usadas_pt: "0:00", pt_leidas: false } : f));
          return p;
        };
        dlgPermisos();
        ok(await hasta(() => /aún no se ha podido leer/.test(dlg()?.textContent || "")), "sin lectura no lo dice");
        ok(!/0:00 imputadas/.test(dlg().textContent), "enseña «0:00 imputadas» sin haber leído nada");
      } finally {
        a.permisos = permisos; a.actualizar_usadas_pt = leer;
        cerrarTodo();
        await espera(300);
      }
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
