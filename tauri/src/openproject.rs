//! Cliente de ProyectosTIC (OpenProject, API v3) y por que falla cuando falla.

use crate::config::Cfg;
use crate::reglas::{redondear, Apunte};
use base64::Engine;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Debug)]
pub enum ErrorOp {
    /// Falta la URL o la API key en la config.
    Config,
    /// ProyectosTIC respondio con un codigo de error.
    Http(u16),
    /// No se llego al servidor (sin red, VPN, DNS, tiempo agotado).
    Red(String),
    Otro(String),
}

impl std::fmt::Display for ErrorOp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErrorOp::Config => write!(f, "Falta la dirección o la API key en la configuración."),
            ErrorOp::Http(401) => write!(f, "Acceso denegado (401): la API key no es válida o ha caducado."),
            ErrorOp::Http(c) => write!(f, "ProyectosTIC respondió con un error ({c})."),
            ErrorOp::Red(e) => write!(f, "No se pudo conectar con ProyectosTIC ({e})."),
            ErrorOp::Otro(e) => write!(f, "{e}"),
        }
    }
}

pub struct Cliente {
    base: String,
    auth: String,
    http: reqwest::Client,
}

fn desde_reqwest(e: reqwest::Error) -> ErrorOp {
    if e.is_connect() || e.is_timeout() {
        ErrorOp::Red(e.to_string())
    } else if let Some(s) = e.status() {
        ErrorOp::Http(s.as_u16())
    } else {
        ErrorOp::Otro(e.to_string())
    }
}

impl Cliente {
    pub fn desde(cfg: &Cfg) -> Result<Cliente, ErrorOp> {
        let base = cfg.texto("base_url").trim().trim_end_matches('/').to_string();
        let key = cfg.texto("api_key").trim().to_string();
        if base.is_empty() || key.is_empty() {
            return Err(ErrorOp::Config);
        }
        let auth = format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("apikey:{key}")));
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| ErrorOp::Otro(e.to_string()))?;
        Ok(Cliente { base, auth, http })
    }

    async fn get(&self, ruta: &str, consulta: &[(&str, String)]) -> Result<Value, ErrorOp> {
        let mut intento = 0;
        loop {
            intento += 1;
            let r = self.http.get(format!("{}{ruta}", self.base))
                .header("Authorization", &self.auth)
                .query(consulta)
                .send()
                .await;
            match r {
                Ok(resp) => {
                    let st = resp.status();
                    if !st.is_success() {
                        return Err(ErrorOp::Http(st.as_u16()));
                    }
                    return resp.json().await.map_err(|e| ErrorOp::Otro(e.to_string()));
                }
                // un reintento ante errores pasajeros de red
                Err(e) if intento == 1 && (e.is_connect() || e.is_timeout()) => {
                    tokio::time::sleep(Duration::from_millis(800)).await;
                }
                Err(e) => return Err(desde_reqwest(e)),
            }
        }
    }

    pub async fn yo(&self) -> Result<Value, ErrorOp> {
        self.get("/api/v3/users/me", &[]).await
    }

    /// Los apuntes de ESE usuario entre dos fechas (incluidas), paginando.
    pub async fn entradas_rango(&self, uid: &str, desde: &str, hasta: &str) -> Result<Vec<Apunte>, ErrorOp> {
        if uid.is_empty() {
            return Err(ErrorOp::Otro("No se pudo identificar tu usuario en ProyectosTIC.".into()));
        }
        let filtros = json!([{"spent_on": {"operator": "<>d", "values": [desde, hasta]}},
                             {"user": {"operator": "=", "values": [uid]}}]).to_string();
        let mut out = Vec::new();
        let mut pagina = 1;
        loop {
            let datos = self.get("/api/v3/time_entries", &[("filters", filtros.clone()),
                                                          ("pageSize", "200".into()),
                                                          ("offset", pagina.to_string())]).await?;
            let elems = datos["_embedded"]["elements"].as_array().cloned().unwrap_or_default();
            let total = datos["total"].as_u64().unwrap_or(0) as usize;
            out.extend(elems.iter().map(apunte));
            if elems.is_empty() || out.len() >= total {
                return Ok(out);
            }
            pagina += 1;
        }
    }

    /// Actividades permitidas en ESA tarea (formulario de time_entries).
    pub async fn actividades(&self, wp_id: &str) -> Result<Vec<String>, ErrorOp> {
        let cuerpo = json!({"_links": {"workPackage": {"href": format!("/api/v3/work_packages/{wp_id}")}}});
        let resp = self.http.post(format!("{}/api/v3/time_entries/form", self.base))
            .header("Authorization", &self.auth)
            .json(&cuerpo)
            .send()
            .await
            .map_err(desde_reqwest)?;
        if !resp.status().is_success() {
            return Err(ErrorOp::Http(resp.status().as_u16()));
        }
        let datos: Value = resp.json().await.map_err(|e| ErrorOp::Otro(e.to_string()))?;
        let vals = datos["_embedded"]["schema"]["activity"]["_embedded"]["allowedValues"]
            .as_array().cloned().unwrap_or_default();
        Ok(vals.iter().filter_map(|v| {
            v["name"].as_str().or_else(|| v["_links"]["self"]["title"].as_str()).map(String::from)
        }).filter(|n| !n.is_empty()).collect())
    }
}

