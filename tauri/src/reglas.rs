//! Reglas de la jornada: objetivo de cada dia, verano, festivos, permisos,
//! guardias y teletrabajo, y lo que pinta la tarjeta de un dia.
//!
//! Port 1:1 de rellenar_horas.py (objetivo_de, es_verano, horas_permiso...)
//! y de registrar_web.py (objetivo_dia, estado_dia). Si cambia alli, cambia
//! aqui: los tests de abajo son los mismos casos.

use crate::config::Cfg;
use chrono::{Datelike, NaiveDate};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

pub const DIAS_ES: [&str; 7] = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

pub fn redondear(x: f64, decimales: i32) -> f64 {
    let f = 10f64.powi(decimales);
    (x * f).round() / f
}

/// '3:30', '3,5' o '3.5' -> 3.5. None si no vale (como parsear_horas).
pub fn parsear_horas(txt: &str) -> Option<f64> {
    let s = txt.trim().replace(',', ".");
    if s.is_empty() {
        return None;
    }
    if let Some((hh, mm)) = s.split_once(':') {
        let h: i64 = hh.trim().parse().ok()?;
        let m: i64 = mm.trim().parse().ok()?;
        if h < 0 || !(0..60).contains(&m) {
            return None;
        }
        return Some(redondear(h as f64 + m as f64 / 60.0, 2));
    }
    let h: f64 = s.parse().ok()?;
    if !h.is_finite() || h < 0.0 {
        return None;
    }
    Some(redondear(h, 2))
}

/// Horas de un valor de la config: numero o texto.
pub fn horas_de_valor(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64().filter(|h| h.is_finite() && *h >= 0.0).map(|h| redondear(h, 2)),
        Value::String(s) => parsear_horas(s),
        _ => None,
    }
}

/// 6.5 -> "6,5h" (como _horas de registrar_web).
pub fn fmt_horas(h: f64) -> String {
    let s = format!("{h:.2}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    format!("{}h", s.replace('.', ","))
}

/// 3.5 -> "3:30" (el formato del portal de permisos).
pub fn fmt_hhmm(h: f64) -> String {
    let total = (h * 60.0).round() as i64;
    let signo = if total < 0 { "-" } else { "" };
    let t = total.abs();
    format!("{signo}{}:{:02}", t / 60, t % 60)
}

fn capitalizar(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(p) => p.to_uppercase().collect::<String>() + &c.as_str().to_lowercase(),
        None => String::new(),
    }
}

/// Un apunte de ProyectosTIC (time_entry), como el dict de _apunte().
#[derive(Clone, Debug, Default)]
pub struct Apunte {
    pub id: String,
    pub wp_id: String,
    pub horas: f64,
    pub wp_titulo: String,
    pub comentario: String,
    pub actividad: String,
    pub fecha: String,
}

