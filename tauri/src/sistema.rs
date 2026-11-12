//! Fase 5b/5c: actualizaciones, aviso diario de fichaje (tarea programada +
//! ventanita aviso.html) y bandeja del sistema con inicio con Windows.
//!
//! En pruebas, la tarea programada y el inicio con Windows llevan nombres
//! PROPIOS ("FichaCSIRC-Rust-..."): no tocan los de la app de Python.

use crate::api::{candado, Estado, VERSION};
use crate::config::{self, Cfg};
use crate::openproject::Cliente;
use crate::reglas::{fmt_horas, Reglas, DIAS_ES};
use crate::modo;
use crate::resumen;
use chrono::{Datelike, Duration, Local, NaiveDate, NaiveDateTime};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const GITHUB_REPO: &str = "enriquegrx/UGR-FichaCSIRC";
const HORAS_ENTRE_CHEQUEOS: i64 = 4;

const CLAVE_RUN: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
pub const AVISO_MINUTOS: u64 = 10;

/// Un programa del sistema sin abrir una consola negra.
fn ejecutar(programa: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
    let mut c = std::process::Command::new(programa);
    c.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c.output()
}

fn exe() -> String {
    std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default()
}

// ---------------------------------------------------------------- actualizaciones

fn version_tupla(s: &str) -> Option<(u64, u64, u64)> {
    let limpia = s.trim().trim_start_matches('v');
    let num: Vec<u64> = limpia.split(['.', '-']).take(3).map(|p| p.parse().ok()).collect::<Option<_>>()?;
    (num.len() == 3).then(|| (num[0], num[1], num[2]))
}

pub async fn comprobar_actualizacion(e: &Estado, cfg: &Cfg, forzar: bool) -> Value {
    if !forzar {
        let ultimo = NaiveDateTime::parse_from_str(&cfg.texto("ultimo_chequeo_update_ts"), "%Y-%m-%dT%H:%M:%S").ok();
        if ultimo.is_some_and(|u| Local::now().naive_local() - u < Duration::hours(HORAS_ENTRE_CHEQUEOS)) {
            return json!({"al_dia": true, "version": VERSION});
        }
    }
    let http = reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).user_agent("FichaCSIRC").build();
    let r = match http {
        Ok(h) => h.get(format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest")).send().await,
        Err(_) => return json!({"error": "No se pudo comprobar."}),
    };
    let datos: Value = match r {
        Ok(resp) if resp.status().is_success() => match resp.json().await {
            Ok(d) => d,
            Err(_) => return json!({"error": "La respuesta de GitHub no era válida."}),
        },
        Ok(resp) => return json!({"error": format!("GitHub respondió {}.", resp.status().as_u16())}),
        Err(_) => return json!({"error": "No se pudo conectar con GitHub. Comprueba tu red o la VPN."}),
    };
    let mut m = Map::new();
    m.insert("ultimo_chequeo_update_ts".into(), json!(Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()));
    let _ = config::guardar_valores(m);
    let tag = datos["tag_name"].as_str().unwrap_or("");
    match (version_tupla(tag), version_tupla(VERSION)) {
        (Some(nueva), Some(actual)) if nueva > actual => {
            *candado(&e.pagina_actualizacion) = datos["html_url"].as_str().map(String::from);
            // en produccion (Windows), el instalador de la release; en pruebas, la pagina
            let instalador = datos["assets"].as_array().and_then(|a| a.iter()
                .find(|x| x["name"].as_str() == Some(modo::INSTALADOR_WINDOWS))
                .and_then(|x| x["browser_download_url"].as_str().map(String::from)))
                .filter(|_| modo::PRODUCCION && cfg!(windows));
            let puede = instalador.is_some();
            *candado(&e.instalador) = instalador.map(|u| (tag.trim_start_matches('v').to_string(), u));
            json!({"version": tag.trim_start_matches('v'), "actual": VERSION, "puede_instalar": puede,
                   "experimento": !modo::PRODUCCION, "mac": cfg!(target_os = "macos")})
        }
        _ => json!({"al_dia": true, "version": VERSION}),
    }
}

