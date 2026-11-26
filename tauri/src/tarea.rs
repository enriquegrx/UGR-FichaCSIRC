//! Las tareas de ProyectosTIC desde la app: crearlas, las plantillas de tarea,
//! modificar una que ya existe y duplicar una con todas las que cuelgan de
//! ella. Port de registrar_web.py.

use crate::api::{candado, favorita, id_entero, tareas, Estado};
use crate::apuntes::horas_de;
use crate::config::{self, Cfg};
use crate::openproject::{self, Cliente, ErrorOp};
use serde_json::{json, Map, Value};

/// Titulo de una tarea: como mucho, lo que admite ProyectosTIC.
const MAX_TITULO: usize = 255;
const MAX_ESTIMADO: f64 = 10000.0;
const MAX_PLANTILLAS: usize = 40;
const MAX_NOMBRE_PLANTILLA: usize = 60;
const MAX_DESCRIPCION: usize = 10000;
/// Duplicar: tope de tareas del arbol (cada una son dos llamadas).
pub const MAX_DUPLICAR: usize = 200;

const NO_ESTA: &str = "ProyectosTIC no encuentra la tarea: ya no existe o no la ves.";

fn error(m: impl Into<String>) -> Result<Value, String> {
    Ok(json!({"error": m.into()}))
}

