//! Fase 4c: copias de seguridad (listar, restaurar, exportar, importar), PIN
//! (poner, cambiar, quitar, cada cuanto se pide), exportar CSV, Novedades,
//! Tecnologia, Diagnostico y abrir enlaces o archivos. Port de registrar_web.py.

use crate::api::{candado, Estado, VERSION};
use crate::config::{self, Cfg};
use crate::copias;
use crate::openproject::{self, Cliente};
use crate::pin;
use crate::reglas::fmt_horas;
use chrono::{Local, NaiveDate};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const NOVEDADES: &str = include_str!("../../NOVEDADES.md");
const TECNOLOGIA: &str = include_str!("../../TECNOLOGIA.md");
const GITHUB_REPO: &str = "enriquegrx/UGR-FichaCSIRC";
pub const PIN_AUTO: [i64; 5] = [0, 5, 15, 30, 60];
const PIN_SUGERENCIA_DIAS: i64 = 30;

// ---------------------------------------------------------------- textos de ayuda

/// Un .md de los que van con la app como bloques {estilo, texto}: '## X' es un
/// titulo de seccion, '**X**' un apartado y '- X' un punto (como _md_a_bloques).
pub fn md_a_bloques(md: &str, prefijo: &str) -> Value {
    let sin = |t: &str| t.replace("**", "").replace('*', "").replace('`', "");
    let mut out: Vec<Value> = Vec::new();
    let (mut estilo, mut texto) = ("normal", String::new());
    let volcar = |out: &mut Vec<Value>, estilo: &mut &str, texto: &mut String| {
        if !texto.trim().is_empty() {
            out.push(json!({"estilo": *estilo, "texto": texto.trim()}));
        }
        *estilo = "normal";
        texto.clear();
    };
    for ln in md.lines() {
        let l = ln.trim();
        if l == "---" || l.starts_with("# ") {
            continue;
        }
        if let Some(t) = l.strip_prefix("## ") {
            volcar(&mut out, &mut estilo, &mut texto);
            out.push(json!({"estilo": "version", "texto": format!("{prefijo}{t}")}));
        } else if l.starts_with("**") && l.ends_with("**") && l.len() > 4 {
            volcar(&mut out, &mut estilo, &mut texto);
            out.push(json!({"estilo": "apartado", "texto": sin(l)}));
        } else if let Some(t) = l.strip_prefix("- ") {
            volcar(&mut out, &mut estilo, &mut texto);
            estilo = "punto";
            texto = sin(t);
        } else if !l.is_empty() {
            texto = format!("{texto} {}", sin(l)).trim().to_string();
        } else {
            volcar(&mut out, &mut estilo, &mut texto);
        }
    }
    volcar(&mut out, &mut estilo, &mut texto);
    Value::Array(out)
}

pub fn novedades() -> Value {
    md_a_bloques(NOVEDADES, "Versión ")
}

pub fn tecnologia() -> Value {
    md_a_bloques(TECNOLOGIA, "")
}

// ---------------------------------------------------------------- Guardar como / Abrir

/// El dialogo de Windows para guardar (o abrir) un archivo. None = cancelado.
async fn pedir_ruta(app: &AppHandle, nombre: String, filtro: (&'static str, &'static [&'static str]), abrir: bool) -> Option<PathBuf> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let d = app.dialog().file().add_filter(filtro.0, filtro.1);
        let r = if abrir { d.blocking_pick_file() } else { d.set_file_name(&nombre).blocking_save_file() };
        r.and_then(|f| f.into_path().ok())
    }).await.ok().flatten()
}

pub fn abrir_github(app: &AppHandle, seccion: &str) -> Value {
    if seccion.is_empty() || seccion == "releases" {
        let url = format!("https://github.com/{GITHUB_REPO}{}", if seccion.is_empty() { String::new() } else { format!("/{seccion}") });
        let _ = app.opener().open_url(url, None::<&str>);
    }
    json!({"ok": true})
}

// ---------------------------------------------------------------- exportar CSV

fn campo_csv(s: &str) -> String {
    if s.contains([';', '"', '\n', '\r']) { format!("\"{}\"", s.replace('"', "\"\"")) } else { s.to_string() }
}

