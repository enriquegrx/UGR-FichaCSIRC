//! El comando "api": cada llamada window.pywebview.api.X(...) de la interfaz
//! llega aqui como (metodo, args) y devuelve lo mismo que la clase Api de
//! registrar_web.py. Fase 1: abrir, PIN y ver la semana (solo lectura).

use crate::apuntes;
use crate::asistente;
use crate::ayuda;
use crate::herramientas as herr;
use crate::permisos as perm;
use crate::resumen;
use crate::sistema;
use crate::config::{self, Cfg};
use crate::openproject::{self, Cliente, ErrorOp};
use crate::pin;
use crate::reglas::{fmt_horas, Apunte, Reglas};
use base64::Engine;
use chrono::{Datelike, Duration, Local, NaiveDate, NaiveDateTime};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::Mutex;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
const GITHUB_REPO: &str = "enriquegrx/UGR-FichaCSIRC";
const LOGO_UGR: &[u8] = include_bytes!("../../logo_ugr.png");
const ACTIVIDADES: [&str; 5] = ["actuacion tecnica", "correctivo", "formacion", "gestion/planificacion", "soporte"];
const ZOOMS: [f64; 6] = [0.8, 0.9, 1.0, 1.1, 1.25, 1.4];
const TEMAS: [&str; 3] = ["sistema", "claro", "oscuro"];
const PIN_AUTO: [i64; 5] = [0, 5, 15, 30, 60];

#[derive(Default)]
pub struct Estado {
    usuario: Mutex<Option<Value>>,
    desbloqueada: Mutex<Option<bool>>,
    /// iso -> apuntes (None = no se pudo leer)
    pub(crate) cache: Mutex<HashMap<String, Option<Vec<Apunte>>>>,
    pub(crate) error: Mutex<Option<ErrorOp>>,
    /// tipo de permiso -> horas imputadas con su actividad (ultima lectura)
    pub(crate) usadas_pt: Mutex<Option<HashMap<String, f64>>>,
    /// tareas elegidas con Buscar en esta sesion ({id, nombre})
    extras: Mutex<Vec<Value>>,
    /// motivo -> tarea de ausencias encontrada buscando (o null)
    pub(crate) ausencias: Mutex<HashMap<String, Value>>,
    /// ultimo CSV exportado (el unico que se puede abrir desde la app)
    pub(crate) ultima_exportacion: Mutex<Option<std::path::PathBuf>>,
    /// pagina de la version nueva (Ayuda > Comprobar actualizaciones)
    pub(crate) pagina_actualizacion: Mutex<Option<String>>,
    /// aviso diario: el texto y los dias con huecos (dia, registrado, objetivo)
    pub(crate) aviso: Mutex<String>,
    pub(crate) pendientes: Mutex<Vec<(NaiveDate, f64, f64)>>,
    /// con icono en la bandeja, cerrar la ventana solo la esconde
    pub(crate) con_bandeja: std::sync::atomic::AtomicBool,
    /// se borro la config por olvidar el PIN (el asistente empieza de cero)
    pub(crate) de_cero: Mutex<bool>,
    /// fecha de la copia de la que se recupero la config al arrancar (una vez)
    recuperada: Mutex<String>,
    /// copia preparada (dia/semana anterior): (tipo, [(destino, apuntes)])
    pub(crate) copia: Mutex<Option<(String, Vec<(String, Vec<Apunte>)>)>>,
    /// acciones deshacibles, la ultima al final (Ctrl+Z repetido)
    pub(crate) pila: Mutex<Vec<crate::apuntes::Accion>>,
    /// id viejo -> id nuevo de los apuntes recreados al deshacer
    pub(crate) ids: Mutex<HashMap<String, String>>,
    /// wp_id -> [(actividad, href)]
    pub(crate) actividades: Mutex<HashMap<String, Vec<(String, String)>>>,
}

pub(crate) fn candado<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Estado {
    pub fn preparar_aviso(&self, pendientes: Vec<(NaiveDate, f64, f64)>) {
        *candado(&self.aviso) = sistema::mensaje_pendientes(&pendientes);
        *candado(&self.pendientes) = pendientes;
    }

    pub fn anotar_recuperada(&self, nombre: &str) {
        *candado(&self.recuperada) = crate::copias::fecha_de(nombre)
            .map(|f| f.format("%d/%m/%Y a las %H:%M").to_string()).unwrap_or_else(|| nombre.to_string());
    }

    /// Tras restaurar o importar: lo leido de ProyectosTIC y la config ya no valen.
    pub(crate) fn olvidar_lo_leido(&self) {
        candado(&self.usuario).take();
        candado(&self.cache).clear();
        candado(&self.usadas_pt).take();
        candado(&self.ausencias).clear();
        candado(&self.actividades).clear();
    }

    pub(crate) fn desbloquear(&self) {
        *candado(&self.desbloqueada) = Some(true);
    }

    fn desbloqueada(&self, cfg: &Cfg) -> bool {
        let mut d = candado(&self.desbloqueada);
        *d.get_or_insert_with(|| pin::guardado(cfg).is_none())
    }
    fn exigir_desbloqueo(&self, cfg: &Cfg) -> Result<(), String> {
        if self.desbloqueada(cfg) { Ok(()) } else { Err("FichaCSIRC está bloqueada: escribe tu PIN.".into()) }
    }
    /// Id del usuario en ProyectosTIC (sin el, no se consulta: veria las horas de otros).
    pub(crate) async fn uid(&self, cli: &Cliente) -> Result<String, ErrorOp> {
        let id = match &self.yo(cli).await?["id"] {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            _ => String::new(),
        };
        if id.is_empty() {
            return Err(ErrorOp::Otro("No se pudo identificar tu usuario en ProyectosTIC.".into()));
        }
        Ok(id)
    }

    async fn yo(&self, cli: &Cliente) -> Result<Value, ErrorOp> {
        if let Some(u) = candado(&self.usuario).clone() {
            return Ok(u);
        }
        let u = cli.yo().await?;
        *candado(&self.usuario) = Some(u.clone());
        Ok(u)
    }
}

