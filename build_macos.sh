#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ -z "${PYTHON_BIN:-}" ]]; then
  for candidate in python3.12 /opt/homebrew/bin/python3.12 /usr/local/bin/python3.12 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_BIN="$(command -v "$candidate")"
      break
    fi
  done
fi
PYTHON_BIN="${PYTHON_BIN:-python3}"
ARCH_LABEL="${ARCH_LABEL:-$(uname -m)}"
if [[ "$ARCH_LABEL" == "x86_64" ]]; then
  ARCH_LABEL="x64"
fi
VENV="build/macos/venv-${ARCH_LABEL}"

ICONSET="build/macos/fichacsirc.iconset"
ICNS="build/macos/fichacsirc.icns"
SRC_ICON="${SRC_ICON:-fichacsirc_256.png}"

echo "Comprobando Tkinter..."
if ! "$PYTHON_BIN" - <<'PY'
import tkinter as tk
print(f"Python/Tk: {tk.TkVersion}")
if tk.TkVersion < 8.6:
    raise SystemExit("Tk demasiado antiguo para empaquetar en macOS")
PY
then
  echo "ERROR: $PYTHON_BIN no tiene Tkinter usable (>= 8.6)."
  echo "En macOS con Homebrew instala: brew install python@3.12 python-tk@3.12"
  echo "Tambien puedes pasar otro Python con: PYTHON_BIN=/ruta/python3.12 ./build_macos.sh"
  exit 1
fi

echo "Preparando entorno de build..."
"$PYTHON_BIN" -m venv "$VENV"
PY="$VENV/bin/python"
"$PY" -m pip install --quiet --upgrade pip pyinstaller requests

echo "Preparando icono .icns..."
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
if [[ ! -f "$SRC_ICON" ]]; then
  SRC_ICON="logo_ugr.png"
fi
for size in 16 32 64 128 256 512; do
  sips -z "$size" "$size" "$SRC_ICON" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
done
cp "$ICONSET/icon_32x32.png" "$ICONSET/icon_16x16@2x.png"
cp "$ICONSET/icon_64x64.png" "$ICONSET/icon_32x32@2x.png"
cp "$ICONSET/icon_256x256.png" "$ICONSET/icon_128x128@2x.png"
cp "$ICONSET/icon_512x512.png" "$ICONSET/icon_256x256@2x.png"
cp "$ICONSET/icon_512x512.png" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$ICNS"

echo "Limpiando builds anteriores..."
rm -rf build/FichaCSIRC build/FichaCSIRC-Configurar
rm -rf dist/FichaCSIRC.app dist/FichaCSIRC-Configurar.app

echo "Construyendo FichaCSIRC.app..."
"$PY" -m PyInstaller --noconfirm --clean --windowed \
  --name "FichaCSIRC" --icon "$ICNS" \
  --add-data "logo_ugr.png:." --add-data "fichacsirc.ico:." \
  --add-data "NOVEDADES.md:." \
  registrar_gui.py

echo "Construyendo FichaCSIRC-Configurar.app..."
"$PY" -m PyInstaller --noconfirm --clean --windowed \
  --name "FichaCSIRC-Configurar" --icon "$ICNS" \
  --add-data "logo_ugr.png:." --add-data "fichacsirc.ico:." \
  --add-data "NOVEDADES.md:." \
  configurar_gui.py

# Se distribuye como .dmg (no .zip): al abrirlo, el Finder muestra las dos apps
# junto a un acceso a Aplicaciones y basta con arrastrarlas; si ya estaban, el
# Finder pregunta "Reemplazar". Con el zip cada actualizacion se descomprimia en
# otra carpeta de Descargas y Launchpad acababa mostrando un icono por copia.
DMG="dist/FichaCSIRC-mac-${ARCH_LABEL}.dmg"
STAGE="build/macos/dmg-${ARCH_LABEL}"
rm -rf "$STAGE"
mkdir -p "$STAGE"
ditto "dist/FichaCSIRC.app" "$STAGE/FichaCSIRC.app"
ditto "dist/FichaCSIRC-Configurar.app" "$STAGE/FichaCSIRC-Configurar.app"
ln -s /Applications "$STAGE/Aplicaciones"
rm -f "$DMG"
# hdiutil falla a veces en los runners de GitHub con "Resource busy" (algun
# proceso del sistema aun tiene abierta la imagen); se reintenta un par de veces.
for intento in 1 2 3; do
  if hdiutil create -volname "FichaCSIRC" -srcfolder "$STAGE" \
       -ov -format UDZO "$DMG"; then
    break
  fi
  if [[ "$intento" == 3 ]]; then
    echo "ERROR: hdiutil no pudo crear $DMG"
    exit 1
  fi
  echo "hdiutil fallo (intento $intento), reintentando..."
  sleep 5
done

echo
echo "Listo:"
echo "  dist/FichaCSIRC.app"
echo "  dist/FichaCSIRC-Configurar.app"
echo "  $DMG"
echo
echo "Nota: sin firma/notarizacion, la primera vez macOS las bloquea. Se abren en"
echo "Ajustes del Sistema > Privacidad y seguridad > Abrir igualmente."