fn horas_csv(h: f64) -> String {
    fmt_horas(h).trim_end_matches('h').to_string()
}

pub async fn exportar_csv(e: &Estado, cfg: &Cfg, app: &AppHandle, desde: &str, hasta: &str) -> Result<Value, String> {
    let f = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok();
    let (Some(mut d1), Some(mut d2)) = (f(desde), f(hasta)) else { return Ok(json!({"error": "Elige las dos fechas."})) };
    if d2 < d1 {
        std::mem::swap(&mut d1, &mut d2);
    }
    let cli = Cliente::desde(cfg).map_err(|x| x.to_string())?;
    let uid = e.uid(&cli).await.map_err(|x| x.to_string())?;
    let mut aps = cli.entradas_rango(&uid, &d1.to_string(), &d2.to_string()).await.map_err(|x| x.to_string())?;
    if aps.is_empty() {
        return Ok(json!({"error": "No hay apuntes en ese rango."}));
    }
    aps.sort_by(|a, b| a.fecha.cmp(&b.fecha));
    let Some(ruta) = pedir_ruta(app, format!("horas_{d1}_a_{d2}.csv"), ("CSV (Excel)", &["csv"]), false).await else {
        return Ok(json!({"cancelado": true}));
    };
    let total: f64 = aps.iter().map(|a| a.horas).sum();
    // ';' y coma decimal para el Excel en español; con BOM para que lea las tildes
    let mut s = String::from("\u{feff}Fecha;Horas;Tarea;Actividad;Comentario\r\n");
    for a in &aps {
        s += &[a.fecha.clone(), horas_csv(a.horas), a.wp_titulo.clone(), a.actividad.clone(), a.comentario.clone()]
            .iter().map(|c| campo_csv(c)).collect::<Vec<_>>().join(";");
        s += "\r\n";
    }
    s += &format!("\r\n;{};TOTAL\r\n", horas_csv(total));
    std::fs::write(&ruta, s).map_err(|x| format!("No se pudo guardar: {x}"))?;
    *candado(&e.ultima_exportacion) = Some(ruta.clone());
    Ok(json!({"ruta": ruta.display().to_string(), "n": aps.len(), "total": fmt_horas(total)}))
}

/// Abre el ultimo CSV exportado con su programa (solo ese).
pub fn abrir_exportacion(e: &Estado, app: &AppHandle) -> Value {
    match candado(&e.ultima_exportacion).clone().filter(|r| r.exists()) {
        Some(r) => {
            let _ = app.opener().open_path(r.display().to_string(), None::<&str>);
            json!({"ok": true})
        }
        None => json!({"error": "No hay ninguna exportación que abrir."}),
    }
}

// ---------------------------------------------------------------- copias de seguridad

pub fn listar_copias() -> Value {
    copias::listar(&config::ruta_config())
}

/// Pone una config restaurada/importada: antes, copia de la actual (para
/// poder volver atras); luego, a empezar de nuevo con lo leido.
fn aplicar(e: &Estado, nueva: &Map<String, Value>) -> Result<Value, String> {
    let ruta = config::ruta_config();
    config::modificar(|cfg| {
        let _ = copias::quizas_copiar(&ruta, cfg);
        *cfg = copias::combinar(cfg, nueva);
    })?;
    e.olvidar_lo_leido();
    Ok(json!({"ok": true}))
}

pub fn restaurar_copia(e: &Estado, nombre: &str) -> Result<Value, String> {
    match copias::leer(&config::ruta_config(), nombre) {
        Ok(datos) => aplicar(e, &datos),
        Err(_) => Ok(json!({"error": "Esa copia ya no existe o está dañada."})),
    }
}

pub async fn exportar_config(cfg: &Cfg, app: &AppHandle) -> Result<Value, String> {
    let nombre = format!("FichaCSIRC-configuracion-{}.json", Local::now().format("%Y-%m-%d"));
    let Some(ruta) = pedir_ruta(app, nombre, ("Configuración de FichaCSIRC", &["json"]), false).await else {
        return Ok(json!({"cancelado": true}));
    };
    let datos = copias::para_exportar(&cfg.0, VERSION);
    std::fs::write(&ruta, serde_json::to_string_pretty(&datos).unwrap_or_default()).map_err(|x| format!("No se pudo guardar: {x}"))?;
    Ok(json!({"ok": true, "ruta": ruta.display().to_string()}))
}

