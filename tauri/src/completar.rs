//! Por completar: los dias del año sin imputar del todo (hasta ayer) y
//! completarlos en bloque con una tarea (o repartido entre varias), a cada
//! dia lo que le falta; los dias en que te pasas; y buscar en los apuntes del
//! año. Port de Api.por_completar, Api.completar_dias y Api.buscar_apuntes de
//! registrar_web.py.

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

/// Reparte 'falta' horas segun 'pesos' (p. ej. [70, 30]) a cuartos de hora;
/// lo que deje el redondeo va a la ultima, para que sume justo lo que falta.
pub fn repartir(falta: f64, pesos: &[f64]) -> Vec<f64> {
    let total: f64 = pesos.iter().sum();
    let mut resto = redondear(falta, 2);
    let mut out = Vec::new();
    for (i, p) in pesos.iter().enumerate() {
        let h = if i == pesos.len() - 1 { resto } else { resto.min((falta * p / total * 4.0 + 0.5).floor() / 4.0) };
        let h = redondear(h.max(0.0), 2);
        out.push(h);
        resto = redondear(resto - h, 2);
    }
    out
}

/// Sin tildes ni mayusculas (para buscar).
fn normal(s: &str) -> String {
    crate::herramientas::sin_tildes(s)
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
           "frac": 0.0, "meses": fichas_meses(anio, hasta, &[0.0; 13], &[0.0; 13], &[0; 13], &[0.0; 13]),
           "excesos": [], "n_excesos": 0, "sobra": "0h"})
}

fn nombre_dia(d: NaiveDate) -> String {
    format!("{} {}", DIAS_ES[d.weekday().num_days_from_monday() as usize], d.format("%d/%m"))
}

/// Un dia en que te pasas: a menudo, un apunte repetido.
fn exceso(reglas: &Reglas, d: NaiveDate, ap: &[Apunte], reg: f64, obj: f64) -> Value {
    let iso = d.to_string();
    let mut veces: HashMap<(String, String), usize> = HashMap::new();
    for a in ap {
        *veces.entry((a.wp_id.clone(), a.actividad.clone())).or_default() += 1;
    }
    let motivo = if obj > 0.0 { String::new() } else { Some(reglas.motivo(&iso)).filter(|m| !m.is_empty()).unwrap_or("permiso".into()) };
    json!({"iso": iso, "mes": d.month(), "dia": nombre_dia(d), "reg": redondear(reg, 2), "obj": redondear(obj, 2),
           "sobra": redondear(reg - obj, 2), "sobra_txt": fmt_horas(reg - obj),
           "texto": format!("{} de {}", fmt_horas(reg), fmt_horas(obj)), "nolab": obj == 0.0, "motivo": motivo,
           "duplicado": veces.values().any(|n| *n > 1),
           // repetido: la misma tarea y actividad mas de una vez ese dia;
           // justo: quitandolo, el dia queda en su jornada exacta
           "apuntes": ap.iter().map(|a| json!({
               "id": a.id, "tarea": a.wp_titulo, "horas": a.horas, "horas_txt": fmt_horas(a.horas),
               "actividad": a.actividad, "comentario": a.comentario,
               "repetido": veces[&(a.wp_id.clone(), a.actividad.clone())] > 1,
               "justo": (a.horas - (reg - obj)).abs() < 0.001})).collect::<Vec<_>>()})
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
    let mut excesos: Vec<Value> = Vec::new();
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
                cache.push((iso.clone(), ap.clone()));
            } else if obj > 0.0 && !ap.is_empty() && reg <= obj + 0.001 {
                modelo = json!(iso);
            }
            // te pasas: mas que la jornada (o horas en un dia no laborable que no es de guardia)
            if !ap.is_empty() && reg > obj + 0.001 && (obj > 0.0 || !reglas.es_guardia(&iso)) {
                excesos.push(exceso(reglas, d, &ap, reg, obj));
                // en la cache: quitar un apunte desde la lista se puede deshacer
                cache.push((iso.clone(), ap.clone()));
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
    let sobra: f64 = excesos.iter().filter_map(|x| x["sobra"].as_f64()).sum();
    r["n_excesos"] = json!(excesos.len());
    r["sobra"] = json!(fmt_horas(sobra));
    r["excesos"] = json!(excesos);
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

/// Una parte del reparto: (tarea, actividad, peso).
pub type Parte = (String, String, f64);

/// Lo que se crea en cada dia: (iso, [(tarea, actividad, horas)], comentario).
/// Lo que falta se calcula con lo que hay AHORA en ProyectosTIC; 'saltados',
/// los dias que no.
pub fn plan(reglas: &Reglas, dias: &[String], aps: Vec<Apunte>, partes: &[Parte], comentario: &str, con_inari: bool)
            -> (Vec<(String, Vec<(String, String, f64)>, String)>, usize, HashMap<String, Vec<Apunte>>) {
    let mut pd = por_dia(aps);
    let acts = reglas.actividades_de_permiso();
    let guardia_auto = comentario == reglas.comentario_guardia;
    let pesos: Vec<f64> = partes.iter().map(|p| p.2).collect();
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
        con_nuevo.extend(partes.iter().map(|p| Apunte { actividad: p.1.clone(), ..Default::default() }));
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
        let trozos: Vec<(String, String, f64)> = partes.iter().zip(repartir(falta, &pesos))
            .filter(|(_, h)| *h > 0.001).map(|(p, h)| (p.0.clone(), p.1.clone(), h)).collect();
        out.push((iso.clone(), trozos, com));
    }
    (out, saltados, leidos)
}

