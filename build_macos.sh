#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PYTHON_BIN="${PYTHON_BIN:-python3}"
ARCH_LABEL="${ARCH_LABEL:-$(uname -m)}"
if [[ "$ARCH_LABEL" == "x86_64" ]]; then
  ARCH_LABEL="x64"
fi

ICONSET="build/macos/fichacsirc.iconset"
ICNS="build/macos/fichacsirc.icns"
SRC_ICON="${SRC_ICON:-fichacsirc_256.png}"

echo "Instalando dependencias..."
"$PYTHON_BIN" -m pip install --quiet --upgrade pip pyinstaller requests

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
"$PYTHON_BIN" -m PyInstaller --noconfirm --clean --windowed \
  --name "FichaCSIRC" --icon "$ICNS" \
  --add-data "logo_ugr.png:." --add-data "fichacsirc.ico:." \
  registrar_gui.py

echo "Construyendo FichaCSIRC-Configurar.app..."
"$PYTHON_BIN" -m PyInstaller --noconfirm --clean --windowed \
  --name "FichaCSIRC-Configurar" --icon "$ICNS" \
  --add-data "logo_ugr.png:." --add-data "fichacsirc.ico:." \
  configurar_gui.py

ZIP="dist/FichaCSIRC-mac-${ARCH_LABEL}.zip"
PKG_DIR="build/macos/FichaCSIRC-mac-${ARCH_LABEL}"
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR"
cp -R "dist/FichaCSIRC.app" "$PKG_DIR/"
cp -R "dist/FichaCSIRC-Configurar.app" "$PKG_DIR/"
rm -f "$ZIP"
ditto -c -k --keepParent "$PKG_DIR" "$ZIP"

echo
echo "Listo:"
echo "  dist/FichaCSIRC.app"
echo "  dist/FichaCSIRC-Configurar.app"
echo "  $ZIP"
echo
echo "Nota: sin firma/notarizacion, macOS puede pedir abrirlas con clic derecho > Abrir."