/// "PT3H30M" -> 3.5 (como _parse_horas).
pub fn duracion(iso: &str) -> f64 {
    let numero_antes = |marca: char| -> f64 {
        let Some(pos) = iso.find(marca) else { return 0.0 };
        let previo = &iso[..pos];
        let ini = previo.rfind(|c: char| !(c.is_ascii_digit() || c == '.')).map(|i| i + 1).unwrap_or(0);
        previo[ini..].parse().unwrap_or(0.0)
    };
    let horas = numero_antes('H');
    // los minutos van tras la T (P1M seria un mes)
    let minutos = iso.find('T').map(|t| {
        let resto = &iso[t..];
        match resto.find('M') {
            Some(pos) => {
                let previo = &resto[..pos];
                let ini = previo.rfind(|c: char| !(c.is_ascii_digit() || c == '.')).map(|i| i + 1).unwrap_or(0);
                previo[ini..].parse().unwrap_or(0.0)
            }
            None => 0.0,
        }
    }).unwrap_or(0.0);
    redondear(horas + minutos / 60.0, 4)
}

fn apunte(e: &Value) -> Apunte {
    let links = &e["_links"];
    let wp = &links["workPackage"];
    let href = wp["href"].as_str().unwrap_or("");
    Apunte {
        id: match &e["id"] { Value::Number(n) => n.to_string(), Value::String(s) => s.clone(), _ => String::new() },
        wp_id: href.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string(),
        horas: duracion(e["hours"].as_str().unwrap_or("")),
        wp_titulo: wp["title"].as_str().unwrap_or("?").to_string(),
        comentario: e["comment"]["raw"].as_str().unwrap_or("").to_string(),
        actividad: links["activity"]["title"].as_str().unwrap_or("").to_string(),
        fecha: e["spentOn"].as_str().unwrap_or("").to_string(),
    }
}

/// ¿Responde la web publica de la UGR? (sin Internet vs fuera de la UGR)
pub async fn hay_internet() -> bool {
    matches!(tokio::time::timeout(Duration::from_secs(3), tokio::net::TcpStream::connect("www.ugr.es:443")).await,
             Ok(Ok(_)))
}

/// Por que no se pudo leer ProyectosTIC, para el usuario (diagnostico_conexion).
pub async fn diagnostico(e: &ErrorOp) -> Value {
    let d = |tipo: &str, titulo: &str, texto: &str| json!({"tipo": tipo, "titulo": titulo, "texto": texto});
    match e {
        ErrorOp::Config => d("config", "Falta la conexión con ProyectosTIC",
            "La configuración no tiene la dirección o la API key. Ponlas en el asistente o restaura una copia de seguridad."),
        ErrorOp::Http(401) => d("clave", "ProyectosTIC no acepta tu API key",
            "Ha caducado o se ha revocado. Genera una nueva en ProyectosTIC (tu avatar → Mi cuenta → Tokens de acceso → API) y ponla en el asistente."),
        ErrorOp::Http(403) => d("permiso", "ProyectosTIC no te deja ver tus horas (403)",
            "Tu usuario no tiene permiso. Consúltalo con quien administra ProyectosTIC."),
        ErrorOp::Http(c) if *c >= 500 => d("servidor", &format!("ProyectosTIC no responde bien (error {c})"),
            "Es un problema del servidor, no de tu equipo. Prueba de nuevo en un rato."),
        ErrorOp::Red(_) => {
            if hay_internet().await {
                d("vpn", "No llego a ProyectosTIC",
                  "La web de la UGR sí responde, pero ProyectosTIC no. Si estás fuera de la UGR, conecta la VPN; si ya estás dentro, ProyectosTIC puede estar caído: prueba en un rato.")
            } else {
                d("internet", "Sin conexión a Internet", "Este equipo no llega a Internet. Revisa el cable, el wifi o la red.")
            }
        }
        otro => d("otro", "No se pudo leer ProyectosTIC", &otro.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duraciones() {
        assert_eq!(duracion("PT3H30M"), 3.5);
        assert_eq!(duracion("PT7H"), 7.0);
        assert_eq!(duracion("PT45M"), 0.75);
        assert_eq!(duracion("PT1.5H"), 1.5);
        assert_eq!(duracion(""), 0.0);
    }

    #[test]
    fn un_apunte_de_la_api() {
        let e = json!({"id": 64077, "hours": "PT4H", "spentOn": "2026-11-11",
                       "comment": {"raw": "Servicio de Guardia"},
                       "_links": {"workPackage": {"href": "/api/v3/work_packages/11754", "title": "[2026_ATE] Mantenimientos"},
                                  "activity": {"title": "Formación"}}});
        let a = apunte(&e);
        assert_eq!((a.id.as_str(), a.wp_id.as_str(), a.horas, a.actividad.as_str()), ("64077", "11754", 4.0, "Formación"));
    }
}
