/* Datos de demostracion: SOLO si la pagina se abre con ?demo en la direccion
 * (para revisar el diseno en un navegador normal, sin pywebview ni red).
 * Imita la forma de las respuestas de la clase Api de registrar_web.py.
 * Dentro de la app (pywebview) no hace nada. */
"use strict";
(function () {
  if (!/[?&]demo\b/.test(location.search)) return;

  const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
  const fmt = (h) => `${Math.round(h * 100) / 100}`.replace(/\.0+$/, "") + "h";
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
  const marcas = { nolab: {}, guardia: new Set(), tele: new Set() };
  let siguiente = 100;
  let borrados = null;

  // semana actual con algo de todo
  const l = lunesDe(hoy);
  const d = (n) => { const x = new Date(l); x.setDate(x.getDate() + n); return iso(x); };
  apuntes[d(0)] = [
    { id: 1, horas: 5, tarea: tareas[0].nombre, wp_id: "11765", actividad: "Actuaciones técnicas", comentario: "Revisión de copias" },
    { id: 2, horas: 2, tarea: tareas[2].nombre, wp_id: "12065", actividad: "Formación", comentario: "" },
  ];
  apuntes[d(1)] = [{ id: 3, horas: 3.5, tarea: tareas[0].nombre, wp_id: "11765", actividad: "Actuaciones técnicas", comentario: "" }];
  apuntes[d(2)] = [{ id: 4, horas: 1, tarea: tareas[3].nombre, wp_id: "13001", actividad: "Asuntos propios", comentario: "" }];
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

  window.pywebview = { api: {
    inicio: () => espera({
      version: "2.9.2", plataforma: "Demo", lunes: iso(l), inari: false, logo: "",
      tareas: tareas.map((t) => ({ ...t, texto: `${t.id} - ${t.nombre}` })),
      actividades: ["Actuaciones técnicas", "Asuntos propios", "Formación", "Soporte"],
      actividad_preferida: "Actuaciones técnicas", comentario_guardia: "Servicio de Guardia",
      github: "enriquegrx/UGR-FichaCSIRC", inari_listo: false,
      asociaciones: { "Asuntos propios": 13001 }, toca_permisos_anio: false, experimento: true,
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
        (apuntes[i] = apuntes[i] || []).push({ id: siguiente++, horas: h, tarea: t.nombre, wp_id: String(wp), actividad, comentario });
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
        usadas: hhmm(usadas), usadas_local: hhmm(p.local), usadas_pt: hhmm(p.pt),
        disponibles: hhmm(cupo - usadas), negativo: cupo < usadas,
        concesiones: p.concesiones.map((c) => ({ horas: hhmm(c.horas), fecha_limite: c.fecha_limite,
          estado: c.fecha_limite === "2026-11-10" ? "por_caducar" : "" })) };
    }) });
  Object.assign(window.pywebview.api, {
    editar: (fecha, id, horas) => {
      const a = (apuntes[fecha] || []).find((x) => String(x.id) === String(id));
      if (!a) return espera({ error: "Ese apunte ya no está." });
      a.horas = parseFloat(String(horas).replace(",", "."));
      return espera({ ok: true });
    },
    asociar: (wp, act) => { asoc[act] = Number(wp); return espera({ ...asoc }); },
    desasociar: (act) => { delete asoc[act]; return espera({ ...asoc }); },
    proyectos: () => espera([{ id: 1, nombre: "Sistemas de Gestión" }, { id: 2, nombre: "ATE" }]),
    tareas_de_proyecto: (pid) => espera(pid === "2" ? { error: "No tienes permiso para ver las tareas de este proyecto." }
      : { tareas: [...tareas, { id: 14000, nombre: "[ASG] Migración de correo" }] }),
    buscar_tareas: (t) => espera(t.length < 3 ? { error: "Escribe al menos 3 letras." }
      : { tareas: [{ id: 14000, nombre: "[ASG] Migración de correo" }] }),
    elegir_tareas: (ts) => {
      for (const t of ts) if (!tareas.some((x) => x.id === t.id)) tareas.unshift(t);
      return espera(tareas.map((t) => ({ ...t, texto: `${t.id} - ${t.nombre}` })));
    },
    preparar_copia_dia: (dias) => {
      copia = dias.map((i) => [i, apuntes[d(0)] || []]);
      return espera({ origen: "Lunes", n: (apuntes[d(0)] || []).length, dias: dias.length,
        lineas: (apuntes[d(0)] || []).map((a) => `${fmt(a.horas)}  ${a.tarea}`) });
    },
    preparar_copia_semana: () => espera({ vacio: "La semana anterior no tiene apuntes (demo)." }),
    ejecutar_copia: () => {
      let creados = 0;
      for (const [i, ap] of copia || []) for (const a of ap) {
        if ((apuntes[i] || []).some((x) => x.wp_id === a.wp_id)) continue;
        (apuntes[i] = apuntes[i] || []).push({ ...a, id: siguiente++ });
        creados++;
      }
      return espera({ creados, saltados: 0, errores: 0, ultimo: "" });
    },
    plantillas: () => espera(plantillas.map((p) => ({ nombre: p.nombre, n: p.apuntes.length,
      total: fmt(p.apuntes.reduce((s, a) => s + a.horas, 0)) }))),
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
    festivos: (n, a, l) => espera([n && { fecha: "08/12/2026", nombre: "La Inmaculada" },
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
    novedades: () => espera([{ estilo: "version", texto: "Versión 2.9.2" }, { estilo: "apartado", texto: "Mejoras" },
      { estilo: "punto", texto: "Permisos: lo que no usas ya no se pierde en enero." },
      { estilo: "punto", texto: "Mac: ahora se instala con un .dmg." }]),
    abrir_github: () => espera({ ok: true }),
    // ---- asistente, actualizaciones, aviso ----
    cfg_cargar: () => espera({ primera_vez: /[?&]primera\b/.test(location.search), aviso: "", experimento: true,
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
    recordatorio_estado: () => espera({ soportado: true, activo: false, experimento: true }),
    recordatorio_activar: () => espera({ error: "En el prototipo no se programa el aviso." }),
    recordatorio_desactivar: () => espera({ error: "En el prototipo no se toca el aviso." }),
    aviso_datos: () => espera({ texto: "Te faltan horas por fichar esta semana (7h en total):\n\n  Miércoles 28/10: 0h de 6.5h\n  Jueves 29/10: 6h de 6.5h", minutos: 10 }),
    aviso_responder: () => espera({ ok: true }),
    aviso_aplicaciones: () => espera(""),
    abrir_aplicaciones: () => espera({ ok: true }),
  });
})();