/// Descarga el instalador de la version nueva y lo lanza. La app sigue
/// abierta: el instalador la cierra al instalar (si se cancela, sigue ahi).
pub async fn instalar_actualizacion(e: &Estado) -> Value {
    let Some((version, url)) = candado(&e.instalador).clone() else {
        return json!({"error": "No hay ninguna actualización preparada.", "pagina": true});
    };
    let ruta = std::env::temp_dir().join(format!("FichaCSIRC-Instalador-{version}.exe"));
    let descarga = async {
        let http = reqwest::Client::builder().user_agent("FichaCSIRC").build().map_err(|x| x.to_string())?;
        let r = http.get(&url).send().await.map_err(|x| x.to_string())?;
        if !r.status().is_success() {
            return Err(format!("respuesta {}", r.status().as_u16()));
        }
        let bytes = r.bytes().await.map_err(|x| x.to_string())?;
        std::fs::write(&ruta, &bytes).map_err(|x| x.to_string())
    };
    if let Err(x) = descarga.await {
        return json!({"error": format!("No se pudo descargar el instalador: {x}"), "pagina": true});
    }
    match std::process::Command::new(&ruta).spawn() {
        Ok(_) => json!({"ok": true, "mac": false}),
        Err(x) => json!({"error": format!("No se pudo abrir el instalador: {x}"), "pagina": true}),
    }
}

pub fn abrir_pagina_actualizacion(e: &Estado, app: &AppHandle) -> Value {
    let url = candado(&e.pagina_actualizacion).clone()
        .unwrap_or_else(|| format!("https://github.com/{GITHUB_REPO}/releases/latest"));
    let _ = app.opener().open_url(url, None::<&str>);
    json!({"ok": true})
}

// ---------------------------------------------------------------- aviso diario

pub fn recordatorio_estado() -> Value {
    let soportado = cfg!(windows);
    let activo = soportado && ejecutar("schtasks", &["/query", "/tn", modo::tarea_recordatorio()]).is_ok_and(|o| o.status.success());
    json!({"soportado": soportado, "activo": activo, "experimento": false})
}

pub fn recordatorio_activar(hora: &str) -> Value {
    let hora = hora.trim();
    if chrono::NaiveTime::parse_from_str(hora, "%H:%M").is_err() {
        return json!({"error": "Escribe la hora como HH:MM (ej. 16:00)."});
    }
    if !cfg!(windows) {
        return json!({"error": "De momento, el aviso diario de esta versión solo está en Windows."});
    }
    let comando = format!("\"{}\" --recordatorio", exe());
    match ejecutar("schtasks", &["/create", "/tn", modo::tarea_recordatorio(), "/tr", &comando, "/sc", "weekly",
                                 "/d", "MON,TUE,WED,THU,FRI", "/st", hora, "/f"]) {
        Ok(o) if o.status.success() => json!({"ok": true}),
        Ok(o) => json!({"error": String::from_utf8_lossy(if o.stderr.is_empty() { &o.stdout } else { &o.stderr }).trim().to_string()}),
        Err(x) => json!({"error": x.to_string()}),
    }
}

pub fn recordatorio_desactivar() -> Value {
    let _ = ejecutar("schtasks", &["/delete", "/tn", modo::tarea_recordatorio(), "/f"]);
    json!({"ok": true})
}

/// Dias de esta semana (hasta hoy) que no llegan a su jornada: (dia, reg, obj).
/// None sin red: no se molesta con un aviso cuando la culpa es la red.
pub async fn dias_pendientes(e: &Estado, cfg: &Cfg, hoy: NaiveDate) -> Option<Vec<(NaiveDate, f64, f64)>> {
    let lunes = hoy - Duration::days(hoy.weekday().num_days_from_monday() as i64);
    let cli = Cliente::desde(cfg).ok()?;
    let uid = e.uid(&cli).await.ok()?;
    let aps = cli.entradas_rango(&uid, &lunes.to_string(), &(lunes + Duration::days(4)).to_string()).await.ok()?;
    let reglas = Reglas::desde(cfg);
    let mut out = Vec::new();
    for i in 0..5 {
        let d = lunes + Duration::days(i);
        if d > hoy {
            continue;
        }
        let obj = reglas.objetivo_de(d);
        if obj == 0.0 {
            continue;
        }
        let reg: f64 = aps.iter().filter(|a| a.fecha == d.to_string()).map(|a| a.horas).sum();
        if reg < obj - 0.001 {
            out.push((d, reg, obj));
        }
    }
    Some(out)
}

