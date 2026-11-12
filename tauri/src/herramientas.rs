//! Fase 4a, lo del dia a dia: marcas del dia (festivo, vacaciones, guardia,
//! teletrabajo, quitar permiso), el aviso "solo en este equipo" con su tarea
//! de ProyectosTIC, plantillas, copiar dia / semana anterior, asociar
//! actividad con tarea y el resumen del mes. Port de registrar_web.py.

use crate::api::{candado, Estado};
use crate::apuntes::Paso;
use crate::config::{self, Cfg};
use crate::openproject::Cliente;
use crate::reglas::{fmt_horas, Apunte, Reglas, DIAS_ES};
use crate::resumen::MESES;
use chrono::{Datelike, Duration, NaiveDate};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

fn fecha(iso: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(iso, "%Y-%m-%d").map_err(|_| format!("Fecha no válida: {iso}"))
}

fn texto(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn dia_largo(d: NaiveDate) -> String {
    format!("{} {}", DIAS_ES[d.weekday().num_days_from_monday() as usize], d.format("%d/%m"))
}

/// minusculas y sin tildes (como _sin_tildes de Python)
pub fn sin_tildes(s: &str) -> String {
    s.to_lowercase().chars().map(|c| match c {
        'á' | 'à' | 'ä' | 'â' => 'a', 'é' | 'è' | 'ë' | 'ê' => 'e', 'í' | 'ì' | 'ï' | 'î' => 'i',
        'ó' | 'ò' | 'ö' | 'ô' => 'o', 'ú' | 'ù' | 'ü' | 'û' => 'u', 'ñ' => 'n', 'ç' => 'c', o => o,
    }).collect()
}

async fn cliente_y_uid(e: &Estado, cfg: &Cfg) -> Result<(Cliente, String), String> {
    let cli = Cliente::desde(cfg).map_err(|x| x.to_string())?;
    let uid = e.uid(&cli).await.map_err(|x| x.to_string())?;
    Ok((cli, uid))
}

// ---------------------------------------------------------------- marcas del dia

fn lista_ordenada(cfg: &mut Map<String, Value>, clave: &str, iso: &str, poner: bool) {
    let mut v: Vec<String> = cfg.get(clave).and_then(Value::as_array)
        .map(|a| a.iter().map(texto).filter(|s| !s.is_empty()).collect()).unwrap_or_default();
    v.retain(|x| x != iso);
    if poner {
        v.push(iso.to_string());
    }
    v.sort();
    cfg.insert(clave.into(), json!(v));
}

pub fn accion_dia(iso: &str, accion: &str, motivo: &str) -> Result<Value, String> {
    let acciones = ["no_laborable", "quitar_no_laborable", "guardia", "quitar_guardia",
                    "teletrabajo", "quitar_teletrabajo", "quitar_permiso"];
    if !acciones.contains(&accion) {
        return Ok(json!({"error": format!("Acción desconocida: {accion}")}));
    }
    fecha(iso)?;
    config::modificar(|cfg| match accion {
        "no_laborable" | "quitar_no_laborable" => {
            let mut m = cfg.get("no_laborables").and_then(Value::as_object).cloned().unwrap_or_default();
            if accion == "no_laborable" {
                m.insert(iso.into(), json!(if motivo.is_empty() { "festivo" } else { motivo }));
            } else {
                m.remove(iso);
            }
            cfg.insert("no_laborables".into(), Value::Object(m));
        }
        "guardia" | "quitar_guardia" => lista_ordenada(cfg, "guardias", iso, accion == "guardia"),
        "teletrabajo" | "quitar_teletrabajo" => lista_ordenada(cfg, "teletrabajo", iso, accion == "teletrabajo"),
        _ => {
            // quitar_permiso: motivo = indice
            let mut m = cfg.get("permisos").and_then(Value::as_object).cloned().unwrap_or_default();
            if let (Some(Value::Array(ps)), Ok(i)) = (m.get(iso).cloned(), motivo.parse::<usize>()) {
                if i < ps.len() {
                    let mut ps = ps;
                    ps.remove(i);
                    if ps.is_empty() { m.remove(iso); } else { m.insert(iso.into(), Value::Array(ps)); }
                }
            }
            cfg.insert("permisos".into(), Value::Object(m));
        }
    })?;
    Ok(json!({"ok": true}))
}

/// true si marcar ese dia supera el cupo semanal de teletrabajo.
pub fn teletrabajo_lleno(cfg: &Cfg, iso: &str) -> Result<bool, String> {
    let d = fecha(iso)?;
    let reglas = Reglas::desde(cfg);
    let cupo = reglas.teletrabajo_por_semana;
    let lunes = d - Duration::days(d.weekday().num_days_from_monday() as i64);
    Ok(cupo > 0 && reglas.teletrabajo_en_semana(lunes) as i64 >= cupo)
}

// ---------------------------------------------------------------- "solo en este equipo"

const TITULOS_LOCAL: [(&str, &str); 5] = [("permiso", "Permisos por horas"), ("baja", "Bajas"),
    ("vacaciones", "Vacaciones"), ("guardia", "Guardias"), ("teletrabajo", "Teletrabajo")];

fn palabras(motivo: &str) -> &'static [&'static str] {
    match motivo {
        "baja" => &["baja", "permiso", "ausencia", "licencia", "incapacidad"],
        "vacaciones" => &["vacacion", "permiso", "ausencia"],
        "permiso" => &["permiso", "asuntos", "ausencia", "licencia", "conciliac"],
        // "disponibilidad", "reten"...: falsos positivos (alta disponibilidad...)
        "guardia" => &["guardia"],
        "teletrabajo" => &["teletrabajo", "trabajo a distancia", "no presencial"],
        _ => &[],
    }
}

