//! INARI (Kanboard, JSON-RPC 2.0): cada slot de teletrabajo es una TAREA con
//! sus horas en `time_spent` y `reference` = "TT-AAAA-MM-DD" para agrupar los
//! del dia. Port de inari.py y destinos.py. El token nunca sale en errores.

use crate::config::Cfg;
use crate::reglas::{redondear, Apunte};
use serde_json::{json, Value};
use std::time::Duration;

pub const URL_POR_DEFECTO: &str = "https://inari.ugr.es/kanboard/jsonrpc.php";

/// 'usuario:token' pegado de una vez -> (usuario, token).
pub fn separar_credencial(texto: &str) -> (String, String) {
    match texto.trim().split_once(':') {
        Some((u, t)) => (u.trim().to_string(), t.trim().to_string()),
        None => (texto.trim().to_string(), String::new()),
    }
}

/// '9:30' -> minutos desde medianoche.
pub fn parsear_hora(t: &str) -> Option<i64> {
    let (h, m) = t.trim().split_once(':')?;
    let (h, m): (i64, i64) = (h.trim().parse().ok()?, m.trim().parse().ok()?);
    ((0..24).contains(&h) && (0..60).contains(&m)).then_some(h * 60 + m)
}

/// Horas entre dos 'HH:MM' con fin > inicio.
pub fn duracion_horas(inicio: &str, fin: &str) -> Option<f64> {
    let (a, b) = (parsear_hora(inicio)?, parsear_hora(fin)?);
    (b > a).then(|| redondear((b - a) as f64 / 60.0, 2))
}

pub struct Inari {
    url: String,
    usuario: String,
    token: String,
}

