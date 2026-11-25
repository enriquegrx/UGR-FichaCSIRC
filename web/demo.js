/* Datos de demostracion: SOLO si la pagina se abre con ?demo en la direccion
 * (para revisar el diseno en un navegador normal, sin pywebview ni red).
 * Imita la forma de las respuestas de la clase Api de registrar_web.py.
 * Dentro de la app (pywebview) no hace nada. */
"use strict";
(function () {
  if (!/[?&]demo\b/.test(location.search)) return;

  const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
  const fmt = (h) => `${Math.round(h * 100) / 100}`.replace(".", ",") + "h";
  const hoy = new Date();
  const lunesDe = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const hoyIso = iso(hoy);

  const tareas = [
    { id: 11765, nombre: "[2026_ASG] Mantenimientos" },
    { id: 12063, nombre: "[ASG] Cabinas almacenamiento SisGes" },
    { id: 12065, nombre: "[ASG] Proxmox + dockers en SisGes" },
    { id: 13001, nombre: "[ATE] Permisos" },
  ];
  const apuntes = {};      // iso -> [{...}]
  const favDemo = new Set([11765, 12063, 12065, 13001]);
  const avisosLocalNo = [];
  const marcas = { nolab: {}, guardia: new Set(), tele: new Set() };
  const destinosDemo = {};
  let avisoMesVisto = false;
  const tareasLocalDemo = () => Object.entries({ permiso: "Permisos por horas", baja: "Bajas",
    vacaciones: "Vacaciones", guardia: "Guardias", teletrabajo: "Teletrabajo" }).map(([m, titulo]) => {
    const g = destinosDemo[m] || {};
    return { motivo: m, titulo, modo: g.ninguna ? "ninguna" : g.id ? "tarea" : "auto", id: g.id || "", nombre: g.nombre || "" };
  });
  let siguiente = 100;
  let borrados = null;
  let diaAntes = null;      // [fecha, apuntes] antes de "Editar día" (deshacer)

  // semana actual con algo de todo
  const l = lunesDe(hoy);
  const d = (n) => { const x = new Date(l); x.setDate(x.getDate() + n); return iso(x); };
  apuntes[d(0)] = [
    { id: 1, horas: 5, tarea: tareas[0].nombre, wp_id: "11765", actividad: "Actuaciones técnicas", comentario: "Revisión de copias" },
    { id: 2, horas: 2, tarea: tareas[2].nombre, wp_id: "12065", actividad: "Formación", comentario: "" },
  ];
  apuntes[d(1)] = [{ id: 3, horas: 3.5, tarea: tareas[0].nombre, wp_id: "11765", actividad: "Actuaciones técnicas", comentario: "" }];
  apuntes[d(2)] = [{ id: 4, horas: 1, tarea: tareas[3].nombre, wp_id: "13001", actividad: "Asuntos propios", comentario: "" }];
  apuntes[d(-5)] = [
    { id: 5, horas: 7, tarea: tareas[0].nombre, wp_id: "11765", actividad: "Actuaciones técnicas", comentario: "Revisión de copias" },
    { id: 6, horas: 2, tarea: tareas[0].nombre, wp_id: "11765", actividad: "Actuaciones técnicas", comentario: "Certificado SSL renovado" },
  ];
  marcas.guardia.add(d(1));
  marcas.tele.add(d(3));

  const objetivo = (i) => (marcas.nolab[i] ? 0 : 7);
  function tarjeta(i, n) {
    const ap = apuntes[i] || [];
    const reg = ap.reduce((s, a) => s + a.horas, 0);
    const obj = objetivo(i);
    let estado, frac, texto;
    if (marcas.nolab[i]) {
      estado = marcas.nolab[i] === "vacaciones" ? "vacaciones" : "nolab"; frac = 1;
      texto = marcas.nolab[i][0].toUpperCase() + marcas.nolab[i].slice(1);
    } else if (reg > obj) { estado = "pasado"; frac = 1; texto = `${fmt(reg)} / ${fmt(obj)}  (te pasas)`; }
    else if (reg >= obj && reg > 0) { estado = "completo"; frac = 1; texto = `${fmt(reg)} / ${fmt(obj)}  ✔`; }
    else if (reg > 0) { estado = "parcial"; frac = reg / obj; texto = `${fmt(reg)} / ${fmt(obj)}`; }
    else { estado = "vacio"; frac = 0; texto = `0h / ${fmt(obj)}`; }
    const [a, m, dd] = i.split("-");
    return {
      iso: i, nombre: DIAS[n], fecha: `${dd}/${m}`, es_hoy: i === hoyIso, estado, frac, texto,
      reg, obj, falta: marcas.nolab[i] ? 0 : obj - reg, no_laborable: !!marcas.nolab[i],
      exceso: !marcas.nolab[i] && reg > obj ? reg - obj : 0,
      motivo: marcas.nolab[i] || "", guardia: marcas.guardia.has(i), teletrabajo: marcas.tele.has(i),
      permiso: "", permiso_detalle: [],
      apuntes: ap.map((x) => ({ ...x, id: String(x.id), horas_txt: fmt(x.horas), destino: "op" })),
    };
  }
  function semana(lunes) {
    const dias = [0, 1, 2, 3, 4].map((n) => {
      const [a, m, dd] = lunes.split("-").map(Number);
      return tarjeta(iso(new Date(a, m - 1, dd + n)), n);
    });
    const reg = dias.reduce((s, x) => s + x.reg, 0), obj = dias.reduce((s, x) => s + x.obj, 0);
    const [a, m, dd] = lunes.split("-").map(Number);
    const dom = new Date(a, m - 1, dd + 6);
    return {
      titulo: `Semana ${dd.toString().padStart(2, "0")}/${String(m).padStart(2, "0")}/${a} - ${String(dom.getDate()).padStart(2, "0")}/${String(dom.getMonth() + 1).padStart(2, "0")}/${dom.getFullYear()}`,
      total: `${fmt(reg)} / ${fmt(obj)}`,
      teletrabajo: `${dias.filter((x) => x.teletrabajo).length}/1`, conexion: "ok", dias,
    };
  }
  const espera = (v) => new Promise((r) => setTimeout(() => r(v), 120));

  // Crear tareas: se puede en dos proyectos. En "Aulas" no deja asignarse y el
  // tipo Incidencia pide un campo propio (la app no lo rellena). Con ?sincrear,
  // en ninguno. Un titulo con "rechaza" lo rechaza, como haria ProyectosTIC.
  const proyectosCrear = /[?&]sincrear\b/.test(location.search) ? []
    : [{ id: 1, nombre: "Sistemas de Gestión" }, { id: 3, nombre: "Aulas y Teledocencia" }];
  const tiposDemo = {
    1: [{ id: 1, nombre: "Tarea", color: "#1a67a3", hito: false }, { id: 2, nombre: "Hito", color: "#35a35a", hito: true },
        { id: 3, nombre: "Fase", color: "#d9822b", hito: false }],
    3: [{ id: 1, nombre: "Tarea", color: "#1a67a3", hito: false }, { id: 4, nombre: "Incidencia", color: "#c0392b", hito: false }],
  };
  const aul = (id, nombre, padre_id = null, padre = "") => ({ id, nombre, proyecto: "Aulas y Teledocencia", padre, padre_id });
  const tareasAulas = [
    aul(15001, "[2026_AUL] Servicio"),
    aul(15002, "[2026_AUL] Mantenimientos", 15001, "[2026_AUL] Servicio"),
    aul(15003, "[2026_AUL] Atención a usuarios", 15001, "[2026_AUL] Servicio"),
    aul(15004, "Revisión de megafonía del Aulario", 15002, "[2026_AUL] Mantenimientos"),
    aul(15005, "Sustitución de lámparas", 15002, "[2026_AUL] Mantenimientos"),
    // cuelga de una tarea que ya esta cerrada: no viene en la lista
    aul(15010, "[AUL] Renovación de proyectores", 14990, "[2026_AUL] Proyectos"),
    aul(15011, "Proyectores de la Facultad de Ciencias", 15010, "[AUL] Renovación de proyectores")];
  let ultimoCrear = null, sigTarea = 14100;
  let ocultosDemo = [];
  let desplegadosDemo = [];
  // Plantillas de tarea (ninguna con ?sinplantillas).
  let plantillasDemo = /[?&]sinplantillas\b/.test(location.search) ? [] : [{
    nombre: "Incidencia de Iris", titulo: "Incidencia de Iris con ticket: *", proyecto: 3, tipo: 1,
    padre: { id: 15003, nombre: "[2026_AUL] Atención a usuarios" }, estimado: 1, descripcion: "",
    asignar: false, favorita: false }];
  // Modificar y duplicar. De Aulas se sabe el arbol entero: una cerrada que ya no
  // sale en la lista (15006), una con tiempo estimado (15005) y una Incidencia
  // (15011: en Sistemas de Gestion no hay ese tipo, y en Aulas pide un campo propio).
  // La 15010 no se deja modificar; en la 15001 no se puede tocar el tiempo estimado.
  // Al duplicar, un titulo con "a la segunda" falla la primera vez.
  const cerradasAulas = [aul(15006, "Inventario de aulas de 2025", 15002, "[2026_AUL] Mantenimientos")];
  const TIPOS_DEMO = { 1: "Tarea", 2: "Hito", 3: "Fase", 4: "Incidencia" };
  const detalleDemo = new Map([[15005, { estimado: 2 }], [15011, { tipo: 4 }], [15006, { cerrada: true }],
    [15002, { descripcion: "Lo que se revisa cada trimestre en las aulas." }]]);
  const detalle = (id) => detalleDemo.get(id) || {};
  const NO_ESTA = "ProyectosTIC no encuentra la tarea: ya no existe o no la ves.";
  const deOtros = [{ id: 14000, nombre: "[ASG] Migración de correo" }, { id: 11754, nombre: "[2026_ATE] Mantenimientos" }];
  const tareaDemo = (id) => {
    const a = [...tareasAulas, ...cerradasAulas].find((x) => x.id === id);
    if (a) return { ...a, pid: 3 };
    const t = [...tareas, ...deOtros].find((x) => x.id === id);
    return t ? { id: t.id, nombre: t.nombre, proyecto: "Sistemas de Gestión", pid: 1, padre_id: null, padre: "" } : null;
  };
  const listaDemo = () => tareas.map((t) => ({ ...t, texto: `${t.id} - ${t.nombre}`, favorita: favDemo.has(t.id) }));
  const yaFallo = new Set();

  window.pywebview = { api: {
    inicio: () => espera({
      version: "3.1.0", plataforma: "Demo", lunes: iso(l), inari: false, logo: "../logo_ugr.png",
      tareas: tareas.map((t) => ({ ...t, texto: `${t.id} - ${t.nombre}`, favorita: favDemo.has(t.id) })),
      actividades: ["Actuaciones técnicas", "Asuntos propios", "Formación", "Soporte"],
      actividad_preferida: "Actuaciones técnicas", comentario_guardia: "Servicio de Guardia",
      github: "enriquegrx/UGR-FichaCSIRC", inari_listo: false,
      asociaciones: { "Asuntos propios": 13001 }, toca_permisos_anio: false, experimento: false,
      novedades_tras_actualizar: /[?&]novedades\b/.test(location.search) ? { desde: "" } : null,
      sugerir_pin: /[?&]sugerirpin\b/.test(location.search),
      avisos_local_no: [],
      vista: /[?&]mes\b/.test(location.search) ? "mes" : "semana",
      zoom: 1, tema: (location.search.match(/[?&]tema=(\w+)/) || [])[1] || "sistema", pin: { activo: /[?&]pin\b/.test(location.search), desbloqueada: true, auto_min: 15 },
      paneles: { form: "abierto", habituales: "abierto", apuntes: "abierto", franja: "abierto", leyenda: "abierto" },
    }),
    usuario: () => espera("Persona de Prueba"),
    semana: (lunes) => espera(semana(lunes)),
    repintar: (lunes) => espera(semana(lunes)),
    actividades: (id) => espera({
      nombres: ["Actuaciones técnicas", "Asuntos propios", "Formación", "Soporte"],
      preferida: id === 13001 ? "Asuntos propios" : "Actuaciones técnicas", comentario: "",
    }),
    comprobar: (dias, wp, horas) => {
      const h = parseFloat(String(horas).replace(",", "."));
      if (!(h > 0 && h <= 24)) return espera({ error: "Escribe un número de horas válido (ej. 3 o 3,5)." });
      if (!dias.length) return espera({ error: "Marca al menos un día." });
      const avisos = [];
      const rep = dias.filter((i) => (apuntes[i] || []).some((a) => String(a.wp_id) === String(wp)));
      if (rep.length) avisos.push({ clave: "repetir", titulo: "Esa tarea ya tiene horas ese día",
        texto: `Ya hay horas de esta tarea en ${rep.length} día(s). ¿Añadir ${fmt(h)} más?` });
      return espera({ avisos });
    },
    anadir: (dias, wp, horas, comentario, actividad, permitir) => {
      const h = parseFloat(String(horas).replace(",", "."));
      const t = tareas.find((x) => x.id === Number(wp));
      let creados = 0, saltados = 0;
      for (const i of dias) {
        if (!permitir && (apuntes[i] || []).some((a) => String(a.wp_id) === String(wp))) { saltados++; continue; }
        (apuntes[i] = apuntes[i] || []).push({ id: siguiente++, horas: h, tarea: t ? t.nombre : "[ASG] Migración de correo",
                                               wp_id: String(wp), actividad, comentario });
        creados++;
      }
      return espera({ creados, saltados, errores: 0, ultimo: "" });
    },
    eliminar: (items) => {
      borrados = [];
      for (const it of items) {
        const lista = apuntes[it.fecha] || [];
        const k = lista.findIndex((a) => String(a.id) === String(it.id));
        if (k >= 0) borrados.push([it.fecha, lista.splice(k, 1)[0]]);
      }
      return espera({ eliminados: borrados.length, errores: 0, ultimo: "", puede_deshacer: borrados.length > 0 });
    },
    deshacer: () => {
      if (diaAntes) {
        const [f, antes] = diaAntes;
        apuntes[f] = antes;
        diaAntes = null;
        return espera({ restaurados: 1, errores: 0, ultimo: "" });
      }
      const n = (borrados || []).length;
      for (const [f, a] of borrados || []) (apuntes[f] = apuntes[f] || []).push(a);
      borrados = null;
      return espera({ restaurados: n, errores: 0, ultimo: "" });
    },
    accion_dia: (i, accion, motivo) => {
      if (accion === "no_laborable") marcas.nolab[i] = motivo;
      if (accion === "quitar_no_laborable") delete marcas.nolab[i];
      if (accion === "guardia") marcas.guardia.add(i);
      if (accion === "quitar_guardia") marcas.guardia.delete(i);
      if (accion === "teletrabajo") marcas.tele.add(i);
      if (accion === "quitar_teletrabajo") marcas.tele.delete(i);
      return espera({ ok: true });
    },
    teletrabajo_lleno: () => espera(marcas.tele.size >= 1),
  } };

  // ---- vista mensual: semanas L-V que tocan el mes (como Api._semanas_de) ----
  function mesDemo(anio, mes) {
    const primero = new Date(anio, mes - 1, 1);
    const ultimo = new Date(anio, mes, 0);
    const lunes = new Date(primero);
    lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7));
    const semanas = [];
    let reg = 0, obj = 0;
    while (lunes <= ultimo) {
      const viernes = new Date(lunes); viernes.setDate(viernes.getDate() + 4);
      if (viernes >= primero) {
        semanas.push([0, 1, 2, 3, 4].map((n) => {
          const f = new Date(lunes); f.setDate(f.getDate() + n);
          const t = tarjeta(iso(f), n);
          const delMes = f.getMonth() === mes - 1;
          if (delMes) { reg += t.reg; obj += t.obj; }
          return { ...t, dia: f.getDate(), del_mes: delMes, futuro: iso(f) > hoyIso };
        }));
      }
      lunes.setDate(lunes.getDate() + 7);
    }
    const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto",
                   "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    return { titulo: `${MESES[mes - 1]} ${anio}`, anio, mes, total: `${fmt(reg)} / ${fmt(obj)}`,
             al_dia: false, estado: "Te faltan 6h", frac: obj ? reg / obj : 0, conexion: "ok", semanas };
  }

  // ---- dialogos ----
  const asoc = { "Asuntos propios": 13001 };
  const plantillas = [{ nombre: "Día tipo (7h)", apuntes: [{ id: 11765, horas: 5 }, { id: 12065, horas: 2 }] }];
  let copia = null;
  const permisos = [
    { id: "ap", nombre: "Asuntos particulares por horas", actividad: "Asuntos propios",
      concesiones: [{ horas: 70, fecha_limite: "2027-01-15" }], local: 2, pt: 4.5 },
    { id: "sm", nombre: "Compensación por servicios mínimos", actividad: "",
      concesiones: [{ horas: 28, fecha_limite: "2026-11-10" }, { horas: 28, fecha_limite: "2027-04-06" }], local: 38, pt: 0 },
  ];
  const hhmm = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  const vistaPermisos = () => ({
    desde: "01/01/2026", anio: 2026, hay_actividades: permisos.some((p) => p.actividad),
    actividades: ["Actuaciones técnicas", "Asuntos propios", "Formación", "Soporte"],
    filas: permisos.map((p) => {
      const cupo = p.concesiones.reduce((s, c) => s + c.horas, 0);
      const usadas = p.local + (p.actividad ? p.pt : 0);
      return { id: p.id, nombre: p.nombre, actividad: p.actividad, concedidas: hhmm(cupo),
        usadas: hhmm(usadas), usadas_local: hhmm(p.local), usadas_pt: hhmm(p.pt), pt_leidas: true,
        disponibles: hhmm(cupo - usadas), negativo: cupo < usadas,
        concesiones: p.concesiones.map((c) => ({ horas: hhmm(c.horas), fecha_limite: c.fecha_limite,
          estado: c.fecha_limite === "2026-11-10" ? "por_caducar" : "" })) };
    }) });
  // el aviso diario: los dos laborables anteriores y hoy, sin fichar
  const diaAviso = (atras) => {
    const x = new Date();
    for (let n = atras; n > 0;) { x.setDate(x.getDate() - 1); if (x.getDay() % 6) n--; }
    return { iso: iso(x), nombre: ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][x.getDay()],
             fecha: `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}`,
             falta: 6.5, falta_txt: "6,5h" };
  };
  let avisoPend = [diaAviso(2), diaAviso(1), diaAviso(0)];
  // la campana: en la ventanita del aviso ya esta puesto (por eso ha saltado)
  const recDemo = { activo: document.body.classList.contains("aviso"), hora: "14:00", ofrecido: false };
  const avisoDemo = () => ({
    texto: avisoPend.length ? `Te faltan horas por fichar esta semana (${fmt(avisoPend.reduce((s, x) => s + x.falta, 0))} en total):` : "",
    minutos: 10, dias: avisoPend, pin: /[?&]pin\b/.test(location.search),
    // ?prueba: "Probar el aviso" (no ficha); ?prueba=ejemplo: con el dia inventado
    prueba: /[?&]prueba\b/.test(location.search), ejemplo: /[?&]prueba=ejemplo\b/.test(location.search),
    habituales: [{ wp_id: 11765, tarea: "[2026_ASG] Mantenimientos", actividad: "Actuaciones técnicas", tipico: 6.5, tipico_txt: "6,5h" },
                 { wp_id: 12065, tarea: "[ASG] Proxmox + dockers en SisGes", actividad: "Formación", tipico: 2, tipico_txt: "2h" }] });
  // ?pin: arranca bloqueada (PIN 1234)
  let pinActivo = /[?&]pin\b/.test(location.search), pinOk = !pinActivo;
  Object.assign(window.pywebview.api, {
    pin_estado: () => espera({ activo: pinActivo, desbloqueada: pinOk, auto_min: 15, logo: "../logo_ugr.png", version: "3.1.0",
                               tema: (location.search.match(/[?&]tema=(\w+)/) || [])[1] || "sistema" }),
    pin_auto: () => espera({ ok: true }),
    pin_bloquear: () => { if (pinActivo) pinOk = false; return espera({ bloqueada: !pinOk }); },
    guardar_zoom: (z) => espera({ ok: true, zoom: z }),
    guardar_tema: () => espera({ ok: true }),
    tarea_ausencia: (motivo) => espera(motivo === "festivo" || motivo === "teletrabajo" ? null
      : motivo === "guardia" ? { id: 13002, nombre: "[ATE] Guardias", proyecto: "ATE", padre: "[2026_ATE] Servicio", actividad: "" }
      : { id: 13001, nombre: "[ATE] Permisos", proyecto: "ATE", padre: "[2026_ATE] Servicio", actividad: "Asuntos propios" }),
    tareas_local: () => espera(tareasLocalDemo()),
    estadisticas: (periodo) => espera({
      periodo, titulo: periodo === "anio" ? "2026" : periodo === "semana" ? "Semana del 09/11 al 13/11/2026" : "Noviembre 2026",
      total: "58,5h", cumplida: 92, media: "6,5h", exceso: "2,5h",
      tareas: [{ wp_id: "11765", nombre: "[2026_ASG] Mantenimientos", horas: 36, horas_txt: "36h", pct: 62 },
               { wp_id: "12065", nombre: "[ASG] Proxmox + dockers en SisGes", horas: 12, horas_txt: "12h", pct: 21 },
               { wp_id: "13001", nombre: "[ATE] Permisos", horas: 6, horas_txt: "6h", pct: 10 },
               { wp_id: "12154", nombre: "Formación UGR", horas: 4.5, horas_txt: "4,5h", pct: 7 }],
      actividades: [{ nombre: "Actuaciones técnicas", horas_txt: "32h", pct: 55 }, { nombre: "Formación", horas_txt: "14,5h", pct: 25 },
                    { nombre: "Gestión", horas_txt: "6h", pct: 10 }, { nombre: "Asuntos propios", horas_txt: "6h", pct: 10 }],
      meses: periodo !== "anio" ? [] : ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"].map((mes, i) => ({
        mes, reg: [140, 145, 130, 147, 150, 120, 90, 40, 138, 142, 58, 0][i], obj: [147, 147, 147, 147, 154, 140, 100, 0, 147, 154, 147, 0][i],
        estado: i === 11 ? "futuro" : i === 7 ? "nolab" : [2, 8, 9, 10].includes(i) ? "parcial" : "completo", texto: "" })),
      detalles: { racha: 9, teletrabajo: 4, guardias: 2, incompletos: 3, faltan: "6h", permisos: "6h" },
      como_va: { al_dia: false, objetivo_hoy: "63h", objetivo_periodo: "147h", frac: 0.4, estado: "Te faltan 4,5h para estar al día",
                 incompletos: [{ iso: d(2), dia: `Miércoles ${d(2).slice(8)}/${d(2).slice(5, 7)}`, horas: "1h / 7h" },
                               { iso: d(1), dia: `Martes ${d(1).slice(8)}/${d(1).slice(5, 7)}`, horas: "3,5h / 7h" }] } }),
    diagnostico: () => espera({ texto: "FichaCSIRC demo · Windows 11\n\nConfiguración: demo\n  API key: sí, 40 caracteres\n\nProyectosTIC: responde 200 en 0.2 s (API key aceptada)" }),
    mes_pendiente: () => espera(avisoMesVisto ? null : { anio: 2026, mes: 11, texto: "Noviembre cierra y te faltan 5h en 1 día:",
                                                      dias: [{ iso: d(2), texto: `miércoles ${d(2).slice(8)}/${d(2).slice(5, 7)} (1h de 7h)` }] }),
    aviso_mes_visto: () => { avisoMesVisto = true; return espera({ ok: true }); },
    bandeja_pendientes: () => espera({ ok: true }),
    bandeja_habituales: () => espera({ ok: true }),
    abrir_informe: (html) => { window.__informe = html; return espera({ ok: true, ruta: "C:\\Temp\\FichaCSIRC-informe.html" }); },
    guardar_plantilla_semana: (lunes, nombre) => {
      const [a, m, dd] = lunes.split("-").map(Number);
      const dias = [0, 1, 2, 3, 4].map((n) => (apuntes[iso(new Date(a, m - 1, dd + n))] || []).map((x) => ({ id: x.wp_id, horas: x.horas })));
      const n = dias.reduce((t, x) => t + x.length, 0);
      if (!n) return espera({ error: "Esa semana no tiene apuntes de ProyectosTIC que guardar." });
      plantillas.push({ nombre, semana: true, dias });
      return espera({ ok: true, n, total: fmt(dias.flat().reduce((t, x) => t + x.horas, 0)) });
    },
    aplicar_plantilla_semana: () => espera({ creados: 3, saltados: 1, errores: 0, ultimo: "" }),
    comentarios_tareas: () => {
      const por = { 11765: ["Parches de seguridad", "Actualización de certificados"] };
      for (const iso of Object.keys(apuntes).sort().reverse()) {
        for (const a of apuntes[iso]) {
          if (!a.comentario || !a.wp_id) continue;
          const lista = (por[a.wp_id] ||= []);
          if (!lista.includes(a.comentario)) lista.push(a.comentario);
        }
      }
      return espera({ por_tarea: por });
    },
    buscar_apuntes: (texto, anio) => {
      const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const palabras = norm(texto).split(/\s+/).filter(Boolean);
      const out = [];
      for (const [i, ap] of Object.entries(apuntes)) {
        for (const a of ap) {
          const heno = norm(`${a.tarea} ${a.wp_id} ${a.actividad} ${a.comentario} ${i.slice(8)}/${i.slice(5, 7)}`);
          if (palabras.length && palabras.every((w) => heno.includes(w))) {
            out.push({ iso: i, dia: `${i.slice(8)}/${i.slice(5, 7)}`, horas: a.horas, horas_txt: fmt(a.horas),
                       tarea: a.tarea, actividad: a.actividad, comentario: a.comentario });
          }
        }
      }
      out.sort((x, y) => (x.iso < y.iso ? 1 : -1));
      return espera({ anio: Number(anio), resultados: out, n: out.length, recortado: false,
                      total: fmt(out.reduce((s, x) => s + x.horas, 0)) });
    },
    // Por completar: los laborables de las 3 semanas anteriores hasta ayer
    por_completar: (anio) => {
      const a = Number(anio) || hoy.getFullYear();
      const dias = [], excesos = [];
      let modelo = null;
      for (let n = -21; n < 0; n++) {
        const x = new Date(hoy); x.setDate(x.getDate() + n);
        const i = iso(x);
        if (x.getDay() === 0 || x.getDay() === 6 || x.getFullYear() !== a || marcas.nolab[i]) continue;
        const reg = (apuntes[i] || []).reduce((s, y) => s + y.horas, 0);
        if (reg > 7) {
          const ap = apuntes[i];
          excesos.push({ iso: i, mes: x.getMonth() + 1, dia: `${["Domingo", ...DIAS][x.getDay()]} ${i.slice(8)}/${i.slice(5, 7)}`,
                         reg, obj: 7, sobra: reg - 7, sobra_txt: fmt(reg - 7), texto: `${fmt(reg)} de 7h`, nolab: false, motivo: "",
                         duplicado: new Set(ap.map((y) => y.wp_id + y.actividad)).size < ap.length,
                         apuntes: ap.map((y) => ({ id: String(y.id), tarea: y.tarea, horas: y.horas, horas_txt: fmt(y.horas),
                           actividad: y.actividad, comentario: y.comentario || "",
                           repetido: ap.filter((z) => z.wp_id === y.wp_id && z.actividad === y.actividad).length > 1,
                           justo: Math.abs(y.horas - (reg - 7)) < 0.001 })) });
        }
        if (reg >= 7) { modelo = i; continue; }
        dias.push({ iso: i, mes: x.getMonth() + 1, dia: `${["Domingo", ...DIAS][x.getDay()]} ${i.slice(8)}/${i.slice(5, 7)}`,
                    reg, obj: 7, falta: 7 - reg, texto: `${fmt(reg)} de 7h`, falta_txt: fmt(7 - reg),
                    vacio: !reg, guardia: marcas.guardia.has(i), teletrabajo: marcas.tele.has(i) });
      }
      const NOMBRES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
      const meses = NOMBRES.map((nombre, i) => {
        const del = dias.filter((y) => y.mes === i + 1);
        const futuro = a === hoy.getFullYear() && i > hoy.getMonth();
        return { mes: i + 1, nombre, n: del.length, falta: fmt(del.reduce((s, y) => s + y.falta, 0)),
                 estado: futuro ? "futuro" : del.length ? "pendiente" : i === 7 ? "nolab" : "completo",
                 frac: futuro ? 0 : del.length ? 0.4 : 1 };
      });
      return espera({ anio: a, titulo: `Por completar · ${a}`, dias, n: dias.length,
                      falta: fmt(dias.reduce((s, y) => s + y.falta, 0)), modelo, meses, frac: 0.86,
                      excesos, n_excesos: excesos.length, sobra: fmt(excesos.reduce((s, y) => s + y.sobra, 0)),
                      anterior: a > hoy.getFullYear() - 3, siguiente: a < hoy.getFullYear() });
    },
    completar_dias: (dias, wp, actividad, comentario, reparto) => {
      const partes = reparto && reparto.length ? reparto : [{ wp_id: wp, actividad, peso: 1 }];
      let creados = 0, saltados = 0, horas = 0;
      for (const i of dias) {
        const falta = 7 - (apuntes[i] || []).reduce((s, y) => s + y.horas, 0);
        if (falta <= 0) { saltados++; continue; }
        repartirHoras(falta, partes.map((p) => p.peso)).forEach((h, k) => {
          if (h <= 0) return;
          const t = tareas.find((x) => x.id === Number(partes[k].wp_id));
          (apuntes[i] = apuntes[i] || []).push({ id: siguiente++, horas: h, tarea: t ? t.nombre : "Tarea", wp_id: String(partes[k].wp_id),
                                                 actividad: partes[k].actividad || "", comentario: comentario || "" });
          horas += h;
        });
        creados++;
      }
      return espera({ creados, saltados, errores: 0, ultimo: "", fallidos: [], horas: fmt(horas),
                      puede_deshacer: !!creados, quedan: creados ? 1 : 0 });
    },
    fijar_tarea_local: (m, modo, id, nombre) => {
      if (modo === "auto") delete destinosDemo[m];
      else destinosDemo[m] = modo === "ninguna" ? { ninguna: true } : { id, nombre };
      return espera({ ok: true, filas: tareasLocalDemo() });
    },
    no_avisar_local: (m) => { avisosLocalNo.push(m); return espera({ ok: true, avisos_local_no: [...avisosLocalNo] }); },
    volver_a_avisar_local: () => { avisosLocalNo.length = 0; return espera({ ok: true }); },
    copias: () => espera([{ id: "config-20261111-1002.json", fecha: "11/11/2026 10:02", resumen: "4 favoritas · 1 plantilla · 2 tipos de permiso · 5 días marcados" },
      { id: "config-20261110-0915.json", fecha: "10/11/2026 09:15", resumen: "3 favoritas · 1 plantilla · 2 tipos de permiso · 5 días marcados" }]),
    restaurar_copia: () => espera({ ok: true }),
    exportar_config: () => espera({ ok: true, ruta: "C:\\Users\\demo\\FichaCSIRC-configuracion.json" }),
    importar_config: () => espera({ cancelado: true }),
    bandeja_estado: () => espera({ soportada: true, activa: false, inicio: false, mac: false }),
    bandeja_guardar: (a, i) => espera({ ok: true, soportada: true, activa: a || i, inicio: i, mac: false }),
    semana_anterior_pendiente: () => espera(/[?&]semana\b/.test(location.search)
      ? { lunes: d(-7), dias: [d(-4), d(-3)], texto: "La semana pasada te faltan 4,5h: jueves (3h de 7h), viernes (5,5h de 7h)." } : null),
    aviso_semana_visto: () => espera({ ok: true }),
    anadir_dia_ugr: () => espera({ ok: true }),
    pin_comprobar: (p) => { pinOk = pinOk || p === "1234"; return espera(pinOk ? { ok: true } : { error: "PIN incorrecto." }); },
    pin_fijar: (n, r) => espera(!/^\d{4,8}$/.test(n) ? { error: "El PIN debe tener entre 4 y 8 cifras." }
      : n !== r ? { error: "Los dos PIN no coinciden." } : (pinActivo = true, { ok: true })),
    pin_no_sugerir: () => espera({ ok: true, hasta: "29/11/2026" }),
    pin_quitar: () => { pinActivo = false; return espera({ ok: true }); },
    pin_olvidado: () => { pinActivo = false; pinOk = true; return espera({ ok: true }); },
    mover_apunte: (fecha, id, destino) => {
      const lista = apuntes[fecha] || [];
      const k = lista.findIndex((x) => String(x.id) === String(id));
      if (k < 0) return espera({ error: "Ese apunte ya no está." });
      const [a] = lista.splice(k, 1);
      (apuntes[destino] = apuntes[destino] || []).push(a);
      borrados = null; diaAntes = null;
      return espera({ ok: true, puede_deshacer: false });
    },
    guardar_dia: (fecha, c) => {
      const num = (v) => parseFloat(String(v).replace(",", "."));
      const lista = (apuntes[fecha] = apuntes[fecha] || []);
      diaAntes = [fecha, lista.map((a) => ({ ...a }))];
      borrados = null;
      for (const e of c.editar) {
        const a = lista.find((x) => String(x.id) === String(e.id));
        if (a) { a.horas = num(e.horas); a.actividad = e.actividad || a.actividad; }
      }
      for (const b of c.borrar) {
        const k = lista.findIndex((x) => String(x.id) === String(b.id));
        if (k >= 0) lista.splice(k, 1);
      }
      for (const n of c.anadir) {
        const t = tareas.find((x) => String(x.id) === String(n.wp_id));
        lista.push({ id: siguiente++, horas: num(n.horas), tarea: t ? t.nombre : `Tarea ${n.wp_id}`,
                     wp_id: String(n.wp_id), actividad: n.actividad, comentario: n.comentario || "" });
      }
      return espera({ hechos: c.editar.length + c.borrar.length + c.anadir.length,
                      errores: 0, ultimo: "", puede_deshacer: true });
    },
    editar: (fecha, id, horas) => {
      const a = (apuntes[fecha] || []).find((x) => String(x.id) === String(id));
      if (!a) return espera({ error: "Ese apunte ya no está." });
      a.horas = parseFloat(String(horas).replace(",", "."));
      return espera({ ok: true });
    },
    asociar: (wp, act) => { asoc[act] = Number(wp); return espera({ ...asoc }); },
    desasociar: (act) => { delete asoc[act]; return espera({ ...asoc }); },
    // los que dejo desplegados en el arbol de tareas
    proyectos_desplegados: () => espera([...desplegadosDemo]),
    proyectos_desplegados_guardar: (ids) => { desplegadosDemo = ids.map(Number); return espera([...desplegadosDemo]); },
    // los que el usuario no quiere ver al buscar tareas (Herramientas > Proyectos visibles)
    proyectos_ocultos: () => espera([...ocultosDemo]),
    proyectos_ocultos_guardar: (ids) => { ocultosDemo = ids.map(Number); return espera([...ocultosDemo]); },
    proyectos: () => espera([{ id: 1, nombre: "Sistemas de Gestión" }, { id: 2, nombre: "ATE" },
                              { id: 3, nombre: "Aulas y Teledocencia" }]),
    tareas_de_proyecto: (pid) => espera(pid === "2" ? { error: "No tienes permiso para ver las tareas de este proyecto." }
      : pid === "3" ? { tareas: tareasAulas.map((t) => ({ ...t })) }
      : { tareas: [...tareas, { id: 14000, nombre: "[ASG] Migración de correo" }] }),
    // ---- crear tareas ----
    nueva_tarea_proyectos: () => espera({ proyectos: proyectosCrear.map((p) => ({ ...p })), ultimo: ultimoCrear,
                                          // con ?sincrear&modifica: no crea, pero puede modificar en Aulas
                                          modificar: !proyectosCrear.length && /[?&]modifica\b/.test(location.search)
                                            ? [{ id: 3, nombre: "Aulas y Teledocencia" }] : [],
                                          plantillas: plantillasDemo.map((p) => ({ ...p })) }),
    nueva_tarea_opciones: (pid, tipo) => {
      const ts = tiposDemo[Number(pid)];
      if (!ts) return espera({ error: "ProyectosTIC no te deja crear tareas en este proyecto." });
      return espera({ tipos: ts.map((t) => ({ ...t })), tipo: ts[0].id, asignable: Number(pid) !== 3, estimable: true,
                      faltan: Number(tipo) === 4 ? ["Servicio afectado no puede estar en blanco."] : [] });
    },
    nueva_tarea_crear: (n) => {
      const titulo = String(n.titulo || "").trim().replace(/\s+/g, " ");
      const p = proyectosCrear.find((x) => String(x.id) === String(n.proyecto));
      if (!p) return espera({ error: "Elige el proyecto de la tarea." });
      if (!titulo) return espera({ error: "Escribe el título de la tarea." });
      if (/rechaza/i.test(titulo)) return espera({ error: "Asunto ya está en uso." });
      const nueva = { id: sigTarea++, nombre: titulo };
      const horas = Number(String(n.estimado || "").replace(",", "."));
      if (horas > 0) detalleDemo.set(nueva.id, { estimado: horas });
      tareas.unshift(nueva);
      if (n.favorita) favDemo.add(nueva.id);
      ultimoCrear = p.id;
      const padre = [...tareasAulas, ...tareas].find((x) => String(x.id) === String(n.padre));
      return espera({ ok: true, tarea: { ...nueva, proyecto: p.nombre, padre: padre ? padre.nombre : "" },
                      tareas: tareas.map((t) => ({ ...t, texto: `${t.id} - ${t.nombre}`, favorita: favDemo.has(t.id) })) });
    },
    // ---- plantillas de tarea ----
    plantilla_tarea_guardar: (p) => {
      const nombre = String(p.nombre || "").trim().replace(/\s+/g, " ");
      if (!nombre) return espera({ error: "Ponle un nombre a la plantilla." });
      const horas = Number(String(p.estimado || "").replace(",", "."));
      const nueva = { nombre, titulo: String(p.titulo || "").trim(), proyecto: Number(p.proyecto) || null, tipo: p.tipo ?? null,
                      padre: p.padre ? { id: p.padre.id, nombre: p.padre.nombre } : null, estimado: horas > 0 ? horas : null,
                      descripcion: String(p.descripcion || "").trim(), asignar: !!p.asignar, favorita: !!p.favorita };
      const i = plantillasDemo.findIndex((x) => x.nombre.toLowerCase() === nombre.toLowerCase());
      if (i >= 0) plantillasDemo[i] = nueva; else plantillasDemo.push(nueva);
      return espera({ plantillas: plantillasDemo.map((x) => ({ ...x })) });
    },
    plantilla_tarea_borrar: (nombre) => {
      plantillasDemo = plantillasDemo.filter((x) => x.nombre.toLowerCase() !== String(nombre).trim().toLowerCase());
      return espera({ plantillas: plantillasDemo.map((x) => ({ ...x })) });
    },
    // ---- modificar una tarea ----
    tarea_datos: (id) => {
      const t = tareaDemo(Number(id));
      if (!t) return espera({ error: NO_ESTA });
      const x = detalle(t.id);
      return espera({ id: t.id, titulo: t.nombre, descripcion: x.descripcion || "", estimado: x.estimado || null,
        version: x.version || 0, proyecto: { id: t.pid, nombre: t.proyecto }, tipo: TIPOS_DEMO[x.tipo || 1],
        estado: x.cerrada ? "Cerrada" : "En curso", padre: t.padre_id ? { id: t.padre_id, nombre: t.padre } : null,
        editable: t.id !== 15010,
        puede: { titulo: true, descripcion: true, estimado: t.id !== 15001, padre: true } });
    },
    tarea_modificar: (d) => {
      const id = Number(d.id), t = tareaDemo(id);
      if (!t) return espera({ error: NO_ESTA });
      if ("titulo" in d && /rechaza/i.test(d.titulo)) return espera({ error: "Asunto ya está en uso." });
      const x = { ...detalle(id), version: (detalle(id).version || 0) + 1 };
      if ("descripcion" in d) x.descripcion = String(d.descripcion).trim();
      if ("estimado" in d) x.estimado = Number(String(d.estimado).replace(",", ".")) || null;
      detalleDemo.set(id, x);
      const nombre = "titulo" in d ? d.titulo : t.nombre;
      const madre = "padre" in d ? tareaDemo(Number(d.padre)) : null;
      for (const lista of [tareasAulas, cerradasAulas, tareas]) {
        for (const y of lista) {
          if (y.id === id) {
            y.nombre = nombre;
            if ("padre" in d && lista !== tareas) { y.padre_id = madre ? madre.id : null; y.padre = madre ? madre.nombre : ""; }
          }
          if (y.padre_id === id) y.padre = nombre;
        }
      }
      const ya = tareaDemo(id);
      return espera({ ok: true, tarea: { id, nombre, proyecto: ya.proyecto, padre: ya.padre }, tareas: listaDemo() });
    },
    // ---- duplicar una tarea con su arbol ----
    duplicar_plan: (id) => {
      const raiz = tareaDemo(Number(id));
      if (!raiz) return espera({ error: NO_ESTA });
      const todas = [...tareasAulas, ...cerradasAulas], out = [raiz];
      for (let i = 0; i < out.length; i++) out.push(...todas.filter((x) => x.padre_id === out[i].id));
      return espera({ raiz: raiz.id, proyecto: { id: raiz.pid, nombre: raiz.proyecto }, tareas: out.map((t) => {
        const x = detalle(t.id);
        return { id: t.id, nombre: t.nombre, padre_id: t.padre_id, tipo: { id: x.tipo || 1, nombre: TIPOS_DEMO[x.tipo || 1] },
                 cerrada: !!x.cerrada, estimado: x.estimado || null };
      }) });
    },
    duplicar_una: (d) => {
      const titulo = String(d.titulo || "").trim().replace(/\s+/g, " ");
      const p = proyectosCrear.find((x) => String(x.id) === String(d.proyecto));
      if (!p) return espera({ error: "Elige el proyecto de destino." });
      if (!titulo) return espera({ error: "Escribe el título de la tarea." });
      if (/rechaza/i.test(titulo)) return espera({ error: "Asunto ya está en uso." });
      if (/a la segunda/i.test(titulo) && !yaFallo.has(titulo)) {
        yaFallo.add(titulo);
        return espera({ error: "ProyectosTIC no ha aceptado la tarea (error 422)." });
      }
      const madre = d.padre ? tareaDemo(Number(d.padre)) : null;
      const nueva = aul(sigTarea++, titulo, madre ? madre.id : null, madre ? madre.nombre : "");
      if (p.id === 3) tareasAulas.push(nueva);
      const origen = detalle(Number(d.origen));
      detalleDemo.set(nueva.id, { tipo: d.tipo || 1, estimado: d.estimado ? origen.estimado : null, descripcion: origen.descripcion });
      return espera({ ok: true, tarea: { id: nueva.id, nombre: titulo, proyecto: p.nombre, padre: madre ? madre.nombre : "" } });
    },
    abrir_tarea: () => espera({ ok: true }),
    abrir_alta_tarea: () => espera({ ok: true }),
    buscar_tareas: (t) => {
      const q = t.trim().replace(/^#/, "");
      const todas = [{ id: 14000, nombre: "[ASG] Migración de correo", proyecto: "Sistemas de Gestión", padre: "[2026_ASG] Proyectos" },
        { id: 11765, nombre: "[2026_ASG] Mantenimientos", proyecto: "Sistemas de Gestión", padre: "[2026_ASG] Servicio" },
        { id: 11754, nombre: "[2026_ATE] Mantenimientos", proyecto: "ATE", padre: "[2026_ATE] Servicio" },
        // cerrada: no sale en el arbol de su proyecto, pero buscando se encuentra
        { id: 13990, nombre: "Auditoría de licencias de 2025", proyecto: "Sistemas de Gestión", padre: "[2025_ASG] Proyectos" }];
      if (/^\d+$/.test(q)) return espera({ tareas: todas.filter((x) => String(x.id) === q).map((x) => ({ ...x, favorita: favDemo.has(x.id) })) });
      if (!q) return espera({ tareas: todas.map((x) => ({ ...x, favorita: favDemo.has(x.id) })) });
      return espera({ tareas: todas.filter((x) => x.nombre.toLowerCase().includes(q.toLowerCase())).map((x) => ({ ...x, favorita: favDemo.has(x.id) })) });
    },
    favorita: (id, nombre, si) => {
      if (si) { favDemo.add(Number(id)); if (!tareas.some((x) => x.id === Number(id))) tareas.unshift({ id: Number(id), nombre }); }
      else favDemo.delete(Number(id));
      return espera({ tareas: tareas.map((t) => ({ ...t, texto: `${t.id} - ${t.nombre}`, favorita: favDemo.has(t.id) })) });
    },
    elegir_tareas: (ts) => {
      for (const t of ts) if (!tareas.some((x) => x.id === t.id)) tareas.unshift(t);
      return espera(tareas.map((t) => ({ ...t, texto: `${t.id} - ${t.nombre}` })));
    },
    preparar_copia_dia: (dias, origen) => {
      const src = (apuntes[origen || d(0)] || []).map((a) => ({ ...a }));
      const dest = dias.filter((i) => i !== origen);
      copia = dest.map((i) => [i, src]);
      return espera({ origen: origen || "Lunes", n: src.length, dias: dest.length,
        lineas: src.map((a) => `${fmt(a.horas)}  ${a.tarea}`) });
    },
    // varios dias copiados: el mismo emparejado que el motor (por fecha, repitiendo
    // el patron; con un solo destino, a partir de el en los laborables siguientes)
    preparar_copia_dias: (origenes, destinos) => {
      copia = null;
      const o = [...new Set(origenes)].sort().filter((i) => (apuntes[i] || []).length);
      const ds = [...new Set(destinos)].sort();
      if (!o.length) return espera({ vacio: "Los días copiados ya no tienen apuntes que copiar." });
      if (!ds.length) return espera({ error: "Marca al menos un día de destino." });
      if (ds.length === 1 && o.length > 1) {
        const x = new Date(`${ds[0]}T12:00:00`);
        for (let k = 0; k < 366 && ds.length < o.length; k++) {
          x.setDate(x.getDate() + 1);
          if (x.getDay() !== 0 && x.getDay() !== 6 && !marcas.nolab[iso(x)]) ds.push(iso(x));
        }
      }
      const pares = ds.map((x, k) => [o[k % o.length], x]).filter(([a, b]) => a !== b);
      if (!pares.length) return espera({ error: "Elige otros días: no se puede pegar un día sobre sí mismo." });
      const largo = (i) => `${["Domingo", ...DIAS, "Sábado"][new Date(`${i}T12:00:00`).getDay()]} ${i.slice(8)}/${i.slice(5, 7)}`;
      copia = pares.map(([a, b]) => [b, apuntes[a].map((x) => ({ ...x }))]);
      return espera({ n: copia.reduce((t, [, ap]) => t + ap.length, 0), dias: pares.length,
        lineas: pares.map(([a, b]) => `${largo(a)} → ${largo(b)}: ${apuntes[a].length} apunte(s), ${fmt(apuntes[a].reduce((t, x) => t + x.horas, 0))}`),
        pares: pares.map(([a, b]) => ({ origen: a, destino: b })) });
    },
    preparar_copia_semana: () => espera({ vacio: "La semana anterior no tiene apuntes (demo)." }),
    ejecutar_copia: () => {
      let creados = 0, saltados = 0;
      // como el motor: lo que ya habia ese dia ANTES de empezar es lo que se salta
      for (const [i, ap] of copia || []) {
        const habia = (apuntes[i] || []).map((x) => x.wp_id);
        for (const a of ap) {
          if (habia.includes(a.wp_id)) { saltados++; continue; }
          (apuntes[i] = apuntes[i] || []).push({ ...a, id: siguiente++ });
          creados++;
        }
      }
      copia = null;
      return espera({ creados, saltados, errores: 0, ultimo: "" });
    },
    plantillas: () => espera(plantillas.map((p) => {
      const aps = p.semana ? p.dias.flat() : p.apuntes;
      return { nombre: p.nombre, n: aps.length, semana: !!p.semana, total: fmt(aps.reduce((s, a) => s + a.horas, 0)) };
    })),
    guardar_plantilla_dia: (i, nombre) => {
      plantillas.push({ nombre, apuntes: (apuntes[i] || []).map((a) => ({ id: a.wp_id, horas: a.horas })) });
      return espera({ ok: true, n: (apuntes[i] || []).length });
    },
    aplicar_plantilla: () => espera({ creados: 2, saltados: 0, errores: 0, ultimo: "" }),
    eliminar_plantilla: (n) => {
      plantillas.splice(plantillas.findIndex((p) => p.nombre === n), 1);
      return window.pywebview.api.plantillas();
    },
    resumen_mes: (a, m) => espera({ titulo: `Mes ${m}/${a}`, registrado: "98h", objetivo_hoy: "104h",
      objetivo_mes: "147h", al_dia: false, estado: "Te faltan 6h para estar al día", frac: 0.66,
      teletrabajo: "", incompletos: [{ iso: d(2), dia: `Miércoles ${d(2).slice(8)}/${d(2).slice(5, 7)}`, horas: "1h / 7h" }] }),
    exportar_csv: () => espera({ ruta: "C:\\Users\\demo\\horas.csv", n: 4, total: "11,5h" }),
    abrir_exportacion: () => espera({ ok: true }),
    festivos: (n, a, l, u) => espera([n && { iso: "2026-12-08", fecha: "08/12/2026", nombre: "La Inmaculada" },
      u && { iso: "2026-12-24", fecha: "24/12/2026", nombre: "Cierre de Navidad (UGR)", ugr: true },
      u && { iso: "2026-12-28", fecha: "28/12/2026", nombre: "Cierre de Navidad (UGR)", ugr: true },
      n && { fecha: "25/12/2026", nombre: "Navidad" }, l && { fecha: "02/01/2027", nombre: "Toma de Granada" }].filter(Boolean)),
    importar_festivos: () => espera({ n: 3 }),
    ajustes_dias: () => espera({ anio: 2026, cupo: 22, usadas: 9, tt: 1 }),
    guardar_ajustes_dias: (c) => espera(Number(c) > 60 ? { error: "El cupo de vacaciones va de 0 a 60 días." } : { ok: true }),
    permisos: () => espera(vistaPermisos()),
    actualizar_usadas_pt: () => espera(vistaPermisos()),
    anadir_concesion: (id, h, f) => {
      const p = permisos.find((x) => x.id === id);
      const horas = parseFloat(String(h).replace(":", "."));
      if (!(horas > 0)) return espera({ error: "Las horas concedidas deben ser un número positivo." });
      p.concesiones.push({ horas, fecha_limite: f || "" });
      return espera(vistaPermisos());
    },
    quitar_concesion: (id, i) => { permisos.find((x) => x.id === id).concesiones.splice(i, 1); return espera(vistaPermisos()); },
    fijar_actividad_permiso: (id, act) => { permisos.find((x) => x.id === id).actividad = act; return espera(vistaPermisos()); },
    info_permiso_dia: (i) => espera({ dia: i, libre: "7:00", lleno: false, ya: "0:00", jornada: "6:30",
      dia_entero: "7:00", dia_completo: "7:00", distintas: true,
      tipos: permisos.map((p) => ({ id: p.id, nombre: p.nombre, disponible: "63:30", actividad: p.actividad,
        caducadas: 0, caduca: p.id === "sm" ? "2026-11-10" : "" })) }),
    anadir_permiso: (i, t, h, conf) => espera(!conf && t === "sm"
      ? { confirmar: "Te quedan 18:00 y vas a usar 20:00. ¿Continuar?" } : { ok: true, horas: h }),
    propuesta_permisos_anio: () => espera({ anio: 2027, filas: permisos.map((p) => ({ id: p.id, nombre: p.nombre,
      horas: hhmm(p.concesiones[p.concesiones.length - 1].horas), fecha_limite: "2028-01-15", quedan: "40:00" })) }),
    anadir_permisos_anio: (filas) => espera({ n: filas.filter((f) => f.horas).length }),
    permisos_anio_no: () => espera({ ok: true }),
    inari_config: () => espera({ activo: false, url: "https://inari.ugr.es/kanboard/jsonrpc.php", usuario: "",
      hay_token: false, proyecto: null, columna: null, carril: null, categoria: null }),
    inari_probar: () => espera({ error: "Escribe usuario y token." }),
    inari_tablero: () => espera({ columnas: [], carriles: [], categorias: [] }),
    inari_guardar: () => espera({ ok: true }),
    inari_opciones_slot: () => espera({ columnas: [{ id: 1, nombre: "Hecho" }], carriles: [{ id: 1, nombre: "General" }],
      categorias: [{ id: 3, nombre: "Soporte" }], pref: { columna: 1, carril: 1, categoria: 3 } }),
    duracion: (a, b) => espera(a && b && b > a ? "1.5h" : ""),
    inari_registrar: () => espera({ ok: true }),
    tecnologia: () => espera([{ estilo: "normal", texto: "Con qué está hecha FichaCSIRC y por qué, contado en corto." },
      { estilo: "version", texto: "Cómo está hecha" }, { estilo: "apartado", texto: "La ventana" },
      { estilo: "punto", texto: "HTML, CSS y JavaScript dentro de la aplicación, con pywebview." },
      { estilo: "version", texto: "El futuro: Rust y Tauri" },
      { estilo: "punto", texto: "Está previsto migrar FichaCSIRC a Tauri (Rust)." }]),
    novedades: () => espera([{ estilo: "version", texto: "Versión 9.0.0" },      // posterior a la de la demo: no se enseña
      { estilo: "punto", texto: "Lo de una versión que aún no tienes." },
      { estilo: "version", texto: "Versión 2.9.2" }, { estilo: "apartado", texto: "Mejoras" },
      { estilo: "punto", texto: "Permisos: lo que no usas ya no se pierde en enero." },
      { estilo: "punto", texto: "Mac: ahora se instala con un .dmg." }]),
    abrir_github: () => espera({ ok: true }),
    // ---- asistente, actualizaciones, aviso ----
    cfg_cargar: () => espera({ primera_vez: /[?&]primera\b/.test(location.search), aviso: "", experimento: true,
      aviso_soportado: true,
      ruta_config: "C:\\Users\\demo\\AppData\\Roaming\\FichaCSIRC",
      logo: "", url: "https://proyectostic.ugr.es", hay_key: true, jornada: "7", desayuno_si: true,
      desayuno: "0,5", verano_si: true, verano: "5", verano_inicio: "16/06", verano_fin: "15/09",
      actividad: "soporte", actividades: ["actuacion tecnica", "correctivo", "formacion", "gestion/planificacion", "soporte"],
      favoritos: tareas.slice(0, 2).map((t) => ({ id: t.id, nombre: t.nombre })) }),
    cfg_probar: (url) => espera(url ? { nombre: "Persona de Prueba" } : { error: "Escribe la URL y la API key." }),
    cfg_proyectos: () => espera({ proyectos: [{ id: 1, nombre: "Sistemas de Gestión" }, { id: 2, nombre: "ATE" }] }),
    cfg_tareas: (u, k, pid) => espera(String(pid) === "2"
      ? { error: "No tienes permiso para ver las tareas de este proyecto." }
      : { tareas: [...tareas, { id: 14000, nombre: "[ASG] Migración de correo" }] }),
    cfg_validar_jornada: (dd) => {
      const n = (x) => parseFloat(String(x).replace(",", "."));
      const of = n(dd.jornada), des = dd.desayuno_si ? n(dd.desayuno) : 0;
      if (!(of > 0 && of <= 24)) return espera({ error: "Las horas por día (normal) deben ser un número entre 0 y 24." });
      if (des >= of) return espera({ error: "El desayuno no puede ser igual o mayor que la jornada." });
      return espera({ texto: des ? `Jornada ${dd.jornada} h − ${dd.desayuno} h de desayuno = fichas ${String(of - des).replace(".", ",")} h al día (un día de permiso cuenta como ${dd.jornada} h)`
                                 : `Fichas ${dd.jornada} h al día.` });
    },
    cfg_guardar: () => espera({ ok: true }),
    cerrar: () => espera({ ok: true }),
    comprobar_actualizacion: (forzar) => espera(forzar
      ? { version: "2.9.3", actual: "2.9.2", puede_instalar: false, experimento: true, mac: false }
      : { al_dia: true, version: "2.9.2" }),
    instalar_actualizacion: () => espera({ error: "El prototipo no instala actualizaciones." }),
    abrir_pagina_actualizacion: () => espera({ ok: true }),
    recordatorio_estado: () => espera({ soportado: true, activo: recDemo.activo, hora: recDemo.activo ? recDemo.hora : "",
                                        por_defecto: "14:00", experimento: false, ofrecer: !recDemo.activo && !recDemo.ofrecido }),
    recordatorio_activar: (hora) => {
      if (!/^\d\d:\d\d$/.test(hora || "")) return espera({ error: "Escribe la hora como HH:MM (ej. 14:00)." });
      Object.assign(recDemo, { activo: true, hora, ofrecido: true });
      return espera({ ok: true, hora });
    },
    recordatorio_desactivar: () => { recDemo.activo = false; return espera({ ok: true }); },
    recordatorio_probar: () => espera({ ok: true }),
    recordatorio_ofrecido: () => { recDemo.ofrecido = true; return espera({ ok: true }); },
    aviso_datos: () => espera(avisoDemo()),
    aviso_fichar: (iso) => { avisoPend = avisoPend.filter((x) => x.iso !== iso); return espera({ ok: true, ...avisoDemo() }); },
    aviso_responder: () => espera({ ok: true }),
    mes: (a, m) => espera(mesDemo(a, m)),
    repintar_mes: (a, m) => espera(mesDemo(a, m)),
    guardar_vista: () => espera({ ok: true }),
    guardar_paneles: (p) => espera(p),
    resumen_franja: () => espera({
      meses: [{ titulo: "Octubre", anio: 2026, mes: 10, al_dia: false, texto: "faltan 4h" },
              { titulo: "Septiembre", anio: 2026, mes: 9, al_dia: false, texto: "faltan 17,5h" }],
      permisos: [{ nombre: "Asuntos particulares", disponible: "63:30", negativo: false },
                 { nombre: "Servicios mínimos", disponible: "18:00", negativo: false }],
      vacaciones: { quedan: 21, cupo: 22 },
      habituales: { desde: "desde el 1 de septiembre", total: "235h", filas: [
        { wp_id: 11765, tarea: "[2026_ASG] Mantenimientos", actividad: "Actuaciones técnicas",
          horas: 118, horas_txt: "118h", pct: 48, tipico: 6.5, tipico_txt: "6,5h" },
        { wp_id: 12065, tarea: "[ASG] Proxmox + dockers en SisGes", actividad: "Formación",
          horas: 52, horas_txt: "52h", pct: 21, tipico: 2, tipico_txt: "2h" },
        { wp_id: 13001, tarea: "[ATE] Permisos", actividad: "Asuntos propios",
          horas: 28, horas_txt: "28h", pct: 11, tipico: 7, tipico_txt: "7h", permiso: true },
        { wp_id: 14000, tarea: "[ASG] Migración de correo", actividad: "Soporte",
          horas: 21, horas_txt: "21h", pct: 9, tipico: 1.5, tipico_txt: "1,5h" } ] } }),
    aviso_aplicaciones: () => espera(""),
    abrir_aplicaciones: () => espera({ ok: true }),
  });

  // Deshacer en varios niveles: una foto de los apuntes antes de cada cambio.
  const pilaDemo = [];
  const api = window.pywebview.api;
  for (const [n, texto] of [["anadir", "añadir"], ["eliminar", "borrar"], ["editar", "cambiar un apunte"],
                            ["guardar_dia", "editar un día"], ["mover_apunte", "mover un apunte"],
                            ["ejecutar_copia", "copiar"]]) {
    const original = api[n];
    api[n] = (...args) => {
      pilaDemo.push([texto, JSON.stringify(apuntes)]);
      return original(...args).then((r) => (r && !r.error ? { ...r, puede_deshacer: true, quedan: pilaDemo.length } : r));
    };
  }
  api.deshacer = () => {
    const ultima = pilaDemo.pop();
    if (!ultima) return espera({ restaurados: 0, texto: "", quedan: 0, siguiente: "", pendiente: false });
    for (const k of Object.keys(apuntes)) delete apuntes[k];
    Object.assign(apuntes, JSON.parse(ultima[1]));
    return espera({ restaurados: 1, errores: 0, texto: ultima[0], pendiente: false, quedan: pilaDemo.length,
                    siguiente: pilaDemo.length ? pilaDemo[pilaDemo.length - 1][0] : "" });
  };
})();