pub fn tareas_local(cfg: &Cfg) -> Value {
    let guardadas = cfg.objeto("tareas_local");
    json!(TITULOS_LOCAL.iter().map(|(m, titulo)| {
        let g = guardadas.get(*m).cloned().unwrap_or(json!({}));
        let modo = if g["ninguna"].as_bool() == Some(true) { "ninguna" } else if !texto(&g["id"]).is_empty() { "tarea" } else { "auto" };
        json!({"motivo": m, "titulo": titulo, "modo": modo,
               "id": if texto(&g["id"]).is_empty() { json!("") } else { g["id"].clone() },
               "nombre": g["nombre"].as_str().unwrap_or("")})
    }).collect::<Vec<_>>())
}

pub fn fijar_tarea_local(e: &Estado, motivo: &str, modo: &str, wp_id: &Value, nombre: &str) -> Result<Value, String> {
    if !TITULOS_LOCAL.iter().any(|(m, _)| *m == motivo) {
        return Ok(json!({"error": format!("Motivo desconocido: {motivo}")}));
    }
    let valor = match modo {
        "auto" => Value::Null,
        "ninguna" => json!({"ninguna": true}),
        "tarea" => match texto(wp_id).trim().trim_start_matches('#').parse::<i64>() {
            Ok(wp) => json!({"id": wp, "nombre": nombre.trim().chars().take(200).collect::<String>()}),
            Err(_) => return Ok(json!({"error": "Elige una tarea de la lista."})),
        },
        _ => return Ok(json!({"error": format!("Modo desconocido: {modo}")})),
    };
    config::modificar(|cfg| {
        let mut m = cfg.get("tareas_local").and_then(Value::as_object).cloned().unwrap_or_default();
        if valor.is_null() { m.remove(motivo); } else { m.insert(motivo.into(), valor); }
        cfg.insert("tareas_local".into(), Value::Object(m));
    })?;
    candado(&e.ausencias).remove(motivo);
    Ok(json!({"ok": true, "filas": tareas_local(&config::leer()?)}))
}

pub fn no_avisar_local(motivo: &str) -> Result<Value, String> {
    let lista = config::modificar(|cfg| {
        let mut l: Vec<Value> = cfg.get("avisos_local_no").and_then(Value::as_array).cloned().unwrap_or_default();
        if !l.iter().any(|x| x.as_str() == Some(motivo)) {
            l.push(json!(motivo));
        }
        cfg.insert("avisos_local_no".into(), Value::Array(l.clone()));
        l
    })?;
    Ok(json!({"ok": true, "avisos_local_no": lista}))
}

