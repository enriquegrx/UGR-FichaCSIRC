//! Vista de mes, franja de resumen (meses, saldo de permisos, vacaciones y
//! tareas habituales) y los avisos de semana anterior y de cierre de mes.
//! Port de registrar_web.py (mes, _pintar_mes, resumen_franja, _habituales,
//! semana_anterior_pendiente, mes_pendiente).

use crate::api::{candado, Estado};
use crate::config::{self, Cfg};
use crate::openproject::{self, Cliente, ErrorOp};
use crate::reglas::{fmt_hhmm, fmt_horas, redondear, Apunte, Reglas, DIAS_ES};
use chrono::{Datelike, Duration, Local, NaiveDate};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub const MESES: [&str; 12] = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
                               "septiembre", "octubre", "noviembre", "diciembre"];
const MAX_HABITUALES: usize = 5;
const DIAS_AVISO_MES: usize = 5;
const DIAS_AVISO_MES_SIGUIENTE: usize = 3;

fn hoy() -> NaiveDate {
    Local::now().date_naive()
}

fn ultimo_dia(anio: i32, mes: u32) -> NaiveDate {
    let (a, m) = if mes == 12 { (anio + 1, 1) } else { (anio, mes + 1) };
    NaiveDate::from_ymd_opt(a, m, 1).unwrap() - Duration::days(1)
}

