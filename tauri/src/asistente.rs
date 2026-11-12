//! Fase 5a: el asistente de configuracion (configurar.html) y "He olvidado el
//! PIN". Port de cfg_* y pin_olvidado de registrar_web.py: guarda SOBRE la
//! config existente (nunca borra festivos, permisos, plantillas...).

use crate::api::{candado, Estado, VERSION};
use crate::config::{self, Cfg};
use crate::copias;
use crate::openproject::{Cliente, ErrorOp};
use crate::pin;
use crate::reglas::parsear_horas;
use base64::Engine;
use chrono::{Duration, Local};
use serde_json::{json, Map, Value};

const LOGO_UGR: &[u8] = include_bytes!("../../logo_ugr.png");
const ACTIVIDADES: [&str; 5] = ["actuacion tecnica", "correctivo", "formacion", "gestion/planificacion", "soporte"];

fn texto(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// 7 -> "7", 6.5 -> "6,5"
fn fmt_num(v: f64) -> String {
    if v.fract() == 0.0 { format!("{}", v as i64) } else { format!("{v}").replace('.', ",") }
}

/// "6,5" o "7" -> jornada valida (0, 24]
fn num_jornada(v: &Value) -> Option<f64> {
    parsear_horas(&texto(v)).filter(|h| *h > 0.0 && *h <= 24.0)
}

/// "16/06" -> [6, 16] (mes, dia)
fn fecha_a_lista(v: &Value) -> Option<[u32; 2]> {
    let t = texto(v).replace('-', "/");
    let mut p = t.split('/');
    let d: u32 = p.next()?.trim().parse().ok()?;
    let m: u32 = p.next()?.trim().parse().ok()?;
    ((1..=12).contains(&m) && (1..=31).contains(&d)).then_some([m, d])
}

fn lista_a_fecha(v: Option<&Value>, defecto: &str) -> String {
    match v.and_then(Value::as_array) {
        Some(a) if a.len() >= 2 => match (a[0].as_u64(), a[1].as_u64()) {
            (Some(m), Some(d)) => format!("{d:02}/{m:02}"),
            _ => defecto.into(),
        },
        _ => defecto.into(),
    }
}

/// Error de conexion -> frase para el usuario.
fn motivo(e: &ErrorOp) -> String {
    match e {
        ErrorOp::Http(401) => "La API key no es válida o ha caducado (401). Genera otra en ProyectosTic.".into(),
        ErrorOp::Http(403) => "Sin permiso (403).".into(),
        ErrorOp::Red(_) => "No se pudo conectar. Revisa la URL y tu red (o la VPN).".into(),
        otro => format!("No se pudo conectar: {}", otro.to_string().chars().take(160).collect::<String>()),
    }
}

/// La API key escrita, o la guardada si el campo se dejo vacio.
fn clave(cfg: &Cfg, escrita: &Value) -> String {
    let k = texto(escrita).trim().to_string();
    if k.is_empty() { cfg.texto("api_key") } else { k }
}

fn cliente(cfg: &Cfg, url: &Value, key: &Value) -> Result<Cliente, String> {
    let mut m = Map::new();
    m.insert("base_url".into(), json!(texto(url).trim().trim_end_matches('/')));
    m.insert("api_key".into(), json!(clave(cfg, key)));
    Cliente::desde(&Cfg(m)).map_err(|_| "Escribe la URL y la API key.".to_string())
}

pub fn cfg_cargar(e: &Estado, cfg: &Cfg, hay_config: bool) -> Value {
    let des = cfg.horas("desayuno").unwrap_or(0.0);
    let jornada = cfg.horas("jornada_invierno").unwrap_or(7.0);
    let favoritos: Vec<Value> = cfg.lista("favoritos").iter().filter_map(|f| {
        let id = f["id"].as_i64().or_else(|| texto(&f["id"]).parse().ok())?;
        Some(json!({"id": id, "nombre": f["nombre"].as_str().unwrap_or("")}))
    }).collect();
    let ruta = config::ruta_config();
    let tema = { let t = cfg.texto("tema"); if ["sistema", "claro", "oscuro"].contains(&t.as_str()) { t } else { "sistema".to_string() } };
    let url = { let u = cfg.texto("base_url"); if u.is_empty() { "https://proyectostic.ugr.es".to_string() } else { u } };
    let actividad = [cfg.texto("actividad_defecto"), cfg.texto("actividad")].into_iter().find(|s| !s.is_empty()).unwrap_or("soporte".into());
    json!({
        "primera_vez": !hay_config || *candado(&e.de_cero),
        "ruta_config": ruta.parent().map(|p| p.display().to_string()).unwrap_or_default(),
        "tema": tema,
        "hay_pin": cfg.0.contains_key("pin"),
        "aviso": "",
        "experimento": false,
        "logo": format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(LOGO_UGR)),
        "url": url,
        "hay_key": !cfg.texto("api_key").is_empty(),
        "jornada": fmt_num(jornada + des),
        "desayuno_si": des > 0.0,
        "desayuno": fmt_num(if des > 0.0 { des } else { 0.5 }),
        "verano_si": cfg.get("tiene_verano").map(|v| v.as_bool().unwrap_or(true)).unwrap_or(true),
        "verano": fmt_num(cfg.horas("jornada_verano").unwrap_or(5.0)),
        "verano_inicio": lista_a_fecha(cfg.get("verano_inicio"), "16/06"),
        "verano_fin": lista_a_fecha(cfg.get("verano_fin"), "15/09"),
        "actividad": actividad,
        "actividades": ACTIVIDADES,
        "favoritos": favoritos,
    })
}