/// La tarea de ProyectosTIC donde este usuario imputaria ese motivo, o null.
/// De mas fiable a menos: la elegida en Herramientas > Permisos, la asociada
/// a mano, habituales y favoritas por el nombre y una busqueda (sin red: null).
pub async fn tarea_ausencia(e: &Estado, cfg: &Cfg, motivo: &str, habituales: &[Value], favoritas: &[Value]) -> Value {
    let pal = palabras(motivo);
    if pal.is_empty() {
        return Value::Null;
    }
    let elegida = cfg.objeto("tareas_local").get(motivo).cloned().unwrap_or(json!({}));
    if elegida["ninguna"].as_bool() == Some(true) {
        return Value::Null;
    }
    if let Ok(id) = texto(&elegida["id"]).parse::<i64>() {
        let nombre = elegida["nombre"].as_str().filter(|s| !s.is_empty()).map(String::from).unwrap_or(format!("Tarea {id}"));
        return json!({"id": id, "nombre": nombre, "proyecto": "", "padre": "", "actividad": ""});
    }
    let encaja = |t: &str| { let t = sin_tildes(t); pal.iter().any(|p| t.contains(p)) };
    let reglas = Reglas::desde(cfg);
    let acts_permiso: Vec<String> = reglas.tipos.iter().map(|t| t.actividad.clone()).collect();
    for (act, wp) in cfg.objeto("tareas_actividad") {
        if encaja(&act) || (motivo == "permiso" && acts_permiso.contains(&act)) {
            let Ok(wp) = texto(&wp).parse::<i64>() else { continue };
            let nombre = favoritas.iter().find(|t| t["id"].as_i64() == Some(wp))
                .and_then(|t| t["nombre"].as_str()).map(String::from).unwrap_or(format!("Tarea {wp}"));
            return json!({"id": wp, "nombre": nombre, "proyecto": "", "padre": "", "actividad": act});
        }
    }
    let candidatas = habituales.iter().filter_map(|h| Some((texto(&h["wp_id"]).parse::<i64>().ok()?, texto(&h["tarea"]), texto(&h["actividad"]))))
        .chain(favoritas.iter().filter_map(|t| Some((t["id"].as_i64()?, texto(&t["nombre"]), String::new()))));
    for (id, nombre, act) in candidatas {
        if encaja(&nombre) {
            return json!({"id": id, "nombre": nombre, "actividad": act, "proyecto": "", "padre": ""});
        }
    }
    if let Some(v) = candado(&e.ausencias).get(motivo) {
        return v.clone();
    }
    let Ok(cli) = Cliente::desde(cfg) else { return Value::Null };
    let buscar = if motivo == "permiso" { "permiso" } else { pal[0] };
    match cli.buscar_wp(buscar).await {
        Ok(ts) => {
            let r = ts.into_iter().find(|t| encaja(t["nombre"].as_str().unwrap_or("")))
                .map(|mut t| { t["actividad"] = json!(""); t }).unwrap_or(Value::Null);
            candado(&e.ausencias).insert(motivo.into(), r.clone());
            r
        }
        Err(_) => Value::Null, // sin red: se reintenta otra vez
    }
}

// ---------------------------------------------------------------- plantillas y copiar

pub fn plantillas(cfg: &Cfg) -> Value {
    json!(cfg.lista("plantillas").iter().map(|p| {
        let aps = p["apuntes"].as_array().cloned().unwrap_or_default();
        let total: f64 = aps.iter().filter_map(|a| a["horas"].as_f64()).sum();
        json!({"nombre": p["nombre"], "n": aps.len(), "total": fmt_horas(total)})
    }).collect::<Vec<_>>())
}

pub fn guardar_plantilla_dia(e: &Estado, iso: &str, nombre: &str) -> Result<Value, String> {
    let nombre = nombre.trim();
    let aps = e.cargados(iso).unwrap_or_default();
    if nombre.is_empty() {
        return Ok(json!({"error": "Ponle un nombre a la plantilla."}));
    }
    if aps.is_empty() {
        return Ok(json!({"error": "Ese día no tiene apuntes de ProyectosTic que guardar."}));
    }
    let nueva = json!({"nombre": nombre, "apuntes": aps.iter().map(|a| json!({
        "id": a.wp_id, "nombre": a.wp_titulo, "horas": a.horas, "comentario": a.comentario, "actividad": a.actividad
    })).collect::<Vec<_>>()});
    config::modificar(|cfg| {
        let mut ps: Vec<Value> = cfg.get("plantillas").and_then(Value::as_array).cloned().unwrap_or_default();
        ps.retain(|p| p["nombre"].as_str() != Some(nombre));
        ps.push(nueva);
        cfg.insert("plantillas".into(), Value::Array(ps));
    })?;
    Ok(json!({"ok": true, "n": aps.len()}))
}

