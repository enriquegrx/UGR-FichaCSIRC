//! El panel de estadisticas (semana, mes o año). Port de
//! Api.estadisticas de registrar_web.py: lo que cuenta para "cumplida" llega
//! hasta hoy; las tareas y actividades, todo el periodo.

use crate::api::Estado;
use crate::config::Cfg;
use crate::openproject::{self, Cliente};
use crate::reglas::{fmt_horas, Apunte, Reglas};
use crate::resumen::MESES;
use chrono::{Datelike, Duration, NaiveDate};
use serde_json::{json, Value};
use std::collections::HashMap;

const MESES_CORTOS: [&str; 12] = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MAX_TAREAS: usize = 8;

/// Redondeo como el round() de Python (a la par en los .5)
fn redondo(x: f64) -> i64 {
    x.round_ties_even() as i64
}

/// [(clave, horas)] de mas a menos; a igualdad, por orden de aparicion (Counter.most_common).
fn mas_comunes(pares: impl Iterator<Item = (String, f64)>) -> Vec<(String, f64)> {
    let mut orden: Vec<(String, f64)> = Vec::new();
    for (k, h) in pares {
        match orden.iter_mut().find(|(x, _)| *x == k) {
            Some(e) => e.1 += h,
            None => orden.push((k, h)),
        }
    }
    orden.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    orden
}

fn ultimo_dia(anio: i32, mes: u32) -> NaiveDate {
    let (a, m) = if mes == 12 { (anio + 1, 1) } else { (anio, mes + 1) };
    NaiveDate::from_ymd_opt(a, m, 1).unwrap() - Duration::days(1)
}

/// (periodo, desde, hasta, titulo) del periodo que contiene 'r'.
pub fn periodo_de(periodo: &str, r: NaiveDate) -> (&'static str, NaiveDate, NaiveDate, String) {
    match periodo {
        "semana" => {
            let desde = r - Duration::days(r.weekday().num_days_from_monday() as i64);
            let hasta = desde + Duration::days(4);
            ("semana", desde, hasta, format!("Semana del {} al {}", desde.format("%d/%m"), hasta.format("%d/%m/%Y")))
        }
        "anio" => ("anio", NaiveDate::from_ymd_opt(r.year(), 1, 1).unwrap(), NaiveDate::from_ymd_opt(r.year(), 12, 31).unwrap(),
                   r.year().to_string()),
        _ => {
            let n = MESES[r.month0() as usize];
            ("mes", NaiveDate::from_ymd_opt(r.year(), r.month(), 1).unwrap(), ultimo_dia(r.year(), r.month()),
             format!("{}{} {}", n[..1].to_uppercase(), &n[1..], r.year()))
        }
    }
}