pub async fn cfg_probar(cfg: &Cfg, url: &Value, key: &Value) -> Value {
    let cli = match cliente(cfg, url, key) {
        Ok(c) => c,
        Err(m) => return json!({"error": m}),
    };
    match cli.yo().await {
        Ok(me) => json!({"nombre": me["name"].as_str().unwrap_or("usuario")}),
        Err(err) => json!({"error": motivo(&err)}),
    }
}

pub async fn cfg_proyectos(cfg: &Cfg, url: &Value, key: &Value) -> Value {
    let cli = match cliente(cfg, url, key) {
        Ok(c) => c,
        Err(m) => return json!({"error": m}),
    };
    match cli.proyectos().await {
        Ok(ps) => json!({"proyectos": ps}),
        Err(err) => json!({"error": motivo(&err)}),
    }
}

pub async fn cfg_tareas(cfg: &Cfg, url: &Value, key: &Value, pid: &Value) -> Value {
    let cli = match cliente(cfg, url, key) {
        Ok(c) => c,
        Err(m) => return json!({"error": m}),
    };
    let Ok(pid) = texto(pid).parse::<i64>() else { return json!({"error": "Proyecto no válido."}) };
    match cli.tareas_proyecto(pid).await {
        Ok(ts) => json!({"tareas": ts.iter().map(|t| json!({"id": t["id"], "nombre": t["nombre"]})).collect::<Vec<_>>()}),
        Err(ErrorOp::Http(403)) => json!({"error": "No tienes permiso para ver las tareas de este proyecto. Elige otro (por ejemplo el de tus tareas habituales)."}),
        Err(err) => json!({"error": motivo(&err)}),
    }
}

pub fn cfg_validar_jornada(d: &Value) -> Value {
    let Some(oficial) = num_jornada(&d["jornada"]) else {
        return json!({"error": "Las horas por día (normal) deben ser un número entre 0 y 24 (puedes usar medias horas, p. ej. 6,5)."});
    };
    if d["verano_si"].as_bool() == Some(true) {
        if num_jornada(&d["verano"]).is_none() {
            return json!({"error": "Las horas por día (verano) deben ser un número entre 0 y 24."});
        }
        for (k, que) in [("verano_inicio", "inicio"), ("verano_fin", "fin")] {
            if fecha_a_lista(&d[k]).is_none() {
                return json!({"error": format!("La fecha de {que} del verano no es válida. Escríbela como DD/MM (ej. 16/06).")});
            }
        }
    }
    let des = if d["desayuno_si"].as_bool() == Some(true) { num_jornada(&d["desayuno"]).unwrap_or(0.0) } else { 0.0 };
    let fichas = crate::reglas::redondear(oficial - des, 2);
    if des > 0.0 && fichas <= 0.0 {
        return json!({"error": "El desayuno no puede ser igual o mayor que la jornada."});
    }
    let texto = if des > 0.0 {
        format!("Jornada {} h − {} h de desayuno = fichas {} h al día (un día de permiso cuenta como {} h)",
                fmt_num(oficial), fmt_num(des), fmt_num(fichas), fmt_num(oficial))
    } else {
        format!("Fichas {} h al día.", fmt_num(oficial))
    };
    json!({"texto": texto})
}