pub fn mensaje_pendientes(p: &[(NaiveDate, f64, f64)]) -> String {
    if p.is_empty() {
        return String::new();
    }
    let total: f64 = p.iter().map(|(_, r, o)| o - r).sum();
    let mut l = vec![format!("Te faltan horas por fichar esta semana ({} en total):", fmt_horas(total).replace(',', ".")), String::new()];
    for (d, r, o) in p {
        l.push(format!("  {} {}: {} de {}", DIAS_ES[d.weekday().num_days_from_monday() as usize], d.format("%d/%m"),
                       fmt_horas(*r).replace(',', "."), fmt_horas(*o).replace(',', ".")));
    }
    l.join("\n")
}

/// Para la ventanita del aviso: el texto, los dias con huecos y 3 habituales.
pub async fn aviso_datos(e: &Estado, cfg: &Cfg) -> Value {
    let pend = candado(&e.pendientes).clone();
    let dias: Vec<Value> = pend.iter().map(|(d, r, o)| json!({
        "iso": d.to_string(), "nombre": DIAS_ES[d.weekday().num_days_from_monday() as usize],
        "fecha": d.format("%d/%m").to_string(), "falta": crate::reglas::redondear(o - r, 2), "falta_txt": fmt_horas(o - r)})).collect();
    let mut habituales = Value::Array(vec![]);
    if !dias.is_empty() {
        let hoy = Local::now().date_naive();
        let ant = NaiveDate::from_ymd_opt(hoy.year(), hoy.month(), 1).unwrap() - Duration::days(1);
        let desde = NaiveDate::from_ymd_opt(ant.year(), ant.month(), 1).unwrap();
        if let Ok(cli) = Cliente::desde(cfg) {
            if let Ok(uid) = e.uid(&cli).await {
                if let Ok(aps) = cli.entradas_rango(&uid, &desde.to_string(), &hoy.to_string()).await {
                    let h = resumen::habituales(&aps, desde);
                    habituales = json!(h["filas"].as_array().map(|f| f.iter().take(3).cloned().collect::<Vec<_>>()).unwrap_or_default());
                }
            }
        }
    }
    let tema = Some(cfg.texto("tema")).filter(|t| !t.is_empty()).unwrap_or("sistema".into());
    json!({"texto": candado(&e.aviso).clone(), "minutos": AVISO_MINUTOS, "dias": dias, "habituales": habituales,
           "pin": crate::pin::guardado(cfg).is_some(), "tema": tema})
}

/// Desde el aviso: un apunte en ese dia; devuelve lo que sigue faltando.
pub async fn aviso_fichar(e: &Estado, cfg: &Cfg, iso: &str, wp_id: &str, horas: &Value, actividad: &str) -> Result<Value, String> {
    let Some(h) = crate::apuntes::horas_de(horas).filter(|h| *h > 0.0 && *h <= 24.0) else {
        return Ok(json!({"error": "Horas no válidas."}));
    };
    let cli = Cliente::desde(cfg).map_err(|x| x.to_string())?;
    if let Err(x) = e.crear(&cli, iso, wp_id, h, "", actividad).await {
        return Ok(json!({"error": format!("No se pudo fichar: {x}")}));
    }
    let Ok(d) = NaiveDate::parse_from_str(iso, "%Y-%m-%d") else { return Ok(json!({"error": "Fecha no válida."})) };
    let mut pend: Vec<_> = candado(&e.pendientes).iter().filter(|(x, _, _)| *x != d).cloned().collect();
    if let Ok(uid) = e.uid(&cli).await {
        if let Ok(aps) = cli.entradas_rango(&uid, iso, iso).await {
            let reg: f64 = aps.iter().map(|a| a.horas).sum();
            let obj = Reglas::desde(cfg).objetivo_de(d);
            if reg < obj - 0.001 {
                pend.push((d, reg, obj));
                pend.sort_by_key(|x| x.0);
            }
        }
    }
    *candado(&e.aviso) = mensaje_pendientes(&pend);
    *candado(&e.pendientes) = pend;
    let mut r = aviso_datos(e, cfg).await;
    r["ok"] = json!(true);
    Ok(r)
}

/// "Abrir FichaCSIRC" o "Ahora no": se cierra el aviso (y se abre la app).
pub fn aviso_responder(app: &AppHandle, abrir: bool) -> Value {
    if abrir {
        let _ = std::process::Command::new(exe()).spawn();
    }
    app.exit(0);
    json!({"ok": true})
}

// ---------------------------------------------------------------- bandeja