fn arg_opcional(args: &[Value], i: usize) -> Option<String> {
    match args.get(i) {
        None | Some(Value::Null) => None,
        Some(_) => Some(arg(args, i)),
    }
}

fn arg_lista(args: &[Value], i: usize) -> Vec<Value> {
    args.get(i).and_then(Value::as_array).cloned().unwrap_or_default()
}

fn arg(args: &[Value], i: usize) -> String {
    match args.get(i) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

fn hoy() -> NaiveDate {
    Local::now().date_naive()
}

fn fecha(iso: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(iso, "%Y-%m-%d").map_err(|_| format!("Fecha no válida: {iso}"))
}

fn plataforma() -> &'static str {
    if cfg!(target_os = "windows") { "Windows" } else if cfg!(target_os = "macos") { "macOS" } else { "Linux" }
}

fn logo() -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(LOGO_UGR))
}

fn guardar(clave: &str, valor: Value) -> Result<Value, String> {
    let mut m = Map::new();
    m.insert(clave.into(), valor);
    config::guardar_valores(m)?;
    Ok(json!({"ok": true}))
}

#[tauri::command]
pub async fn api(metodo: String, args: Vec<Value>, estado: tauri::State<'_, Estado>, app: tauri::AppHandle) -> Result<Value, String> {
    let e: &Estado = &estado;
    // el asistente (y el PIN) funcionan tambien sin config: la primera vez,
    // tras "He olvidado el PIN" o con el fichero roto
    let sin_config_vale = metodo.starts_with("cfg_") || ["cerrar", "pin_estado", "tema"].contains(&metodo.as_str());
    let (cfg, hay_config) = match config::leer() {
        Ok(c) => (c, true),
        Err(_) if sin_config_vale => (Cfg(Map::new()), false),
        Err(x) => return Err(x),
    };
    match metodo.as_str() {
        // ---- PIN ----
        "pin_estado" => Ok(pin_estado(e, &cfg)),
        "pin_comprobar" => pin_comprobar(e, &cfg, &arg(&args, 0)),
        "pin_bloquear" => {
            if pin::guardado(&cfg).is_some() {
                *candado(&e.desbloqueada) = Some(false);
            }
            Ok(json!({"bloqueada": !e.desbloqueada(&cfg)}))
        }
        // ---- arranque y semana ----
        "inicio" => {
            e.exigir_desbloqueo(&cfg)?;
            Ok(inicio(e, &cfg))
        }
        "semana" => {
            e.exigir_desbloqueo(&cfg)?;
            semana(e, &cfg, &arg(&args, 0)).await
        }
        "repintar" => {
            e.exigir_desbloqueo(&cfg)?;
            let lunes = fecha(&arg(&args, 0))?;
            Ok(pintar_semana(e, &cfg, lunes).await)
        }
        "usuario" => {
            let nombre = match Cliente::desde(&cfg) {
                Ok(cli) => e.yo(&cli).await.ok().and_then(|u| u["name"].as_str().map(String::from)),
                Err(_) => None,
            };
            Ok(Value::String(nombre.unwrap_or_default()))
        }
        "tareas" => Ok(tareas(e, &cfg)),
        // ---- mes, franja y avisos (fase 3) ----
        "mes" => {
            e.exigir_desbloqueo(&cfg)?;
            let anio = args.first().and_then(Value::as_i64).unwrap_or(0) as i32;
            let mes = args.get(1).and_then(Value::as_u64).unwrap_or(0) as u32;
            resumen::mes(e, &cfg, anio, mes).await
        }
        "repintar_mes" => {
            e.exigir_desbloqueo(&cfg)?;
            let anio = args.first().and_then(Value::as_i64).unwrap_or(0) as i32;
            let mes = args.get(1).and_then(Value::as_u64).unwrap_or(1).clamp(1, 12) as u32;
            Ok(resumen::pintar_mes(e, &cfg, anio, mes).await)
        }
        "resumen_franja" => {
            e.exigir_desbloqueo(&cfg)?;
            Ok(resumen::resumen_franja(e, &cfg).await)
        }
        "semana_anterior_pendiente" => {
            e.exigir_desbloqueo(&cfg)?;
            Ok(resumen::semana_anterior_pendiente(e, &cfg).await)
        }
        "aviso_semana_visto" => Ok(resumen::guardar_visto("aviso_semana_vista", &arg(&args, 0))),
        "mes_pendiente" => {
            e.exigir_desbloqueo(&cfg)?;
            Ok(resumen::mes_pendiente(e, &cfg, hoy()).await)
        }
        "aviso_mes_visto" => Ok(resumen::guardar_visto("aviso_mes_visto", &hoy().to_string())),
        // ---- marcas del dia y "solo en este equipo" (fase 4a) ----
        "accion_dia" => {
            e.exigir_desbloqueo(&cfg)?;
            herr::accion_dia(&arg(&args, 0), &arg(&args, 1), &arg(&args, 2))
        }
        "teletrabajo_lleno" => Ok(json!(herr::teletrabajo_lleno(&cfg, &arg(&args, 0))?)),
        "tarea_ausencia" => {
            e.exigir_desbloqueo(&cfg)?;
            let favs = tareas(e, &cfg).as_array().cloned().unwrap_or_default();
            Ok(herr::tarea_ausencia(e, &cfg, &arg(&args, 0), &arg_lista(&args, 1), &favs).await)
        }
        "avisos_local_no" => Ok(json!(cfg.lista("avisos_local_no"))),
        "no_avisar_local" => herr::no_avisar_local(&arg(&args, 0)),
        "volver_a_avisar_local" => guardar("avisos_local_no", json!([])),
        "tareas_local" => Ok(herr::tareas_local(&cfg)),
        "fijar_tarea_local" => {
            e.exigir_desbloqueo(&cfg)?;
            herr::fijar_tarea_local(e, &arg(&args, 0), &arg(&args, 1), args.get(2).unwrap_or(&Value::Null), &arg(&args, 3))
        }
        // ---- plantillas y copiar ----
        "plantillas" => Ok(herr::plantillas(&cfg)),
        "guardar_plantilla_dia" => {
            e.exigir_desbloqueo(&cfg)?;
            herr::guardar_plantilla_dia(e, &arg(&args, 0), &arg(&args, 1))
        }
        "eliminar_plantilla" => {
            e.exigir_desbloqueo(&cfg)?;
            herr::eliminar_plantilla(&arg(&args, 0))
        }
        "aplicar_plantilla" => {
            e.exigir_desbloqueo(&cfg)?;
            let dias: Vec<String> = arg_lista(&args, 1).iter().filter_map(|d| d.as_str().map(String::from)).collect();
            herr::aplicar_plantilla(e, &cfg, &arg(&args, 0), &dias).await
        }
        "preparar_copia_dia" => {
            e.exigir_desbloqueo(&cfg)?;
            let dias: Vec<String> = arg_lista(&args, 0).iter().filter_map(|d| d.as_str().map(String::from)).collect();
            herr::preparar_copia_dia(e, &cfg, &dias, &arg(&args, 1)).await
        }
        "preparar_copia_semana" => {
            e.exigir_desbloqueo(&cfg)?;
            herr::preparar_copia_semana(e, &cfg, &arg(&args, 0)).await
        }
        "ejecutar_copia" => {
            e.exigir_desbloqueo(&cfg)?;
            herr::ejecutar_copia(e, &cfg).await
        }
        "asociar" => {
            e.exigir_desbloqueo(&cfg)?;
            herr::asociar(&arg(&args, 0), &arg(&args, 1))
        }
        "desasociar" => {
            e.exigir_desbloqueo(&cfg)?;
            herr::desasociar(&arg(&args, 0))
        }
        "resumen_mes" => {
            e.exigir_desbloqueo(&cfg)?;
            let anio = args.first().and_then(Value::as_i64).unwrap_or(0) as i32;
            let mes = args.get(1).and_then(Value::as_u64).unwrap_or(0) as u32;
            herr::resumen_mes(e, &cfg, anio, mes, hoy()).await
        }
        // ---- permisos, festivos, vacaciones y teletrabajo (fase 4b) ----
        "permisos" => {
            e.exigir_desbloqueo(&cfg)?;
            Ok(perm::permisos(e, &cfg).await)
        }
        "actualizar_usadas_pt" => {
            e.exigir_desbloqueo(&cfg)?;
            Ok(perm::actualizar_usadas_pt(e, &cfg).await)
        }
        "fijar_actividad_permiso" => {
            e.exigir_desbloqueo(&cfg)?;
            perm::fijar_actividad_permiso(e, &arg(&args, 0), &arg(&args, 1)).await
        }
        "anadir_concesion" => {
            e.exigir_desbloqueo(&cfg)?;
            perm::anadir_concesion(e, &arg(&args, 0), args.get(1).unwrap_or(&Value::Null), &arg(&args, 2)).await
        }
        "quitar_concesion" => {
            e.exigir_desbloqueo(&cfg)?;
            let i = arg(&args, 1).parse::<usize>().map_err(|_| "Concesión no válida.".to_string())?;
            perm::quitar_concesion(e, &arg(&args, 0), i).await
        }
        "info_permiso_dia" => {
            e.exigir_desbloqueo(&cfg)?;
            perm::info_permiso_dia(e, &cfg, &arg(&args, 0))
        }
        "anadir_permiso" => {
            e.exigir_desbloqueo(&cfg)?;
            let confirmado = args.get(3).and_then(Value::as_bool).unwrap_or(false);
            perm::anadir_permiso(e, &cfg, &arg(&args, 0), &arg(&args, 1), args.get(2).unwrap_or(&Value::Null), confirmado)
        }
        "propuesta_permisos_anio" => Ok(perm::propuesta_permisos_anio(e, &cfg)),
        "anadir_permisos_anio" => {
            e.exigir_desbloqueo(&cfg)?;
            perm::anadir_permisos_anio(&arg_lista(&args, 0))
        }
        "permisos_anio_no" => perm::marcar_anio_revisado(),
        "festivos" | "importar_festivos" => {
            e.exigir_desbloqueo(&cfg)?;
            let b = |i: usize| args.get(i).and_then(Value::as_bool).unwrap_or(false);
            if metodo == "festivos" {
                Ok(perm::festivos(&cfg, b(0), b(1), b(2), b(3)))
            } else {
                perm::importar_festivos(&cfg, b(0), b(1), b(2), b(3), &arg_lista(&args, 4))
            }
        }
        "anadir_dia_ugr" => {
            e.exigir_desbloqueo(&cfg)?;
            perm::anadir_dia_ugr(&arg(&args, 0), &arg(&args, 1))
        }
        "ajustes_dias" => Ok(perm::ajustes_dias(&cfg)),
        "guardar_ajustes_dias" => {
            e.exigir_desbloqueo(&cfg)?;
            perm::guardar_ajustes_dias(args.first().unwrap_or(&Value::Null), args.get(1).unwrap_or(&Value::Null))
        }
        // ---- asistente y "He olvidado el PIN" (fase 5a) ----
        "cfg_cargar" => {
            e.exigir_desbloqueo(&cfg)?;
            Ok(asistente::cfg_cargar(e, &cfg, hay_config))
        }
        "cfg_probar" => Ok(asistente::cfg_probar(&cfg, args.first().unwrap_or(&Value::Null), args.get(1).unwrap_or(&Value::Null)).await),
        "cfg_proyectos" => Ok(asistente::cfg_proyectos(&cfg, args.first().unwrap_or(&Value::Null), args.get(1).unwrap_or(&Value::Null)).await),
        "cfg_tareas" => Ok(asistente::cfg_tareas(&cfg, args.first().unwrap_or(&Value::Null), args.get(1).unwrap_or(&Value::Null),
                                                 args.get(2).unwrap_or(&Value::Null)).await),
        "cfg_validar_jornada" => Ok(asistente::cfg_validar_jornada(args.first().unwrap_or(&Value::Null))),
        "cfg_guardar" => {
            e.exigir_desbloqueo(&cfg)?;
            Ok(asistente::cfg_guardar(e, &cfg, args.first().unwrap_or(&Value::Null)))
        }
        "cerrar" => {
            app.exit(0);
            Ok(json!({"ok": true}))
        }
        // ---- copias, PIN, CSV y ayuda (fase 4c) ----
        "copias" => {
            e.exigir_desbloqueo(&cfg)?;
            Ok(ayuda::listar_copias())
        }
        "restaurar_copia" => {
            e.exigir_desbloqueo(&cfg)?;
            ayuda::restaurar_copia(e, &arg(&args, 0))
        }
        "exportar_config" => {
            e.exigir_desbloqueo(&cfg)?;
            ayuda::exportar_config(&cfg, &app).await
        }
        "importar_config" => {
            e.exigir_desbloqueo(&cfg)?;
            ayuda::importar_config(e, &app).await
        }
        "pin_fijar" => {
            e.exigir_desbloqueo(&cfg)?;
            ayuda::pin_fijar(&cfg, &arg(&args, 0), &arg(&args, 1), &arg(&args, 2))
        }
        "pin_quitar" => {
            e.exigir_desbloqueo(&cfg)?;
            ayuda::pin_quitar(&cfg, &arg(&args, 0))
        }
        "pin_auto" => ayuda::pin_auto(args.first().unwrap_or(&Value::Null)),
        "pin_no_sugerir" => Ok(ayuda::pin_no_sugerir()),
        "pin_olvidado" => Ok(asistente::pin_olvidado(e, &cfg)),
        "exportar_csv" => {
            e.exigir_desbloqueo(&cfg)?;
            ayuda::exportar_csv(e, &cfg, &app, &arg(&args, 0), &arg(&args, 1)).await
        }
        "abrir_exportacion" => Ok(ayuda::abrir_exportacion(e, &app)),
        "abrir_github" => Ok(ayuda::abrir_github(&app, &arg(&args, 0))),
        "novedades" => Ok(ayuda::novedades()),
        "tecnologia" => Ok(ayuda::tecnologia()),
        "diagnostico" => {
            e.exigir_desbloqueo(&cfg)?;
            Ok(ayuda::diagnostico().await)
        }
        // ---- buscar tareas ----
        "buscar_tareas" => {
            e.exigir_desbloqueo(&cfg)?;
            let cli = Cliente::desde(&cfg).map_err(|err| err.to_string())?;
            let favs = ids_favoritas(&cfg);
            let ts = cli.buscar_wp(&arg(&args, 0)).await.map_err(|err| err.to_string())?;
            Ok(json!({"tareas": ts.into_iter().map(|mut t| {
                t["favorita"] = json!(t["id"].as_i64().is_some_and(|i| favs.contains(&i)));
                t
            }).collect::<Vec<_>>()}))
        }
        "proyectos" => {
            e.exigir_desbloqueo(&cfg)?;
            let cli = Cliente::desde(&cfg).map_err(|err| err.to_string())?;
            Ok(json!(cli.proyectos().await.map_err(|err| err.to_string())?))
        }
        "tareas_de_proyecto" => {
            e.exigir_desbloqueo(&cfg)?;
            let cli = Cliente::desde(&cfg).map_err(|err| err.to_string())?;
            let pid = arg(&args, 0).parse::<i64>().map_err(|_| "Proyecto no válido.".to_string())?;
            match cli.tareas_proyecto(pid).await {
                Ok(ts) => Ok(json!({"tareas": ts})),
                Err(ErrorOp::Http(403)) => Ok(json!({"error": "No tienes permiso para ver las tareas de este proyecto."})),
                Err(err) => Err(err.to_string()),
            }
        }
        "favorita" => {
            e.exigir_desbloqueo(&cfg)?;
            let id = args.first().and_then(id_entero).ok_or("Tarea no válida.")?;
            let si = args.get(2).and_then(Value::as_bool).unwrap_or(false);
            favorita(e, &cfg, id, &arg(&args, 1), si)?;
            Ok(json!({"tareas": tareas(e, &config::leer()?)}))
        }
        "elegir_tareas" => {
            e.exigir_desbloqueo(&cfg)?;
            let a_favoritas = args.get(1).and_then(Value::as_bool).unwrap_or(false);
            for t in arg_lista(&args, 0).iter().rev() {
                let Some(id) = id_entero(&t["id"]) else { continue };
                let nombre = t["nombre"].as_str().unwrap_or("").to_string();
                if a_favoritas {
                    favorita(e, &config::leer()?, id, &nombre, true)?;
                } else {
                    let mut ex = candado(&e.extras);
                    if !ex.iter().any(|x| id_entero(&x["id"]) == Some(id)) {
                        ex.insert(0, json!({"id": id, "nombre": nombre}));
                    }
                }
            }
            Ok(tareas(e, &config::leer()?))
        }
        // ---- fichar (fase 2) ----
        "comprobar" => {
            e.exigir_desbloqueo(&cfg)?;
            let dias: Vec<String> = arg_lista(&args, 0).iter().filter_map(|d| d.as_str().map(String::from)).collect();
            Ok(apuntes::comprobar(e, &cfg, &dias, &arg(&args, 1), args.get(2).unwrap_or(&Value::Null)))
        }
        "anadir" => {
            e.exigir_desbloqueo(&cfg)?;
            let dias: Vec<String> = arg_lista(&args, 0).iter().filter_map(|d| d.as_str().map(String::from)).collect();
            let repetir = args.get(5).and_then(Value::as_bool).unwrap_or(true);
            apuntes::anadir(e, &cfg, &dias, &arg(&args, 1), args.get(2).unwrap_or(&Value::Null),
                            &arg(&args, 3), &arg(&args, 4), repetir).await
        }
        "eliminar" => {
            e.exigir_desbloqueo(&cfg)?;
            apuntes::eliminar(e, &cfg, &arg_lista(&args, 0)).await
        }
        "editar" => {
            e.exigir_desbloqueo(&cfg)?;
            apuntes::editar(e, &cfg, &arg(&args, 0), &arg(&args, 1), args.get(2).unwrap_or(&Value::Null),
                            arg_opcional(&args, 3), arg_opcional(&args, 4)).await
        }
        "guardar_dia" => {
            e.exigir_desbloqueo(&cfg)?;
            apuntes::guardar_dia(e, &cfg, &arg(&args, 0), args.get(1).unwrap_or(&Value::Null)).await
        }
        "mover_apunte" => {
            e.exigir_desbloqueo(&cfg)?;
            apuntes::mover(e, &cfg, &arg(&args, 0), &arg(&args, 1), &arg(&args, 2)).await
        }
        "deshacer" => {
            e.exigir_desbloqueo(&cfg)?;
            apuntes::deshacer(e, &cfg).await
        }
        "deshacer_estado" => Ok(apuntes::deshacer_estado(e)),
        "actividades" => Ok(actividades(&cfg, &arg(&args, 0)).await),
        // ---- preferencias de la ventana ----
        "vista" => Ok(Value::String(vista(&cfg))),
        "zoom" => Ok(json!(zoom(&cfg))),
        "tema" => Ok(Value::String(tema(&cfg))),
        "paneles" => Ok(paneles(&cfg)),
        "guardar_vista" => {
            let v = arg(&args, 0);
            if v != "semana" && v != "mes" { return Ok(json!({"error": "Vista desconocida."})) }
            guardar("vista_inicio", Value::String(v))
        }
        "guardar_tema" => {
            let t = arg(&args, 0);
            if !TEMAS.contains(&t.as_str()) { return Ok(json!({"error": "Tema desconocido."})) }
            guardar("tema", Value::String(t))
        }
        "guardar_zoom" => {
            let z = args.first().and_then(Value::as_f64).unwrap_or(1.0);
            if !ZOOMS.contains(&z) { return Ok(json!({"error": "Zoom no válido."})) }
            guardar("zoom", json!(z))
        }
        "guardar_paneles" => {
            let mut todos = paneles(&cfg).as_object().cloned().unwrap_or_default();
            if let Some(m) = args.first().and_then(Value::as_object) {
                for (k, v) in m {
                    if estados_panel(k).contains(&v.as_str().unwrap_or("")) {
                        todos.insert(k.clone(), v.clone());
                    }
                }
            }
            let _ = guardar("paneles", Value::Object(todos));
            Ok(paneles(&config::leer()?))
        }
        // ---- avisos que aun no estan: en silencio, sin molestar ----
        "aviso_aplicaciones" => Ok(Value::Null),
        "abrir_aplicaciones" => Ok(json!({"ok": true})),
        // ---- actualizaciones, aviso diario y bandeja (fase 5b/5c) ----
        "comprobar_actualizacion" => {
            let forzar = args.first().and_then(Value::as_bool).unwrap_or(false);
            Ok(sistema::comprobar_actualizacion(e, &cfg, forzar).await)
        }
        "abrir_pagina_actualizacion" => Ok(sistema::abrir_pagina_actualizacion(e, &app)),
        "instalar_actualizacion" => Ok(json!({"error": "La versión Rust en pruebas aún no se instala sola: descárgala desde la página.", "pagina": true})),
        "recordatorio_estado" => Ok(sistema::recordatorio_estado()),
        "recordatorio_activar" => {
            e.exigir_desbloqueo(&cfg)?;
            Ok(sistema::recordatorio_activar(&arg(&args, 0)))
        }
        "recordatorio_desactivar" => {
            e.exigir_desbloqueo(&cfg)?;
            Ok(sistema::recordatorio_desactivar())
        }
        "aviso_datos" => Ok(sistema::aviso_datos(e, &cfg).await),
        "aviso_fichar" => {
            e.exigir_desbloqueo(&cfg)?;
            sistema::aviso_fichar(e, &cfg, &arg(&args, 0), &arg(&args, 1), args.get(2).unwrap_or(&Value::Null), &arg(&args, 3)).await
        }
        "aviso_responder" => Ok(sistema::aviso_responder(&app, args.first().and_then(Value::as_bool).unwrap_or(false))),
        "bandeja_estado" => Ok(sistema::bandeja_estado(&cfg)),
        "bandeja_guardar" => {
            e.exigir_desbloqueo(&cfg)?;
            let b = |i: usize| args.get(i).and_then(Value::as_bool).unwrap_or(false);
            sistema::bandeja_guardar(&app, b(0), b(1))
        }
        otro => Err(format!("Esto aún no está en la versión Rust (en pruebas): «{otro}». Hazlo desde FichaCSIRC normal.")),
    }
}