fn texto(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn entero(v: &Value) -> i64 {
    v.as_i64().or_else(|| texto(v).parse().ok()).unwrap_or(0)
}

impl Inari {
    pub fn nuevo(url: &str, usuario: &str, token: &str) -> Inari {
        let url = if url.trim().is_empty() { URL_POR_DEFECTO.to_string() } else { url.trim().to_string() };
        Inari { url, usuario: usuario.to_string(), token: token.to_string() }
    }

    /// Con lo guardado en la config.
    pub fn desde(cfg: &Cfg) -> Inari {
        Inari::nuevo(&cfg.texto("inari_url"), &cfg.texto("inari_usuario"), &cfg.texto("inari_token"))
    }

    async fn rpc(&self, metodo: &str, params: Value) -> Result<Value, String> {
        let http = reqwest::Client::builder().timeout(Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
        let cuerpo = json!({"jsonrpc": "2.0", "id": 1, "method": metodo, "params": params});
        let r = http.post(&self.url).basic_auth(&self.usuario, Some(&self.token)).json(&cuerpo).send().await
            .map_err(|_| "No se pudo conectar con INARI. Comprueba la URL y tu red/VPN.".to_string())?;
        match r.status().as_u16() {
            200 => {}
            401 => return Err("Usuario o token de INARI incorrectos (401).".into()),
            c => return Err(format!("INARI respondio con un error HTTP {c}.")),
        }
        let datos: Value = r.json().await.map_err(|_| "Respuesta de INARI no valida. ¿La URL apunta a jsonrpc.php?".to_string())?;
        if let Some(err) = datos.get("error").filter(|e| !e.is_null()) {
            return Err(format!("INARI rechazo la peticion: {}", err["message"].as_str().unwrap_or("error desconocido")));
        }
        Ok(datos.get("result").cloned().unwrap_or(Value::Null))
    }

    pub async fn probar(&self) -> Result<Value, String> {
        let me = self.rpc("getMe", json!({})).await?;
        if me.is_null() || me == json!(false) {
            return Err("Conexion establecida, pero el token no identifica a un usuario.".into());
        }
        Ok(me)
    }

    /// Kanboard -> [{id, nombre}] (algunas versiones devuelven {id: nombre}).
    fn lista(res: &Value, claves: &[&str]) -> Value {
        match res {
            Value::Object(m) => json!(m.iter().map(|(k, v)| json!({"id": k.parse::<i64>().unwrap_or(0), "nombre": v})).collect::<Vec<_>>()),
            Value::Array(a) => json!(a.iter().map(|it| {
                let nombre = claves.iter().find_map(|k| it.get(*k).and_then(Value::as_str).filter(|s| !s.is_empty())).unwrap_or("");
                json!({"id": entero(&it["id"]), "nombre": nombre})
            }).collect::<Vec<_>>()),
            _ => json!([]),
        }
    }

    pub async fn proyectos(&self) -> Result<Value, String> {
        Ok(Self::lista(&self.rpc("getMyProjects", json!({})).await?, &["name"]))
    }

    pub async fn tablero(&self, pid: i64) -> Result<Value, String> {
        let p = json!({"project_id": pid});
        Ok(json!({
            "columnas": Self::lista(&self.rpc("getColumns", p.clone()).await?, &["title", "name"]),
            "carriles": Self::lista(&self.rpc("getActiveSwimlanes", p.clone()).await?, &["name"]),
            "categorias": Self::lista(&self.rpc("getAllCategories", p).await?, &["name"]),
        }))
    }

    /// Los slots (tareas) de un dia, como apuntes con destino "inari".
    pub async fn slots_dia(&self, pid: i64, iso: &str) -> Result<Vec<Apunte>, String> {
        let referencia = format!("TT-{iso}");
        let res = self.rpc("searchTasks", json!({"project_id": pid, "query": format!("ref:{referencia} status:open")})).await?;
        Ok(res.as_array().cloned().unwrap_or_default().iter()
            .filter(|t| texto(&t["reference"]) == referencia)
            .map(|t| Apunte {
                id: entero(&t["id"]).to_string(), wp_id: String::new(),
                horas: texto(&t["time_spent"]).parse().unwrap_or(0.0),
                wp_titulo: texto(&t["title"]), comentario: String::new(),
                actividad: "INARI · Teletrabajo".into(), fecha: iso.into(), destino: "inari".into(),
            }).collect())
    }

    /// Crea un slot (una tarea) con sus horas en time_spent. Devuelve su id.
    pub async fn crear_slot(&self, pid: i64, iso: &str, inicio: &str, fin: &str, descripcion: &str,
                            columna: i64, carril: i64, categoria: i64) -> Result<i64, String> {
        let horas = duracion_horas(inicio, fin).ok_or("Franja horaria no valida (revisa inicio y fin).")?;
        let titulo = if descripcion.trim().is_empty() { format!("{inicio}-{fin}") } else { format!("{inicio}-{fin} - {}", descripcion.trim()) };
        let mut p = json!({"project_id": pid, "title": titulo, "time_spent": horas, "reference": format!("TT-{iso}"),
                           "date_started": format!("{iso} 00:00")});
        for (k, v) in [("column_id", columna), ("swimlane_id", carril), ("category_id", categoria)] {
            if v > 0 {
                p[k] = json!(v);
            }
        }
        if !descripcion.trim().is_empty() {
            p["description"] = json!(descripcion.trim());
        }
        let r = self.rpc("createTask", p).await?;
        match entero(&r) {
            id if id > 0 => Ok(id),
            _ => Err("INARI no pudo crear el slot.".into()),
        }
    }

    pub async fn borrar_slot(&self, id: &str) -> Result<(), String> {
        match self.rpc("removeTask", json!({"task_id": id.parse::<i64>().unwrap_or(0)})).await? {
            Value::Bool(true) => Ok(()),
            _ => Err("INARI no pudo borrar el slot.".into()),
        }
    }
}

/// INARI activo y con lo minimo para operar.
pub fn configurado(cfg: &Cfg) -> bool {
    cfg.get("inari_activo").and_then(Value::as_bool).unwrap_or(false)
        && !cfg.texto("inari_usuario").is_empty() && !cfg.texto("inari_token").is_empty()
        && proyecto(cfg) > 0
}

pub fn proyecto(cfg: &Cfg) -> i64 {
    cfg.get("inari_project_id").map(entero).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn franjas_horarias() {
        assert_eq!(duracion_horas("9:00", "13:30"), Some(4.5));
        assert_eq!(duracion_horas("13:00", "9:00"), None);
        assert_eq!(duracion_horas("25:00", "26:00"), None);
        assert_eq!(separar_credencial("pepe:abc:d"), ("pepe".into(), "abc:d".into()));
        assert_eq!(separar_credencial("pepe"), ("pepe".into(), "".into()));
    }

    #[test]
    fn listas_de_kanboard() {
        assert_eq!(Inari::lista(&json!([{"id": "3", "title": "Hecho"}]), &["title", "name"]), json!([{"id": 3, "nombre": "Hecho"}]));
        assert_eq!(Inari::lista(&json!({"7": "Por defecto"}), &["name"]), json!([{"id": 7, "nombre": "Por defecto"}]));
    }
}