pub struct TipoPermiso {
    pub id: String,
    pub nombre: String,
    pub actividad: String,
    /// las bolsas de horas concedidas de este tipo
    pub concesiones: Vec<Concesion>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Concesion {
    pub horas: f64,
    /// "AAAA-MM-DD" o "" si no caduca
    pub fecha_limite: String,
}

impl Concesion {
    pub fn limite(&self) -> Option<NaiveDate> {
        NaiveDate::parse_from_str(&self.fecha_limite, "%Y-%m-%d").ok()
    }
}

impl TipoPermiso {
    pub fn cupo(&self) -> f64 {
        redondear(self.concesiones.iter().map(|c| c.horas).sum(), 2)
    }
}

fn concesion(horas: f64) -> Concesion {
    Concesion { horas, fecha_limite: String::new() }
}

/// Concesiones de un tipo de la config (tolera el modelo viejo de un "cupo").
pub fn concesiones_de(t: &Value) -> Vec<Concesion> {
    let lim = |v: &Value| v.as_str().unwrap_or("").trim().to_string();
    match t.get("concesiones") {
        Some(Value::Array(cs)) => cs.iter()
            .filter_map(|c| horas_de_valor(&c["horas"]).filter(|h| *h > 0.0).map(|h| Concesion { horas: h, fecha_limite: lim(&c["fecha_limite"]) }))
            .collect(),
        Some(Value::Null) | None => t.get("cupo").and_then(horas_de_valor).filter(|h| *h > 0.0)
            .map(|h| Concesion { horas: h, fecha_limite: lim(&t["fecha_limite"]) }).into_iter().collect(),
        _ => vec![],
    }
}

pub struct Reglas {
    jornada_inv: f64,
    jornada_ver: f64,
    tiene_verano: bool,
    verano_inicio: (u32, u32),
    verano_fin: (u32, u32),
    no_laborables: HashMap<String, String>,
    permisos: HashMap<String, Vec<(String, f64)>>,
    guardias: HashSet<String>,
    teletrabajo: HashSet<String>,
    desayuno: f64,
    horas_dia_permiso: f64,
    pub tipos: Vec<TipoPermiso>,
    tareas_local: Map<String, Value>,
    pub comentario_guardia: String,
    pub teletrabajo_por_semana: i64,
    permisos_desde: Option<NaiveDate>,
    pub cupo_vacaciones: f64,
}

fn par(v: Option<&Value>, defecto: (u32, u32)) -> (u32, u32) {
    match v {
        Some(Value::Array(a)) if a.len() >= 2 => {
            match (a[0].as_u64(), a[1].as_u64()) {
                (Some(m), Some(d)) => (m as u32, d as u32),
                _ => defecto,
            }
        }
        _ => defecto,
    }
}

fn texto(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn conjunto(cfg: &Cfg, k: &str) -> HashSet<String> {
    cfg.lista(k).iter().map(texto).filter(|s| !s.is_empty()).collect()
}

impl Reglas {
    pub fn desde(cfg: &Cfg) -> Reglas {
        let jornada_inv = cfg.horas("jornada_invierno").unwrap_or(7.0);
        let desayuno = cfg.horas("desayuno").unwrap_or(0.0);
        let tipos_cfg = cfg.lista("permisos_tipos");
        let tipos = if tipos_cfg.is_empty() {
            vec![
                TipoPermiso { id: "asuntos_particulares".into(), nombre: "Asuntos particulares por horas".into(), actividad: String::new(), concesiones: vec![concesion(70.0)] },
                TipoPermiso { id: "servicios_minimos".into(), nombre: "Compensación por servicios mínimos".into(), actividad: String::new(), concesiones: vec![concesion(56.0)] },
                TipoPermiso { id: "conciliacion".into(), nombre: "Conciliación vida laboral y familiar".into(), actividad: String::new(), concesiones: vec![concesion(30.0)] },
            ]
        } else {
            tipos_cfg
                .iter()
                .map(|t| TipoPermiso {
                    id: texto(&t["id"]),
                    nombre: texto(&t["nombre"]),
                    actividad: texto(&t["actividad"]).trim().to_string(),
                    concesiones: concesiones_de(t),
                })
                .collect()
        };
        let permisos = cfg
            .objeto("permisos")
            .iter()
            .map(|(iso, lista)| {
                let ps = lista
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .map(|p| (texto(&p["tipo"]), horas_de_valor(&p["horas"]).unwrap_or(0.0)))
                            .collect()
                    })
                    .unwrap_or_default();
                (iso.clone(), ps)
            })
            .collect();
        Reglas {
            jornada_inv,
            jornada_ver: cfg.horas("jornada_verano").unwrap_or(jornada_inv),
            tiene_verano: cfg.get("tiene_verano").map(|v| v.as_bool().unwrap_or(true)).unwrap_or(true),
            verano_inicio: par(cfg.get("verano_inicio"), (6, 16)),
            verano_fin: par(cfg.get("verano_fin"), (9, 15)),
            no_laborables: cfg.objeto("no_laborables").iter().map(|(k, v)| (k.clone(), texto(v))).collect(),
            permisos,
            guardias: conjunto(cfg, "guardias"),
            teletrabajo: conjunto(cfg, "teletrabajo"),
            desayuno,
            horas_dia_permiso: cfg
                .horas("horas_dia_permiso")
                .filter(|h| *h > 0.0)
                .unwrap_or_else(|| redondear(jornada_inv + desayuno, 2)),
            tipos,
            tareas_local: cfg.objeto("tareas_local"),
            comentario_guardia: if cfg.0.contains_key("comentario_guardia") {
                cfg.texto("comentario_guardia")
            } else {
                "Servicio de Guardia".into()
            },
            teletrabajo_por_semana: cfg.get("teletrabajo_por_semana").and_then(|v| v.as_i64()).unwrap_or(1),
            permisos_desde: NaiveDate::parse_from_str(&cfg.texto("permisos_desde"), "%Y-%m-%d").ok(),
            cupo_vacaciones: cfg.get("cupo_vacaciones").and_then(Value::as_f64).unwrap_or(22.0),
        }
    }