pub fn cfg_guardar(e: &Estado, cfg: &Cfg, d: &Value) -> Value {
    let hay_pin = pin::guardado(cfg).is_some();
    let mut pin_nuevo = None;
    if d["pin_si"].as_bool() == Some(true) && !hay_pin {
        let p = texto(&d["pin"]).trim().to_string();
        let valido = p.chars().all(|c| c.is_ascii_digit()) && (4..=8).contains(&p.len());
        if !valido || p != texto(&d["pin2"]).trim() {
            return json!({"error": "Revisa el PIN: de 4 a 8 cifras y el mismo las dos veces."});
        }
        pin_nuevo = Some(crate::ayuda::pin_nuevo(&p));
    }
    let url = texto(&d["url"]).trim().trim_end_matches('/').to_string();
    let key = clave(cfg, &d["key"]);
    if url.is_empty() || key.is_empty() {
        return json!({"error": "Faltan la URL o la API key."});
    }
    let val = cfg_validar_jornada(d);
    if val.get("error").is_some() {
        return val;
    }
    let oficial = num_jornada(&d["jornada"]).unwrap();
    let des = if d["desayuno_si"].as_bool() == Some(true) { num_jornada(&d["desayuno"]).unwrap_or(0.0) } else { 0.0 };
    let favoritos: Vec<Value> = d["favoritos"].as_array().cloned().unwrap_or_default().iter().filter_map(|f| {
        let id = f["id"].as_i64().or_else(|| texto(&f["id"]).parse().ok())?;
        Some(json!({"id": id, "nombre": texto(&f["nombre"])}))
    }).collect();
    let cambiar = |c: &mut Map<String, Value>| {
        let verano_ant = c.get("jornada_verano").cloned().unwrap_or(json!(5));
        c.insert("base_url".into(), json!(url));
        c.insert("api_key".into(), json!(key));
        c.insert("jornada_invierno".into(), json!(crate::reglas::redondear(oficial - des, 2)));
        c.insert("desayuno".into(), json!(des));
        // lo que vale un dia completo de permiso: la jornada OFICIAL
        c.insert("horas_dia_permiso".into(), json!(oficial));
        c.insert("tiene_verano".into(), json!(d["verano_si"].as_bool() == Some(true)));
        c.insert("jornada_verano".into(), num_jornada(&d["verano"]).map(|v| json!(v)).unwrap_or(verano_ant));
        c.insert("verano_inicio".into(), json!(fecha_a_lista(&d["verano_inicio"]).unwrap_or([6, 16])));
        c.insert("verano_fin".into(), json!(fecha_a_lista(&d["verano_fin"]).unwrap_or([9, 15])));
        c.insert("actividad_defecto".into(), json!(Some(texto(&d["actividad"])).filter(|s| !s.is_empty()).unwrap_or("soporte".into())));
        c.insert("favoritos".into(), json!(favoritos));
        if let Some(p) = &pin_nuevo {
            c.insert("pin".into(), p.clone());
        } else if !hay_pin {
            c.insert("pin_sugerencia_hasta".into(), json!((Local::now().date_naive() + Duration::days(30)).to_string()));
        }
        // recien configurada: sus novedades no son "nuevas" para nadie
        c.entry("ultima_version_abierta").or_insert(json!(VERSION));
    };
    // sobre la config que haya; si estuviera rota, se sustituye por una completa
    let r = config::modificar(&cambiar).or_else(|_| {
        let mut nueva = Map::new();
        cambiar(&mut nueva);
        config::guardar_entera(&nueva)
    });
    if let Err(x) = r {
        return json!({"error": x});
    }
    *candado(&e.de_cero) = false;
    e.olvidar_lo_leido();
    json!({"ok": true})
}

/// Sin el PIN no se puede entrar: se borra la configuracion (las horas de
/// ProyectosTIC no se tocan) y se vuelve al asistente. Las copias se
/// conservan para recuperar favoritas y plantillas, pero ya no se usan solas
/// al arrancar (traerian el PIN olvidado).
pub fn pin_olvidado(e: &Estado, cfg: &Cfg) -> Value {
    if pin::guardado(cfg).is_none() {
        return json!({"ok": true});
    }
    let ruta = config::ruta_config();
    if let Err(x) = std::fs::remove_file(&ruta) {
        if x.kind() != std::io::ErrorKind::NotFound {
            return json!({"error": format!("No se pudo borrar la configuración: {x}")});
        }
    }
    copias::marcar_de_cero(&ruta);
    e.olvidar_lo_leido();
    *candado(&e.de_cero) = true;
    e.desbloquear();
    json!({"ok": true})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jornada_con_desayuno_como_python() {
        let r = cfg_validar_jornada(&json!({"jornada": "7", "desayuno_si": true, "desayuno": "0,5"}));
        assert_eq!(r["texto"], "Jornada 7 h − 0,5 h de desayuno = fichas 6,5 h al día (un día de permiso cuenta como 7 h)");
        assert_eq!(cfg_validar_jornada(&json!({"jornada": "6,5"}))["texto"], "Fichas 6,5 h al día.");
        assert!(cfg_validar_jornada(&json!({"jornada": "25"}))["error"].is_string());
        assert!(cfg_validar_jornada(&json!({"jornada": "7", "desayuno_si": true, "desayuno": "7"}))["error"].is_string());
        assert!(cfg_validar_jornada(&json!({"jornada": "7", "verano_si": true, "verano": "5", "verano_inicio": "32/06", "verano_fin": "15/09"}))["error"]
            .as_str().unwrap().contains("inicio"));
    }

    #[test]
    fn fechas_del_verano() {
        assert_eq!(fecha_a_lista(&json!("16/06")), Some([6, 16]));
        assert_eq!(fecha_a_lista(&json!("15-09")), Some([9, 15]));
        assert_eq!(fecha_a_lista(&json!("x")), None);
        assert_eq!(lista_a_fecha(Some(&json!([6, 16])), "?"), "16/06");
        assert_eq!(fmt_num(6.5), "6,5");
        assert_eq!(fmt_num(7.0), "7");
    }
}