/// Las estadisticas con los apuntes ya leidos (sin red: para compararlas con Python).
pub fn calcular(reglas: &Reglas, aps: &[Apunte], periodo: &str, r: NaiveDate, hoy: NaiveDate, con_inari: bool) -> Value {
    let (periodo, desde, hasta, titulo) = periodo_de(periodo, r);
    let mut por_dia: HashMap<String, Vec<Apunte>> = HashMap::new();
    for a in aps {
        por_dia.entry(a.fecha.clone()).or_default().push(a.clone());
    }
    let acts = reglas.actividades_de_permiso();
    let (mut obj_total, mut reg_hoy, mut exceso, mut faltan, mut permisos) = (0.0, 0.0, 0.0, 0.0, 0.0);
    let (mut dias_lab, mut incompletos, mut racha, mut tele, mut guardias) = (0, 0, 0, 0, 0);
    let (mut obj_mes, mut reg_mes) = ([0.0f64; 13], [0.0f64; 13]);
    let mut d = desde;
    while d <= hasta {
        let iso = d.to_string();
        let ap = por_dia.get(&iso).cloned().unwrap_or_default();
        let reg: f64 = ap.iter().map(|a| a.horas).sum();
        reg_mes[d.month() as usize] += reg;
        if d.weekday().num_days_from_monday() < 5 && d <= hoy {
            tele += reglas.es_teletrabajo(&iso) as i64;
            guardias += reglas.es_guardia(&iso) as i64;
            if !reglas.es_no_laborable(&iso) {
                permisos += reglas.horas_permiso(&iso);
            }
            // teletrabajo con INARI: sus horas no estan en ProyectosTIC
            if !(con_inari && reglas.es_teletrabajo(&iso)) {
                let obj = reglas.objetivo_dia(d, Some(&ap), &acts);
                obj_mes[d.month() as usize] += obj;
                obj_total += obj;
                reg_hoy += reg;
                exceso += (reg - obj).max(0.0);
                if obj > 0.0 {
                    dias_lab += 1;
                    if reg < obj - 0.001 {
                        incompletos += 1;
                        faltan += obj - reg;
                        racha = 0;
                    } else {
                        racha += 1;
                    }
                }
            }
        }
        d += Duration::days(1);
    }
    let total: f64 = aps.iter().map(|a| a.horas).sum();
    let pct = |h: f64| if total > 0.0 { redondo(100.0 * h / total) } else { 0 };
    let nombres: HashMap<String, String> = aps.iter()
        .map(|a| (if a.wp_id.is_empty() { a.wp_titulo.clone() } else { a.wp_id.clone() }, a.wp_titulo.clone())).collect();
    let por_tarea = mas_comunes(aps.iter().map(|a| (if a.wp_id.is_empty() { a.wp_titulo.clone() } else { a.wp_id.clone() }, a.horas)));
    let mut tareas: Vec<Value> = por_tarea.iter().take(MAX_TAREAS).map(|(k, h)| json!({
        "wp_id": k, "nombre": nombres[k], "horas": crate::reglas::redondear(*h, 2), "horas_txt": fmt_horas(*h), "pct": pct(*h)})).collect();
    let otras = total - tareas.iter().map(|t| t["horas"].as_f64().unwrap_or(0.0)).sum::<f64>();
    if por_tarea.len() > MAX_TAREAS && otras > 0.001 {
        tareas.push(json!({"wp_id": "", "nombre": format!("Otras {}", por_tarea.len() - MAX_TAREAS),
                           "horas": crate::reglas::redondear(otras, 2), "horas_txt": fmt_horas(otras), "pct": pct(otras)}));
    }
    let actividades: Vec<Value> = mas_comunes(aps.iter().map(|a| {
        (if a.actividad.is_empty() { "Sin actividad".to_string() } else { a.actividad.clone() }, a.horas)
    })).iter().map(|(k, h)| json!({"nombre": k, "horas_txt": fmt_horas(*h), "pct": pct(*h)})).collect();
    let mut meses = Vec::new();
    if periodo == "anio" {
        for m in 1..=12u32 {
            let estado = if NaiveDate::from_ymd_opt(r.year(), m, 1).unwrap() > hoy {
                "futuro"
            } else if obj_mes[m as usize] == 0.0 {
                "nolab"
            } else if reg_mes[m as usize] >= obj_mes[m as usize] - 0.001 {
                "completo"
            } else {
                "parcial"
            };
            meses.push(json!({"mes": MESES_CORTOS[m as usize - 1], "reg": crate::reglas::redondear(reg_mes[m as usize], 2),
                              "obj": crate::reglas::redondear(obj_mes[m as usize], 2), "estado": estado,
                              "texto": format!("{} de {}", fmt_horas(reg_mes[m as usize]), fmt_horas(obj_mes[m as usize]))}));
        }
    }
    permisos += aps.iter().filter(|a| acts.contains(&a.actividad.trim().to_lowercase())).map(|a| a.horas).sum::<f64>();
    json!({
        "periodo": periodo, "titulo": titulo, "desde": desde.to_string(), "hasta": hasta.to_string(),
        "total": fmt_horas(total),
        "cumplida": if obj_total > 0.0 { json!(redondo(100.0 * reg_hoy / obj_total)) } else { Value::Null },
        "media": if dias_lab > 0 { fmt_horas(reg_hoy / dias_lab as f64) } else { "—".into() },
        "exceso": fmt_horas(exceso), "tareas": tareas, "actividades": actividades, "meses": meses,
        "detalles": {"racha": racha, "teletrabajo": tele, "guardias": guardias, "incompletos": incompletos,
                     "faltan": fmt_horas(faltan), "permisos": fmt_horas(permisos)},
    })
}