/// Las partes del reparto (o la tarea sola); None si falta la tarea.
pub fn partes_de(wp_id: &str, actividad: &str, reparto: &[Value]) -> Option<Vec<Parte>> {
    let txt = |v: &Value| match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    };
    let crudas: Vec<(String, String, f64)> = if reparto.is_empty() {
        vec![(wp_id.trim().to_string(), actividad.to_string(), 1.0)]
    } else {
        reparto.iter().map(|p| (txt(&p["wp_id"]), txt(&p["actividad"]),
                                 p["peso"].as_f64().or_else(|| txt(&p["peso"]).parse().ok()).unwrap_or(0.0))).collect()
    };
    if crudas.iter().any(|(wp, _, _)| wp.parse::<i64>().is_err()) {
        return None;
    }
    let partes: Vec<Parte> = crudas.into_iter().filter(|p| p.2 > 0.0).collect();
    (!partes.is_empty()).then_some(partes)
}

pub async fn completar_dias(e: &Estado, cfg: &Cfg, dias: &[String], wp_id: &str, actividad: &str, comentario: &str,
                            reparto: &[Value]) -> Result<Value, String> {
    let mut dias: Vec<String> = dias.to_vec();
    dias.sort();
    dias.dedup();
    if dias.is_empty() {
        return Ok(json!({"error": "Marca al menos un día."}));
    }
    let Some(partes) = partes_de(wp_id, actividad, reparto) else {
        return Ok(json!({"error": "Elige la tarea con la que completar."}));
    };
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
    let (plan, saltados, leidos) = plan(&reglas, &dias, aps, &partes, comentario, crate::inari::configurado(cfg));
    {
        let mut c = candado(&e.cache);
        for (iso, ap) in leidos {
            c.insert(iso, Some(ap));
        }
    }
    let (mut creados, mut n_apuntes, mut errores, mut ultimo, mut horas) = (0, 0, 0, String::new(), 0.0);
    let (mut fallidos, mut hechos, mut deshacer) = (Vec::<String>::new(), Vec::new(), Vec::new());
    for (iso, trozos, com) in plan {
        let mut hecho = false;
        for (wp, act, h) in trozos {
            match e.crear(&cli, &iso, &wp, h, &com, &act).await {
                Ok(nuevo) => {
                    deshacer.extend(nuevo.map(|id| Paso::Borrar { id }));
                    n_apuntes += 1;
                    horas += h;
                    hecho = true;
                }
                Err(err) => {
                    errores += 1;
                    ultimo = err.to_string();
                    let dc = dia_corto(&iso);
                    if !fallidos.contains(&dc) {
                        fallidos.push(dc);
                    }
                }
            }
        }
        if hecho {
            creados += 1;
            hechos.push(iso);
        }
    }
    if creados > 0 {
        for (wp, act, _) in &partes {
            recordar(cfg, wp, comentario, act, &reglas.comentario_guardia);
        }
    }
    let mut texto = if creados > 1 {
        format!("completar {creados} días ({})", fmt_horas(horas))
    } else {
        format!("completar el {}", dia_corto(hechos.first().unwrap_or(&dias[0])))
    };
    if partes.len() > 1 {
        texto.push_str(&format!(" entre {} tareas", partes.len()));
    }
    let puede = e.apilar(texto, deshacer);
    Ok(json!({"creados": creados, "apuntes": n_apuntes, "saltados": saltados, "errores": errores, "ultimo": ultimo,
              "fallidos": fallidos, "horas": fmt_horas(horas), "puede_deshacer": puede, "quedan": e.quedan()}))
}