// ---------------------------------------------------------------- PIN

fn pin_auto_min(cfg: &Cfg) -> i64 {
    cfg.get("pin_auto_min").and_then(Value::as_i64).filter(|m| PIN_AUTO.contains(m)).unwrap_or(15)
}

fn pin_estado(e: &Estado, cfg: &Cfg) -> Value {
    json!({"activo": pin::guardado(cfg).is_some(), "desbloqueada": e.desbloqueada(cfg),
           "auto_min": pin_auto_min(cfg), "logo": logo(), "version": VERSION, "tema": tema(cfg)})
}

fn pin_comprobar(e: &Estado, cfg: &Cfg, intento: &str) -> Result<Value, String> {
    let Some(g) = pin::guardado(cfg) else {
        *candado(&e.desbloqueada) = Some(true);
        return Ok(json!({"ok": true}));
    };
    let intentos = cfg.objeto("pin_intentos");
    let ahora = Local::now().naive_local();
    let hasta = intentos.get("hasta").and_then(Value::as_str)
        .and_then(|s| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok());
    if let Some(h) = hasta.filter(|h| *h > ahora) {
        let s = (h - ahora).num_seconds() + 1;
        return Ok(json!({"error": format!("Demasiados intentos. Espera {s} s."), "espera": s}));
    }
    if pin::correcto(intento, &g) {
        *candado(&e.desbloqueada) = Some(true);
        if !intentos.is_empty() {
            guardar("pin_intentos", Value::Null)?;
        }
        return Ok(json!({"ok": true}));
    }
    let fallos = intentos.get("fallos").and_then(Value::as_u64).unwrap_or(0) as u32 + 1;
    let espera = pin::espera(fallos);
    let mut nuevo = json!({"fallos": fallos});
    if espera > 0 {
        nuevo["hasta"] = json!((ahora + Duration::seconds(espera)).format("%Y-%m-%dT%H:%M:%S").to_string());
    }
    guardar("pin_intentos", nuevo)?;
    if espera > 0 {
        return Ok(json!({"error": format!("PIN incorrecto. Espera {espera} s antes de volver a probar."), "espera": espera}));
    }
    Ok(json!({"error": "PIN incorrecto."}))
}