pub async fn importar_config(e: &Estado, app: &AppHandle) -> Result<Value, String> {
    let Some(ruta) = pedir_ruta(app, String::new(), ("Configuración de FichaCSIRC", &["json"]), true).await else {
        return Ok(json!({"cancelado": true}));
    };
    let Some(datos) = std::fs::read_to_string(&ruta).ok().and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok()) else {
        return Ok(json!({"error": "No se pudo leer ese archivo."}));
    };
    if !copias::es_exportacion(&datos) {
        return Ok(json!({"error": "Ese archivo no es una configuración de FichaCSIRC."}));
    }
    aplicar(e, datos.as_object().unwrap())
}

// ---------------------------------------------------------------- PIN

pub fn pin_nuevo(p: &str) -> Value {
    let mut sal = [0u8; 16];
    getrandom::getrandom(&mut sal).expect("sin aleatoriedad del sistema");
    let mut out = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(p.as_bytes(), &sal, pin::ITERACIONES, &mut out);
    json!({"hash": hex::encode(out), "sal": hex::encode(sal), "iter": pin::ITERACIONES})
}

fn formato_pin(p: &str) -> Option<String> {
    let p = p.trim();
    (p.chars().all(|c| c.is_ascii_digit()) && (4..=8).contains(&p.len())).then(|| p.to_string())
}

fn cambiar(valores: &[(&str, Value)]) -> Result<(), String> {
    let mut m = Map::new();
    for (k, v) in valores {
        m.insert((*k).into(), v.clone());
    }
    config::guardar_valores(m)
}

/// Activa o cambia el PIN (si ya habia uno, hay que escribir el actual).
pub fn pin_fijar(cfg: &Cfg, nuevo: &str, repetido: &str, actual: &str) -> Result<Value, String> {
    if let Some(g) = pin::guardado(cfg) {
        if !pin::correcto(actual, &g) {
            return Ok(json!({"error": "El PIN actual no es correcto."}));
        }
    }
    let Some(p) = formato_pin(nuevo) else { return Ok(json!({"error": "El PIN debe tener entre 4 y 8 cifras."})) };
    if p != repetido.trim() {
        return Ok(json!({"error": "Los dos PIN no coinciden."}));
    }
    cambiar(&[("pin", pin_nuevo(&p)), ("pin_intentos", Value::Null)])?;
    Ok(json!({"ok": true}))
}

pub fn pin_quitar(cfg: &Cfg, actual: &str) -> Result<Value, String> {
    if let Some(g) = pin::guardado(cfg) {
        if !pin::correcto(actual, &g) {
            return Ok(json!({"error": "El PIN actual no es correcto."}));
        }
    }
    cambiar(&[("pin", Value::Null), ("pin_intentos", Value::Null)])?;
    Ok(json!({"ok": true}))
}

pub fn pin_auto(minutos: &Value) -> Result<Value, String> {
    let Some(m) = minutos.as_i64().or_else(|| minutos.as_str().and_then(|s| s.trim().parse().ok())) else {
        return Ok(json!({"error": "Minutos no válidos."}));
    };
    if !PIN_AUTO.contains(&m) {
        return Ok(json!({"error": "Elige 0, 5, 15, 30 o 60 minutos."}));
    }
    cambiar(&[("pin_auto_min", json!(m))])?;
    Ok(json!({"ok": true}))
}

pub fn pin_no_sugerir() -> Value {
    let hasta = Local::now().date_naive() + chrono::Duration::days(PIN_SUGERENCIA_DIAS);
    let _ = cambiar(&[("pin_sugerencia_hasta", json!(hasta.to_string()))]);
    json!({"ok": true, "hasta": hasta.format("%d/%m/%Y").to_string()})
}

// ---------------------------------------------------------------- diagnostico

