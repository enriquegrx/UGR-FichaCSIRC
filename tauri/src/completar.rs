//! Por completar: los dias del año sin imputar del todo (hasta ayer) y
//! completarlos en bloque con una tarea, a cada dia lo que le falta. Port de
//! Api.por_completar y Api.completar_dias de registrar_web.py.

use crate::api::{candado, Estado};
use crate::apuntes::{dia_corto, recordar, Paso};
use crate::config::Cfg;
use crate::openproject::{self, Cliente};
use crate::reglas::{fmt_horas, redondear, Apunte, Reglas, DIAS_ES};
use chrono::{Datelike, Duration, NaiveDate};
use serde_json::{json, Value};
use std::collections::HashMap;

/// Cuantos años atras se puede mirar (como ANIOS_ATRAS_PENDIENTES).
pub const ANIOS_ATRAS: i32 = 3;

fn por_dia(aps: Vec<Apunte>) -> HashMap<String, Vec<Apunte>> {
    let mut m: HashMap<String, Vec<Apunte>> = HashMap::new();
    for a in aps {
        m.entry(a.fecha.clone()).or_default().push(a);
    }
    m
}

/// El año que se mira: el pedido, entre hace ANIOS_ATRAS años y este.
pub fn anio_valido(anio: Option<i64>, hoy: NaiveDate) -> i32 {
    let a = anio.map(|a| a as i32).unwrap_or(hoy.year());
    a.clamp(hoy.year() - ANIOS_ATRAS, hoy.year())
}

/// (desde, hasta) del año, hasta AYER; None si aun no hay ningun dia.
pub fn rango(anio: i32, hoy: NaiveDate) -> Option<(NaiveDate, NaiveDate)> {
    let desde = NaiveDate::from_ymd_opt(anio, 1, 1)?;
    let hasta = NaiveDate::from_ymd_opt(anio, 12, 31)?.min(hoy - Duration::days(1));
    (hasta >= desde).then_some((desde, hasta))
}

fn base(anio: i32, hoy: NaiveDate) -> Value {
    let hasta = NaiveDate::from_ymd_opt(anio, 12, 31).unwrap().min(hoy - Duration::days(1));
    json!({"anio": anio, "titulo": format!("Por completar · {anio}"), "dias": [], "n": 0, "falta": "0h",
           "modelo": Value::Null, "anterior": anio > hoy.year() - ANIOS_ATRAS, "siguiente": anio < hoy.year(),
           "frac": 0.0, "meses": fichas_meses(anio, hasta, &[0.0; 13], &[0.0; 13], &[0; 13], &[0.0; 13])})
}

/// Una ficha por mes: "pendiente" (con dias por completar), "completo",
/// "nolab" (sin dias laborables) o "futuro" (aun no ha empezado).
fn fichas_meses(anio: i32, hasta: NaiveDate, obj: &[f64; 13], cub: &[f64; 13], n: &[usize; 13], falta: &[f64; 13]) -> Value {
    json!((1..=12usize).map(|m| {
        let estado = if NaiveDate::from_ymd_opt(anio, m as u32, 1).unwrap() > hasta {
            "futuro"
        } else if n[m] > 0 {
            "pendiente"
        } else if obj[m] == 0.0 {
            "nolab"
        } else {
            "completo"
        };
        let frac = if obj[m] > 0.0 { redondear(cub[m] / obj[m], 3) } else if estado == "futuro" { 0.0 } else { 1.0 };
        let nombre = crate::resumen::MESES[m - 1];
        json!({"mes": m, "nombre": format!("{}{}", nombre[..1].to_uppercase(), &nombre[1..]), "estado": estado,
               "n": n[m], "falta": fmt_horas(falta[m]), "frac": frac})
    }).collect::<Vec<_>>())
}