// ---------------------------------------------------------------- arranque

fn vista(cfg: &Cfg) -> String {
    let v = cfg.texto("vista_inicio");
    if v == "mes" { v } else { "semana".into() }
}

fn zoom(cfg: &Cfg) -> f64 {
    cfg.get("zoom").and_then(Value::as_f64).filter(|z| ZOOMS.contains(z)).unwrap_or(1.0)
}

fn tema(cfg: &Cfg) -> String {
    let t = cfg.texto("tema");
    if TEMAS.contains(&t.as_str()) { t } else { "sistema".into() }
}

fn estados_panel(panel: &str) -> &'static [&'static str] {
    match panel {
        "form" | "habituales" | "apuntes" => &["abierto", "min", "oculto"],
        "franja" | "leyenda" => &["abierto", "oculto"],
        _ => &[],
    }
}

fn paneles(cfg: &Cfg) -> Value {
    let guardado = cfg.objeto("paneles");
    let mut out = Map::new();
    for p in ["form", "habituales", "apuntes", "franja", "leyenda"] {
        let v = guardado.get(p).and_then(Value::as_str).filter(|v| estados_panel(p).contains(v)).unwrap_or("abierto");
        out.insert(p.into(), json!(v));
    }
    Value::Object(out)
}

fn id_entero(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_str().and_then(|s| s.trim().trim_start_matches('#').parse().ok()))
}

