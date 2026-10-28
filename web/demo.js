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
})();