    /// Lo que vale un dia completo de permiso: la jornada OFICIAL.
    pub fn horas_dia_permiso(&self) -> f64 {
        self.horas_dia_permiso
    }

    pub fn es_verano(&self, d: NaiveDate) -> bool {
        self.tiene_verano && self.verano_inicio <= (d.month(), d.day()) && (d.month(), d.day()) <= self.verano_fin
    }
    pub fn jornada_de(&self, d: NaiveDate) -> f64 {
        if self.es_verano(d) { self.jornada_ver } else { self.jornada_inv }
    }
    pub fn es_no_laborable(&self, iso: &str) -> bool {
        self.no_laborables.contains_key(iso)
    }
    pub fn motivo(&self, iso: &str) -> String {
        self.no_laborables.get(iso).cloned().unwrap_or_default()
    }
    pub fn es_vacaciones(&self, iso: &str) -> bool {
        self.motivo(iso).trim().to_lowercase() == "vacaciones"
    }
    pub fn es_guardia(&self, iso: &str) -> bool {
        self.guardias.contains(iso)
    }
    pub fn es_teletrabajo(&self, iso: &str) -> bool {
        self.teletrabajo.contains(iso)
    }
    pub fn horas_permiso(&self, iso: &str) -> f64 {
        redondear(self.permisos.get(iso).map(|ps| ps.iter().map(|p| p.1).sum()).unwrap_or(0.0), 2)
    }
    /// Desde cuando se lleva el saldo de permisos (por defecto, el 1 de enero).
    pub fn permisos_desde(&self, hoy: NaiveDate) -> NaiveDate {
        self.permisos_desde.unwrap_or_else(|| NaiveDate::from_ymd_opt(hoy.year(), 1, 1).unwrap())
    }

    /// Horas de ese tipo MARCADAS en el dia desde 'desde' (permiso local).
    pub fn permiso_usadas_local(&self, tipo: &str, desde: NaiveDate) -> f64 {
        let total: f64 = self.permisos.iter()
            .filter(|(iso, _)| NaiveDate::parse_from_str(iso, "%Y-%m-%d").map(|d| d >= desde).unwrap_or(false))
            .flat_map(|(_, ps)| ps.iter().filter(|(t, _)| t == tipo).map(|(_, h)| *h))
            .sum();
        redondear(total, 2)
    }

    /// Dias laborables marcados como vacaciones en ese año.
    pub fn vacaciones_usadas(&self, anio: i32) -> usize {
        self.no_laborables.keys().filter(|iso| self.es_vacaciones(iso)).filter_map(|iso| NaiveDate::parse_from_str(iso, "%Y-%m-%d").ok())
            .filter(|d| d.year() == anio && d.weekday().num_days_from_monday() < 5).count()
    }

    pub fn teletrabajo_en_semana(&self, lunes: NaiveDate) -> usize {
        (0..5).filter(|i| self.es_teletrabajo(&(lunes + chrono::Duration::days(*i)).to_string())).count()
    }

    /// Jornada objetivo: 0 si no laborable; si no, la jornada menos los permisos.
    pub fn objetivo_de(&self, d: NaiveDate) -> f64 {
        let iso = d.to_string();
        if self.es_no_laborable(&iso) {
            return 0.0;
        }
        redondear(self.jornada_de(d) - self.horas_permiso(&iso), 2).max(0.0)
    }