/// La lista con los apuntes ya leidos (sin red), y los dias para la cache.
pub fn calcular(reglas: &Reglas, aps: Vec<Apunte>, anio: i32, hoy: NaiveDate, con_inari: bool)
                -> (Value, Vec<(String, Vec<Apunte>)>) {
    let mut r = base(anio, hoy);
    let Some((desde, hasta)) = rango(anio, hoy) else { return (r, Vec::new()) };
    let mut pd = por_dia(aps);
    let acts = reglas.actividades_de_permiso();
    let (mut dias, mut cache, mut total, mut modelo) = (Vec::new(), Vec::new(), 0.0, Value::Null);
    let (mut obj_mes, mut cub_mes, mut n_mes, mut falta_mes) = ([0.0f64; 13], [0.0f64; 13], [0usize; 13], [0.0f64; 13]);
    let mut d = desde;
    while d <= hasta {
        let iso = d.to_string();
        // teletrabajo con INARI: sus horas no estan en ProyectosTIC
        if d.weekday().num_days_from_monday() < 5 && !(con_inari && reglas.es_teletrabajo(&iso)) {
            let ap = pd.remove(&iso).unwrap_or_default();
            let obj = reglas.objetivo_dia(d, Some(&ap), &acts);
            let reg: f64 = ap.iter().map(|a| a.horas).sum();
            let m = d.month() as usize;
            obj_mes[m] += obj;
            cub_mes[m] += reg.min(obj); // lo de mas un dia no tapa el hueco de otro
            if obj > 0.0 && reg < obj - 0.001 {
                let falta = redondear(obj - reg, 2);
                total += falta;
                n_mes[m] += 1;
                falta_mes[m] += falta;
                dias.push(json!({
                    "iso": iso, "mes": d.month(),
                    "dia": format!("{} {}", DIAS_ES[d.weekday().num_days_from_monday() as usize], d.format("%d/%m")),
                    "reg": redondear(reg, 2), "obj": redondear(obj, 2), "falta": falta,
                    "texto": format!("{} de {}", fmt_horas(reg), fmt_horas(obj)), "falta_txt": fmt_horas(falta),
                    "vacio": ap.is_empty(), "guardia": reglas.es_guardia(&iso), "teletrabajo": reglas.es_teletrabajo(&iso)}));
                cache.push((iso, ap));
            } else if obj > 0.0 && !ap.is_empty() {
                modelo = json!(iso);
            }
        }
        d += Duration::days(1);
    }
    r["n"] = json!(dias.len());
    r["dias"] = json!(dias);
    r["falta"] = json!(fmt_horas(total));
    r["modelo"] = modelo;
    let obj_t: f64 = obj_mes.iter().sum();
    r["frac"] = json!(if obj_t > 0.0 { redondear(cub_mes.iter().sum::<f64>() / obj_t, 3) } else { 1.0 });
    r["meses"] = fichas_meses(anio, hasta, &obj_mes, &cub_mes, &n_mes, &falta_mes);
    (r, cache)
}

pub async fn por_completar(e: &Estado, cfg: &Cfg, anio: Option<i64>, hoy: NaiveDate) -> Value {
    let anio = anio_valido(anio, hoy);
    let Some((desde, hasta)) = rango(anio, hoy) else { return base(anio, hoy) };
    let leido = async {
        let cli = Cliente::desde(cfg)?;
        let uid = e.uid(&cli).await?;
        cli.entradas_rango(&uid, &desde.to_string(), &hasta.to_string()).await
    }.await;
    match leido {
        Ok(aps) => {
            let (r, dias) = calcular(&Reglas::desde(cfg), aps, anio, hoy, crate::inari::configurado(cfg));
            // completar, copiar y las plantillas saben asi lo que ya tiene cada dia
            let mut c = candado(&e.cache);
            for (iso, ap) in dias {
                c.insert(iso, Some(ap));
            }
            r
        }
        Err(err) => {
            let mut r = base(anio, hoy);
            r["error"] = openproject::diagnostico(&err).await["titulo"].clone();
            r
        }
    }
}