fn capital(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|p| p.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

fn por_dia(aps: Vec<Apunte>) -> HashMap<String, Vec<Apunte>> {
    let mut m: HashMap<String, Vec<Apunte>> = HashMap::new();
    for a in aps {
        m.entry(a.fecha.clone()).or_default().push(a);
    }
    m
}

/// Los apuntes del usuario en un rango (identificandolo primero).
async fn rango(e: &Estado, cfg: &Cfg, desde: NaiveDate, hasta: NaiveDate) -> Result<Vec<Apunte>, ErrorOp> {
    let cli = Cliente::desde(cfg)?;
    let uid = e.uid(&cli).await?;
    cli.entradas_rango(&uid, &desde.to_string(), &hasta.to_string()).await
}

// ---------------------------------------------------------------- mes

/// Lunes de cada semana (L-V) que toca el mes: la cuadricula completa.
pub fn semanas_de(anio: i32, mes: u32) -> Vec<NaiveDate> {
    let primero = NaiveDate::from_ymd_opt(anio, mes, 1).unwrap();
    let ultimo = ultimo_dia(anio, mes);
    let mut lunes = primero - Duration::days(primero.weekday().num_days_from_monday() as i64);
    let mut out = Vec::new();
    while lunes <= ultimo {
        if lunes + Duration::days(4) >= primero {
            out.push(lunes);
        }
        lunes += Duration::days(7);
    }
    out
}

pub async fn mes(e: &Estado, cfg: &Cfg, anio: i32, mes: u32) -> Result<Value, String> {
    if !(1..=12).contains(&mes) {
        return Err("Mes no válido.".into());
    }
    let semanas = semanas_de(anio, mes);
    let dias: Vec<NaiveDate> = semanas.iter().flat_map(|l| (0..5).map(move |i| *l + Duration::days(i))).collect();
    let leido = rango(e, cfg, dias[0], *dias.last().unwrap()).await;
    let ok = leido.is_ok();
    {
        let mut cache = candado(&e.cache);
        match leido {
            Ok(aps) => {
                let mut pd = por_dia(aps);
                for d in &dias {
                    cache.insert(d.to_string(), Some(pd.remove(&d.to_string()).unwrap_or_default()));
                }
                *candado(&e.error) = None;
            }
            Err(err) => {
                for d in &dias {
                    cache.insert(d.to_string(), None);
                }
                *candado(&e.error) = Some(err);
            }
        }
    }
    if ok {
        crate::api::inari_en_cache(e, cfg, &dias).await;
    }
    Ok(pintar_mes(e, cfg, anio, mes).await)
}

pub async fn pintar_mes(e: &Estado, cfg: &Cfg, anio: i32, mes: u32) -> Value {
    let reglas = Reglas::desde(cfg);
    let acts = reglas.actividades_de_permiso();
    let h = hoy();
    let semanas = semanas_de(anio, mes);
    let (mut reg, mut obj, mut obj_hoy, mut fallos) = (0.0, 0.0, 0.0, 0);
    let filas: Vec<Value> = {
        let cache = candado(&e.cache);
        semanas.iter().map(|l| {
            Value::Array((0..5).map(|i| {
                let d = *l + Duration::days(i);
                let aps = cache.get(&d.to_string()).cloned().unwrap_or(None);
                if aps.is_none() {
                    fallos += 1;
                }
                let mut t = reglas.estado_dia(d, aps.as_deref(), h, &acts);
                t["dia"] = json!(d.day());
                t["del_mes"] = json!(d.month() == mes);
                t["futuro"] = json!(d > h);
                if d.month() == mes {
                    let o = t["obj"].as_f64().unwrap_or(0.0);
                    reg += t["reg"].as_f64().unwrap_or(0.0);
                    obj += o;
                    if d <= h {
                        obj_hoy += o;
                    }
                }
                t
            }).collect())
        }).collect()
    };
    let al_dia = reg >= obj_hoy - 0.001;
    let total_dias = semanas.len() * 5;
    let error = candado(&e.error).clone();
    let detalle = match (fallos, error) {
        (0, _) | (_, None) => Value::Null,
        (_, Some(err)) => openproject::diagnostico(&err).await,
    };
    json!({
        "titulo": format!("{} {anio}", capital(MESES[mes as usize - 1])),
        "anio": anio, "mes": mes,
        "total": format!("{} / {}", fmt_horas(reg), fmt_horas(obj)),
        "al_dia": al_dia,
        "estado": if al_dia { "Al día ✔".to_string() } else { format!("Te faltan {}", fmt_horas(obj_hoy - reg)) },
        "frac": redondear(if obj > 0.0 { (reg / obj).clamp(0.0, 1.0) } else { 0.0 }, 3),
        "conexion": if fallos >= total_dias { "error" } else if fallos > 0 { "warn" } else { "ok" },
        "conexion_detalle": detalle,
        "semanas": filas,
    })
}

// ---------------------------------------------------------------- franja

/// (registrado, objetivo hasta 'hasta') de un mes con los apuntes ya leidos.
fn estado_mes(reglas: &Reglas, anio: i32, mes: u32, pd: &HashMap<String, Vec<Apunte>>, hasta: NaiveDate,
              tt: &HashMap<String, f64>) -> (f64, f64) {
    let acts = reglas.actividades_de_permiso();
    let (mut reg, mut obj) = (0.0, 0.0);
    let mut d = NaiveDate::from_ymd_opt(anio, mes, 1).unwrap();
    while d.month() == mes && d <= hasta {
        if d.weekday().num_days_from_monday() < 5 {
            let aps = pd.get(&d.to_string());
            obj += reglas.objetivo_dia(d, aps.map(|v| v.as_slice()), &acts);
            // teletrabajo con INARI: sus horas (cubos disjuntos, sin doble conteo)
            reg += match tt.get(&d.to_string()) {
                Some(h) => *h,
                None => aps.map(|v| v.iter().map(|a| a.horas).sum::<f64>()).unwrap_or(0.0),
            };
        }
        d += Duration::days(1);
    }
    (reg, obj)
}

/// Tareas mas usadas en el periodo (por tarea Y actividad) y sus horas
/// habituales por dia (las que mas se repiten), que propone el "+".
pub fn habituales(aps: &[Apunte], desde: NaiveDate) -> Value {
    let total: f64 = aps.iter().map(|a| a.horas).sum();
    let mut orden: Vec<(String, String)> = Vec::new();
    let mut horas: HashMap<(String, String), f64> = HashMap::new();
    let mut nombres: HashMap<(String, String), String> = HashMap::new();
    let mut dias: HashMap<(String, String), Vec<(String, f64)>> = HashMap::new();
    for a in aps.iter().filter(|a| !a.wp_id.is_empty()) {
        let k = (a.wp_id.clone(), a.actividad.clone());
        if !horas.contains_key(&k) {
            orden.push(k.clone());
        }
        *horas.entry(k.clone()).or_default() += a.horas;
        nombres.insert(k.clone(), a.wp_titulo.clone());
        let lista = dias.entry(k).or_default();
        match lista.iter_mut().find(|(f, _)| *f == a.fecha) {
            Some(x) => x.1 += a.horas,
            None => lista.push((a.fecha.clone(), a.horas)),
        }
    }
    // como Counter.most_common: de mas a menos horas; a igualdad, el orden de aparicion
    orden.sort_by(|x, y| horas[y].partial_cmp(&horas[x]).unwrap_or(std::cmp::Ordering::Equal));
    let filas: Vec<Value> = orden.iter().take(MAX_HABITUALES).filter_map(|k| {
        let h = horas[k];
        // la cantidad diaria que mas se repite (a igualdad, la mayor)
        let mut frec: Vec<(f64, usize)> = Vec::new();
        for (_, v) in &dias[k] {
            let v = redondear(*v, 2);
            match frec.iter_mut().find(|(x, _)| (*x - v).abs() < 1e-9) {
                Some(f) => f.1 += 1,
                None => frec.push((v, 1)),
            }
        }
        let tipico = frec.iter().max_by(|a, b| a.1.cmp(&b.1).then(a.0.partial_cmp(&b.0).unwrap()))?.0;
        Some(json!({"wp_id": k.0.parse::<i64>().ok()?, "tarea": nombres[k], "actividad": k.1,
                    "horas": redondear(h, 2), "horas_txt": fmt_horas(h),
                    "pct": if total > 0.0 { (100.0 * h / total).round() as i64 } else { 0 },
                    "tipico": tipico, "tipico_txt": fmt_horas(tipico)}))
    }).collect();
    json!({"desde": format!("desde el {} de {}", desde.day(), MESES[desde.month0() as usize]),
           "total": fmt_horas(total), "filas": filas})
}

fn nombre_corto(id: &str, nombre: &str) -> String {
    match id {
        "asuntos_particulares" => "Asuntos particulares".into(),
        "servicios_minimos" => "Servicios mínimos".into(),
        "conciliacion" => "Conciliación".into(),
        _ => nombre.chars().take(26).collect(),
    }
}

/// Horas de cada permiso imputadas en ProyectosTIC con su actividad (desde
/// permisos_desde hasta fin del año siguiente). Una consulta; se recuerda.
pub(crate) async fn usadas_pt(e: &Estado, cfg: &Cfg, reglas: &Reglas) -> HashMap<String, f64> {
    let mapa: Vec<(String, String)> = reglas.tipos.iter().filter(|t| !t.actividad.is_empty())
        .map(|t| (t.id.clone(), t.actividad.to_lowercase())).collect();
    if mapa.is_empty() {
        return HashMap::new();
    }
    if let Some(m) = candado(&e.usadas_pt).clone() {
        return m;
    }
    let h = hoy();
    let hasta = NaiveDate::from_ymd_opt(h.year() + 1, 12, 31).unwrap();
    let Ok(aps) = rango(e, cfg, reglas.permisos_desde(h), hasta).await else { return HashMap::new() };
    let mut res: HashMap<String, f64> = mapa.iter().map(|(id, _)| (id.clone(), 0.0)).collect();
    for a in &aps {
        let act = a.actividad.trim().to_lowercase();
        for (id, buscada) in &mapa {
            if act == *buscada {
                *res.get_mut(id).unwrap() += a.horas;
            }
        }
    }
    let res: HashMap<String, f64> = res.into_iter().map(|(k, v)| (k, redondear(v, 2))).collect();
    *candado(&e.usadas_pt) = Some(res.clone());
    res
}

fn mes_anterior(h: NaiveDate) -> (NaiveDate, NaiveDate) {
    let ant = NaiveDate::from_ymd_opt(h.year(), h.month(), 1).unwrap() - Duration::days(1);
    (ant, NaiveDate::from_ymd_opt(ant.year(), ant.month(), 1).unwrap())
}

pub async fn resumen_franja(e: &Estado, cfg: &Cfg) -> Value {
    let reglas = Reglas::desde(cfg);
    let h = hoy();
    let (_, ant_primero) = mes_anterior(h);
    let aps = rango(e, cfg, ant_primero, h).await.ok();
    let pt = usadas_pt(e, cfg, &reglas).await;
    let tt = horas_inari(cfg, &reglas, ant_primero, h).await;
    franja(&reglas, aps, h, &pt, &tt)
}

/// Teletrabajo con INARI: {iso: horas en INARI} de los dias de teletrabajo
/// del rango (0 si no se pudieron leer, como la app de Python).
pub async fn horas_inari(cfg: &Cfg, reglas: &Reglas, desde: NaiveDate, hasta: NaiveDate) -> HashMap<String, f64> {
    let mut out = HashMap::new();
    if !crate::inari::configurado(cfg) {
        return out;
    }
    let cli = crate::inari::Inari::desde(cfg);
    let pid = crate::inari::proyecto(cfg);
    let mut d = desde;
    while d <= hasta {
        if d.weekday().num_days_from_monday() < 5 && reglas.es_teletrabajo(&d.to_string()) {
            let h = cli.slots_dia(pid, &d.to_string()).await.map(|s| s.iter().map(|a| a.horas).sum()).unwrap_or(0.0);
            out.insert(d.to_string(), h);
        }
        d += Duration::days(1);
    }
    out
}

/// La franja ya con los apuntes leidos (None = sin red) y las horas de
/// permiso imputadas: sin red, para poder compararla con la de Python.
pub fn franja(reglas: &Reglas, aps: Option<Vec<Apunte>>, h: NaiveDate, pt: &HashMap<String, f64>,
              tt: &HashMap<String, f64>) -> Value {
    let (ant, ant_primero) = mes_anterior(h);
    let mut out = json!({"permisos": [], "meses": [], "habituales": null});
    if let Some(aps) = aps {
        out["habituales"] = habituales(&aps, ant_primero);
        let pd = por_dia(aps);
        let mut meses = Vec::new();
        for (anio, mes, hasta, siempre) in [(h.year(), h.month(), h, true), (ant.year(), ant.month(), ant, false)] {
            let (reg, obj) = estado_mes(reglas, anio, mes, &pd, hasta, tt);
            let al_dia = reg >= obj - 0.001;
            if siempre || !al_dia {
                meses.push(json!({"titulo": capital(MESES[mes as usize - 1]), "anio": anio, "mes": mes, "al_dia": al_dia,
                                  "texto": if al_dia { "al día ✔".to_string() } else { format!("faltan {}", fmt_horas(obj - reg)) }}));
            }
        }
        out["meses"] = json!(meses);
    }
    let desde = reglas.permisos_desde(h);
    let permisos: Vec<Value> = reglas.tipos.iter().filter(|t| !t.concesiones.is_empty()).map(|t| {
        let usadas = reglas.permiso_usadas_local(&t.id, desde) + pt.get(&t.id).copied().unwrap_or(0.0);
        let disp = redondear(t.cupo() - redondear(usadas, 2), 2);
        json!({"nombre": nombre_corto(&t.id, &t.nombre), "disponible": fmt_hhmm(disp), "negativo": disp < 0.0})
    }).collect();
    out["permisos"] = json!(permisos);
    if reglas.cupo_vacaciones != 0.0 {
        let usadas = reglas.vacaciones_usadas(h.year()) as f64;
        out["vacaciones"] = json!({"quedan": reglas.cupo_vacaciones - usadas, "cupo": reglas.cupo_vacaciones});
    }
    out
}

// ---------------------------------------------------------------- avisos

/// La semana pasada con huecos (y no cerrado su aviso): {lunes, texto, dias}.
pub async fn semana_anterior_pendiente(e: &Estado, cfg: &Cfg) -> Value {
    let h = hoy();
    let lunes = h - Duration::days(h.weekday().num_days_from_monday() as i64 + 7);
    if cfg.texto("aviso_semana_vista") == lunes.to_string() {
        return Value::Null;
    }
    let Ok(aps) = rango(e, cfg, lunes, lunes + Duration::days(4)).await else { return Value::Null };
    let pd = por_dia(aps);
    let reglas = Reglas::desde(cfg);
    let acts = reglas.actividades_de_permiso();
    let (mut faltan, mut dias, mut total) = (Vec::new(), Vec::new(), 0.0);
    for i in 0..5 {
        let d = lunes + Duration::days(i);
        let ap = pd.get(&d.to_string()).cloned().unwrap_or_default();
        let obj = reglas.objetivo_dia(d, Some(&ap), &acts);
        let reg: f64 = ap.iter().map(|a| a.horas).sum();
        if obj > 0.0 && reg < obj - 0.001 {
            total += obj - reg;
            dias.push(d.to_string());
            faltan.push(format!("{} {} ({} de {})", DIAS_ES[i as usize].to_lowercase(), d.format("%d/%m"),
                                fmt_horas(reg), fmt_horas(obj)));
        }
    }
    if dias.is_empty() {
        return Value::Null;
    }
    json!({"lunes": lunes.to_string(), "dias": dias,
           "texto": format!("La semana pasada te faltan {}: {}.", fmt_horas(total), faltan.join(", "))})
}

fn laborables(reglas: &Reglas, anio: i32, mes: u32) -> Vec<NaiveDate> {
    let mut out = Vec::new();
    let mut d = NaiveDate::from_ymd_opt(anio, mes, 1).unwrap();
    while d.month() == mes {
        if d.weekday().num_days_from_monday() < 5 && !reglas.es_no_laborable(&d.to_string()) {
            out.push(d);
        }
        d += Duration::days(1);
    }
    out
}

/// Cierre de mes: ultimos dias laborables del mes (y primeros del siguiente).
pub async fn mes_pendiente(e: &Estado, cfg: &Cfg, h: NaiveDate) -> Value {
    if cfg.texto("aviso_mes_visto") == h.to_string() {
        return Value::Null;
    }
    let reglas = Reglas::desde(cfg);
    let lab = laborables(&reglas, h.year(), h.month());
    let (anio, mes, hasta) = if lab.len() >= DIAS_AVISO_MES && h >= lab[lab.len() - DIAS_AVISO_MES] {
        (h.year(), h.month(), h - Duration::days(1))
    } else if !lab.is_empty() && h <= lab[DIAS_AVISO_MES_SIGUIENTE.min(lab.len()) - 1] {
        let fin = NaiveDate::from_ymd_opt(h.year(), h.month(), 1).unwrap() - Duration::days(1);
        (fin.year(), fin.month(), fin)
    } else {
        return Value::Null;
    };
    let desde = NaiveDate::from_ymd_opt(anio, mes, 1).unwrap();
    if hasta < desde {
        return Value::Null;
    }
    let Ok(aps) = rango(e, cfg, desde, hasta).await else { return Value::Null };
    let pd = por_dia(aps);
    let acts = reglas.actividades_de_permiso();
    let (mut dias, mut total) = (Vec::new(), 0.0);
    let mut d = desde;
    while d <= hasta {
        let wd = d.weekday().num_days_from_monday() as usize;
        // teletrabajo con INARI: sus horas no estan en ProyectosTIC
        let con_inari = crate::inari::configurado(cfg) && reglas.es_teletrabajo(&d.to_string());
        if wd < 5 && !con_inari {
            let ap = pd.get(&d.to_string()).cloned().unwrap_or_default();
            let obj = reglas.objetivo_dia(d, Some(&ap), &acts);
            let reg: f64 = ap.iter().map(|a| a.horas).sum();
            if obj > 0.0 && reg < obj - 0.001 {
                total += obj - reg;
                dias.push(json!({"iso": d.to_string(), "texto": format!("{} {} ({} de {})",
                    DIAS_ES[wd].to_lowercase(), d.format("%d/%m"), fmt_horas(reg), fmt_horas(obj))}));
            }
        }
        d += Duration::days(1);
    }
    if dias.is_empty() {
        return Value::Null;
    }
    let cierra = if mes == h.month() { "cierra" } else { "se ha cerrado" };
    let n = dias.len();
    json!({"anio": anio, "mes": mes, "dias": dias,
           "texto": format!("{} {cierra} y te faltan {} en {n} {}:", capital(MESES[mes as usize - 1]),
                            fmt_horas(total), if n == 1 { "día" } else { "días" })})
}

pub fn guardar_visto(clave: &str, valor: &str) -> Value {
    let mut m = Map::new();
    m.insert(clave.into(), json!(valor));
    let _ = config::guardar_valores(m);
    json!({"ok": true})
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ap(wp: &str, act: &str, fecha: &str, horas: f64) -> Apunte {
        Apunte { id: "1".into(), wp_id: wp.into(), horas, wp_titulo: format!("T{wp}"), actividad: act.into(),
                 fecha: fecha.into(), ..Default::default() }
    }

    /// Paridad de la franja con Python sobre datos de verdad (tests/paridad_rust.py).
    #[test]
    #[ignore]
    fn paridad_franja() {
        let Ok(ruta) = std::env::var("FICHACSIRC_PARIDAD") else { return };
        let entrada: Value = serde_json::from_str(&std::fs::read_to_string(&ruta).unwrap()).unwrap();
        let reglas = Reglas::desde(&Cfg(entrada["config"].as_object().unwrap().clone()));
        let h = NaiveDate::parse_from_str(entrada["hoy"].as_str().unwrap(), "%Y-%m-%d").unwrap();
        let aps: Vec<Apunte> = entrada["franja_apuntes"].as_array().unwrap().iter().map(|x| Apunte {
            id: x["id"].to_string(), wp_id: x["wp_id"].as_str().unwrap_or("").into(), horas: x["horas"].as_f64().unwrap(),
            wp_titulo: x["wp_titulo"].as_str().unwrap_or("").into(), comentario: x["comentario"].as_str().unwrap_or("").into(),
            actividad: x["actividad"].as_str().unwrap_or("").into(), fecha: x["fecha"].as_str().unwrap_or("").into(),
            destino: String::new(),
        }).collect();
        let salida = franja(&reglas, Some(aps), h, &HashMap::new(), &HashMap::new());
        std::fs::write(format!("{ruta}.franja.json"), serde_json::to_string_pretty(&salida).unwrap()).unwrap();
    }

    #[test]
    fn cuadricula_del_mes() {
        // noviembre de 2026 empieza en domingo: la semana del 26/10 no tiene ningun L-V del mes
        let s = semanas_de(2026, 11);
        assert_eq!(s.first().unwrap().to_string(), "2026-11-02");
        assert_eq!(s.last().unwrap().to_string(), "2026-11-30");
        assert_eq!(s.len(), 5);
        // octubre de 2026 empieza en jueves: si entra la semana del 28/09
        assert_eq!(semanas_de(2026, 10).first().unwrap().to_string(), "2026-09-28");
    }

    #[test]
    fn habituales_como_en_python() {
        let aps = vec![ap("10", "soporte", "2026-11-02", 3.0), ap("10", "soporte", "2026-11-03", 3.0),
                       ap("10", "soporte", "2026-11-04", 2.0), ap("20", "formación", "2026-11-02", 4.0),
                       ap("", "INARI", "2026-11-05", 1.0)];
        let h = habituales(&aps, NaiveDate::from_ymd_opt(2026, 10, 1).unwrap());
        assert_eq!(h["desde"], "desde el 1 de octubre");
        assert_eq!(h["total"], "13h");
        let f = &h["filas"];
        assert_eq!((f[0]["wp_id"].as_i64(), f[0]["tipico"].as_f64(), f[0]["pct"].as_i64()), (Some(10), Some(3.0), Some(62)));
        assert_eq!(f[1]["tarea"], "T20");
        assert_eq!(f.as_array().unwrap().len(), 2);
    }
}
