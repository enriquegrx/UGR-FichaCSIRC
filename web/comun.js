/* FichaCSIRC - utilidades comunes a todas las paginas (ventana principal,
 * asistente de configuracion y aviso de fichaje).
 *
 * Todo el texto que viene de los datos se pone con textContent (nunca
 * innerHTML), para que un comentario con "<" no pueda inyectar HTML.
 */
"use strict";

const $ = (id) => document.getElementById(id);
const api = () => window.pywebview.api;

function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const h of hijos) if (h !== null && h !== undefined && h !== false) n.append(h);
  return n;
}

function fmtHoras(h) {
  return (Math.round(h * 100) / 100).toString().replace(".", ",");
}

// Barra de estado (si la pagina tiene una).
function estado(texto) {
  const e = $("estado");
  if (e) e.textContent = texto || "";
}

// Modal de pregunta propio (confirm() no es igual en todos los visores web).
// Va por encima de cualquier dialogo abierto. Necesita el #modal de la pagina.
function preguntar(titulo, texto, { soloAceptar = false, si = "Sí", no = "No" } = {}) {
  return new Promise((resolver) => {
    $("modal-titulo").textContent = titulo;
    $("modal-texto").textContent = texto;
    $("modal-no").hidden = soloAceptar;
    $("modal-no").textContent = no;
    $("modal-si").textContent = soloAceptar ? "Aceptar" : si;
    $("modal").hidden = false;
    $("modal-si").focus();
    const cerrar = (valor) => {
      $("modal").hidden = true;
      $("modal-si").onclick = $("modal-no").onclick = null;
      document.removeEventListener("keydown", teclas, true);
      resolver(valor);
    };
    const teclas = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cerrar(false); }
    };
    document.addEventListener("keydown", teclas, true);
    $("modal-si").onclick = () => cerrar(true);
    $("modal-no").onclick = () => cerrar(false);
  });
}
const avisar = (titulo, texto) => preguntar(titulo, texto, { soloAceptar: true });

// Llamada a la API de Python; si falla, lo dice y relanza el error.
async function llamar(fn, ...args) {
  try {
    return await api()[fn](...args);
  } catch (e) {
    const msg = (e && (e.message || e.toString())) || "error desconocido";
    estado(`Error: ${msg}`);
    await avisar("Algo ha fallado", msg);
    throw e;
  }
}

// Ejecuta fn cuando esten la pagina entera y la API: pywebview la inyecta y
// avisa con 'pywebviewready', que puede llegar antes o despues de DOMContentLoaded.
function cuandoListo(fn) {
  const iniciar = () => {
    if (window.pywebview?.api && Object.keys(window.pywebview.api).length) fn();
    else window.addEventListener("pywebviewready", fn, { once: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
}

// Sin el menu contextual del navegador (no es una web), salvo en los campos.
document.addEventListener("contextmenu", (e) => {
  if (!["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) e.preventDefault();
});