pub async fn estadisticas(e: &Estado, cfg: &Cfg, periodo: &str, referencia: &str, hoy: NaiveDate) -> Value {
    let r = NaiveDate::parse_from_str(referencia, "%Y-%m-%d").unwrap_or(hoy);
    let (_, desde, hasta, _) = periodo_de(periodo, r);
    let leido = async {
        let cli = Cliente::desde(cfg)?;
        let uid = e.uid(&cli).await?;
        cli.entradas_rango(&uid, &desde.to_string(), &hasta.to_string()).await
    }.await;
    match leido {
        Ok(aps) => calcular(&Reglas::desde(cfg), &aps, periodo, r, hoy, crate::inari::configurado(cfg)),
        Err(err) => json!({"error": openproject::diagnostico(&err).await["titulo"]}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ap(fecha: &str, wp: &str, horas: f64) -> Apunte {
        Apunte { id: "1".into(), wp_id: wp.into(), horas, wp_titulo: format!("T{wp}"), actividad: "soporte".into(),
                 fecha: fecha.into(), ..Default::default() }
    }

    /// Paridad con Python sobre datos de verdad (tests/paridad_rust.py).
    #[test]
    #[ignore]
    fn paridad_estadisticas() {
        let Ok(ruta) = std::env::var("FICHACSIRC_PARIDAD") else { return };
        let entrada: Value = serde_json::from_str(&std::fs::read_to_string(&ruta).unwrap()).unwrap();
        let cfg = Cfg(entrada["config"].as_object().unwrap().clone());
        let hoy = NaiveDate::parse_from_str(entrada["hoy"].as_str().unwrap(), "%Y-%m-%d").unwrap();
        let aps: Vec<Apunte> = entrada["franja_apuntes"].as_array().unwrap().iter().map(|x| Apunte {
            id: x["id"].to_string(), wp_id: x["wp_id"].as_str().unwrap_or("").into(), horas: x["horas"].as_f64().unwrap(),
            wp_titulo: x["wp_titulo"].as_str().unwrap_or("").into(), comentario: x["comentario"].as_str().unwrap_or("").into(),
            actividad: x["actividad"].as_str().unwrap_or("").into(), fecha: x["fecha"].as_str().unwrap_or("").into(),
            destino: String::new(),
        }).collect();
        let salida: Vec<Value> = ["semana", "mes"].iter().map(|p| {
            let (_, desde, hasta, _) = periodo_de(p, hoy);
            let del_periodo: Vec<Apunte> = aps.iter().filter(|a| a.fecha >= desde.to_string() && a.fecha <= hasta.to_string()).cloned().collect();
            calcular(&Reglas::desde(&cfg), &del_periodo, p, hoy, hoy, crate::inari::configurado(&cfg))
        }).collect();
        std::fs::write(format!("{ruta}.estadisticas.json"), serde_json::to_string_pretty(&salida).unwrap()).unwrap();
    }

    #[test]
    fn periodos() {
        let r = NaiveDate::from_ymd_opt(2026, 11, 4).unwrap();
        assert_eq!(periodo_de("semana", r).3, "Semana del 02/11 al 06/11/2026");
        assert_eq!(periodo_de("mes", r).3, "Noviembre 2026");
        assert_eq!(periodo_de("anio", r).3, "2026");
    }

    #[test]
    fn semana_como_python() {
        let reglas = Reglas::desde(&Cfg(json!({"jornada_invierno": 7}).as_object().unwrap().clone()));
        let aps = vec![ap("2026-11-02", "10", 7.0), ap("2026-11-03", "10", 5.0), ap("2026-11-03", "20", 3.0),
                       ap("2026-11-04", "20", 7.0), ap("2026-11-05", "10", 4.0), ap("2026-11-06", "30", 7.0)];
        let hoy = NaiveDate::from_ymd_opt(2026, 11, 12).unwrap();
        let r = calcular(&reglas, &aps, "semana", NaiveDate::from_ymd_opt(2026, 11, 4).unwrap(), hoy, false);
        assert_eq!(r["total"], "33h");
        assert_eq!(r["cumplida"], 94);
        assert_eq!(r["exceso"], "1h");
        assert_eq!(r["detalles"]["incompletos"], 1);
        assert_eq!(r["detalles"]["racha"], 1);
        assert_eq!(r["tareas"][0]["nombre"], "T10");
        assert_eq!(r["tareas"][0]["horas_txt"], "16h");
        assert_eq!(redondo(12.5), 12);
    }
}