/// Lo que se crea en cada dia: (iso, horas, comentario). Lo que falta se
/// calcula con lo que hay AHORA en ProyectosTIC; 'saltados', los que no.
pub fn plan(reglas: &Reglas, dias: &[String], aps: Vec<Apunte>, actividad: &str, comentario: &str, con_inari: bool)
            -> (Vec<(String, f64, String)>, usize, HashMap<String, Vec<Apunte>>) {
    let mut pd = por_dia(aps);
    let acts = reglas.actividades_de_permiso();
    let guardia_auto = comentario == reglas.comentario_guardia;
    let (mut out, mut saltados, mut leidos) = (Vec::new(), 0, HashMap::new());
    for iso in dias {
        let Ok(d) = NaiveDate::parse_from_str(iso, "%Y-%m-%d") else { saltados += 1; continue };
        let ap = pd.remove(iso).unwrap_or_default();
        if d.weekday().num_days_from_monday() >= 5 || reglas.es_no_laborable(iso) || (con_inari && reglas.es_teletrabajo(iso)) {
            saltados += 1;
            continue;
        }
        // con una actividad de permiso, el objetivo es el de la jornada oficial
        let mut con_nuevo = ap.clone();
        con_nuevo.push(Apunte { actividad: actividad.to_string(), ..Default::default() });
        let obj = reglas.objetivo_dia(d, Some(&con_nuevo), &acts);
        let falta = redondear(obj - ap.iter().map(|a| a.horas).sum::<f64>(), 2);
        leidos.insert(iso.clone(), ap);
        if falta <= 0.001 {
            saltados += 1;
            continue;
        }
        let com = if reglas.es_guardia(iso) {
            if comentario.is_empty() { reglas.comentario_guardia.clone() } else { comentario.to_string() }
        } else if guardia_auto {
            String::new()
        } else {
            comentario.to_string()
        };
        out.push((iso.clone(), falta, com));
    }
    (out, saltados, leidos)
}

