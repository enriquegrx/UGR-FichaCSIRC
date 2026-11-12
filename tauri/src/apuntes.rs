//! Fichar: añadir, editar, editar un dia entero, borrar, mover y Deshacer en
//! varios niveles. Port de la clase Api de registrar_web.py (comprobar,
//! anadir, editar, guardar_dia, eliminar, mover_apunte, deshacer): mismos
//! avisos, mismos textos y misma forma de las respuestas.

use crate::api::{candado, Estado};
use crate::config::{self, Cfg};
use crate::openproject::{elegir_actividad, Cliente, ErrorOp};
use crate::reglas::{fmt_horas, Apunte, Reglas, DIAS_ES};
use chrono::{Datelike, NaiveDate};
use serde_json::{json, Map, Value};

pub const MAX_DESHACER: usize = 20;

/// Lo contrario de algo que se hizo, para deshacerlo.
#[derive(Clone, Debug, PartialEq)]
pub enum Paso {
    /// se creo: deshacer = borrarlo
    Borrar { id: String },
    /// se borro: deshacer = volver a crearlo (con otro id)
    Crear { fecha: String, wp_id: String, horas: f64, comentario: String, actividad: String, id_original: String },
    /// se edito: deshacer = devolverle lo que tenia
    Editar { id: String, horas: f64, comentario: String, actividad: String, wp_id: String },
}

#[derive(Clone, Debug)]
pub struct Accion {
    pub texto: String,
    pub pasos: Vec<Paso>,
}

/// "3", "3,5", 3.5 -> 3.5
pub fn horas_de(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().replace(',', ".").parse().ok(),
        _ => None,
    }
    .filter(|h: &f64| h.is_finite())
}

