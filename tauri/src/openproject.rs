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

    /// Todos los elementos de un listado, siguiendo la paginacion.
    async fn get_todos(&self, ruta: &str, mut consulta: Vec<(&str, String)>) -> Result<Vec<Value>, ErrorOp> {
        consulta.push(("pageSize", "200".into()));
        let mut out = Vec::new();
        let mut pagina = 1;
        loop {
            let mut c = consulta.clone();
            c.push(("offset", pagina.to_string()));
            let datos = self.get(ruta, &c).await?;
            let elems = datos["_embedded"]["elements"].as_array().cloned().unwrap_or_default();
            let total = datos["total"].as_u64().unwrap_or(0) as usize;
            let vacia = elems.is_empty();
            out.extend(elems);
            if vacia || out.len() >= total {
                return Ok(out);
            }
            pagina += 1;
        }
    }

    pub async fn proyectos(&self) -> Result<Vec<Value>, ErrorOp> {
        Ok(self.get_todos("/api/v3/projects", vec![]).await?.iter()
            .filter_map(|p| Some(json!({"id": p["id"].as_i64()?, "nombre": p["name"].as_str().unwrap_or("?")})))
            .collect())
    }

    pub async fn tareas_proyecto(&self, pid: i64) -> Result<Vec<Value>, ErrorOp> {
        Ok(self.get_todos(&format!("/api/v3/projects/{pid}/work_packages"), vec![]).await?
            .iter().filter_map(wp_resumen).collect())
    }

    /// Tareas de TODOS los proyectos visibles: por su NUMERO (la exacta), por
    /// texto en el nombre o, sin texto, todas las abiertas (hasta MAX_TODAS).
    pub async fn buscar_wp(&self, texto: &str) -> Result<Vec<Value>, ErrorOp> {
        let t = texto.trim();
        if t.is_empty() {
            let filtros = json!([{"status": {"operator": "o", "values": []}}]).to_string();
            let mut out = Vec::new();
            let mut pagina = 1;
            while out.len() < MAX_TODAS {
                let datos = self.get("/api/v3/work_packages", &[("filters", filtros.clone()), ("pageSize", "200".into()),
                    ("offset", pagina.to_string()), ("sortBy", json!([["subject", "asc"]]).to_string())]).await?;
                let elems = datos["_embedded"]["elements"].as_array().cloned().unwrap_or_default();
                let total = datos["total"].as_u64().unwrap_or(0) as usize;
                out.extend(elems.iter().filter_map(wp_resumen));
                if elems.is_empty() || out.len() >= total {
                    break;
                }
                pagina += 1;
            }
            out.truncate(MAX_TODAS);
            return Ok(out);
        }
        if let Ok(n) = t.trim_start_matches('#').parse::<u64>() {
            return match self.get(&format!("/api/v3/work_packages/{n}"), &[]).await {
                Ok(w) => Ok(wp_resumen(&w).into_iter().collect()),
                // no existe, o es de un proyecto en el que no estas
                Err(ErrorOp::Http(403 | 404)) => Ok(vec![]),
                Err(e) => Err(e),
            };
        }
        let filtros = json!([{"subject": {"operator": "~", "values": [t]}}]).to_string();
        let datos = self.get("/api/v3/work_packages", &[("filters", filtros), ("pageSize", "50".into())]).await?;
        Ok(datos["_embedded"]["elements"].as_array().map(|a| a.iter().filter_map(wp_resumen).collect()).unwrap_or_default())
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

    async fn enviar(&self, metodo: reqwest::Method, ruta: &str, cuerpo: Option<&Value>, oks: &[u16]) -> Result<Value, ErrorOp> {
        let mut pet = self.http.request(metodo, format!("{}{ruta}", self.base)).header("Authorization", &self.auth);
        if let Some(c) = cuerpo {
            pet = pet.json(c);
        }
        let resp = pet.send().await.map_err(desde_reqwest)?;
        let codigo = resp.status().as_u16();
        let texto = resp.text().await.unwrap_or_default();
        if !oks.contains(&codigo) {
            if codigo == 401 || codigo == 403 || codigo >= 500 {
                return Err(ErrorOp::Http(codigo));
            }
            // 422 y compania: el motivo que da ProyectosTIC (como la app de Python)
            let corto: String = texto.chars().take(200).collect();
            return Err(ErrorOp::Otro(format!("Error {codigo}: {corto}")));
        }
        Ok(serde_json::from_str(&texto).unwrap_or(Value::Null))
    }

    /// Crea un apunte y devuelve su id (para poder deshacerlo).
    pub async fn crear(&self, fecha: &str, wp_id: &str, horas: f64, comentario: &str,
                       actividad_href: Option<&str>) -> Result<Option<String>, ErrorOp> {
        let mut cuerpo = json!({
            "hours": iso_dur(horas),
            "spentOn": fecha,
            "comment": {"raw": comentario},
            "_links": {"workPackage": {"href": format!("/api/v3/work_packages/{wp_id}")}},
        });
        if let Some(h) = actividad_href {
            cuerpo["_links"]["activity"] = json!({"href": h});
        }
        let r = self.enviar(reqwest::Method::POST, "/api/v3/time_entries", Some(&cuerpo), &[200, 201]).await?;
        Ok(match &r["id"] {
            Value::Number(n) => Some(n.to_string()),
            Value::String(s) => Some(s.clone()),
            _ => None,
        })
    }

    /// Cambia horas y comentario (y la actividad, si se da su href).
    pub async fn actualizar(&self, id: &str, horas: f64, comentario: &str, actividad_href: Option<&str>) -> Result<(), ErrorOp> {
        let mut cuerpo = json!({"hours": iso_dur(horas), "comment": {"raw": comentario}});
        if let Some(h) = actividad_href {
            cuerpo["_links"] = json!({"activity": {"href": h}});
        }
        self.enviar(reqwest::Method::PATCH, &format!("/api/v3/time_entries/{id}"), Some(&cuerpo), &[200, 201]).await?;
        Ok(())
    }

    pub async fn eliminar(&self, id: &str) -> Result<(), ErrorOp> {
        self.enviar(reqwest::Method::DELETE, &format!("/api/v3/time_entries/{id}"), None, &[200, 204]).await?;
        Ok(())
    }

    /// Actividades permitidas en ESA tarea, con su href (formulario de time_entries).
    pub async fn actividades_href(&self, wp_id: &str) -> Result<Vec<(String, String)>, ErrorOp> {
        let cuerpo = json!({"_links": {"workPackage": {"href": format!("/api/v3/work_packages/{wp_id}")}}});
        let datos = self.enviar(reqwest::Method::POST, "/api/v3/time_entries/form", Some(&cuerpo), &[200]).await?;
        let vals = datos["_embedded"]["schema"]["activity"]["_embedded"]["allowedValues"]
            .as_array().cloned().unwrap_or_default();
        Ok(vals.iter().filter_map(|v| {
            let nombre = v["name"].as_str().or_else(|| v["_links"]["self"]["title"].as_str())?;
            let href = v["_links"]["self"]["href"].as_str()?;
            (!nombre.is_empty() && !href.is_empty()).then(|| (nombre.to_string(), href.to_string()))
        }).collect())
    }

    /// Solo los nombres de las actividades de ESA tarea.
    pub async fn actividades(&self, wp_id: &str) -> Result<Vec<String>, ErrorOp> {
        Ok(self.actividades_href(wp_id).await?.into_iter().map(|(n, _)| n).collect())
    }
}

