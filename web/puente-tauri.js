/* FichaCSIRC - puente para la version Rust/Tauri (en pruebas).
 *
 * La interfaz llama al motor como window.pywebview.api.<metodo>(...args) y
 * espera una promesa: asi es en la app de Python (pywebview). Dentro de Tauri
 * no hay pywebview, asi que aqui se crea un window.pywebview.api que reenvia
 * CADA llamada al comando "api" de Rust, con el mismo nombre y argumentos. Asi
 * el HTML y el JS sirven igual para las dos versiones mientras se porta el
 * motor poco a poco.
 *
 * Fuera de Tauri (pywebview, navegador, ?demo) no hace nada. */
"use strict";
(function () {
  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core || window.pywebview) return;
  const invocar = (metodo, args) => tauri.core.invoke("api", { metodo, args })
    // Rust devuelve el error como texto; la interfaz espera un Error con .message
    .catch((e) => { throw new Error(typeof e === "string" ? e : (e && e.message) || String(e)); });
  const api = new Proxy({ __tauri: true }, {   // una clave: comun.js mira que la API "tenga algo"
    get(destino, metodo) {
      if (metodo in destino || typeof metodo !== "string" || metodo === "then") return destino[metodo];
      return (...args) => invocar(metodo, args);
    },
  });
  window.pywebview = { api };
})();