fn ids_favoritas(cfg: &Cfg) -> std::collections::HashSet<i64> {
    cfg.lista("favoritos").iter().filter_map(|f| id_entero(&f["id"])).collect()
}

/// Tareas del desplegable: las buscadas en la sesion y las favoritas.
fn tareas(e: &Estado, cfg: &Cfg) -> Value {
    let favs = ids_favoritas(cfg);
    let mut vistas = std::collections::HashSet::new();
    let todas: Vec<Value> = candado(&e.extras).iter().cloned().chain(cfg.lista("favoritos")).collect();
    let out: Vec<Value> = todas.iter().filter_map(|f| {
        let id = id_entero(&f["id"])?;
        if !vistas.insert(id) { return None }
        let nombre = f["nombre"].as_str().unwrap_or("").to_string();
        Some(json!({"id": id, "nombre": nombre, "texto": format!("{id} - {nombre}"), "favorita": favs.contains(&id)}))
    }).collect();
    Value::Array(out)
}

/// La estrella del buscador: marca o quita una tarea de favoritas.
fn favorita(e: &Estado, cfg: &Cfg, id: i64, nombre: &str, si: bool) -> Result<(), String> {
    let mut favs = cfg.lista("favoritos");
    let esta = favs.iter().any(|f| id_entero(&f["id"]) == Some(id));
    if si && !esta {
        favs.push(json!({"id": id, "nombre": nombre}));
    } else if !si && esta {
        favs.retain(|f| id_entero(&f["id"]) != Some(id));
        // sigue en el desplegable de esta sesion, como una buscada
        let mut ex = candado(&e.extras);
        if !ex.iter().any(|x| id_entero(&x["id"]) == Some(id)) {
            ex.insert(0, json!({"id": id, "nombre": nombre}));
        }
    } else {
        return Ok(());
    }
    let mut m = Map::new();
    m.insert("favoritos".into(), Value::Array(favs));
    config::guardar_valores(m)
}