/// "Buscar en todo" sin texto: tope de tareas que se traen.
pub const MAX_TODAS: usize = 1000;

/// Lo que se enseña de una tarea: id, nombre, su proyecto y su tarea padre.
pub fn wp_resumen(w: &Value) -> Option<Value> {
    let id = w["id"].as_i64()?;
    Some(json!({"id": id, "nombre": w["subject"].as_str().unwrap_or("?"),
                "proyecto": w["_links"]["project"]["title"].as_str().unwrap_or(""),
                "padre": w["_links"]["parent"]["title"].as_str().unwrap_or("")}))
}

/// 3.5 -> "PT3H30M" (como _iso_dur).
pub fn iso_dur(horas: f64) -> String {
    let total = (horas * 60.0).round() as i64;
    let (h, m) = (total / 60, total % 60);
    let mut s = String::from("PT");
    if h != 0 {
        s += &format!("{h}H");
    }
    if m != 0 {
        s += &format!("{m}M");
    }
    if s == "PT" { "PT0H".into() } else { s }
}

/// La actividad 'nombre' entre las de la tarea: igual (sin mayusculas) o,
/// si no, la que la contenga (como _actividad_href).
pub fn elegir_actividad<'a>(acts: &'a [(String, String)], nombre: &str) -> Option<&'a str> {
    let n = nombre.to_lowercase();
    acts.iter().find(|(a, _)| a.to_lowercase() == n)
        .or_else(|| acts.iter().find(|(a, _)| a.to_lowercase().contains(&n)))
        .map(|(_, h)| h.as_str())
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
        destino: String::new(),
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
    fn duraciones_hacia_la_api() {
        assert_eq!(iso_dur(3.5), "PT3H30M");
        assert_eq!(iso_dur(7.0), "PT7H");
        assert_eq!(iso_dur(0.25), "PT15M");
        assert_eq!(iso_dur(0.0), "PT0H");
        assert_eq!(duracion(&iso_dur(6.75)), 6.75);
    }

    #[test]
    fn la_actividad_se_elige_como_en_python() {
        let acts = vec![("Actuaciones técnicas".to_string(), "/a/1".to_string()),
                        ("Formación".to_string(), "/a/2".to_string()),
                        ("Asuntos propios".to_string(), "/a/3".to_string())];
        assert_eq!(elegir_actividad(&acts, "formación"), Some("/a/2"));
        assert_eq!(elegir_actividad(&acts, "Asuntos"), Some("/a/3"));
        assert_eq!(elegir_actividad(&acts, "soporte"), None);
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