/// "  Con   espacios " -> "Con espacios"
fn en_una_linea(v: &Value) -> String {
    v.as_str().unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// El titulo de una tarea, limpio; o por que no vale.
fn titulo_valido(v: &Value) -> Result<String, String> {
    let t = en_una_linea(v);
    if t.is_empty() {
        return Err("Escribe el título de la tarea.".into());
    }
    if t.chars().count() > MAX_TITULO {
        return Err(format!("El título es demasiado largo: como mucho, {MAX_TITULO} letras."));
    }
    Ok(t)
}

/// El tiempo estimado: vacio (None) o las horas ("1", "1,5", 1.5); o por que no vale.
pub fn estimado_de(v: &Value) -> Result<Option<f64>, String> {
    if v.is_null() || v.as_str().is_some_and(|s| s.trim().is_empty()) {
        return Ok(None);
    }
    match horas_de(v) {
        Some(h) if h > 0.0 && h <= MAX_ESTIMADO => Ok(Some(h)),
        _ => Err("El tiempo estimado no vale: escribe las horas (ej. 1 o 1,5).".into()),
    }
}

/// Lo que se le dice al usuario cuando ProyectosTIC no acepta algo o no
/// responde (sin respuesta no se sabe si llego: que no lo repita a ciegas).
fn rechazo(err: ErrorOp, sin_respuesta: &str) -> Result<Value, String> {
    match err {
        ErrorOp::Otro(m) => error(m),
        err @ ErrorOp::Red(_) => error(format!("{err} {sin_respuesta}").trim_end()),
        err => Err(err.to_string()),
    }
}

// ---------------------------------------------------------------- crear

/// Crea una tarea en ProyectosTIC y la deja en el desplegable (o en favoritas).
/// d: {proyecto, titulo, tipo, padre, descripcion, estimado, asignar, asignado, favorita}
/// asignado: el numero de la persona a la que se asigna; sin el, asignar
/// (true) se la asigna al usuario.
pub async fn crear(e: &Estado, cfg: &Cfg, d: &Value) -> Result<Value, String> {
    let Some(pid) = id_entero(&d["proyecto"]) else { return error("Elige el proyecto de la tarea.") };
    let titulo = match titulo_valido(&d["titulo"]) {
        Ok(t) => t,
        Err(m) => return error(m),
    };
    let estimado = match estimado_de(&d["estimado"]) {
        Ok(h) => h,
        Err(m) => return error(m),
    };
    let cli = Cliente::desde(cfg).map_err(|err| err.to_string())?;
    let asignado = if let Some(otro) = id_entero(&d["asignado"]).filter(|n| *n > 0) {
        Some(otro.to_string())
    } else if d["asignar"].as_bool().unwrap_or(false) {
        Some(e.uid(&cli).await.map_err(|err| err.to_string())?)
    } else {
        None
    };
    let mut cuerpo = openproject::cuerpo_tarea(pid, &titulo, id_entero(&d["tipo"]), id_entero(&d["padre"]),
                                               d["descripcion"].as_str().unwrap_or(""), asignado.as_deref());
    openproject::poner_estimado(&mut cuerpo, estimado);
    let creada = match cli.crear_tarea(&cuerpo, true).await {
        Ok(w) => w,
        Err(err) => return rechazo(err, "Antes de repetirla, mira en ProyectosTIC si la tarea llegó a crearse."),
    };
    let Some(t) = openproject::wp_resumen(&creada) else {
        return error("ProyectosTIC ha respondido, pero sin los datos de la tarea. Mira allí si se ha creado.");
    };
    let id = t["id"].as_i64().unwrap_or(0);
    let nombre = t["nombre"].as_str().unwrap_or(&titulo).to_string();
    if d["favorita"].as_bool().unwrap_or(false) {
        favorita(e, &config::leer()?, id, &nombre, true)?;
    } else {
        let mut ex = candado(&e.extras);
        if !ex.iter().any(|x| id_entero(&x["id"]) == Some(id)) {
            ex.insert(0, json!({"id": id, "nombre": nombre}));
        }
    }
    // la proxima vez, el mismo proyecto ya elegido
    let mut m = Map::new();
    m.insert("nueva_tarea_proyecto".into(), json!(pid));
    let _ = config::guardar_valores(m);
    Ok(json!({"ok": true, "tarea": t, "tareas": tareas(e, &config::leer()?)}))
}

/// A quien se le puede asignar una tarea del proyecto: sus miembros con un rol
/// asignable (solo personas) y cual de ellos es el usuario. Si ProyectosTIC no
/// deja ver la lista, va vacia y se dice.
pub async fn asignables(e: &Estado, cfg: &Cfg, pid: &Value) -> Result<Value, String> {
    let pid = id_entero(pid).ok_or("Proyecto no válido.")?;
    let cli = Cliente::desde(cfg).map_err(|err| err.to_string())?;
    let yo = e.uid(&cli).await.map_err(|err| err.to_string())?.parse::<i64>().ok();
    match cli.asignables(pid).await {
        Ok(ps) => Ok(json!({"yo": yo, "personas": ps})),
        Err(ErrorOp::Http(403 | 404)) => Ok(json!({"yo": yo, "personas": [],
            "error": "ProyectosTIC no te deja ver a quién se puede asignar en este proyecto."})),
        Err(err) => Err(err.to_string()),
    }
}

// ---------------------------------------------------------------- plantillas de tarea

/// Una plantilla de tarea tal como se guarda: lo que rellena el dialogo de
/// Nueva tarea. Solo el nombre es obligatorio; en el titulo, un * marca lo
/// que se cambia cada vez ("Incidencia de Iris con ticket: *").
pub fn plantilla_limpia(p: &Value) -> Result<Value, String> {
    let nombre = en_una_linea(&p["nombre"]);
    if nombre.is_empty() {
        return Err("Ponle un nombre a la plantilla.".into());
    }
    if nombre.chars().count() > MAX_NOMBRE_PLANTILLA {
        return Err(format!("El nombre es demasiado largo: como mucho, {MAX_NOMBRE_PLANTILLA} letras."));
    }
    let titulo = en_una_linea(&p["titulo"]);
    if titulo.chars().count() > MAX_TITULO {
        return Err(format!("El título es demasiado largo: como mucho, {MAX_TITULO} letras."));
    }
    let descripcion = p["descripcion"].as_str().unwrap_or("").trim();
    if descripcion.chars().count() > MAX_DESCRIPCION {
        return Err("La descripción es demasiado larga para guardarla en una plantilla.".into());
    }
    let padre = id_entero(&p["padre"]["id"]).filter(|n| *n > 0)
        .map(|id| json!({"id": id, "nombre": en_una_linea(&p["padre"]["nombre"])}));
    Ok(json!({"nombre": nombre, "titulo": titulo,
              "proyecto": id_entero(&p["proyecto"]), "tipo": id_entero(&p["tipo"]), "padre": padre,
              "estimado": estimado_de(&p["estimado"])?, "descripcion": descripcion,
              "asignar": p["asignar"].as_bool().unwrap_or(false),
              "favorita": p["favorita"].as_bool().unwrap_or(false)}))
}

/// Las plantillas de tarea guardadas (las que no valgan, fuera).
pub fn plantillas(cfg: &Cfg) -> Vec<Value> {
    cfg.lista("plantillas_tarea").iter().filter_map(|p| plantilla_limpia(p).ok()).collect()
}

fn mismo_nombre(p: &Value, nombre: &str) -> bool {
    p["nombre"].as_str().unwrap_or("").to_lowercase() == nombre.to_lowercase()
}

/// 'lista' con la plantilla nueva: sustituye a la del mismo nombre o va al final.
pub fn con_plantilla(mut lista: Vec<Value>, nueva: Value) -> Result<Vec<Value>, String> {
    let nombre = nueva["nombre"].as_str().unwrap_or("").to_string();
    match lista.iter().position(|x| mismo_nombre(x, &nombre)) {
        Some(i) => lista[i] = nueva,
        None if lista.len() >= MAX_PLANTILLAS => {
            return Err(format!("Ya tienes {MAX_PLANTILLAS} plantillas de tarea: borra alguna antes de guardar otra."));
        }
        None => lista.push(nueva),
    }
    Ok(lista)
}

fn escribir_plantillas(lista: Vec<Value>) -> Result<Value, String> {
    let mut m = Map::new();
    m.insert("plantillas_tarea".into(), json!(lista));
    config::guardar_valores(m)?;
    Ok(json!({"plantillas": lista}))
}

pub fn guardar_plantilla(cfg: &Cfg, p: &Value) -> Result<Value, String> {
    match plantilla_limpia(p).and_then(|nueva| con_plantilla(plantillas(cfg), nueva)) {
        Ok(lista) => escribir_plantillas(lista),
        Err(m) => error(m),
    }
}

pub fn borrar_plantilla(cfg: &Cfg, nombre: &str) -> Result<Value, String> {
    let mut lista = plantillas(cfg);
    lista.retain(|p| !mismo_nombre(p, nombre.trim()));
    escribir_plantillas(lista)
}

// ---------------------------------------------------------------- modificar

/// Lo que el dialogo de Modificar ensena de una tarea y lo que ProyectosTIC
/// deja cambiarle (lo dice su formulario, que no cambia nada).
pub async fn datos(cfg: &Cfg, id: &Value) -> Result<Value, String> {
    let Some(id) = id_entero(id).filter(|n| *n > 0) else { return error("Elige la tarea.") };
    let cli = Cliente::desde(cfg).map_err(|err| err.to_string())?;
    let w = match cli.tarea(id).await {
        Ok(w) => w,
        Err(ErrorOp::Http(403 | 404)) => return error(NO_ESTA),
        Err(err) => return Err(err.to_string()),
    };
    // si el formulario no responde se da por bueno: lo que no deje, lo dira al guardar
    let form = if openproject::es_editable(&w) {
        cli.formulario_cambio(id, w["lockVersion"].as_i64().unwrap_or(0)).await.ok()
    } else {
        None
    };
    match openproject::datos_tarea(&w, form.as_ref()) {
        Some(t) => Ok(t),
        None => error("ProyectosTIC ha respondido, pero sin los datos de la tarea."),
    }
}

/// (titulo, descripcion, estimado, padre, asignado): None = no se toca; Some(None) = se quita.
type Cambios = (Option<String>, Option<String>, Option<Option<f64>>, Option<Option<i64>>, Option<Option<i64>>);

/// Lo que cambia de una tarea. d: {id, version} y SOLO lo que cambia: titulo,
/// descripcion, estimado ("" o null lo quita), padre (null: que no cuelgue de
/// ninguna), asignado (null: sin asignar). O por que no vale.
pub fn cambios_de(id: i64, d: &Value) -> Result<Cambios, String> {
    let tiene = |k: &str| d.get(k).is_some();
    let titulo = if tiene("titulo") { Some(titulo_valido(&d["titulo"])?) } else { None };
    let descripcion = tiene("descripcion").then(|| d["descripcion"].as_str().unwrap_or("").trim().to_string());
    let estimado = if tiene("estimado") { Some(estimado_de(&d["estimado"])?) } else { None };
    let padre = tiene("padre").then(|| id_entero(&d["padre"]).filter(|n| *n > 0));
    if padre == Some(Some(id)) {
        return Err("Una tarea no puede colgar de sí misma.".into());
    }
    let asignado = tiene("asignado").then(|| id_entero(&d["asignado"]).filter(|n| *n > 0));
    if titulo.is_none() && descripcion.is_none() && estimado.is_none() && padre.is_none() && asignado.is_none() {
        return Err("No has cambiado nada.".into());
    }
    Ok((titulo, descripcion, estimado, padre, asignado))
}

/// El nombre nuevo de una tarea, tambien donde la app lo tiene guardado.
fn renombrar(e: &Estado, cfg: &Cfg, id: i64, nombre: &str) -> Result<(), String> {
    for x in candado(&e.extras).iter_mut() {
        if id_entero(&x["id"]) == Some(id) {
            x["nombre"] = json!(nombre);
        }
    }
    let mut favs = cfg.lista("favoritos");
    let mut cambia = false;
    for f in favs.iter_mut() {
        if id_entero(&f["id"]) == Some(id) && f["nombre"].as_str() != Some(nombre) {
            f["nombre"] = json!(nombre);
            cambia = true;
        }
    }
    if cambia {
        let mut m = Map::new();
        m.insert("favoritos".into(), Value::Array(favs));
        config::guardar_valores(m)?;
    }
    Ok(())
}

pub async fn modificar(e: &Estado, cfg: &Cfg, d: &Value) -> Result<Value, String> {
    let Some(id) = id_entero(&d["id"]).filter(|n| *n > 0) else { return error("Elige la tarea.") };
    let Some(version) = d["version"].as_i64() else {
        return error("Vuelve a abrir la tarea antes de modificarla.");
    };
    let (titulo, descripcion, estimado, padre, asignado) = match cambios_de(id, d) {
        Ok(c) => c,
        Err(m) => return error(m),
    };
    let cli = Cliente::desde(cfg).map_err(|err| err.to_string())?;
    let cuerpo = openproject::cuerpo_cambio(version, titulo.as_deref(), descripcion.as_deref(), estimado, padre, asignado);
    let w = match cli.modificar_tarea(id, &cuerpo).await {
        Ok(w) => w,
        Err(err) => return rechazo(err, "Antes de repetirlo, mira en ProyectosTIC si el cambio llegó a guardarse."),
    };
    let Some(t) = openproject::wp_resumen(&w) else {
        return error("ProyectosTIC ha respondido, pero sin los datos de la tarea. Mira allí si se ha guardado.");
    };
    renombrar(e, cfg, id, t["nombre"].as_str().unwrap_or(""))?;
    Ok(json!({"ok": true, "tarea": t, "tareas": tareas(e, &config::leer()?)}))
}

// ---------------------------------------------------------------- duplicar

/// El arbol que se duplicaria: la tarea y todas las que cuelgan de ella
/// (abiertas y cerradas), cada una con su tipo y de cual cuelga.
pub async fn plan_duplicar(cfg: &Cfg, id: &Value) -> Result<Value, String> {
    let Some(id) = id_entero(id).filter(|n| *n > 0) else { return error("Elige la tarea que quieres duplicar.") };
    let cli = Cliente::desde(cfg).map_err(|err| err.to_string())?;
    let raiz = match cli.tarea(id).await {
        Ok(w) => w,
        Err(ErrorOp::Http(403 | 404)) => return error(NO_ESTA),
        Err(err) => return Err(err.to_string()),
    };
    // sin la lista de estados no se sabe cuales estan cerradas: se dan por abiertas
    let cerrados = cli.estados_cerrados().await.unwrap_or_default();
    let Some(resto) = cli.descendientes(id, MAX_DUPLICAR - 1).await.map_err(|err| err.to_string())? else {
        return error(format!("De esta tarea cuelgan más de {MAX_DUPLICAR} tareas: son demasiadas para duplicarlas desde aquí."));
    };
    let nodos: Vec<Value> = std::iter::once(&raiz).chain(resto.iter())
        .filter_map(|w| openproject::nodo_plan(w, &cerrados)).collect();
    Ok(json!({"raiz": id, "tareas": nodos,
              "proyecto": {"id": openproject::id_de_href(&raiz["_links"]["project"]["href"]),
                           "nombre": raiz["_links"]["project"]["title"].as_str().unwrap_or("")}}))
}

/// Crea la copia de UNA tarea del arbol (la interfaz va de arriba abajo y dice
/// de cual cuelga cada copia). d: {origen, proyecto, padre, titulo, tipo,
/// estimado}. Se copian titulo, tipo, descripcion, prioridad y tiempo
/// estimado; ni horas, ni asignacion, ni fechas. Sin avisos por correo.
pub async fn duplicar_una(cfg: &Cfg, d: &Value) -> Result<Value, String> {
    let Some(origen) = id_entero(&d["origen"]).filter(|n| *n > 0) else { return error("Falta la tarea de origen.") };
    let Some(pid) = id_entero(&d["proyecto"]) else { return error("Elige el proyecto de destino.") };
    let titulo = match titulo_valido(&d["titulo"]) {
        Ok(t) => t,
        Err(m) => return error(m),
    };
    let cli = Cliente::desde(cfg).map_err(|err| err.to_string())?;
    let w = match cli.tarea(origen).await {
        Ok(w) => w,
        Err(ErrorOp::Http(403 | 404)) => return error(NO_ESTA),
        Err(err) => return rechazo(err, ""),
    };
    let cuerpo = openproject::cuerpo_copia(&w, pid, &titulo, id_entero(&d["tipo"]),
                                           id_entero(&d["padre"]).filter(|n| *n > 0),
                                           d["estimado"].as_bool().unwrap_or(false));
    let creada = match cli.crear_tarea(&cuerpo, false).await {
        Ok(c) => c,
        Err(err) => return rechazo(err, "Antes de seguir, mira en ProyectosTIC si esta tarea llegó a crearse."),
    };
    match openproject::wp_resumen(&creada) {
        Some(t) => Ok(json!({"ok": true, "tarea": t})),
        None => error("ProyectosTIC ha respondido, pero sin los datos de la tarea. Mira allí si se ha creado."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_tiempo_estimado() {
        assert_eq!(estimado_de(&Value::Null), Ok(None));
        assert_eq!(estimado_de(&json!("  ")), Ok(None));
        assert_eq!(estimado_de(&json!("1,5")), Ok(Some(1.5)));
        assert_eq!(estimado_de(&json!(2)), Ok(Some(2.0)));
        for malo in [json!("0"), json!(-1), json!("una hora"), json!(20000)] {
            assert!(estimado_de(&malo).is_err(), "{malo}");
        }
    }

    #[test]
    fn una_plantilla_de_tarea() {
        let p = plantilla_limpia(&json!({"nombre": "  Incidencia   de Iris ", "titulo": "Incidencia de Iris con ticket: *",
            "proyecto": "42", "tipo": 3, "padre": {"id": 11754, "nombre": "[2026_ATE] Servicio"},
            "estimado": "1", "descripcion": "  Abierta por Iris.\n", "asignar": true, "sobra": 1})).unwrap();
        assert_eq!(p, json!({"nombre": "Incidencia de Iris", "titulo": "Incidencia de Iris con ticket: *",
            "proyecto": 42, "tipo": 3, "padre": {"id": 11754, "nombre": "[2026_ATE] Servicio"},
            "estimado": 1.0, "descripcion": "Abierta por Iris.", "asignar": true, "favorita": false}));
        // solo el nombre es obligatorio
        let p = plantilla_limpia(&json!({"nombre": "Vacía"})).unwrap();
        assert_eq!((p["titulo"].clone(), p["proyecto"].clone(), p["padre"].clone(), p["estimado"].clone()),
                   (json!(""), Value::Null, Value::Null, Value::Null));
        assert!(plantilla_limpia(&json!({"nombre": "  "})).unwrap_err().contains("nombre"));
        assert!(plantilla_limpia(&json!({"nombre": "x".repeat(61)})).unwrap_err().contains("largo"));
        assert!(plantilla_limpia(&json!({"nombre": "x", "estimado": "mucho"})).unwrap_err().contains("estimado"));
    }

    #[test]
    fn guardar_una_plantilla_sustituye_a_la_del_mismo_nombre() {
        let p = |n: &str, t: &str| json!({"nombre": n, "titulo": t});
        let lista = con_plantilla(vec![p("Iris", "a"), p("Otra", "b")], p("iris", "c")).unwrap();
        assert_eq!(lista, vec![p("iris", "c"), p("Otra", "b")]);
        let lista = con_plantilla(lista, p("Nueva", "d")).unwrap();
        assert_eq!(lista.len(), 3);
        let llena: Vec<Value> = (0..MAX_PLANTILLAS).map(|i| p(&format!("P{i}"), "")).collect();
        assert!(con_plantilla(llena.clone(), p("Una más", "")).unwrap_err().contains("borra alguna"));
        assert_eq!(con_plantilla(llena, p("p3", "x")).unwrap().len(), MAX_PLANTILLAS);
    }

    #[test]
    fn lo_que_cambia_de_una_tarea() {
        // solo lo que viene: el padre a null es "que no cuelgue de ninguna"
        let (t, d, e, p, a) = cambios_de(7, &json!({"id": 7, "version": 3, "padre": null})).unwrap();
        assert_eq!((t, d, e, p, a), (None, None, None, Some(None), None));
        let (t, d, e, p, a) = cambios_de(7, &json!({"titulo": "  Otro   nombre ", "descripcion": " x ", "estimado": "", "padre": "12"})).unwrap();
        assert_eq!((t.as_deref(), d.as_deref(), e, p, a), (Some("Otro nombre"), Some("x"), Some(None), Some(Some(12)), None));
        // a quien se asigna: su numero, o null (o algo que no es un numero) para dejarla sin asignar
        assert_eq!(cambios_de(7, &json!({"asignado": 9})).unwrap().4, Some(Some(9)));
        assert_eq!(cambios_de(7, &json!({"asignado": null})).unwrap().4, Some(None));
        assert_eq!(cambios_de(7, &json!({"asignado": "nadie"})).unwrap().4, Some(None));
        assert!(cambios_de(7, &json!({"id": 7, "version": 3})).unwrap_err().contains("nada"));
        assert!(cambios_de(7, &json!({"padre": 7})).unwrap_err().contains("sí misma"));
        assert!(cambios_de(7, &json!({"titulo": " "})).unwrap_err().contains("título"));
        assert!(cambios_de(7, &json!({"estimado": "x"})).unwrap_err().contains("estimado"));
    }
}