pub const MAX_BUSQUEDA: usize = 300;

/// Los apuntes cuyo comentario, tarea, actividad o fecha (dd/mm) contienen
/// TODAS las palabras (sin tildes ni mayusculas); los mas recientes primero.
pub fn filtrar(aps: &[Apunte], texto: &str, anio: i32) -> Value {
    let palabras: Vec<String> = normal(texto).split_whitespace().map(String::from).collect();
    let mut out: Vec<(String, Value, f64)> = Vec::new();
    if palabras.concat().chars().count() >= 2 {
        for a in aps {
            let Ok(d) = NaiveDate::parse_from_str(&a.fecha, "%Y-%m-%d") else { continue };
            let heno = normal(&format!("{} {} {} {} {} {}", a.wp_titulo, a.wp_id, a.actividad, a.comentario,
                                       d.format("%d/%m"), DIAS_ES[d.weekday().num_days_from_monday() as usize]));
            if palabras.iter().all(|p| heno.contains(p.as_str())) {
                out.push((a.fecha.clone(), json!({"iso": a.fecha, "dia": nombre_dia(d), "horas": a.horas, "horas_txt": fmt_horas(a.horas),
                                                  "tarea": a.wp_titulo, "actividad": a.actividad, "comentario": a.comentario}), a.horas));
            }
        }
    }
    // estable: a igual fecha, en el orden en que llegaron (como sort de Python)
    out.sort_by(|x, y| y.0.cmp(&x.0));
    let total: f64 = out.iter().map(|x| x.2).sum();
    let n = out.len();
    json!({"anio": anio, "resultados": out.into_iter().take(MAX_BUSQUEDA).map(|x| x.1).collect::<Vec<_>>(),
           "n": n, "total": fmt_horas(total), "recortado": n > MAX_BUSQUEDA})
}

pub async fn buscar_apuntes(e: &Estado, cfg: &Cfg, texto: &str, anio: Option<i64>, hoy: NaiveDate) -> Value {
    let anio = anio.map(|a| a as i32).unwrap_or(hoy.year());
    let vacio = filtrar(&[], "", anio);
    if normal(texto).split_whitespace().collect::<String>().chars().count() < 2 {
        return vacio;
    }
    let (Some(desde), Some(fin)) = (NaiveDate::from_ymd_opt(anio, 1, 1), NaiveDate::from_ymd_opt(anio, 12, 31)) else { return vacio };
    let hasta = fin.min(hoy);
    if hasta < desde {
        return vacio;
    }
    let leido = async {
        let cli = Cliente::desde(cfg)?;
        let uid = e.uid(&cli).await?;
        cli.entradas_rango(&uid, &desde.to_string(), &hasta.to_string()).await
    }.await;
    match leido {
        Ok(aps) => filtrar(&aps, texto, anio),
        Err(err) => {
            let mut r = vacio;
            r["error"] = openproject::diagnostico(&err).await["titulo"].clone();
            r
        }
    }
}