async fn actividades(cfg: &Cfg, wp_id: &str) -> Value {
    let nombres = match Cliente::desde(cfg) {
        Ok(cli) => cli.actividades(wp_id).await.unwrap_or_else(|_| ACTIVIDADES.iter().map(|s| s.to_string()).collect()),
        Err(_) => ACTIVIDADES.iter().map(|s| s.to_string()).collect(),
    };
    let por_tarea = cfg.objeto("actividades_tarea");
    let pref = por_tarea.get(wp_id).and_then(Value::as_str).map(String::from)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| actividad_preferida(cfg));
    let comentario = cfg.objeto("comentarios_tarea").get(wp_id).and_then(Value::as_str).unwrap_or("").to_string();
    json!({"nombres": nombres, "preferida": pref, "comentario": comentario})
}

fn actividad_preferida(cfg: &Cfg) -> String {
    ["ultima_actividad", "actividad_defecto", "actividad"].iter()
        .map(|k| cfg.texto(k)).find(|s| !s.is_empty()).unwrap_or_default()
}

fn inicio(e: &Estado, cfg: &Cfg) -> Value {
    let h = hoy();
    let lunes = h - Duration::days(h.weekday().num_days_from_monday() as i64);
    let asociaciones: Map<String, Value> = cfg.objeto("tareas_actividad").into_iter()
        .filter_map(|(k, v)| id_entero(&v).map(|id| (k, json!(id)))).collect();
    let reglas = Reglas::desde(cfg);
    json!({
        "version": VERSION,
        "experimento": false,
        "github": GITHUB_REPO,
        "inari_listo": false,
        "inari": false,
        "asociaciones": asociaciones,
        "toca_permisos_anio": perm::toca_permisos_anio(cfg),
        "novedades_tras_actualizar": null,
        "recuperada": std::mem::take(&mut *candado(&e.recuperada)),
        "sugerir_pin": false,
        "avisos_local_no": cfg.lista("avisos_local_no"),
        "pin": pin_estado(e, cfg),
        "zoom": zoom(cfg),
        "tema": tema(cfg),
        "plataforma": format!("{} · Rust (en pruebas)", plataforma()),
        "lunes": lunes.to_string(),
        "logo": logo(),
        "tareas": tareas(e, cfg),
        "actividades": ACTIVIDADES,
        "actividad_preferida": actividad_preferida(cfg),
        "comentario_guardia": reglas.comentario_guardia,
        "vista": vista(cfg),
        "paneles": paneles(cfg),
    })
}