    /// Nombres (en minusculas) de las actividades enlazadas a algun permiso.
    pub fn actividades_de_permiso(&self) -> HashSet<String> {
        self.tipos.iter().map(|t| t.actividad.to_lowercase()).filter(|a| !a.is_empty()).collect()
    }

    /// Objetivo contando los permisos IMPUTADOS como actividad: van en jornada
    /// oficial, asi que ese dia el objetivo suma el desayuno (no en verano).
    pub fn objetivo_dia(&self, d: NaiveDate, apuntes: Option<&[Apunte]>, acts: &HashSet<String>) -> f64 {
        let obj = self.objetivo_de(d);
        let ap = match apuntes {
            Some(a) if !a.is_empty() => a,
            _ => return obj,
        };
        if obj == 0.0 || self.es_verano(d) {
            return obj;
        }
        if ap.iter().any(|a| acts.contains(&a.actividad.trim().to_lowercase())) {
            return redondear(obj + self.desayuno, 2);
        }
        obj
    }

    fn wp_de(&self, motivo: &str) -> String {
        self.tareas_local.get(motivo).and_then(|v| v.get("id")).map(texto).unwrap_or_default()
    }

    fn nombre_tipo(&self, id: &str) -> String {
        self.tipos.iter().find(|t| t.id == id).map(|t| t.nombre.clone()).unwrap_or_else(|| id.to_string())
    }