pub const MAX_COMENTARIOS: usize = 8;
pub const DIAS_COMENTARIOS: i64 = 365;

/// {wp_id: [comentarios]}: los ultimos comentarios distintos usados con cada
/// tarea, el mas reciente primero (el desplegable del campo Comentario). No
/// cuentan los vacios ni el de guardia, y dos que solo se diferencian en
/// mayusculas, tildes o espacios son el mismo.
pub fn comentarios_por_tarea(aps: &[Apunte], guardia: &str, maximo: usize) -> Value {
    let limpio = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    let guardia = limpio(guardia);
    let mut orden: Vec<&Apunte> = aps.iter().collect();
    // estable: a igual fecha, en el orden en que llegaron (como sort de Python)
    orden.sort_by(|x, y| y.fecha.cmp(&x.fecha));
    let mut out = serde_json::Map::new();
    let mut vistos = std::collections::HashSet::new();
    for a in orden {
        let com = limpio(&a.comentario);
        if a.wp_id.is_empty() || com.is_empty() || com == guardia {
            continue;
        }
        let Some(lista) = out.entry(a.wp_id.clone()).or_insert_with(|| json!([])).as_array_mut() else { continue };
        if lista.len() >= maximo || !vistos.insert((a.wp_id.clone(), normal(&com))) {
            continue;
        }
        lista.push(Value::String(com));
    }
    Value::Object(out)
}