// ---------------------------------------------------------------- semana

async fn semana(e: &Estado, cfg: &Cfg, lunes_iso: &str) -> Result<Value, String> {
    let lunes = fecha(lunes_iso)?;
    let dias: Vec<NaiveDate> = (0..5).map(|i| lunes + Duration::days(i)).collect();
    let leido: Result<Vec<Apunte>, ErrorOp> = async {
        let cli = Cliente::desde(cfg)?;
        let uid = e.uid(&cli).await?;
        cli.entradas_rango(&uid, &dias[0].to_string(), &dias[4].to_string()).await
    }.await;
    {
        let mut cache = candado(&e.cache);
        match leido {
            Ok(aps) => {
                let mut por_dia: HashMap<String, Vec<Apunte>> = HashMap::new();
                for a in aps {
                    por_dia.entry(a.fecha.clone()).or_default().push(a);
                }
                for d in &dias {
                    cache.insert(d.to_string(), Some(por_dia.remove(&d.to_string()).unwrap_or_default()));
                }
                *candado(&e.error) = None;
            }
            Err(err) => {
                for d in &dias {
                    cache.insert(d.to_string(), None);
                }
                *candado(&e.error) = Some(err);
            }
        }
    }
    Ok(pintar_semana(e, cfg, lunes).await)
}

