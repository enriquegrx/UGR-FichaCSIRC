//! config.json: leer y guardar SIN poder perderla (lo aprendido en la 3.2.x).
//!
//! - Si el fichero existe y no se puede leer, se reintenta y, si sigue igual,
//!   error: nunca se parte de vacio para escribir encima.
//! - Leer-cambiar-escribir con un candado y temporal propio: dos guardados a
//!   la vez no se pisan.
//! - Escritura atomica (temporal + rename).

use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

static CANDADO: Mutex<()> = Mutex::new(());
static SECUENCIA: AtomicU64 = AtomicU64::new(0);

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_else(|_| ".".into()))
}

/// Donde guardan su config las apps de este usuario (la de Python usa
/// <esto>/FichaCSIRC).
pub fn carpeta_base() -> PathBuf {
    if cfg!(target_os = "windows") {
        std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| home())
    } else if cfg!(target_os = "macos") {
        home().join("Library").join("Application Support")
    } else {
        std::env::var("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|_| home().join(".config"))
    }
}

/// config.json de la version Rust. En pruebas: su propia carpeta
/// (FichaCSIRC-rust), copiada la primera vez de la de la app de verdad, para
/// no tocar los datos de nadie mientras se porta el motor.
pub fn ruta_config() -> PathBuf {
    if let Ok(r) = std::env::var("FICHACSIRC_CONFIG") {
        return PathBuf::from(r);
    }
    let destino = carpeta_base().join("FichaCSIRC-rust").join("config.json");
    if !destino.exists() {
        let real = carpeta_base().join("FichaCSIRC").join("config.json");
        if real.exists() {
            if let Some(dir) = destino.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::copy(&real, &destino);
        }
    }
    destino
}

fn leer_de(ruta: &Path) -> Result<Map<String, Value>, String> {
    let mut ultimo = String::new();
    for i in 0..6 {
        match std::fs::read_to_string(ruta) {
            Ok(t) => match serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')) {
                Ok(Value::Object(m)) => return Ok(m),
                Ok(_) => ultimo = "no es una configuración".into(),
                Err(e) => ultimo = e.to_string(),
            },
            Err(e) => ultimo = e.to_string(),
        }
        if i < 5 {
            std::thread::sleep(Duration::from_millis(150));
        }
    }
    Err(format!("No se pudo leer la configuración ({ultimo}). No se ha guardado nada, para no perderla."))
}

/// La config entera. Sin fichero: error (la version Rust aun no tiene asistente).
pub fn leer() -> Result<Cfg, String> {
    let ruta = ruta_config();
    if !ruta.exists() {
        return Err(format!(
            "No encuentro la configuración ({}). Configura primero FichaCSIRC normal: \
             esta versión en pruebas copia su configuración.",
            ruta.display()
        ));
    }
    leer_de(&ruta).map(Cfg)
}

/// Cambia varias claves (Null = quitarla) en una sola lectura-escritura.
pub fn guardar_valores(valores: Map<String, Value>) -> Result<(), String> {
    let _turno = CANDADO.lock().unwrap_or_else(|e| e.into_inner());
    let ruta = ruta_config();
    let mut cfg = if ruta.exists() { leer_de(&ruta)? } else { Map::new() };
    for (k, v) in valores {
        if v.is_null() {
            cfg.remove(&k);
        } else {
            cfg.insert(k, v);
        }
    }
    escribir(&ruta, &cfg)
}

fn escribir(ruta: &Path, cfg: &Map<String, Value>) -> Result<(), String> {
    let n = SECUENCIA.fetch_add(1, Ordering::SeqCst);
    let tmp = ruta.with_extension(format!("json.{}-{n}.tmp", std::process::id()));
    let texto = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    let resultado = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(texto.as_bytes())?;
        f.sync_all()?;
        drop(f);
        let mut intento = 0;
        loop {
            match std::fs::rename(&tmp, ruta) {
                Ok(()) => return Ok(()),
                // Windows: otro proceso (antivirus, el aviso) lo tiene abierto un instante
                Err(e) if intento < 3 && e.kind() == std::io::ErrorKind::PermissionDenied => {
                    intento += 1;
                    std::thread::sleep(Duration::from_millis(200));
                }
                Err(e) => return Err(e),
            }
        }
    })();
    if resultado.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    resultado.map_err(|e| format!("No se pudo guardar la configuración: {e}"))
}

/// La config leida, con ayudas para sacar valores.
pub struct Cfg(pub Map<String, Value>);

impl Cfg {
    pub fn get(&self, k: &str) -> Option<&Value> {
        self.0.get(k).filter(|v| !v.is_null())
    }
    pub fn texto(&self, k: &str) -> String {
        match self.get(k) {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            _ => String::new(),
        }
    }
    pub fn horas(&self, k: &str) -> Option<f64> {
        self.get(k).and_then(crate::reglas::horas_de_valor)
    }
    pub fn objeto(&self, k: &str) -> Map<String, Value> {
        match self.get(k) {
            Some(Value::Object(m)) => m.clone(),
            _ => Map::new(),
        }
    }
    pub fn lista(&self, k: &str) -> Vec<Value> {
        match self.get(k) {
            Some(Value::Array(a)) => a.clone(),
            _ => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn con_config(nombre: &str, contenido: Option<&str>) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fichacsirc-rs-{nombre}-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let ruta = dir.join("config.json");
        let _ = std::fs::remove_file(&ruta);
        if let Some(c) = contenido {
            std::fs::write(&ruta, c).unwrap();
        }
        ruta
    }

    #[test]
    fn un_fichero_roto_no_se_lee_como_vacio() {
        let ruta = con_config("roto", Some("{\"base_url\": \"https://op.te"));
        assert!(leer_de(&ruta).is_err());
    }

    #[test]
    fn escribir_y_leer() {
        let ruta = con_config("ok", None);
        let mut m = Map::new();
        m.insert("api_key".into(), Value::String("k".into()));
        escribir(&ruta, &m).unwrap();
        assert_eq!(leer_de(&ruta).unwrap().get("api_key").unwrap(), "k");
    }
}
