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
mod config;
mod herramientas;
mod openproject;
mod pin;
mod reglas;
mod resumen;

fn main() {
    tauri::Builder::default()
        .manage(api::Estado::default())
        .invoke_handler(tauri::generate_handler![api::api])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar FichaCSIRC");
}
