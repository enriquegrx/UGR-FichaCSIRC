//! Fase 4b: permisos por horas (saldos, concesiones, permiso de un dia,
//! permisos del año), festivos y dias UGR, y vacaciones / teletrabajo.
//! Port de rellenar_horas.py y registrar_web.py.

use crate::api::{candado, Estado};
use crate::config::{self, Cfg};
use crate::openproject::Cliente;
use crate::reglas::{fmt_hhmm, fmt_horas, parsear_horas, redondear, Concesion, Reglas, TipoPermiso, DIAS_ES};
use crate::resumen;
use chrono::{Datelike, Duration, Local, NaiveDate};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashSet};

const DIAS_AVISO_CADUCIDAD: i64 = 30;
const ACTIVIDADES: [&str; 5] = ["actuacion tecnica", "correctivo", "formacion", "gestion/planificacion", "soporte"];

fn hoy() -> NaiveDate {
    Local::now().date_naive()
}

fn texto(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn caducadas(t: &TipoPermiso, h: NaiveDate) -> Vec<&Concesion> {
    t.concesiones.iter().filter(|c| c.limite().is_some_and(|l| l < h)).collect()
}

fn por_caducar(t: &TipoPermiso, h: NaiveDate) -> Vec<&Concesion> {
    t.concesiones.iter().filter(|c| c.limite().is_some_and(|l| h <= l && l <= h + Duration::days(DIAS_AVISO_CADUCIDAD))).collect()
}

/// Horas de permiso imputadas en ProyectosTIC (ultima lectura; 0 si no aplica).
fn pt_de(e: &Estado, t: &TipoPermiso) -> f64 {
    if t.actividad.is_empty() {
        return 0.0;
    }
    candado(&e.usadas_pt).as_ref().and_then(|m| m.get(&t.id).copied()).unwrap_or(0.0)
}

fn disponible(e: &Estado, reglas: &Reglas, t: &TipoPermiso, h: NaiveDate) -> f64 {
    let usadas = redondear(reglas.permiso_usadas_local(&t.id, reglas.permisos_desde(h)) + pt_de(e, t), 2);
    redondear(t.cupo() - usadas, 2)
}

/// Reescribe permisos_tipos normalizado al modelo de concesiones (migra el
/// "cupo" viejo), cambiando lo que diga f a cada tipo.
fn guardar_tipos(f: impl Fn(&str, &mut Map<String, Value>)) -> Result<(), String> {
    config::modificar(|cfg| {
        let tipos = Reglas::desde(&Cfg(cfg.clone())).tipos;
        let originales: Vec<Value> = cfg.get("permisos_tipos").and_then(Value::as_array).cloned().unwrap_or_default();
        let nuevos: Vec<Value> = tipos.iter().map(|t| {
            let mut m = originales.iter().find(|o| texto(&o["id"]) == t.id).and_then(Value::as_object).cloned()
                .unwrap_or_else(|| { let mut m = Map::new(); m.insert("id".into(), json!(t.id)); m.insert("nombre".into(), json!(t.nombre)); m });
            m.remove("cupo");
            m.remove("fecha_limite");
            m.insert("concesiones".into(), json!(t.concesiones.iter().map(|c| json!({"horas": c.horas, "fecha_limite": c.fecha_limite})).collect::<Vec<_>>()));
            f(&t.id, &mut m);
            Value::Object(m)
        }).collect();
        cfg.insert("permisos_tipos".into(), Value::Array(nuevos));
    })
}

/// El cuadro de Herramientas > Permisos.
pub async fn permisos(e: &Estado, cfg: &Cfg) -> Value {
    let reglas = Reglas::desde(cfg);
    let h = hoy();
    // actividades de verdad: usadas, asociadas y las de las tareas elegidas
    let mut conocidas: HashSet<String> = cfg.objeto("tareas_actividad").keys().cloned().collect();
    conocidas.extend(cfg.objeto("actividades_tarea").values().map(texto));
    conocidas.insert(cfg.texto("ultima_actividad"));
    conocidas.extend(reglas.tipos.iter().map(|t| t.actividad.clone()));
    if let Ok(cli) = Cliente::desde(cfg) {
        for m in ["permiso", "baja", "vacaciones"] {
            let wp = texto(&cfg.objeto("tareas_local").get(m).cloned().unwrap_or(json!({}))["id"]);
            if !wp.is_empty() {
                if let Ok(acts) = cli.actividades(&wp).await {
                    conocidas.extend(acts);
                }
            }
        }
    }
    conocidas.remove("");
    if conocidas.is_empty() {
        conocidas = ACTIVIDADES.iter().map(|s| s.to_string()).collect();
    }
    let mut actividades: Vec<String> = conocidas.into_iter().collect();
    actividades.sort_by_key(|a| a.to_lowercase());
    let desde = reglas.permisos_desde(h);
    let filas: Vec<Value> = reglas.tipos.iter().map(|t| {
        let local = reglas.permiso_usadas_local(&t.id, desde);
        let pt = pt_de(e, t);
        let usadas = redondear(local + pt, 2);
        let disp = redondear(t.cupo() - usadas, 2);
        let cad = caducadas(t, h);
        let prox = por_caducar(t, h);
        json!({"id": t.id, "nombre": t.nombre, "actividad": t.actividad,
               "concedidas": fmt_hhmm(t.cupo()), "usadas": fmt_hhmm(usadas),
               "usadas_local": fmt_hhmm(local), "usadas_pt": fmt_hhmm(pt),
               "disponibles": fmt_hhmm(disp), "negativo": disp < 0.0,
               "concesiones": t.concesiones.iter().map(|c| json!({
                   "horas": fmt_hhmm(c.horas), "fecha_limite": c.fecha_limite,
                   "estado": if cad.contains(&c) { "caducada" } else if prox.contains(&c) { "por_caducar" } else { "" }
               })).collect::<Vec<_>>()})
    }).collect();
    json!({"desde": desde.format("%d/%m/%Y").to_string(), "anio": h.year(), "filas": filas,
           "hay_actividades": reglas.tipos.iter().any(|t| !t.actividad.is_empty()), "actividades": actividades})
}

pub async fn actualizar_usadas_pt(e: &Estado, cfg: &Cfg) -> Value {
    *candado(&e.usadas_pt) = None;
    let reglas = Reglas::desde(cfg);
    let _ = resumen::usadas_pt(e, cfg, &reglas).await;
    permisos(e, cfg).await
}

pub async fn anadir_concesion(e: &Estado, tipo: &str, horas: &Value, fecha: &str) -> Result<Value, String> {
    let Some(h) = parsear_horas(&texto(horas)).filter(|h| *h > 0.0) else {
        return Ok(json!({"error": "Las horas concedidas deben ser un número positivo."}));
    };
    let fecha = fecha.trim();
    if !fecha.is_empty() && NaiveDate::parse_from_str(fecha, "%Y-%m-%d").is_err() {
        return Ok(json!({"error": "La fecha límite debe ser AAAA-MM-DD."}));
    }
    if !Reglas::desde(&config::leer()?).tipos.iter().any(|t| t.id == tipo) {
        return Ok(json!({"error": "Tipo de permiso desconocido."}));
    }
    guardar_tipos(|id, m| if id == tipo {
        if let Some(Value::Array(cs)) = m.get_mut("concesiones") {
            cs.push(json!({"horas": h, "fecha_limite": fecha}));
        }
    })?;
    Ok(permisos(e, &config::leer()?).await)
}

pub async fn quitar_concesion(e: &Estado, tipo: &str, indice: usize) -> Result<Value, String> {
    guardar_tipos(|id, m| if id == tipo {
        if let Some(Value::Array(cs)) = m.get_mut("concesiones") {
            if indice < cs.len() {
                cs.remove(indice);
            }
        }
    })?;
    Ok(permisos(e, &config::leer()?).await)
}

pub async fn fijar_actividad_permiso(e: &Estado, tipo: &str, actividad: &str) -> Result<Value, String> {
    let actividad = actividad.trim().to_string();
    guardar_tipos(|id, m| if id == tipo {
        if actividad.is_empty() { m.remove("actividad"); } else { m.insert("actividad".into(), json!(actividad)); }
    })?;
    candado(&e.usadas_pt).take();
    Ok(permisos(e, &config::leer()?).await)
}

pub fn info_permiso_dia(e: &Estado, cfg: &Cfg, iso: &str) -> Result<Value, String> {
    let d = NaiveDate::parse_from_str(iso, "%Y-%m-%d").map_err(|_| "Fecha no válida.".to_string())?;
    let reglas = Reglas::desde(cfg);
    let h = hoy();
    let jornada = reglas.jornada_de(d);
    let entero = reglas.horas_dia_permiso();
    let ya = reglas.horas_permiso(iso);
    let libre = redondear(jornada.max(entero) - ya, 2);
    let tipos: Vec<Value> = reglas.tipos.iter().map(|t| {
        let prox = por_caducar(t, h);
        json!({"id": t.id, "nombre": t.nombre, "disponible": fmt_hhmm(disponible(e, &reglas, t, h)),
               "actividad": t.actividad, "caducadas": caducadas(t, h).len(),
               "caduca": prox.iter().map(|c| c.fecha_limite.clone()).min().unwrap_or_default()})
    }).collect();
    Ok(json!({"dia": format!("{} {}", DIAS_ES[d.weekday().num_days_from_monday() as usize], d.format("%d/%m/%Y")),
              "tipos": tipos, "libre": fmt_hhmm(libre), "lleno": libre <= 0.0, "ya": fmt_hhmm(ya),
              "jornada": fmt_hhmm(jornada), "dia_entero": fmt_hhmm(entero),
              "dia_completo": fmt_hhmm(redondear(entero - ya, 2)), "distintas": (entero - jornada).abs() > 0.01}))
}

pub fn anadir_permiso(e: &Estado, cfg: &Cfg, iso: &str, tipo: &str, horas: &Value, confirmado: bool) -> Result<Value, String> {
    let Some(h) = parsear_horas(&texto(horas)).filter(|h| *h > 0.0) else {
        return Ok(json!({"error": "Escribe las horas como 3:00 o 3,5."}));
    };
    let reglas = Reglas::desde(cfg);
    let Some(t) = reglas.tipos.iter().find(|t| t.id == tipo) else {
        return Ok(json!({"error": "Tipo de permiso desconocido."}));
    };
    let disp = disponible(e, &reglas, t, hoy());
    if h > disp && !confirmado {
        return Ok(json!({"confirmar": format!("Te quedan {} de «{}» y vas a usar {}. ¿Continuar?",
                                              fmt_hhmm(disp), t.nombre, fmt_hhmm(h))}));
    }
    let Ok(d) = NaiveDate::parse_from_str(iso, "%Y-%m-%d") else { return Ok(json!({"error": "Fecha no válida."})) };
    // tope: un dia completo de permiso (7 h) o la jornada si fuera mayor
    let tope = reglas.jornada_de(d).max(reglas.horas_dia_permiso());
    if reglas.horas_permiso(iso) + h > tope + 1e-9 {
        return Ok(json!({"error": format!("Las horas de permiso del día no pueden superar la jornada ({}).", fmt_horas(tope).replace(',', "."))}));
    }
    config::modificar(|c| {
        let mut m = c.get("permisos").and_then(Value::as_object).cloned().unwrap_or_default();
        let mut ps = m.get(iso).and_then(Value::as_array).cloned().unwrap_or_default();
        ps.push(json!({"tipo": tipo, "horas": h}));
        m.insert(iso.into(), Value::Array(ps));
        c.insert("permisos".into(), Value::Object(m));
    })?;
    Ok(json!({"ok": true, "horas": fmt_hhmm(h)}))
}

fn un_anio_despues(f: &str) -> String {
    let Ok(d) = NaiveDate::parse_from_str(f, "%Y-%m-%d") else { return String::new() };
    d.with_year(d.year() + 1).or_else(|| NaiveDate::from_ymd_opt(d.year() + 1, d.month(), 28))
        .map(|x| x.to_string()).unwrap_or_default()
}

pub fn propuesta_permisos_anio(e: &Estado, cfg: &Cfg) -> Value {
    let reglas = Reglas::desde(cfg);
    let h = hoy();
    json!({"anio": h.year(), "filas": reglas.tipos.iter().map(|t| {
        let ultima = t.concesiones.last().cloned().unwrap_or(Concesion { horas: 0.0, fecha_limite: String::new() });
        json!({"id": t.id, "nombre": t.nombre, "horas": if ultima.horas > 0.0 { fmt_hhmm(ultima.horas) } else { String::new() },
               "fecha_limite": un_anio_despues(&ultima.fecha_limite), "quedan": fmt_hhmm(disponible(e, &reglas, t, h))})
    }).collect::<Vec<_>>()})
}

/// filas: [{id, nombre, horas, fecha_limite}]. O se añade todo o nada.
pub fn anadir_permisos_anio(filas: &[Value]) -> Result<Value, String> {
    let mut pendientes: Vec<(String, f64, String)> = Vec::new();
    for f in filas {
        let txt = texto(&f["horas"]);
        if txt.trim().is_empty() {
            continue;
        }
        let nombre = texto(&f["nombre"]);
        let Some(h) = parsear_horas(&txt).filter(|h| *h > 0.0) else {
            return Ok(json!({"error": format!("{nombre}: escribe las horas como 70:00 o 70, o déjalo en blanco.")}));
        };
        let fecha = texto(&f["fecha_limite"]).trim().to_string();
        if !fecha.is_empty() && NaiveDate::parse_from_str(&fecha, "%Y-%m-%d").is_err() {
            return Ok(json!({"error": format!("{nombre}: la fecha límite debe ser AAAA-MM-DD (o vacía si no caduca).")}));
        }
        pendientes.push((texto(&f["id"]), h, fecha));
    }
    guardar_tipos(|id, m| {
        if let Some(Value::Array(cs)) = m.get_mut("concesiones") {
            for (tid, h, fecha) in &pendientes {
                if tid == id {
                    cs.push(json!({"horas": h, "fecha_limite": fecha}));
                }
            }
        }
    })?;
    marcar_anio_revisado()?;
    Ok(json!({"n": pendientes.len()}))
}

pub fn marcar_anio_revisado() -> Result<Value, String> {
    let mut m = Map::new();
    m.insert("permisos_anio_revisado".into(), json!(hoy().year()));
    config::guardar_valores(m)?;
    Ok(json!({"ok": true}))
}

pub fn toca_permisos_anio(cfg: &Cfg) -> bool {
    let h = hoy();
    let revisado = cfg.get("permisos_anio_revisado").and_then(|v| v.as_i64().or_else(|| texto(v).parse().ok())).unwrap_or(h.year() as i64);
    (h.year() as i64) > revisado
}

// ---------------------------------------------------------------- festivos

/// Domingo de Pascua (algoritmo de Gauss/Butcher).
pub fn pascua(anio: i32) -> NaiveDate {
    let a = anio % 19;
    let (b, c) = (anio / 100, anio % 100);
    let (d, e) = (b / 4, b % 4);
    let f = (b + 8) / 25;
    let g = (b - f + 1) / 3;
    let h = (19 * a + b - d - g + 15) % 30;
    let (i, k) = (c / 4, c % 4);
    let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = (a + 11 * h + 22 * l) / 451;
    let mes = (h + l - 7 * m + 114) / 31;
    let dia = (h + l - 7 * m + 114) % 31 + 1;
    NaiveDate::from_ymd_opt(anio, mes as u32, dia as u32).unwrap()
}

/// Festivos calculados del año {iso: nombre} (los de domingo pasan al lunes).
pub fn festivos_del_anio(cfg: &Cfg, anio: i32, nacional: bool, andalucia: bool, local: bool) -> BTreeMap<String, String> {
    let p = pascua(anio);
    let mut out = BTreeMap::new();
    let mut anadir = |mut f: NaiveDate, nombre: &str| {
        let mut n = nombre.to_string();
        if f.weekday().num_days_from_monday() == 6 {
            f += Duration::days(1);
            n += " (traslado)";
        }
        out.insert(f.to_string(), n);
    };
    let dia = |m: u32, d: u32| NaiveDate::from_ymd_opt(anio, m, d).unwrap();
    if nacional {
        for (m, d, n) in [(1, 1, "Año Nuevo"), (1, 6, "Reyes"), (5, 1, "Día del Trabajo"), (8, 15, "Asunción"),
                          (10, 12, "Fiesta Nacional"), (11, 1, "Todos los Santos"), (12, 6, "La Constitución"),
                          (12, 8, "La Inmaculada"), (12, 25, "Navidad")] {
            anadir(dia(m, d), n);
        }
        anadir(p - Duration::days(3), "Jueves Santo");
        anadir(p - Duration::days(2), "Viernes Santo");
    }
    if andalucia {
        anadir(dia(2, 28), "Día de Andalucía");
    }
    if local {
        anadir(dia(1, 2), "Toma de Granada");
        anadir(p + Duration::days(60), "Corpus Christi");
        for md in cfg.lista("festivos_locales_extra") {
            let s = texto(&md);
            if let Some((m, d)) = s.split_once('-') {
                if let (Ok(m), Ok(d)) = (m.trim().parse(), d.trim().parse()) {
                    if let Some(f) = NaiveDate::from_ymd_opt(anio, m, d) {
                        anadir(f, "Festivo local");
                    }
                }
            }
        }
    }
    out
}

/// Dias propios de la UGR que suelen repetirse (propuesta a revisar).
pub fn propuesta_dias_ugr(cfg: &Cfg, anio: i32) -> BTreeMap<String, String> {
    let p = pascua(anio);
    let mut otros: HashSet<String> = festivos_del_anio(cfg, anio, true, true, true).into_keys().collect();
    otros.extend(festivos_del_anio(cfg, anio + 1, true, true, true).into_keys());
    let mut out = BTreeMap::new();
    let mut anadir = |f: NaiveDate, n: &str| {
        if f.weekday().num_days_from_monday() < 5 && !otros.contains(&f.to_string()) {
            out.insert(f.to_string(), n.to_string());
        }
    };
    let mut d = NaiveDate::from_ymd_opt(anio, 12, 24).unwrap();
    while d <= NaiveDate::from_ymd_opt(anio + 1, 1, 6).unwrap() {
        anadir(d, "Cierre de Navidad (UGR)");
        d += Duration::days(1);
    }
    for i in [6, 5, 4] {
        anadir(p - Duration::days(i), "Semana Santa (UGR)");
    }
    anadir(NaiveDate::from_ymd_opt(anio, 5, 17).unwrap(), "San Pascual Bailón (UGR)");
    anadir(p + Duration::days(61), "Feria del Corpus (UGR)");
    out
}

/// Festivos de los ambitos pedidos que caen en laborable y aun no estan
/// marcados. A partir de noviembre, tambien los del año siguiente.
pub fn festivos_pendientes(cfg: &Cfg, h: NaiveDate, nacional: bool, andalucia: bool, local: bool, ugr: bool) -> BTreeMap<String, String> {
    let anios: Vec<i32> = if h.month() >= 11 { vec![h.year(), h.year() + 1] } else { vec![h.year()] };
    let mut catalogo = BTreeMap::new();
    for a in &anios {
        catalogo.extend(festivos_del_anio(cfg, *a, nacional, andalucia, local));
    }
    if ugr {
        for a in &anios {
            catalogo.extend(propuesta_dias_ugr(cfg, *a));
        }
        catalogo.extend(cfg.objeto("dias_ugr").into_iter().map(|(k, v)| (k, texto(&v))));
    }
    let marcados = cfg.objeto("no_laborables");
    catalogo.into_iter().filter(|(f, _)| {
        !marcados.contains_key(f)
            && NaiveDate::parse_from_str(f, "%Y-%m-%d").is_ok_and(|d| d.weekday().num_days_from_monday() < 5)
    }).collect()
}

pub fn festivos(cfg: &Cfg, n: bool, a: bool, l: bool, u: bool) -> Value {
    let ugr = cfg.objeto("dias_ugr");
    json!(festivos_pendientes(cfg, hoy(), n, a, l, u).into_iter().map(|(f, nombre)| {
        let fecha = NaiveDate::parse_from_str(&f, "%Y-%m-%d").map(|d| d.format("%d/%m/%Y").to_string()).unwrap_or_default();
        json!({"iso": f, "fecha": fecha, "ugr": nombre.ends_with("(UGR)") || ugr.contains_key(&f), "nombre": nombre})
    }).collect::<Vec<_>>())
}

pub fn importar_festivos(cfg: &Cfg, n: bool, a: bool, l: bool, u: bool, excluir: &[Value]) -> Result<Value, String> {
    let fuera: HashSet<String> = excluir.iter().map(texto).collect();
    let pendientes: Vec<(String, String)> = festivos_pendientes(cfg, hoy(), n, a, l, u).into_iter()
        .filter(|(f, _)| !fuera.contains(f)).collect();
    if !pendientes.is_empty() {
        config::modificar(|c| {
            let mut m = c.get("no_laborables").and_then(Value::as_object).cloned().unwrap_or_default();
            for (f, nombre) in &pendientes {
                m.insert(f.clone(), json!(nombre));
            }
            c.insert("no_laborables".into(), Value::Object(m));
        })?;
    }
    Ok(json!({"n": pendientes.len()}))
}

pub fn anadir_dia_ugr(fecha: &str, nombre: &str) -> Result<Value, String> {
    if NaiveDate::parse_from_str(fecha, "%Y-%m-%d").is_err() {
        return Ok(json!({"error": "Elige una fecha."}));
    }
    let nombre = if nombre.trim().is_empty() { "Día propio UGR".to_string() } else { nombre.trim().to_string() };
    config::modificar(|c| {
        let mut m = c.get("dias_ugr").and_then(Value::as_object).cloned().unwrap_or_default();
        m.insert(fecha.into(), json!(nombre));
        c.insert("dias_ugr".into(), Value::Object(m));
    })?;
    Ok(json!({"ok": true}))
}

// ---------------------------------------------------------------- vacaciones y teletrabajo

fn numero(x: f64) -> Value {
    if x.fract() == 0.0 { json!(x as i64) } else { json!(x) }
}

pub fn ajustes_dias(cfg: &Cfg) -> Value {
    let r = Reglas::desde(cfg);
    let anio = hoy().year();
    json!({"anio": anio, "cupo": numero(r.cupo_vacaciones), "usadas": r.vacaciones_usadas(anio), "tt": r.teletrabajo_por_semana})
}

pub fn guardar_ajustes_dias(cupo: &Value, tt: &Value) -> Result<Value, String> {
    let n = |v: &Value| texto(v).trim().replace(',', ".").parse::<f64>().ok().filter(|x| x.is_finite()).map(|x| x.trunc() as i64);
    let (Some(cupo), Some(tt)) = (n(cupo), n(tt)) else {
        return Ok(json!({"error": "Escribe números válidos."}));
    };
    if !((0..=60).contains(&cupo) && (0..=5).contains(&tt)) {
        return Ok(json!({"error": "El cupo de vacaciones va de 0 a 60 días y el teletrabajo de 0 a 5 días por semana."}));
    }
    let mut m = Map::new();
    m.insert("cupo_vacaciones".into(), json!(cupo));
    m.insert("teletrabajo_por_semana".into(), json!(tt));
    config::guardar_valores(m)?;
    Ok(json!({"ok": true}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(v: Value) -> Cfg {
        Cfg(v.as_object().unwrap().clone())
    }

    #[test]
    fn pascua_de_varios_anios() {
        assert_eq!(pascua(2026).to_string(), "2026-04-05");
        assert_eq!(pascua(2027).to_string(), "2027-03-28");
        assert_eq!(pascua(2024).to_string(), "2024-03-31");
    }

    /// Las mismas fechas que da festivos_del_anio / propuesta_dias_ugr de Python.
    #[test]
    fn festivos_como_python() {
        let c = cfg(json!({}));
        let f26: Vec<String> = festivos_del_anio(&c, 2026, true, true, true).into_keys().collect();
        assert_eq!(f26, ["2026-01-01", "2026-01-02", "2026-01-06", "2026-02-28", "2026-04-02", "2026-04-03", "2026-05-01",
                         "2026-06-04", "2026-08-15", "2026-10-12", "2026-11-02", "2026-12-07", "2026-12-08", "2026-12-25"]);
        let f27 = festivos_del_anio(&c, 2027, true, true, true);
        assert_eq!(f27["2027-03-01"], "Día de Andalucía (traslado)");
        assert_eq!(f27["2027-08-16"], "Asunción (traslado)");
        assert_eq!(festivos_del_anio(&c, 2026, true, true, true)["2026-11-02"], "Todos los Santos (traslado)");
        let u26: Vec<String> = propuesta_dias_ugr(&c, 2026).into_keys().collect();
        assert_eq!(u26, ["2026-03-30", "2026-03-31", "2026-04-01", "2026-06-05", "2026-12-24", "2026-12-28",
                         "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-04", "2027-01-05"]);
        let u27 = propuesta_dias_ugr(&c, 2027);
        assert_eq!(u27["2027-05-17"], "San Pascual Bailón (UGR)");
        assert_eq!(u27.len(), 13);
    }

    #[test]
    fn un_anio_despues_y_bisiestos() {
        assert_eq!(un_anio_despues("2027-01-15"), "2028-01-15");
        assert_eq!(un_anio_despues("2028-02-29"), "2029-02-28");
        assert_eq!(un_anio_despues(""), "");
    }
}