/// Los comentarios usados con cada tarea en el ultimo año. Una consulta por
/// rango; es una ayuda: sin conexion no hay sugerencias, y no se avisa.
pub async fn comentarios_tareas(e: &Estado, cfg: &Cfg, hoy: NaiveDate) -> Value {
    let desde = hoy - Duration::days(DIAS_COMENTARIOS);
    let leido = async {
        let cli = Cliente::desde(cfg)?;
        let uid = e.uid(&cli).await?;
        cli.entradas_rango(&uid, &desde.to_string(), &hoy.to_string()).await
    }.await;
    match leido {
        Ok(aps) => json!({"por_tarea": comentarios_por_tarea(&aps, &Reglas::desde(cfg).comentario_guardia, MAX_COMENTARIOS)}),
        Err(_) => json!({"por_tarea": {}}),
    }
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
        let partes = partes_de("20", "soporte", &[]).unwrap();
        let (plan, saltados, _) = plan(&reglas(), &dias, apuntes(), &partes, "", false);
        assert_eq!(saltados, 2); // el 2 ya completo y el festivo
        let t = |h: f64| vec![("20".to_string(), "soporte".to_string(), h)];
        assert_eq!(plan, vec![("2026-11-03".to_string(), t(3.0), String::new()),
                              ("2026-11-04".to_string(), t(7.0), "Servicio de Guardia".to_string()),
                              ("2026-11-06".to_string(), t(0.5), String::new())]);
    }

    /// Los mismos casos que test_repartir_a_cuartos y test_completar_repartido
    #[test]
    fn repartido() {
        assert_eq!(repartir(7.0, &[70.0, 30.0]), vec![5.0, 2.0]);
        assert_eq!(repartir(3.0, &[1.0, 1.0, 1.0]), vec![1.0, 1.0, 1.0]);
        assert_eq!(repartir(0.5, &[70.0, 30.0]), vec![0.25, 0.25]);
        assert_eq!(repartir(0.25, &[50.0, 50.0]), vec![0.25, 0.0]);
        assert!((repartir(6.5, &[60.0, 25.0, 15.0]).iter().sum::<f64>() - 6.5).abs() < 1e-9);
        let partes = partes_de("", "", &[json!({"wp_id": "20", "actividad": "Soporte", "peso": 70}),
                                         json!({"wp_id": 30, "actividad": "Formación", "peso": 30})]).unwrap();
        let dias = vec!["2026-11-03".to_string(), "2026-11-04".to_string()];
        let (plan, _, _) = plan(&reglas(), &dias, apuntes(), &partes, "", false);
        let horas: Vec<Vec<f64>> = plan.iter().map(|(_, t, _)| t.iter().map(|x| x.2).collect()).collect();
        assert_eq!(horas, vec![vec![2.0, 1.0], vec![5.0, 2.0]]);
        assert!(partes_de("", "", &[json!({"wp_id": "x", "peso": 1})]).is_none());
    }

    #[test]
    fn comentarios_de_cada_tarea() {
        let con = |fecha: &str, wp: &str, com: &str| Apunte { wp_id: wp.into(), comentario: com.into(), ..ap(fecha, 1.0) };
        let aps = vec![con("2026-11-02", "10", "Revisión de copias"), con("2026-11-05", "10", "Parches"),
                       con("2026-11-09", "10", "revision  de copias"),       // el mismo, mas reciente
                       con("2026-11-10", "10", ""), con("2026-11-11", "10", "Servicio de Guardia"),
                       con("2026-11-03", "20", "Curso")];
        let r = comentarios_por_tarea(&aps, "Servicio de Guardia", MAX_COMENTARIOS);
        assert_eq!(r, json!({"10": ["revision de copias", "Parches"], "20": ["Curso"]}));
        assert_eq!(comentarios_por_tarea(&aps, "", 1)["10"], json!(["Servicio de Guardia"]));
    }

    #[test]
    fn excesos_y_buscar() {
        let hoy = NaiveDate::from_ymd_opt(2026, 11, 12).unwrap();
        let mut aps = apuntes();
        aps.push(ap("2026-11-10", 2.0));
        aps.push(ap("2026-10-12", 3.0));
        let (r, _) = calcular(&reglas(), aps.clone(), 2026, hoy, false);
        let ex = r["excesos"].as_array().unwrap();
        assert_eq!(ex.iter().map(|x| x["iso"].as_str().unwrap()).collect::<Vec<_>>(), vec!["2026-10-12", "2026-11-10"]);
        assert_eq!((ex[1]["sobra_txt"].as_str(), ex[1]["texto"].as_str(), ex[1]["duplicado"].as_bool()),
                   (Some("2h"), Some("9h de 7h"), Some(true)));
        assert!(ex[0]["nolab"].as_bool().unwrap());
        assert_eq!((r["n_excesos"].as_u64(), r["sobra"].as_str()), (Some(2), Some("5h")));
        assert_eq!(r["modelo"], "2026-11-11");
        // que apunte sobra: los dos son la misma tarea; quitando el de 2h queda justo
        let a = ex[1]["apuntes"].as_array().unwrap();
        assert_eq!(a.iter().map(|x| (x["repetido"].as_bool(), x["justo"].as_bool())).collect::<Vec<_>>(),
                   vec![(Some(true), Some(false)), (Some(true), Some(true))]);
        aps[1].comentario = "Renovación del certificado SSL".into();
        let b = filtrar(&aps, "certificado renovacion", 2026);
        assert_eq!((b["n"].as_u64(), b["resultados"][0]["iso"].as_str(), b["total"].as_str()), (Some(1), Some("2026-11-03"), Some("4h")));
        assert_eq!(filtrar(&aps, "t10", 2026)["resultados"][0]["iso"], "2026-11-11");
        assert_eq!(filtrar(&aps, "05/11", 2026)["n"], 1);
        assert_eq!(filtrar(&aps, " ", 2026)["n"], 0);
    }
}