    /// Lo que necesita la tarjeta de un dia (estado_dia de registrar_web).
    /// apuntes None = no se pudo leer ProyectosTIC.
    pub fn estado_dia(&self, d: NaiveDate, apuntes: Option<&[Apunte]>, hoy: NaiveDate, acts: &HashSet<String>) -> Value {
        let iso = d.to_string();
        let obj = self.objetivo_dia(d, apuntes, acts);
        let nolab = self.es_no_laborable(&iso);
        let lista: &[Apunte] = apuntes.unwrap_or(&[]);
        let reg = if lista.is_empty() { 0.0 } else { redondear(lista.iter().map(|a| a.horas).sum(), 2) };
        let h_permiso = if nolab { 0.0 } else { self.horas_permiso(&iso) };
        let es_act_permiso = |a: &Apunte| acts.contains(&a.actividad.trim().to_lowercase());
        let h_permiso_pt: f64 = lista.iter().filter(|a| es_act_permiso(a)).map(|a| a.horas).sum();
        let dia_permiso_pt = h_permiso_pt > 0.0 && h_permiso_pt >= self.horas_dia_permiso - 0.01;
        // imputado en ProyectosTIC (no solo marcado aqui)
        let (wp_guardia, wp_tele, wp_permiso) = (self.wp_de("guardia"), self.wp_de("teletrabajo"), self.wp_de("permiso"));
        let en = |wp: &str, a: &Apunte| !wp.is_empty() && a.wp_id == wp;
        let guardia_pt = lista.iter().any(|a| {
            en(&wp_guardia, a) || (!self.comentario_guardia.is_empty() && a.comentario.trim() == self.comentario_guardia)
        });
        let tele_pt = lista.iter().any(|a| en(&wp_tele, a));
        let h_permiso_pt_tarea = h_permiso_pt
            + lista.iter().filter(|a| en(&wp_permiso, a) && !es_act_permiso(a)).map(|a| a.horas).sum::<f64>();

        let (estado, frac, mut texto_dia);
        if nolab {
            estado = if self.es_vacaciones(&iso) { "vacaciones" } else { "nolab" };
            frac = 1.0;
            texto_dia = capitalizar(&self.motivo(&iso));
            if reg > 0.0 {
                texto_dia = format!("{} · {}", fmt_horas(reg), texto_dia);
            }
        } else if apuntes.is_none() {
            estado = "error";
            frac = 0.0;
            texto_dia = "sin conexión".to_string();
        } else if (h_permiso > 0.0 && obj == 0.0) || dia_permiso_pt {
            estado = "permiso";
            frac = 1.0;
            texto_dia = "Permiso (día completo)".to_string();
            if reg > 0.0 {
                texto_dia = format!("{} · {}", fmt_horas(reg), texto_dia);
            }
        } else if reg > obj + 0.001 {
            estado = "pasado";
            frac = 1.0;
            texto_dia = format!("{} / {} · +{}", fmt_horas(reg), fmt_horas(obj), fmt_horas(reg - obj));
        } else if reg >= obj - 0.001 && reg > 0.0 {
            estado = "completo";
            frac = 1.0;
            texto_dia = format!("{} / {}  ✔", fmt_horas(reg), fmt_horas(obj));
        } else if reg > 0.0 {
            estado = "parcial";
            frac = if obj > 0.0 { reg / obj } else { 0.0 };
            texto_dia = format!("{} / {}", fmt_horas(reg), fmt_horas(obj));
        } else {
            estado = "vacio";
            frac = 0.0;
            texto_dia = format!("0h / {}", fmt_horas(obj));
        }
        let sin_falta = nolab || dia_permiso_pt;
        let detalle: Vec<String> = self
            .permisos
            .get(&iso)
            .map(|ps| ps.iter().map(|(t, h)| format!("{}: {}", self.nombre_tipo(t), fmt_hhmm(*h))).collect())
            .unwrap_or_default();
        json!({
            "iso": iso,
            "nombre": DIAS_ES[d.weekday().num_days_from_monday() as usize],
            "fecha": d.format("%d/%m").to_string(),
            "es_hoy": d == hoy,
            "estado": estado,
            "frac": redondear(frac.clamp(0.0, 1.0), 3),
            "texto": texto_dia,
            "reg": reg,
            "obj": obj,
            "falta": if sin_falta { 0.0 } else { redondear(obj - reg, 2) },
            "exceso": if !sin_falta && reg > obj { redondear(reg - obj, 2) } else { 0.0 },
            "no_laborable": nolab,
            "motivo": if nolab { self.motivo(&iso) } else { String::new() },
            "guardia": self.es_guardia(&iso),
            "teletrabajo": self.es_teletrabajo(&iso),
            "permiso": if h_permiso > 0.0 { fmt_hhmm(h_permiso) } else { String::new() },
            "guardia_pt": guardia_pt,
            "teletrabajo_pt": tele_pt,
            "permiso_pt": if h_permiso_pt_tarea > 0.0 { fmt_hhmm(h_permiso_pt_tarea) } else { String::new() },
            "permiso_detalle": detalle,
            "apuntes": lista.iter().map(|a| json!({
                "id": a.id, "horas": a.horas, "horas_txt": fmt_horas(a.horas), "wp_id": a.wp_id,
                "tarea": a.wp_titulo, "actividad": a.actividad, "comentario": a.comentario,
                "destino": "op"})).collect::<Vec<_>>(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reglas(cfg: Value) -> Reglas {
        Reglas::desde(&Cfg(cfg.as_object().unwrap().clone()))
    }
    fn dia(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }
    fn ap(horas: f64, actividad: &str) -> Apunte {
        Apunte { id: "1".into(), wp_id: "5".into(), horas, wp_titulo: "T".into(), actividad: actividad.into(), ..Default::default() }
    }

    #[test]
    fn horas_y_formatos() {
        assert_eq!(parsear_horas("3:30"), Some(3.5));
        assert_eq!(parsear_horas("6,5"), Some(6.5));
        assert_eq!(parsear_horas("70:00"), Some(70.0));
        assert_eq!(parsear_horas("3:75"), None);
        assert_eq!(parsear_horas("-1"), None);
        assert_eq!(fmt_horas(6.5), "6,5h");
        assert_eq!(fmt_horas(7.0), "7h");
        assert_eq!(fmt_horas(0.25), "0,25h");
        assert_eq!(fmt_hhmm(3.5), "3:30");
        assert_eq!(fmt_hhmm(-0.5), "-0:30");
    }

    #[test]
    fn verano_festivos_y_permisos() {
        let r = reglas(json!({"jornada_invierno": 6.5, "jornada_verano": 5, "no_laborables": {"2026-11-09": "festivo"},
                              "permisos": {"2026-11-10": [{"tipo": "conciliacion", "horas": 2}]}}));
        assert_eq!(r.objetivo_de(dia("2026-07-01")), 5.0);
        assert_eq!(r.objetivo_de(dia("2026-11-09")), 0.0);
        assert_eq!(r.objetivo_de(dia("2026-11-10")), 4.5);
        assert_eq!(r.objetivo_de(dia("2026-11-11")), 6.5);
    }

    #[test]
    fn estados_de_la_tarjeta() {
        let r = reglas(json!({"jornada_invierno": 6.5, "desayuno": 0.5,
                              "permisos_tipos": [{"id": "ap", "nombre": "Asuntos", "actividad": "Asuntos propios"}]}));
        let acts = r.actividades_de_permiso();
        let hoy = dia("2026-11-12");
        let e = |aps: Option<&[Apunte]>| r.estado_dia(dia("2026-11-11"), aps, hoy, &acts);
        assert_eq!(e(None)["estado"], "error");
        assert_eq!(e(Some(&[]))["texto"], "0h / 6,5h");
        assert_eq!(e(Some(&[ap(3.0, "soporte")]))["estado"], "parcial");
        let c = e(Some(&[ap(3.5, "soporte"), ap(3.0, "soporte")]));
        assert_eq!((c["estado"].as_str(), c["texto"].as_str()), (Some("completo"), Some("6,5h / 6,5h  ✔")));
        assert_eq!(e(Some(&[ap(7.5, "soporte")]))["texto"], "7,5h / 6,5h · +1h");
        // 7 h de "Asuntos propios" = dia de permiso completo (no "+0,5h")
        let p = e(Some(&[ap(7.0, "Asuntos propios")]));
        assert_eq!(p["estado"], "permiso");
        assert_eq!(p["falta"], 0.0);
        // 2 h de permiso imputado: objetivo con desayuno (7), faltan 5
        let parcial = e(Some(&[ap(2.0, "Asuntos propios")]));
        assert_eq!(parcial["obj"], 7.0);
        assert_eq!(parcial["falta"], 5.0);
    }

    /// Paridad con la app de Python sobre datos de verdad (no va en el repo):
    /// FICHACSIRC_PARIDAD=entrada.json cargo test paridad -- --ignored
    /// entrada: {config, hoy, dias: [{iso, apuntes|null}]}; escribe
    /// <entrada>.rust.json con lo que pinta cada tarjeta, para compararlo con
    /// estado_dia de registrar_web.py (tests/paridad_rust.py).
    #[test]
    #[ignore]
    fn paridad() {
        let Ok(ruta) = std::env::var("FICHACSIRC_PARIDAD") else { return };
        let entrada: Value = serde_json::from_str(&std::fs::read_to_string(&ruta).unwrap()).unwrap();
        let r = Reglas::desde(&Cfg(entrada["config"].as_object().unwrap().clone()));
        let acts = r.actividades_de_permiso();
        let hoy = dia(entrada["hoy"].as_str().unwrap());
        let salida: Vec<Value> = entrada["dias"].as_array().unwrap().iter().map(|d| {
            let aps: Option<Vec<Apunte>> = d["apuntes"].as_array().map(|a| a.iter().map(|x| Apunte {
                id: x["id"].to_string().trim_matches('"').to_string(),
                wp_id: x["wp_id"].as_str().unwrap_or("").to_string(),
                horas: x["horas"].as_f64().unwrap(),
                wp_titulo: x["wp_titulo"].as_str().unwrap_or("").to_string(),
                comentario: x["comentario"].as_str().unwrap_or("").to_string(),
                actividad: x["actividad"].as_str().unwrap_or("").to_string(),
                fecha: String::new(),
            }).collect());
            r.estado_dia(dia(d["iso"].as_str().unwrap()), aps.as_deref(), hoy, &acts)
        }).collect();
        // (la franja la compara resumen::tests::paridad_franja)
        std::fs::write(format!("{ruta}.rust.json"), serde_json::to_string_pretty(&salida).unwrap()).unwrap();
    }
}