pub fn inicio_activo() -> bool {
    cfg!(windows) && ejecutar("reg", &["query", CLAVE_RUN, "/v", modo::valor_inicio()]).is_ok_and(|o| o.status.success())
}

fn activar_inicio(si: bool) -> Result<(), String> {
    let r = if si {
        let comando = format!("\"{}\" --minimizado", exe());
        ejecutar("reg", &["add", CLAVE_RUN, "/v", modo::valor_inicio(), "/t", "REG_SZ", "/d", &comando, "/f"])
    } else {
        if !inicio_activo() {
            return Ok(());
        }
        ejecutar("reg", &["delete", CLAVE_RUN, "/v", modo::valor_inicio(), "/f"])
    };
    match r {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => Err(String::from_utf8_lossy(&o.stderr).trim().to_string()),
        Err(x) => Err(x.to_string()),
    }
}

pub fn bandeja_activa(cfg: &Cfg) -> bool {
    cfg!(windows) && cfg.get("bandeja").and_then(Value::as_bool).unwrap_or(false)
}

pub fn bandeja_estado(cfg: &Cfg) -> Value {
    json!({"soportada": cfg!(windows), "activa": bandeja_activa(cfg), "inicio": inicio_activo(), "mac": cfg!(target_os = "macos")})
}

pub fn bandeja_guardar(app: &AppHandle, activa: bool, inicio: bool) -> Result<Value, String> {
    if !cfg!(windows) {
        return Ok(json!({"error": "La bandeja del sistema solo está disponible en Windows."}));
    }
    let activa = activa || inicio; // arrancar con Windows exige bandeja
    let mut m = Map::new();
    m.insert("bandeja".into(), json!(activa));
    config::guardar_valores(m)?;
    if let Err(x) = activar_inicio(inicio) {
        return Ok(json!({"error": format!("No se pudo cambiar el inicio con Windows: {x}")}));
    }
    if activa {
        poner_bandeja(app).map_err(|x| x.to_string())?;
    } else {
        quitar_bandeja(app);
    }
    let mut r = bandeja_estado(&config::leer()?);
    r["ok"] = json!(true);
    Ok(r)
}

pub fn mostrar(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("principal") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// El icono junto al reloj: abrir, fichar hoy y salir. Con el, cerrar la
/// ventana solo la esconde.
pub fn poner_bandeja(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    app.state::<Estado>().con_bandeja.store(true, std::sync::atomic::Ordering::SeqCst);
    if app.tray_by_id("bandeja").is_some() {
        return Ok(());
    }
    let abrir = MenuItem::with_id(app, "abrir", "Abrir FichaCSIRC", true, None::<&str>)?;
    let hoy = MenuItem::with_id(app, "hoy", "Fichar hoy", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let salir = MenuItem::with_id(app, "salir", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&abrir, &hoy, &sep, &salir])?;
    let mut b = TrayIconBuilder::with_id("bandeja").tooltip(format!("FichaCSIRC{}", modo::sufijo())).menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "abrir" => mostrar(app),
            "hoy" => {
                mostrar(app);
                if let Some(w) = app.get_webview_window("principal") {
                    let _ = w.eval("navegar(0)");
                }
            }
            "salir" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|t, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                mostrar(t.app_handle());
            }
        });
    if let Some(icono) = app.default_window_icon() {
        b = b.icon(icono.clone());
    }
    b.build(app)?;
    Ok(())
}

pub fn quitar_bandeja(app: &AppHandle) {
    app.state::<Estado>().con_bandeja.store(false, std::sync::atomic::Ordering::SeqCst);
    let _ = app.remove_tray_by_id("bandeja");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versiones() {
        assert_eq!(version_tupla("v3.2.2"), Some((3, 2, 2)));
        assert_eq!(version_tupla("4.0.0-alpha.1"), Some((4, 0, 0)));
        assert!(version_tupla("v3.2.2") < version_tupla(VERSION));
        assert_eq!(version_tupla("x"), None);
    }

    #[test]
    fn mensaje_del_aviso_como_python() {
        let d = NaiveDate::from_ymd_opt(2026, 11, 10).unwrap();
        assert_eq!(mensaje_pendientes(&[(d, 3.0, 6.5)]),
                   "Te faltan horas por fichar esta semana (3.5h en total):\n\n  Martes 10/11: 3h de 6.5h");
        assert_eq!(mensaje_pendientes(&[]), "");
    }
}
