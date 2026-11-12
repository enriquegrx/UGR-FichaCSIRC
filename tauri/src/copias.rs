//! Copias de seguridad de config.json, restaurar y exportar/importar, y la
//! recuperacion sola al arrancar. Port de copias.py y de
//! configurar.recuperar_si_hace_falta (3.2.2).
//!
//! - Copia en <carpeta de config>/copias/ cada vez que cambia algo que
//!   importa (no por lo volatil: ventana, zoom...). Se guardan las 10 ultimas,
//!   una por dia de los ultimos 7 y SIEMPRE la completa mas reciente.
//! - Restaurar no toca credenciales, PIN ni lo de este equipo, salvo que la
//!   config actual se haya quedado sin conexion: entonces vuelven conexion y
//!   PIN de la copia, juntos.

use chrono::{Local, NaiveDateTime};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const MAX_RECIENTES: usize = 10;
pub const DIAS_DIARIAS: i64 = 7;
const VOLATILES: [&str; 15] = ["ventana", "ultimo_chequeo_update_ts", "pin_intentos", "aviso_semana_vista",
    "ultima_version_abierta", "vista_inicio", "zoom", "paneles", "tema", "pin_sugerencia_hasta",
    "aviso_aplicaciones", "ultima_actividad", "permisos_anio_revisado", "recordatorio_ejecutable", "aviso_mes_visto"];
const SECRETOS: [&str; 2] = ["api_key", "inari_token"];
const PIN: [&str; 4] = ["pin", "pin_intentos", "pin_auto_min", "pin_sugerencia_hasta"];
const DE_ESTE_EQUIPO: [&str; 1] = ["bandeja"];
pub const CONEXION: [&str; 2] = ["base_url", "api_key"];

/// La config tiene con que conectarse (URL y API key).
pub fn completa(cfg: &Map<String, Value>) -> bool {
    CONEXION.iter().all(|k| cfg.get(*k).is_some_and(|v| v.as_str().is_some_and(|s| !s.is_empty())))
}

pub fn carpeta(ruta_config: &Path) -> PathBuf {
    ruta_config.parent().unwrap_or(Path::new(".")).join("copias")
}

/// JSON con las claves ordenadas (para que la huella no dependa del orden).
fn canonico(v: &Value) -> String {
    match v {
        Value::Object(m) => {
            let mut ks: Vec<&String> = m.keys().collect();
            ks.sort();
            format!("{{{}}}", ks.iter().map(|k| format!("{}:{}", Value::String((*k).clone()), canonico(&m[*k]))).collect::<Vec<_>>().join(","))
        }
        Value::Array(a) => format!("[{}]", a.iter().map(canonico).collect::<Vec<_>>().join(",")),
        otro => otro.to_string(),
    }
}

fn huella(cfg: &Map<String, Value>) -> String {
    let importa: Map<String, Value> = cfg.iter().filter(|(k, _)| !VOLATILES.contains(&k.as_str()))
        .map(|(k, v)| (k.clone(), v.clone())).collect();
    hex::encode(Sha256::digest(canonico(&Value::Object(importa)).as_bytes()))
}

/// "config-AAAAMMDD-HHMMSS[-n].json" -> su fecha; None si no es una copia.
pub fn fecha_de(nombre: &str) -> Option<NaiveDateTime> {
    let resto = nombre.strip_prefix("config-")?.strip_suffix(".json")?;
    let (f, h) = (resto.get(..8)?, resto.get(9..15)?);
    if resto.as_bytes().get(8) != Some(&b'-') {
        return None;
    }
    let cola = &resto[15..];
    if !(cola.is_empty() || (cola.starts_with('-') && cola.len() > 1 && cola[1..].bytes().all(|b| b.is_ascii_digit()))) {
        return None;
    }
    if !f.bytes().chain(h.bytes()).all(|b| b.is_ascii_digit()) {
        return None;
    }
    NaiveDateTime::parse_from_str(&format!("{f}{h}"), "%Y%m%d%H%M%S").ok()
}

fn indice(dirc: &Path) -> Map<String, Value> {
    std::fs::read_to_string(dirc.join("indice.json")).ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_object().cloned()).unwrap_or_default()
}

fn escribir(ruta: &Path, datos: &Value) -> std::io::Result<()> {
    let tmp = ruta.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&tmp, serde_json::to_string_pretty(datos).unwrap_or_default())?;
    let mut intento = 0;
    loop {
        match std::fs::rename(&tmp, ruta) {
            Ok(()) => return Ok(()),
            Err(e) if intento < 3 && e.kind() == std::io::ErrorKind::PermissionDenied => {
                intento += 1;
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(e);
            }
        }
    }
}

