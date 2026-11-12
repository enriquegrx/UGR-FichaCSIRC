//! En pruebas o en produccion (cargo build --features produccion).
//!
//! En pruebas convive con la app de Python sin tocarla: config propia
//! (FichaCSIRC-rust, copiada de la real la primera vez), aviso diario e inicio
//! con Windows con nombres propios y "(Rust, en pruebas)" en los titulos.
//!
//! En produccion ES FichaCSIRC 4.x: lee y escribe la MISMA config que la 3.x
//! (%APPDATA%\FichaCSIRC: migrar es no hacer nada), usa los mismos nombres de
//! aviso diario e inicio con Windows (sustituye a los de la 3.x) y se
//! actualiza sola descargando el instalador de la release.

pub const PRODUCCION: bool = cfg!(feature = "produccion");

/// Carpeta de la config dentro de la del usuario.
pub fn carpeta_config() -> &'static str {
    if PRODUCCION { "FichaCSIRC" } else { "FichaCSIRC-rust" }
}

/// Lo que se añade a titulos y textos para distinguirla.
pub fn sufijo() -> &'static str {
    if PRODUCCION { "" } else { " (Rust, en pruebas)" }
}

/// Tarea programada del aviso diario (la de la 3.x se llama asi).
pub fn tarea_recordatorio() -> &'static str {
    if PRODUCCION { "FichaCSIRC-Recordatorio" } else { "FichaCSIRC-Rust-Recordatorio" }
}

/// Valor de HKCU\...\Run del inicio con Windows (el de la 3.x se llama asi).
pub fn valor_inicio() -> &'static str {
    if PRODUCCION { "FichaCSIRC" } else { "FichaCSIRC-Rust" }
}

/// Nombre del instalador en cada release (el mismo que publica la 3.x).
pub const INSTALADOR_WINDOWS: &str = "FichaCSIRC-Instalador.exe";