fn texto_de(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn nombre_dia(iso: &str) -> String {
    match NaiveDate::parse_from_str(iso, "%Y-%m-%d") {
        Ok(d) => format!("{} {}", DIAS_ES[d.weekday().num_days_from_monday() as usize], d.format("%d/%m")),
        Err(_) => iso.to_string(),
    }
}

/// "martes 10/11" para los textos de Deshacer.
fn dia_corto(iso: &str) -> String {
    let n = nombre_dia(iso);
    match n.split_once(' ') {
        Some((dia, resto)) => format!("{} {resto}", dia.to_lowercase()),
        None => n,
    }
}

fn cliente(cfg: &Cfg) -> Result<Cliente, String> {
    Cliente::desde(cfg).map_err(|e| e.to_string())
}

impl Estado {
    /// Apuntes cargados de ese dia; None = no se pudieron leer. Sin cargar: [].
    pub(crate) fn cargados(&self, iso: &str) -> Option<Vec<Apunte>> {
        candado(&self.cache).get(iso).cloned().unwrap_or(Some(Vec::new()))
    }

    fn apunte(&self, fecha: &str, id: &str) -> Option<Apunte> {
        self.cargados(fecha)?.into_iter().find(|a| a.id == id)
    }

    pub fn quedan(&self) -> usize {
        candado(&self.pila).len()
    }

    /// Una accion deshacible a la pila (las MAX_DESHACER ultimas).
    pub(crate) fn apilar(&self, texto: String, pasos: Vec<Paso>) -> bool {
        if pasos.is_empty() {
            return false;
        }
        let mut pila = candado(&self.pila);
        pila.push(Accion { texto, pasos });
        let sobran = pila.len().saturating_sub(MAX_DESHACER);
        pila.drain(..sobran);
        true
    }

    /// Un apunte borrado y recreado al deshacer tiene OTRO id en ProyectosTIC:
    /// los pasos mas antiguos que lo nombran usan el nuevo (puede haber cadena).
    fn id_actual(&self, id: &str) -> String {
        let ids = candado(&self.ids);
        let mut s = id.to_string();
        let mut vistos = std::collections::HashSet::new();
        while let Some(n) = ids.get(&s) {
            if !vistos.insert(s.clone()) {
                break;
            }
            s = n.clone();
        }
        s
    }

    /// href de la actividad en esa tarea (None si no hay o no existe en ella).
    async fn href(&self, cli: &Cliente, wp_id: &str, actividad: &str) -> Result<Option<String>, ErrorOp> {
        if actividad.trim().is_empty() {
            return Ok(None);
        }
        let guardadas = candado(&self.actividades).get(wp_id).cloned();
        let acts = match guardadas {
            Some(a) => a,
            None => {
                let a = cli.actividades_href(wp_id).await?;
                candado(&self.actividades).insert(wp_id.to_string(), a.clone());
                a
            }
        };
        Ok(elegir_actividad(&acts, actividad).map(String::from))
    }

    pub(crate) async fn crear(&self, cli: &Cliente, fecha: &str, wp_id: &str, horas: f64, comentario: &str, actividad: &str)
                   -> Result<Option<String>, ErrorOp> {
        let href = self.href(cli, wp_id, actividad).await?;
        cli.crear(fecha, wp_id, horas, comentario, href.as_deref()).await
    }

    async fn actualizar(&self, cli: &Cliente, id: &str, horas: f64, comentario: &str, actividad: &str, wp_id: &str)
                        -> Result<(), ErrorOp> {
        let href = if wp_id.is_empty() { None } else { self.href(cli, wp_id, actividad).await? };
        cli.actualizar(id, horas, comentario, href.as_deref()).await
    }

    /// Borra un apunte y devuelve el paso para deshacerlo.
    async fn borrar_uno(&self, cli: &Cliente, fecha: &str, id: &str) -> Result<Option<Paso>, ErrorOp> {
        let datos = self.apunte(fecha, id);
        cli.eliminar(id).await?;
        Ok(datos.map(|a| Paso::Crear {
            fecha: fecha.to_string(), wp_id: a.wp_id, horas: a.horas, comentario: a.comentario,
            actividad: a.actividad, id_original: id.to_string(),
        }))
    }
}

/// Recordar la actividad y el comentario de la tarea (comodidad: nunca rompe nada).
fn recordar(cfg: &Cfg, wp_id: &str, comentario: &str, actividad: &str, com_guardia: &str) {
    let mut cambios = Map::new();
    if !comentario.is_empty() && comentario != com_guardia {
        let mut m = cfg.objeto("comentarios_tarea");
        m.insert(wp_id.into(), json!(comentario));
        cambios.insert("comentarios_tarea".into(), Value::Object(m));
    }
    if !actividad.is_empty() {
        let mut m = cfg.objeto("actividades_tarea");
        m.insert(wp_id.into(), json!(actividad));
        cambios.insert("actividades_tarea".into(), Value::Object(m));
        cambios.insert("ultima_actividad".into(), json!(actividad));
    }
    if !cambios.is_empty() {
        let _ = config::guardar_valores(cambios);
    }
}

/// Avisos ANTES de añadir (los mismos que la app de Python).
pub fn comprobar(e: &Estado, cfg: &Cfg, dias: &[String], wp_id: &str, horas: &Value) -> Value {
    let Some(horas) = horas_de(horas) else {
        return json!({"error": "Escribe un número de horas válido (ej. 3 o 3,5)."});
    };
    if !(horas > 0.0 && horas <= 24.0) {
        return json!({"error": "Las horas deben estar entre 0 y 24."});
    }
    if dias.is_empty() {
        return json!({"error": "Marca al menos un día."});
    }
    let reglas = Reglas::desde(cfg);
    let acts = reglas.actividades_de_permiso();
    let mut avisos = Vec::new();
    let sin_leer: Vec<String> = dias.iter().filter(|i| e.cargados(i).is_none()).map(|i| nombre_dia(i)).collect();
    if !sin_leer.is_empty() {
        avisos.push(json!({"clave": "sin_leer", "titulo": "No se pudieron leer algunos días",
            "texto": format!("No se pudieron leer los apuntes de: {}. Puede que ya tengan horas de esta tarea. ¿Añadir igualmente?", sin_leer.join(", "))}));
    }
    let nolab: Vec<String> = dias.iter().filter(|i| reglas.es_no_laborable(i))
        .map(|i| format!("{} ({})", nombre_dia(i), reglas.motivo(i))).collect();
    if !nolab.is_empty() {
        avisos.push(json!({"clave": "nolab", "titulo": "Día no laborable",
            "texto": format!("Vas a imputar horas en días no laborables: {}. ¿Continuar?", nolab.join(", "))}));
    }
    let mut repetidos = Vec::new();
    let mut exceso = Vec::new();
    for i in dias {
        let aps = e.cargados(i);
        let lista = aps.clone().unwrap_or_default();
        let ya: f64 = lista.iter().filter(|a| a.wp_id == wp_id).map(|a| a.horas).sum();
        if ya > 0.0 {
            repetidos.push(format!("{} (ya tiene {})", nombre_dia(i), fmt_horas(ya)));
        }
        if reglas.es_no_laborable(i) {
            continue;
        }
        let Ok(d) = NaiveDate::parse_from_str(i, "%Y-%m-%d") else { continue };
        let reg: f64 = lista.iter().map(|a| a.horas).sum();
        let obj = reglas.objetivo_dia(d, aps.as_deref(), &acts);
        if reg + horas > obj + 0.001 {
            exceso.push(format!("{} ({} de {})", nombre_dia(i), fmt_horas(reg + horas), fmt_horas(obj)));
        }
    }
    if !repetidos.is_empty() {
        avisos.push(json!({"clave": "repetir", "titulo": "Esa tarea ya tiene horas ese día",
            "texto": format!("Ya hay horas de esta tarea en: {}. ¿Añadir {} más? (Si dices que no, esos días se dejan como están.)",
                             repetidos.join(", "), fmt_horas(horas))}));
    }
    if !exceso.is_empty() {
        avisos.push(json!({"clave": "exceso", "titulo": "Jornada superada",
            "texto": format!("Con este apunte te pasarás de la jornada en: {}. ¿Continuar?", exceso.join(", "))}));
    }
    json!({"avisos": avisos})
}

pub async fn anadir(e: &Estado, cfg: &Cfg, dias: &[String], wp_id: &str, horas: &Value, comentario: &str,
                    actividad: &str, permitir_repetir: bool) -> Result<Value, String> {
    let horas = horas_de(horas).ok_or("Escribe un número de horas válido.")?;
    let cli = cliente(cfg)?;
    let reglas = Reglas::desde(cfg);
    let comentario = comentario.trim();
    let com_guardia = reglas.comentario_guardia.clone();
    let guardia_auto = comentario == com_guardia;
    let (mut creados, mut saltados, mut errores, mut ultimo) = (0, 0, 0, String::new());
    let mut deshacer = Vec::new();
    for iso in dias {
        let existentes = e.cargados(iso).unwrap_or_default();
        if !permitir_repetir && existentes.iter().any(|a| a.wp_id == wp_id) {
            saltados += 1;
            continue;
        }
        let com = if reglas.es_guardia(iso) {
            if comentario.is_empty() { com_guardia.clone() } else { comentario.to_string() }
        } else if guardia_auto {
            String::new()
        } else {
            comentario.to_string()
        };
        match e.crear(&cli, iso, wp_id, horas, &com, actividad).await {
            Ok(nuevo) => {
                if let Some(id) = nuevo {
                    deshacer.push(Paso::Borrar { id });
                }
                creados += 1;
            }
            Err(err) => {
                errores += 1;
                ultimo = err.to_string();
            }
        }
    }
    if creados > 0 {
        recordar(cfg, wp_id, comentario, actividad, &com_guardia);
    }
    let texto = if creados > 1 {
        format!("añadir {} a {creados} día(s)", fmt_horas(horas))
    } else {
        format!("añadir {} al {}", fmt_horas(horas), dias.first().map(|d| dia_corto(d)).unwrap_or_default())
    };
    let puede = e.apilar(texto, deshacer);
    Ok(json!({"creados": creados, "saltados": saltados, "errores": errores, "ultimo": ultimo,
              "puede_deshacer": puede, "quedan": e.quedan()}))
}

/// items: [{id, fecha, destino}]
pub async fn eliminar(e: &Estado, cfg: &Cfg, items: &[Value]) -> Result<Value, String> {
    let cli = cliente(cfg)?;
    let (mut n_ok, mut errores, mut ultimo) = (0, 0, String::new());
    let mut deshacer = Vec::new();
    let mut dias = std::collections::BTreeSet::new();
    for it in items {
        let (id, fecha) = (texto_de(&it["id"]), texto_de(&it["fecha"]));
        dias.insert(fecha.clone());
        if texto_de(&it["destino"]) == "inari" {
            errores += 1;
            ultimo = "INARI aún no está en la versión Rust.".into();
            continue;
        }
        match e.borrar_uno(&cli, &fecha, &id).await {
            Ok(paso) => {
                deshacer.extend(paso);
                n_ok += 1;
            }
            Err(err) => {
                errores += 1;
                ultimo = err.to_string();
            }
        }
    }
    let texto = format!("borrar {n_ok} apunte(s)")
        + &if dias.len() == 1 { format!(" del {}", dia_corto(dias.iter().next().unwrap())) } else { String::new() };
    let puede = e.apilar(texto, deshacer);
    Ok(json!({"eliminados": n_ok, "errores": errores, "ultimo": ultimo, "puede_deshacer": puede, "quedan": e.quedan()}))
}

/// Cambiar un apunte (comentario/actividad None = dejarlos como estan).
pub async fn editar(e: &Estado, cfg: &Cfg, fecha: &str, id: &str, horas: &Value,
                    comentario: Option<String>, actividad: Option<String>) -> Result<Value, String> {
    let Some(horas) = horas_de(horas) else { return Ok(json!({"error": "Escribe un número de horas válido."})) };
    if !(horas > 0.0 && horas <= 24.0) {
        return Ok(json!({"error": "Las horas deben estar entre 0 y 24."}));
    }
    let Some(a) = e.apunte(fecha, id) else {
        return Ok(json!({"error": "Ese apunte ya no está en la semana cargada (pulsa F5)."}));
    };
    let cli = cliente(cfg)?;
    let comentario = comentario.map(|c| c.trim().to_string()).unwrap_or_else(|| a.comentario.clone());
    let actividad = actividad.unwrap_or_else(|| a.actividad.clone());
    e.actualizar(&cli, id, horas, &comentario, &actividad, &a.wp_id).await.map_err(|err| err.to_string())?;
    let titulo = if a.wp_titulo.is_empty() { "un apunte".to_string() } else { a.wp_titulo.clone() };
    e.apilar(format!("cambiar «{titulo}» del {}", dia_corto(fecha)),
             vec![Paso::Editar { id: a.id, horas: a.horas, comentario: a.comentario, actividad: a.actividad, wp_id: a.wp_id }]);
    Ok(json!({"ok": true, "puede_deshacer": true, "quedan": e.quedan()}))
}

/// "Editar dia": {editar: [{id, horas, actividad}], borrar: [{id, destino}],
/// anadir: [{wp_id, horas, actividad, comentario}]}. Se valida TODO antes de
/// tocar nada; Deshacer devuelve el dia a como estaba.
pub async fn guardar_dia(e: &Estado, cfg: &Cfg, fecha: &str, cambios: &Value) -> Result<Value, String> {
    let error_horas = json!({"error": "Las horas deben ser un número entre 0 y 24 (por ejemplo 3,5)."});
    let valida = |v: &Value| horas_de(v).filter(|h| *h > 0.0 && *h <= 24.0);
    let actuales: Vec<Apunte> = e.cargados(fecha).unwrap_or_default();
    let lista = |k: &str| cambios[k].as_array().cloned().unwrap_or_default();
    let mut editar = Vec::new();
    for c in lista("editar") {
        let Some(a) = actuales.iter().find(|a| a.id == texto_de(&c["id"])) else {
            return Ok(json!({"error": "Algún apunte ya no está en la semana cargada (pulsa F5)."}));
        };
        let Some(h) = valida(&c["horas"]) else { return Ok(error_horas) };
        let act = Some(texto_de(&c["actividad"])).filter(|s| !s.is_empty()).unwrap_or_else(|| a.actividad.clone());
        if (h - a.horas).abs() < 0.001 && act == a.actividad {
            continue;
        }
        editar.push((a.clone(), h, act));
    }
    let mut anadir = Vec::new();
    for n in lista("anadir") {
        let Some(h) = valida(&n["horas"]) else { return Ok(error_horas) };
        let wp = texto_de(&n["wp_id"]);
        if wp.trim().parse::<i64>().is_err() {
            return Ok(error_horas);
        }
        anadir.push((n.clone(), h, wp.trim().to_string()));
    }
    let cli = cliente(cfg)?;
    let reglas = Reglas::desde(cfg);
    let (mut hechos, mut errores, mut ultimo) = (0, 0, String::new());
    let mut deshacer = Vec::new();
    for (a, h, act) in editar {
        match e.actualizar(&cli, &a.id, h, &a.comentario, &act, &a.wp_id).await {
            Ok(()) => {
                deshacer.push(Paso::Editar { id: a.id, horas: a.horas, comentario: a.comentario, actividad: a.actividad, wp_id: a.wp_id });
                hechos += 1;
            }
            Err(err) => { errores += 1; ultimo = err.to_string(); }
        }
    }
    for b in lista("borrar") {
        match e.borrar_uno(&cli, fecha, &texto_de(&b["id"])).await {
            Ok(paso) => { deshacer.extend(paso); hechos += 1; }
            Err(err) => { errores += 1; ultimo = err.to_string(); }
        }
    }
    for (n, h, wp) in anadir {
        let mut com = texto_de(&n["comentario"]).trim().to_string();
        if com.is_empty() && reglas.es_guardia(fecha) {
            com = reglas.comentario_guardia.clone();
        }
        let act = texto_de(&n["actividad"]);
        match e.crear(&cli, fecha, &wp, h, &com, &act).await {
            Ok(nuevo) => {
                deshacer.extend(nuevo.map(|id| Paso::Borrar { id }));
                recordar(cfg, &wp, &com, &act, &reglas.comentario_guardia);
                hechos += 1;
            }
            Err(err) => { errores += 1; ultimo = err.to_string(); }
        }
    }
    let puede = e.apilar(format!("editar el {}", dia_corto(fecha)), deshacer);
    Ok(json!({"hechos": hechos, "errores": errores, "ultimo": ultimo, "puede_deshacer": puede, "quedan": e.quedan()}))
}

/// Arrastrar con Mayus: lo crea en el otro dia y lo borra de este.
pub async fn mover(e: &Estado, cfg: &Cfg, fecha: &str, id: &str, destino: &str) -> Result<Value, String> {
    let Some(a) = e.apunte(fecha, id) else {
        return Ok(json!({"error": "Ese apunte ya no está en la semana cargada (pulsa F5)."}));
    };
    if destino == fecha {
        return Ok(json!({"ok": true}));
    }
    let cli = cliente(cfg)?;
    let nuevo = e.crear(&cli, destino, &a.wp_id, a.horas, &a.comentario, &a.actividad).await.map_err(|err| err.to_string())?;
    let mut deshacer: Vec<Paso> = nuevo.map(|id| Paso::Borrar { id }).into_iter().collect();
    match e.borrar_uno(&cli, fecha, id).await {
        Ok(paso) => deshacer.extend(paso),
        Err(err) => {
            let puede = e.apilar("mover un apunte".into(), deshacer);
            return Ok(json!({"error": format!("Se copió al otro día, pero no se pudo quitar de este: {err}"),
                             "puede_deshacer": puede, "quedan": e.quedan()}));
        }
    }
    let puede = e.apilar(format!("mover un apunte al {}", dia_corto(destino)), deshacer);
    Ok(json!({"ok": true, "puede_deshacer": puede, "quedan": e.quedan()}))
}

pub fn deshacer_estado(e: &Estado) -> Value {
    let pila = candado(&e.pila);
    json!({"quedan": pila.len(), "siguiente": pila.last().map(|a| a.texto.clone()).unwrap_or_default()})
}

fn con_estado(e: &Estado, mut v: Value) -> Value {
    let est = deshacer_estado(e);
    v["quedan"] = est["quedan"].clone();
    v["siguiente"] = est["siguiente"].clone();
    v
}

/// Deshace la ULTIMA accion; lo que falle (sin red...) se queda en la pila
/// para reintentarlo con el siguiente Ctrl+Z, en vez de perderse.
pub async fn deshacer(e: &Estado, cfg: &Cfg) -> Result<Value, String> {
    let accion = candado(&e.pila).pop();
    let Some(accion) = accion else {
        return Ok(con_estado(e, json!({"restaurados": 0, "errores": 0, "ultimo": "", "texto": "", "pendiente": false})));
    };
    let cli = match cliente(cfg) {
        Ok(c) => c,
        Err(err) => {
            candado(&e.pila).push(accion);
            return Err(err);
        }
    };
    let (mut restaurados, mut errores, mut ultimo) = (0, 0, String::new());
    let mut fallidos = Vec::new();
    for p in accion.pasos.iter().rev() {
        let r = match p {
            Paso::Crear { fecha, wp_id, horas, comentario, actividad, id_original } => {
                match e.crear(&cli, fecha, wp_id, *horas, comentario, actividad).await {
                    Ok(nuevo) => {
                        if let Some(n) = nuevo {
                            candado(&e.ids).insert(id_original.clone(), n);
                        }
                        Ok(())
                    }
                    Err(err) => Err(err),
                }
            }
            Paso::Editar { id, horas, comentario, actividad, wp_id } => {
                e.actualizar(&cli, &e.id_actual(id), *horas, comentario, actividad, wp_id).await
            }
            Paso::Borrar { id } => cli.eliminar(&e.id_actual(id)).await,
        };
        match r {
            Ok(()) => restaurados += 1,
            Err(err) => {
                errores += 1;
                ultimo = err.to_string();
                fallidos.push(p.clone());
            }
        }
    }
    let pendiente = !fallidos.is_empty();
    if pendiente {
        fallidos.reverse(); // en su orden original
        candado(&e.pila).push(Accion { texto: accion.texto.clone(), pasos: fallidos });
    }
    Ok(con_estado(e, json!({"restaurados": restaurados, "errores": errores, "ultimo": ultimo,
                            "texto": accion.texto, "pendiente": pendiente})))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn estado_con(dia: &str, aps: Option<Vec<Apunte>>) -> Estado {
        let e = Estado::default();
        candado(&e.cache).insert(dia.into(), aps);
        e
    }
    fn ap(id: &str, wp: &str, horas: f64) -> Apunte {
        Apunte { id: id.into(), wp_id: wp.into(), horas, wp_titulo: "T".into(), ..Default::default() }
    }
    fn cfg() -> Cfg {
        Cfg(json!({"jornada_invierno": 7, "no_laborables": {"2026-11-13": "festivo"}}).as_object().unwrap().clone())
    }

    #[test]
    fn horas_escritas_de_varias_formas() {
        assert_eq!(horas_de(&json!("3,5")), Some(3.5));
        assert_eq!(horas_de(&json!(2)), Some(2.0));
        assert_eq!(horas_de(&json!("x")), None);
    }

    #[test]
    fn avisos_antes_de_anadir() {
        let e = estado_con("2026-11-10", Some(vec![ap("1", "11754", 5.0)]));
        candado(&e.cache).insert("2026-11-11".into(), None);
        let r = comprobar(&e, &cfg(), &["2026-11-10".into(), "2026-11-11".into(), "2026-11-13".into()], "11754", &json!("3"));
        let claves: Vec<&str> = r["avisos"].as_array().unwrap().iter().map(|a| a["clave"].as_str().unwrap()).collect();
        assert_eq!(claves, ["sin_leer", "nolab", "repetir", "exceso"]);
        assert!(r["avisos"][3]["texto"].as_str().unwrap().contains("Martes 10/11 (8h de 7h)"));
        assert_eq!(comprobar(&e, &cfg(), &[], "1", &json!(1))["error"], "Marca al menos un día.");
        assert!(comprobar(&e, &cfg(), &["2026-11-10".into()], "1", &json!(30))["error"].is_string());
    }

    #[test]
    fn la_pila_guarda_las_20_ultimas_y_sigue_los_ids_recreados() {
        let e = Estado::default();
        for i in 0..25 {
            e.apilar(format!("a{i}"), vec![Paso::Borrar { id: i.to_string() }]);
        }
        assert_eq!(e.quedan(), MAX_DESHACER);
        assert_eq!(deshacer_estado(&e)["siguiente"], "a24");
        assert!(!e.apilar("nada".into(), vec![]));
        candado(&e.ids).insert("100".into(), "200".into());
        candado(&e.ids).insert("200".into(), "300".into());
        assert_eq!(e.id_actual("100"), "300");
        assert_eq!(e.id_actual("7"), "7");
    }

    #[test]
    fn textos_de_deshacer() {
        assert_eq!(dia_corto("2026-11-10"), "martes 10/11");
    }
}