fn nombres(dirc: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dirc).map(|it| it.filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| fecha_de(n).is_some()).collect())
        .unwrap_or_default();
    v.sort_by(|a, b| b.cmp(a)); // de la mas nueva a la mas vieja
    v
}

/// Copia si cambio algo que importa. Nunca debe impedir guardar: el que
/// llama ignora los errores.
pub fn quizas_copiar(ruta_config: &Path, cfg: &Map<String, Value>) -> std::io::Result<Option<String>> {
    if cfg.is_empty() {
        return Ok(None);
    }
    let dirc = carpeta(ruta_config);
    std::fs::create_dir_all(&dirc)?;
    let h = huella(cfg);
    let mut ind = indice(&dirc);
    if ind.get("ultima_huella").and_then(Value::as_str) == Some(h.as_str()) {
        return Ok(None);
    }
    let ahora = Local::now().naive_local();
    let base = format!("config-{}", ahora.format("%Y%m%d-%H%M%S"));
    let mut nombre = format!("{base}.json");
    let mut n = 1;
    while dirc.join(&nombre).exists() {
        nombre = format!("{base}-{n}.json");
        n += 1;
    }
    escribir(&dirc.join(&nombre), &Value::Object(cfg.clone()))?;
    ind.insert("ultima_huella".into(), json!(h));
    ind.insert("ultima".into(), json!(nombre));
    escribir(&dirc.join("indice.json"), &Value::Object(ind))?;
    purgar(ruta_config, ahora);
    Ok(Some(nombre))
}

/// Deja las 10 ultimas, la mas reciente de cada uno de los ultimos 7 dias y
/// la completa (con conexion) mas reciente.
pub fn purgar(ruta_config: &Path, ahora: NaiveDateTime) {
    let dirc = carpeta(ruta_config);
    let todas = nombres(&dirc);
    let mut quedan: std::collections::HashSet<String> = todas.iter().take(MAX_RECIENTES).cloned().collect();
    if let Some(n) = todas.iter().find(|n| leer(ruta_config, n).is_ok_and(|c| completa(&c))) {
        quedan.insert(n.clone());
    }
    let mut dias = std::collections::HashSet::new();
    for n in &todas {
        let f = fecha_de(n).unwrap();
        if (ahora - f).num_days() < DIAS_DIARIAS && dias.insert(f.date()) {
            quedan.insert(n.clone());
        }
    }
    for n in todas.iter().filter(|n| !quedan.contains(*n)) {
        let _ = std::fs::remove_file(dirc.join(n));
    }
}

pub fn leer(ruta_config: &Path, nombre: &str) -> Result<Map<String, Value>, String> {
    if fecha_de(nombre).is_none() {
        return Err("Copia no válida.".into()); // nada de rutas: solo nombres de copia
    }
    let t = std::fs::read_to_string(carpeta(ruta_config).join(nombre)).map_err(|e| e.to_string())?;
    match serde_json::from_str::<Value>(&t) {
        Ok(Value::Object(m)) => Ok(m),
        _ => Err("Copia no válida.".into()),
    }
}

pub fn resumen(cfg: &Map<String, Value>) -> String {
    let n = |k: &str| cfg.get(k).map(|v| v.as_array().map(Vec::len).or(v.as_object().map(Map::len)).unwrap_or(0)).unwrap_or(0);
    let partes: Vec<String> = [(n("favoritos"), "favorita", "favoritas"), (n("plantillas"), "plantilla", "plantillas"),
        (n("permisos_tipos"), "tipo de permiso", "tipos de permiso"), (n("no_laborables"), "día marcado", "días marcados")]
        .iter().filter(|(c, _, _)| *c > 0).map(|(c, uno, varios)| format!("{c} {}", if *c == 1 { uno } else { varios })).collect();
    if partes.is_empty() { "sin datos".into() } else { partes.join(" · ") }
}

/// Las copias, de la mas nueva a la mas vieja: [{id, fecha, resumen}].
pub fn listar(ruta_config: &Path) -> Value {
    json!(nombres(&carpeta(ruta_config)).iter().filter_map(|n| {
        let c = leer(ruta_config, n).ok()?;
        Some(json!({"id": n, "fecha": fecha_de(n)?.format("%d/%m/%Y %H:%M").to_string(), "resumen": resumen(&c)}))
    }).collect::<Vec<_>>())
}