async fn pintar_semana(e: &Estado, cfg: &Cfg, lunes: NaiveDate) -> Value {
    let reglas = Reglas::desde(cfg);
    let acts = reglas.actividades_de_permiso();
    let h = hoy();
    let dias: Vec<NaiveDate> = (0..5).map(|i| lunes + Duration::days(i)).collect();
    let (tarjetas, fallos) = {
        let cache = candado(&e.cache);
        let mut fallos = 0;
        let t: Vec<Value> = dias.iter().map(|d| {
            let aps = cache.get(&d.to_string()).cloned().unwrap_or(None);
            if aps.is_none() { fallos += 1 }
            reglas.estado_dia(*d, aps.as_deref(), h, &acts)
        }).collect();
        (t, fallos)
    };
    let reg: f64 = tarjetas.iter().map(|t| t["reg"].as_f64().unwrap_or(0.0)).sum();
    let obj: f64 = tarjetas.iter().map(|t| t["obj"].as_f64().unwrap_or(0.0)).sum();
    let error = candado(&e.error).clone();
    let detalle = match (fallos, error) {
        (0, _) | (_, None) => Value::Null,
        (_, Some(err)) => openproject::diagnostico(&err).await,
    };
    let cupo = reglas.teletrabajo_por_semana;
    let dom = lunes + Duration::days(6);
    json!({
        "titulo": format!("Semana {} - {}", lunes.format("%d/%m/%Y"), dom.format("%d/%m/%Y")),
        "total": format!("{} / {}", fmt_horas(reg), fmt_horas(obj)),
        "teletrabajo": if cupo > 0 { format!("{}/{cupo}", reglas.teletrabajo_en_semana(lunes)) } else { String::new() },
        "conexion": if fallos >= dias.len() { "error" } else if fallos > 0 { "warn" } else { "ok" },
        "conexion_detalle": detalle,
        "dias": tarjetas,
    })
}
