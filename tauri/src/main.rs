// FichaCSIRC en Rust + Tauri (rama rust/tauri, en pruebas).
//
// La interfaz es la MISMA que la de la app de Python (carpeta web/): el
// puente web/puente-tauri.js convierte sus llamadas window.pywebview.api.X()
// en el comando "api" de aqui. El motor se va portando por fases; lo que aun
// no esta devuelve un error claro ("aun no esta en la version Rust").
//
// Para no tocar los datos de la app de verdad, usa su propia config
// (FichaCSIRC-rust), copiada de la real la primera vez.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod apuntes;
mod asistente;
mod ayuda;
mod config;
mod copias;
mod herramientas;
mod inari;
mod openproject;
mod permisos;
mod pin;
mod reglas;
mod resumen;
mod sistema;

fn main() {
    // config.json sin URL/API key (o roto) y una copia buena: se recupera sola
    // ANTES de nada (como la 3.2.2), y se avisa al abrir.
    let estado = api::Estado::default();
    if let Some(nombre) = config::recuperar_si_hace_falta() {
        estado.anotar_recuperada(&nombre);
    }
    let args: Vec<String> = std::env::args().collect();
    let recordatorio = args.iter().any(|a| a == "--recordatorio");
    let minimizado = args.iter().any(|a| a == "--minimizado");
    // --recordatorio: lo lanza la tarea programada. Si no falta nada (o no hay
    // red), se sale en silencio; si falta, una ventanita encima de todo.
    if recordatorio {
        let Ok(cfg) = config::leer() else { return };
        let hoy = chrono::Local::now().date_naive();
        match tauri::async_runtime::block_on(sistema::dias_pendientes(&estado, &cfg, hoy)) {
            Some(p) if !p.is_empty() => estado.preparar_aviso(p),
            _ => return,
        }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(estado)
        .on_window_event(|w, ev| {
            // con icono en la bandeja, cerrar la ventana principal solo la esconde
            if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
                use tauri::Manager;
                let con_bandeja = w.app_handle().state::<api::Estado>().con_bandeja.load(std::sync::atomic::Ordering::SeqCst);
                if w.label() == "principal" && con_bandeja {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
        })
        .setup(move |app| {
            if recordatorio {
                tauri::WebviewWindowBuilder::new(app, "aviso", tauri::WebviewUrl::App("aviso.html".into()))
                    .title("FichaCSIRC - Recordatorio")
                    .inner_size(600.0, 470.0)
                    .resizable(false)
                    .always_on_top(true)
                    .build()?;
                // se cierra solo: si nadie lo atiende, el proceso no se queda vivo
                let h = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(sistema::AVISO_MINUTOS * 60));
                    h.exit(0);
                });
                return Ok(());
            }
            // sin config (primera vez, o tras olvidar el PIN) o con --configurar:
            // el asistente; si no, la ventana principal
            let asistente = std::env::args().any(|a| a == "--configurar") || !config::ruta_config().exists();
            let bandeja = !asistente && config::leer().is_ok_and(|c| sistema::bandeja_activa(&c));
            let (pagina, titulo, ancho, alto) = if asistente {
                ("configurar.html", "FichaCSIRC · configuración (Rust, en pruebas)", 900.0, 760.0)
            } else {
                ("index.html", "FichaCSIRC (Rust, en pruebas)", 1280.0, 860.0)
            };
            tauri::WebviewWindowBuilder::new(app, "principal", tauri::WebviewUrl::App(pagina.into()))
                // Tauri captura por defecto el arrastrar y soltar (para recibir
                // archivos del Explorador) y eso anula el del HTML: sin esto no
                // se pueden arrastrar tareas de una ficha a otra
                .disable_drag_drop_handler()
                .title(titulo)
                .inner_size(ancho, alto)
                .min_inner_size(820.0, 600.0)
                // --minimizado (inicio con Windows): escondida en la bandeja
                .visible(!(minimizado && bandeja))
                .build()?;
            if bandeja {
                sistema::poner_bandeja(app.handle())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![api::api])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar FichaCSIRC");
}