/// Ayuda > Copiar diagnostico: para pegar en un correo cuando "no me va".
/// NUNCA la API key, el token de INARI ni el PIN (y se tachan si aparecieran).
pub async fn diagnostico() -> Value {
    let ruta = config::ruta_config();
    let (cfg, leida) = match config::leer() {
        Ok(c) => (c.0, "se lee bien".to_string()),
        Err(x) => (Map::new(), format!("NO SE PUEDE LEER ({x})")),
    };
    let c = Cfg(cfg.clone());
    let (url, key) = (c.texto("base_url"), c.texto("api_key"));
    let n = |k: &str| cfg.get(k).map(|v| v.as_array().map(Vec::len).or(v.as_object().map(Map::len)).unwrap_or(0)).unwrap_or(0);
    let lista = copias::listar(&ruta);
    let buena = copias::ultima_completa(&ruta).and_then(|(nombre, _)| copias::fecha_de(&nombre));
    let so = if cfg!(target_os = "windows") { "Windows" } else if cfg!(target_os = "macos") { "macOS" } else { "Linux" };
    let mut lin = vec![
        format!("FichaCSIRC {VERSION} (Rust, en pruebas) · {so} · {}", Local::now().format("%d/%m/%Y %H:%M")),
        String::new(),
        format!("Configuración: {} ({leida})", ruta.display()),
        format!("  Dirección: {}", if url.is_empty() { "(FALTA)".into() } else { url.clone() }),
        format!("  API key: {}", if key.is_empty() { "(FALTA)".into() } else { format!("sí, {} caracteres", key.chars().count()) }),
        format!("  PIN: {}", if cfg.get("pin").is_some_and(|p| !p.is_null()) { "sí" } else { "no" }),
        format!("  Favoritas: {} · plantillas: {} · días marcados: {}", n("favoritos"), n("plantillas"), n("no_laborables")),
        format!("  Copias de seguridad: {}{}", lista.as_array().map(Vec::len).unwrap_or(0),
                buena.map(|f| format!(" (última con conexión: {})", f.format("%d/%m/%Y %H:%M"))).unwrap_or(" (ninguna con conexión)".into())),
        String::new(),
        format!("Internet (web de la UGR): {}", if openproject::hay_internet().await { "responde" } else { "NO responde" }),
    ];
    match Cliente::desde(&c) {
        Ok(cli) => {
            let t0 = std::time::Instant::now();
            match cli.yo().await {
                Ok(_) => lin.push(format!("ProyectosTIC: responde 200 en {:.1} s (API key aceptada)", t0.elapsed().as_secs_f64())),
                Err(err) => lin.push(format!("ProyectosTIC: {err}")),
            }
        }
        Err(_) => lin.push("ProyectosTIC: no se prueba (falta la dirección o la API key)".into()),
    }
    let mut texto = lin.join("\n");
    let pin = cfg.get("pin").cloned().unwrap_or(Value::Null);
    for s in [key, c.texto("inari_token"), pin["hash"].as_str().unwrap_or("").to_string(), pin["sal"].as_str().unwrap_or("").to_string()] {
        if s.len() >= 6 {
            texto = texto.replace(&s, "***");
        }
    }
    json!({"texto": texto})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bloques_de_markdown() {
        let b = md_a_bloques("# Titulo\n\n## 3.2.2\n\n**Correcciones**\n- Una cosa\n  que sigue\n- Otra `x`\n\nTexto normal\n---\n", "Versión ");
        assert_eq!(b, json!([{"estilo": "version", "texto": "Versión 3.2.2"}, {"estilo": "apartado", "texto": "Correcciones"},
                            {"estilo": "punto", "texto": "Una cosa que sigue"}, {"estilo": "punto", "texto": "Otra x"},
                            {"estilo": "normal", "texto": "Texto normal"}]));
    }

    #[test]
    fn csv_para_excel() {
        assert_eq!(campo_csv("a;b"), "\"a;b\"");
        assert_eq!(campo_csv("dijo \"hola\""), "\"dijo \"\"hola\"\"\"");
        assert_eq!(horas_csv(6.5), "6,5");
    }

    #[test]
    fn el_pin_nuevo_se_comprueba_con_el_de_siempre() {
        let g = pin_nuevo("2468");
        assert!(pin::correcto("2468", &g));
        assert!(!pin::correcto("2469", &g));
        assert_eq!(formato_pin(" 1234 "), Some("1234".into()));
        assert_eq!(formato_pin("12a4"), None);
    }
}
