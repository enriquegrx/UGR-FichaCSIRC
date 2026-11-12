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
mod openproject;
mod permisos;
mod pin;
mod reglas;
mod resumen;

fn main() {
    // config.json sin URL/API key (o roto) y una copia buena: se recupera sola
    // ANTES de nada (como la 3.2.2), y se avisa al abrir.
    let estado = api::Estado::default();
    if let Some(nombre) = config::recuperar_si_hace_falta() {
        estado.anotar_recuperada(&nombre);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(estado)
        .setup(|app| {
            // sin config (primera vez, o tras olvidar el PIN) o con --configurar:
            // el asistente; si no, la ventana principal
            let asistente = std::env::args().any(|a| a == "--configurar") || !config::ruta_config().exists();
            let (pagina, titulo, ancho, alto) = if asistente {
                ("configurar.html", "FichaCSIRC · configuración (Rust, en pruebas)", 900.0, 760.0)
            } else {
                ("index.html", "FichaCSIRC (Rust, en pruebas)", 1280.0, 860.0)
            };
            tauri::WebviewWindowBuilder::new(app, "principal", tauri::WebviewUrl::App(pagina.into()))
                .title(titulo)
                .inner_size(ancho, alto)
                .min_inner_size(820.0, 600.0)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![api::api])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar FichaCSIRC");
}