pub fn eliminar_plantilla(nombre: &str) -> Result<Value, String> {
    config::modificar(|cfg| {
        let mut ps: Vec<Value> = cfg.get("plantillas").and_then(Value::as_array).cloned().unwrap_or_default();
        ps.retain(|p| p["nombre"].as_str() != Some(nombre));
        cfg.insert("plantillas".into(), Value::Array(ps));
    })?;
    Ok(plantillas(&config::leer()?))
}

/// Crea los apuntes en cada dia destino. Nunca a ciegas: un dia que no se
/// pudo leer se salta (podria duplicar), y una tarea que ya esta ese dia, tambien.
async fn copiar(e: &Estado, cfg: &Cfg, pares: Vec<(String, Vec<Apunte>)>, saltar_no_laborables: bool) -> Result<Value, String> {
    let cli = Cliente::desde(cfg).map_err(|x| x.to_string())?;
    let reglas = Reglas::desde(cfg);
    let (mut creados, mut saltados, mut errores, mut ultimo) = (0, 0, 0, String::new());
    let mut deshacer = Vec::new();
    for (iso, aps) in pares {
        if saltar_no_laborables && reglas.es_no_laborable(&iso) {
            saltados += aps.len();
            continue;
        }
        let Some(existentes) = e.cargados(&iso) else {
            errores += aps.len();
            ultimo = format!("no se pudieron leer los apuntes del {}; se ha saltado",
                             fecha(&iso).map(|d| d.format("%d/%m").to_string()).unwrap_or(iso.clone()));
            continue;
        };
        for a in aps {
            if existentes.iter().any(|x| x.wp_id == a.wp_id) {
                saltados += 1;
                continue;
            }
            match e.crear(&cli, &iso, &a.wp_id, a.horas, &a.comentario, &a.actividad).await {
                Ok(nuevo) => {
                    deshacer.extend(nuevo.map(|id| Paso::Borrar { id }));
                    creados += 1;
                }
                Err(err) => { errores += 1; ultimo = err.to_string(); }
            }
        }
    }
    let puede = e.apilar(format!("copiar {creados} apunte(s)"), deshacer);
    Ok(json!({"creados": creados, "saltados": saltados, "errores": errores, "ultimo": ultimo,
              "puede_deshacer": puede, "quedan": e.quedan()}))
}

pub async fn aplicar_plantilla(e: &Estado, cfg: &Cfg, nombre: &str, dias: &[String]) -> Result<Value, String> {
    let Some(p) = cfg.lista("plantillas").into_iter().find(|p| p["nombre"].as_str() == Some(nombre)) else {
        return Ok(json!({"error": "Esa plantilla ya no existe."}));
    };
    if dias.is_empty() {
        return Ok(json!({"error": "Marca al menos un día de destino."}));
    }
    let aps: Vec<Apunte> = p["apuntes"].as_array().cloned().unwrap_or_default().iter().map(|a| Apunte {
        wp_id: texto(&a["id"]), horas: a["horas"].as_f64().unwrap_or(0.0),
        comentario: texto(&a["comentario"]), actividad: texto(&a["actividad"]), ..Default::default()
    }).collect();
    let mut destino = dias.to_vec();
    destino.sort();
    copiar(e, cfg, destino.into_iter().map(|i| (i, aps.clone())).collect(), false).await
}

fn lineas(aps: &[Apunte]) -> Vec<String> {
    aps.iter().map(|a| format!("{}  {}", fmt_horas(a.horas), a.wp_titulo)).collect()
}