pub async fn completar_dias(e: &Estado, cfg: &Cfg, dias: &[String], wp_id: &str, actividad: &str, comentario: &str)
                            -> Result<Value, String> {
    let mut dias: Vec<String> = dias.to_vec();
    dias.sort();
    dias.dedup();
    if dias.is_empty() {
        return Ok(json!({"error": "Marca al menos un día."}));
    }
    if wp_id.trim().parse::<i64>().is_err() {
        return Ok(json!({"error": "Elige la tarea con la que completar."}));
    }
    let leido = async {
        let cli = Cliente::desde(cfg)?;
        let uid = e.uid(&cli).await?;
        let aps = cli.entradas_rango(&uid, &dias[0], dias.last().unwrap()).await?;
        Ok::<_, openproject::ErrorOp>((cli, aps))
    }.await;
    let (cli, aps) = match leido {
        Ok(x) => x,
        Err(err) => return Ok(json!({"error": openproject::diagnostico(&err).await["titulo"]})),
    };
    let reglas = Reglas::desde(cfg);
    let comentario = comentario.trim();
    let (plan, saltados, leidos) = plan(&reglas, &dias, aps, actividad, comentario, crate::inari::configurado(cfg));
    {
        let mut c = candado(&e.cache);
        for (iso, ap) in leidos {
            c.insert(iso, Some(ap));
        }
    }
    let (mut creados, mut errores, mut ultimo, mut horas) = (0, 0, String::new(), 0.0);
    let (mut fallidos, mut hechos, mut deshacer) = (Vec::new(), Vec::new(), Vec::new());
    for (iso, falta, com) in plan {
        match e.crear(&cli, &iso, wp_id, falta, &com, actividad).await {
            Ok(nuevo) => {
                deshacer.extend(nuevo.map(|id| Paso::Borrar { id }));
                creados += 1;
                horas += falta;
                hechos.push(iso);
            }
            Err(err) => {
                errores += 1;
                ultimo = err.to_string();
                fallidos.push(dia_corto(&iso));
            }
        }
    }
    if creados > 0 {
        recordar(cfg, wp_id, comentario, actividad, &reglas.comentario_guardia);
    }
    let texto = if creados > 1 {
        format!("completar {creados} días ({})", fmt_horas(horas))
    } else {
        format!("completar el {}", dia_corto(hechos.first().unwrap_or(&dias[0])))
    };
    let puede = e.apilar(texto, deshacer);
    Ok(json!({"creados": creados, "saltados": saltados, "errores": errores, "ultimo": ultimo,
              "fallidos": fallidos, "horas": fmt_horas(horas), "puede_deshacer": puede, "quedan": e.quedan()}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ap(fecha: &str, horas: f64) -> Apunte {
        Apunte { id: "1".into(), wp_id: "10".into(), horas, wp_titulo: "T10".into(), actividad: "soporte".into(),
                 fecha: fecha.into(), ..Default::default() }
    }

    fn reglas() -> Reglas {
        Reglas::desde(&Cfg(json!({"jornada_invierno": 7, "tiene_verano": false,
                                  "no_laborables": {"2026-10-12": "Fiesta"},
                                  "guardias": ["2026-11-04"]}).as_object().unwrap().clone()))
    }

    fn apuntes() -> Vec<Apunte> {
        vec![ap("2026-11-02", 7.0), ap("2026-11-03", 4.0), ap("2026-11-05", 7.0), ap("2026-11-06", 6.5),
             ap("2026-11-09", 7.0), ap("2026-11-10", 7.0), ap("2026-11-11", 7.0)]
    }

    /// Los mismos casos que tests/test_por_completar.py
    #[test]
    fn lista_hasta_ayer() {
        let hoy = NaiveDate::from_ymd_opt(2026, 11, 12).unwrap();
        let (r, cache) = calcular(&reglas(), apuntes(), 2026, hoy, false);
        let nov: Vec<&Value> = r["dias"].as_array().unwrap().iter().filter(|x| x["mes"] == 11).collect();
        assert_eq!(nov.iter().map(|x| x["iso"].as_str().unwrap()).collect::<Vec<_>>(),
                   vec!["2026-11-03", "2026-11-04", "2026-11-06"]);
        assert_eq!(nov[0]["falta_txt"], "3h");
        assert!(nov[1]["vacio"].as_bool().unwrap() && nov[1]["guardia"].as_bool().unwrap());
        assert_eq!(nov[2]["texto"], "6,5h de 7h");
        assert_eq!(r["modelo"], "2026-11-11");
        assert!(!r["dias"].as_array().unwrap().iter().any(|x| x["iso"] == "2026-10-12"));
        assert_eq!((r["anterior"].as_bool(), r["siguiente"].as_bool()), (Some(true), Some(false)));
        assert!(cache.iter().any(|(iso, ap)| iso == "2026-11-03" && ap.len() == 1));
        let m = &r["meses"];
        assert_eq!((m[10]["estado"].as_str(), m[10]["n"].as_u64(), m[10]["falta"].as_str()), (Some("pendiente"), Some(3), Some("10,5h")));
        assert_eq!(m[11]["estado"], "futuro");
        assert_eq!(m[10]["nombre"], "Noviembre");
        assert_eq!(m[10]["frac"].as_f64(), Some(redondear(45.5 / 56.0, 3)));
    }

    #[test]
    fn anios() {
        let hoy = NaiveDate::from_ymd_opt(2026, 11, 12).unwrap();
        assert_eq!(anio_valido(Some(2030), hoy), 2026);
        assert_eq!(anio_valido(Some(2001), hoy), 2026 - ANIOS_ATRAS);
        assert_eq!(anio_valido(None, hoy), 2026);
        assert!(rango(2026, NaiveDate::from_ymd_opt(2026, 1, 1).unwrap()).is_none());
    }

    #[test]
    fn completar_lo_que_falta() {
        let dias: Vec<String> = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-06", "2026-10-12"]
            .iter().map(|s| s.to_string()).collect();
        let (plan, saltados, _) = plan(&reglas(), &dias, apuntes(), "soporte", "", false);
        assert_eq!(saltados, 2); // el 2 ya completo y el festivo
        assert_eq!(plan, vec![("2026-11-03".to_string(), 3.0, String::new()),
                              ("2026-11-04".to_string(), 7.0, "Servicio de Guardia".to_string()),
                              ("2026-11-06".to_string(), 0.5, String::new())]);
    }
}