/// La config restaurada/importada, conservando de la actual lo que no debe
/// viajar. Si la actual no tiene conexion y la copia si, vuelven conexion y PIN.
pub fn combinar(actual: &Map<String, Value>, nueva: &Map<String, Value>) -> Map<String, Value> {
    let mut conservar: std::collections::HashSet<&str> = SECRETOS.iter().chain(PIN.iter()).chain(DE_ESTE_EQUIPO.iter())
        .chain(VOLATILES.iter()).copied().collect();
    conservar.insert("base_url");
    if !completa(actual) && completa(nueva) {
        for k in SECRETOS.iter().chain(["pin", "pin_auto_min", "base_url"].iter()) {
            conservar.remove(k);
        }
    }
    let mut out: Map<String, Value> = nueva.iter().filter(|(k, _)| !conservar.contains(k.as_str()) && !k.starts_with('_'))
        .map(|(k, v)| (k.clone(), v.clone())).collect();
    for k in &conservar {
        if let Some(v) = actual.get(*k) {
            out.insert((*k).into(), v.clone());
        }
    }
    if out.get("base_url").and_then(Value::as_str).is_none_or(str::is_empty) {
        out.remove("base_url");
    }
    out
}

pub fn para_exportar(cfg: &Map<String, Value>, version: &str) -> Value {
    let quitar: Vec<&str> = SECRETOS.iter().chain(PIN.iter()).chain(DE_ESTE_EQUIPO.iter()).chain(VOLATILES.iter()).copied().collect();
    let mut out: Map<String, Value> = cfg.iter().filter(|(k, _)| !quitar.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect();
    out.insert("_exportado".into(), json!({"app": "FichaCSIRC", "version": version,
                                           "fecha": Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()}));
    Value::Object(out)
}

/// Un JSON que se puede importar: una exportacion o algo con pinta de config.
pub fn es_exportacion(datos: &Value) -> bool {
    let Some(m) = datos.as_object() else { return false };
    m.get("_exportado").and_then(|e| e["app"].as_str()) == Some("FichaCSIRC")
        || ["favoritos", "jornada_invierno", "plantillas", "permisos_tipos"].iter().any(|k| m.contains_key(*k))
}

/// La copia completa mas reciente (posterior a un "He olvidado el PIN").
pub fn ultima_completa(ruta_config: &Path) -> Option<(String, Map<String, Value>)> {
    let dirc = carpeta(ruta_config);
    let desde = indice(&dirc).get("de_cero_desde").and_then(Value::as_str).unwrap_or("").to_string();
    for n in nombres(&dirc) {
        if !desde.is_empty() && fecha_de(&n).unwrap().format("%Y%m%d%H%M%S").to_string() <= desde {
            break;
        }
        if let Ok(c) = leer(ruta_config, &n) {
            if completa(&c) {
                return Some((n, c));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn nombres_de_copia() {
        assert!(fecha_de("config-20261111-125943.json").is_some());
        assert!(fecha_de("config-20261111-125943-2.json").is_some());
        assert!(fecha_de("../config.json").is_none());
        assert!(fecha_de("config-2026111-125943.json").is_none());
        assert!(fecha_de("config-20261111-125943-.json").is_none());
    }

    #[test]
    fn restaurar_conserva_credenciales_salvo_config_sin_conexion() {
        let copia = m(json!({"base_url": "https://op", "api_key": "VIEJA", "pin": {"hash": "h"}, "favoritos": [1], "ventana": "x"}));
        let r = combinar(&m(json!({"base_url": "https://op", "api_key": "NUEVA"})), &copia);
        assert_eq!((r["api_key"].as_str(), r.get("pin"), r["favoritos"].clone()), (Some("NUEVA"), None, json!([1])));
        let rota = combinar(&m(json!({"no_laborables": {}})), &copia);
        assert_eq!((rota["api_key"].as_str(), rota["pin"].clone()), (Some("VIEJA"), json!({"hash": "h"})));
    }

    #[test]
    fn exportar_sin_secretos() {
        let e = para_exportar(&m(json!({"api_key": "K", "pin": {}, "tema": "oscuro", "favoritos": []})), "4.0");
        assert!(e.get("api_key").is_none() && e.get("pin").is_none() && e.get("tema").is_none());
        assert!(es_exportacion(&e));
        assert!(!es_exportacion(&json!({"cualquier": "cosa"})));
    }

    #[test]
    fn copias_y_purga_guardan_la_ultima_completa() {
        let dir = std::env::temp_dir().join(format!("fichacsirc-copias-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ruta = dir.join("config.json");
        let buena = m(json!({"base_url": "https://op", "api_key": "K", "favoritos": [1]}));
        assert!(quizas_copiar(&ruta, &buena).unwrap().is_some());
        assert!(quizas_copiar(&ruta, &buena).unwrap().is_none()); // sin cambios: nada
        for i in 0..15 {
            quizas_copiar(&ruta, &m(json!({"no_laborables": {i.to_string(): "x"}}))).unwrap();
        }
        assert!(ultima_completa(&ruta).is_some());
        assert_eq!(resumen(&buena), "1 favorita");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