/// El ultimo dia laborable con horas (14 dias atras) antes del primero
/// marcado; con origen (Ctrl+C / Ctrl+V), ESE dia. Deja la copia preparada.
pub async fn preparar_copia_dia(e: &Estado, cfg: &Cfg, dias: &[String], origen: &str) -> Result<Value, String> {
    if dias.is_empty() {
        return Ok(json!({"error": "Marca al menos un día de destino."}));
    }
    let (cli, uid) = cliente_y_uid(e, cfg).await?;
    if !origen.is_empty() {
        let o = fecha(origen)?;
        let aps = cli.entradas_rango(&uid, origen, origen).await.map_err(|x| x.to_string())?;
        if aps.is_empty() {
            return Ok(json!({"vacio": format!("El {} ya no tiene apuntes que copiar.", o.format("%d/%m"))}));
        }
        let mut destino: Vec<String> = dias.iter().filter(|i| *i != origen).cloned().collect();
        destino.sort();
        if destino.is_empty() {
            return Ok(json!({"error": "Elige otro día: no se puede pegar un día sobre sí mismo."}));
        }
        let r = json!({"origen": dia_largo(o), "lineas": lineas(&aps), "n": aps.len(), "dias": destino.len()});
        *candado(&e.copia) = Some(("dia".into(), destino.into_iter().map(|i| (i, aps.clone())).collect()));
        return Ok(r);
    }
    let primero = fecha(dias.iter().min().unwrap())?;
    let aps = cli.entradas_rango(&uid, &(primero - Duration::days(14)).to_string(), &(primero - Duration::days(1)).to_string())
        .await.map_err(|x| x.to_string())?;
    let mut por_dia: HashMap<String, Vec<Apunte>> = HashMap::new();
    for a in aps {
        por_dia.entry(a.fecha.clone()).or_default().push(a);
    }
    for i in 1..=14 {
        let d = primero - Duration::days(i);
        if d.weekday().num_days_from_monday() >= 5 {
            continue;
        }
        if let Some(aps) = por_dia.get(&d.to_string()).filter(|v| !v.is_empty()) {
            let mut destino = dias.to_vec();
            destino.sort();
            let r = json!({"origen": dia_largo(d), "lineas": lineas(aps), "n": aps.len(), "dias": dias.len()});
            *candado(&e.copia) = Some(("dia".into(), destino.into_iter().map(|x| (x, aps.clone())).collect()));
            return Ok(r);
        }
    }
    Ok(json!({"vacio": format!("No hay apuntes en los 14 días anteriores al {}.", primero.format("%d/%m"))}))
}

pub async fn preparar_copia_semana(e: &Estado, cfg: &Cfg, lunes_iso: &str) -> Result<Value, String> {
    let lunes = fecha(lunes_iso)?;
    let (cli, uid) = cliente_y_uid(e, cfg).await?;
    let o0 = lunes - Duration::days(7);
    let aps = cli.entradas_rango(&uid, &o0.to_string(), &(o0 + Duration::days(4)).to_string()).await.map_err(|x| x.to_string())?;
    let mut leidos: HashMap<String, Vec<Apunte>> = HashMap::new();
    for a in aps {
        leidos.entry(a.fecha.clone()).or_default().push(a);
    }
    let total: usize = leidos.values().map(Vec::len).sum();
    if total == 0 {
        return Ok(json!({"vacio": format!("La semana del {} no tiene apuntes.", o0.format("%d/%m"))}));
    }
    let mut pares = Vec::new();
    let mut lins = Vec::new();
    for i in 0..5 {
        let o = (o0 + Duration::days(i)).to_string();
        let v = leidos.get(&o).cloned().unwrap_or_default();
        if !v.is_empty() {
            lins.push(format!("{}: {} apunte(s), {}", DIAS_ES[i as usize], v.len(), fmt_horas(v.iter().map(|a| a.horas).sum())));
        }
        pares.push(((lunes + Duration::days(i)).to_string(), v));
    }
    *candado(&e.copia) = Some(("semana".into(), pares));
    Ok(json!({"origen": o0.format("%d/%m").to_string(), "n": total, "lineas": lins}))
}

pub async fn ejecutar_copia(e: &Estado, cfg: &Cfg) -> Result<Value, String> {
    let Some((tipo, pares)) = candado(&e.copia).take() else {
        return Ok(json!({"error": "No hay ninguna copia preparada."}));
    };
    copiar(e, cfg, pares, tipo == "semana").await
}

// ---------------------------------------------------------------- asociar actividad <-> tarea

pub fn asociaciones(cfg: &Cfg) -> Value {
    Value::Object(cfg.objeto("tareas_actividad").into_iter()
        .filter_map(|(k, v)| texto(&v).parse::<i64>().ok().map(|id| (k, json!(id)))).collect())
}

pub fn asociar(wp_id: &str, actividad: &str) -> Result<Value, String> {
    let wp: i64 = wp_id.trim().parse().map_err(|_| "Tarea no válida.".to_string())?;
    config::modificar(|cfg| {
        let mut por_tarea = cfg.get("actividades_tarea").and_then(Value::as_object).cloned().unwrap_or_default();
        let mut por_act = cfg.get("tareas_actividad").and_then(Value::as_object).cloned().unwrap_or_default();
        por_tarea.insert(wp.to_string(), json!(actividad));
        por_act.insert(actividad.into(), json!(wp));
        cfg.insert("actividades_tarea".into(), Value::Object(por_tarea));
        cfg.insert("tareas_actividad".into(), Value::Object(por_act));
    })?;
    Ok(asociaciones(&config::leer()?))
}

pub fn desasociar(actividad: &str) -> Result<Value, String> {
    config::modificar(|cfg| {
        let mut por_act = cfg.get("tareas_actividad").and_then(Value::as_object).cloned().unwrap_or_default();
        let mut por_tarea = cfg.get("actividades_tarea").and_then(Value::as_object).cloned().unwrap_or_default();
        if let Some(wp) = por_act.remove(actividad) {
            por_tarea.remove(&texto(&wp));
        }
        cfg.insert("actividades_tarea".into(), Value::Object(por_tarea));
        cfg.insert("tareas_actividad".into(), Value::Object(por_act));
    })?;
    Ok(asociaciones(&config::leer()?))
}

// ---------------------------------------------------------------- resumen del mes

pub async fn resumen_mes(e: &Estado, cfg: &Cfg, anio: i32, mes: u32, hoy: NaiveDate) -> Result<Value, String> {
    if !(1..=12).contains(&mes) {
        return Err("Mes no válido.".into());
    }
    let primero = NaiveDate::from_ymd_opt(anio, mes, 1).unwrap();
    let ultimo = if mes == 12 { NaiveDate::from_ymd_opt(anio + 1, 1, 1) } else { NaiveDate::from_ymd_opt(anio, mes + 1, 1) }.unwrap() - Duration::days(1);
    let (cli, uid) = cliente_y_uid(e, cfg).await?;
    let aps = cli.entradas_rango(&uid, &primero.to_string(), &ultimo.to_string()).await.map_err(|x| x.to_string())?;
    let mut por_dia: HashMap<String, Vec<Apunte>> = HashMap::new();
    for a in aps {
        por_dia.entry(a.fecha.clone()).or_default().push(a);
    }
    let reglas = Reglas::desde(cfg);
    let acts = reglas.actividades_de_permiso();
    let (mut total, mut obj_hoy, mut obj_mes) = (0.0, 0.0, 0.0);
    let mut incompletos = Vec::new();
    let mut d = primero;
    while d <= ultimo {
        if d.weekday().num_days_from_monday() < 5 {
            let ap = por_dia.get(&d.to_string());
            let obj = reglas.objetivo_dia(d, ap.map(|v| v.as_slice()), &acts);
            obj_mes += obj;
            let reg: f64 = ap.map(|v| v.iter().map(|a| a.horas).sum()).unwrap_or(0.0);
            total += reg;
            if d <= hoy {
                obj_hoy += obj;
                if obj > 0.0 && reg < obj - 0.001 {
                    incompletos.push(json!({"iso": d.to_string(), "dia": dia_largo(d),
                                            "horas": format!("{} / {}", fmt_horas(reg), fmt_horas(obj))}));
                }
            }
        }
        d += Duration::days(1);
    }
    let al_dia = total >= obj_hoy - 0.001;
    let nombre = MESES[mes as usize - 1];
    Ok(json!({
        "titulo": format!("{}{} {anio}", nombre[..1].to_uppercase(), &nombre[1..]),
        "registrado": fmt_horas(total), "objetivo_hoy": fmt_horas(obj_hoy), "objetivo_mes": fmt_horas(obj_mes),
        "al_dia": al_dia,
        "estado": if al_dia { "Al día ✔".to_string() } else { format!("Te faltan {} para estar al día", fmt_horas(obj_hoy - total)) },
        "frac": crate::reglas::redondear(if obj_mes > 0.0 { (total / obj_mes).clamp(0.0, 1.0) } else { 0.0 }, 3),
        "teletrabajo": "",
        "incompletos": incompletos,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sin_tildes_como_python() {
        assert_eq!(sin_tildes("Vacaciones Ñandú CONCILIACIÓN"), "vacaciones nandu conciliacion");
    }

    #[test]
    fn palabras_por_motivo() {
        assert!(palabras("guardia").contains(&"guardia"));
        assert!(palabras("festivo").is_empty());
    }
}
