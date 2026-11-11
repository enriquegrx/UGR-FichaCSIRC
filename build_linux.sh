#!/usr/bin/env bash
# Construye FichaCSIRC para Linux: un .deb (Ubuntu/Debian) y un AppImage.
#
# No se usa PyInstaller: WebKitGTK no se puede meter dentro (depende de
# programas auxiliares en rutas fijas del sistema). Los dos paquetes llevan la
# app y sus librerias de Python PURAS (vendor/), y usan el Python, PyGObject y
# WebKitGTK del sistema. Ver fichacsirc_linux.py.
#
#   bash build_linux.sh            -> dist/fichacsirc_X.Y.Z_all.deb
#                                     dist/FichaCSIRC-linux-x86_64.AppImage
# Necesita: python3 con pip, dpkg-deb y (para el AppImage) red para bajar
# appimagetool. Se ejecuta en GitHub Actions (ubuntu).
set -euo pipefail
cd "$(dirname "$0")"

VER=$(sed -n 's/^VERSION = "\(.*\)"/\1/p' rellenar_horas.py)
echo "FichaCSIRC $VER para Linux"
rm -rf build/linux dist/linux && mkdir -p build/linux dist

# ---------------- la app (solo lo que usa la version web) ----------------
APP=build/linux/app
mkdir -p "$APP"
cp registrar_web.py rellenar_horas.py configurar.py destinos.py inari.py \
   recordatorio.py copias.py bandeja.py fichacsirc_linux.py "$APP/"
cp -r web "$APP/web"
rm -f "$APP/web/humo.js"                      # solo para las pruebas
cp logo_ugr.png NOVEDADES.md TECNOLOGIA.md "$APP/"

# Librerias de Python PURAS (sirven para cualquier Python 3.10+ del sistema).
# pywebview usa en Linux el PyGObject del sistema, que no va aqui.
# El pip de Ubuntu 22.04 es de 2022 y no sabe construir algunas librerias
# desde su codigo fuente: se usa uno actual en un entorno aislado.
python3 -m venv build/linux/venv
build/linux/venv/bin/python -m pip install --quiet --upgrade pip
PIP="build/linux/venv/bin/python -m pip"
# charset-normalizer se publica tambien compilado para UNA version de Python:
# se toma su version pura (py3-none-any), que vale para 3.10 (22.04) y 3.12 (24.04).
$PIP install --quiet --target "$APP/vendor" --only-binary=:all: \
  --implementation py --platform any --python-version 3.10 charset-normalizer
# El resto, sin dependencias (ya estan todas aqui y son puras; proxy_tools solo
# se publica como codigo fuente y se construye, tambien puro).
$PIP install --quiet --target "$APP/vendor" --no-deps \
  "pywebview>=6.2,<7" proxy_tools bottle typing_extensions \
  requests urllib3 idna certifi
# nada compilado: si se colara, en otra version de Python no cargaria
if find "$APP/vendor" -name "*.so" | grep -q .; then
  echo "ERROR: hay librerias compiladas en vendor/:"; find "$APP/vendor" -name "*.so"; exit 1
fi
rm -rf "$APP/vendor/bin" "$APP"/vendor/*.dist-info/RECORD
find "$APP" -name "__pycache__" -type d -prune -exec rm -rf {} +

ICONO=fichacsirc_256.png
DESKTOP='[Desktop Entry]
Type=Application
Name=FichaCSIRC
GenericName=Registro de horas
Comment=Registro de horas en ProyectosTIC (UGR)
Exec=fichacsirc
Icon=fichacsirc
Terminal=false
Categories=Office;Utility;
StartupWMClass=fichacsirc'

# ---------------- .deb ----------------
DEB=build/linux/deb
mkdir -p "$DEB/DEBIAN" "$DEB/opt/fichacsirc" "$DEB/usr/bin" \
         "$DEB/usr/share/applications" "$DEB/usr/share/icons/hicolor/256x256/apps"
cp -r "$APP"/. "$DEB/opt/fichacsirc/"
cat > "$DEB/usr/bin/fichacsirc" <<'EOF'
#!/bin/sh
# Lanzador de FichaCSIRC (.deb). La config va en ~/.config/FichaCSIRC.
export FICHACSIRC_LANZADOR=/usr/bin/fichacsirc
export FICHACSIRC_CONFIG="${FICHACSIRC_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/FichaCSIRC/config.json}"
mkdir -p "$(dirname "$FICHACSIRC_CONFIG")"
exec python3 /opt/fichacsirc/fichacsirc_linux.py "$@"
EOF
chmod 755 "$DEB/usr/bin/fichacsirc"
printf '%s\n' "$DESKTOP" > "$DEB/usr/share/applications/fichacsirc.desktop"
cp "$ICONO" "$DEB/usr/share/icons/hicolor/256x256/apps/fichacsirc.png"
TAM=$(du -sk "$DEB" | cut -f1)
cat > "$DEB/DEBIAN/control" <<EOF
Package: fichacsirc
Version: $VER
Section: utils
Priority: optional
Architecture: all
Depends: python3 (>= 3.10), python3-gi, gir1.2-gtk-3.0, gir1.2-webkit2-4.1 | gir1.2-webkit2-4.0
Installed-Size: $TAM
Maintainer: Enrique Vargas Vega <quique@ugr.es>
Homepage: https://github.com/enriquegrx/UGR-FichaCSIRC
Description: Registro de horas en ProyectosTIC (OpenProject) de la UGR
 Semana y mes, permisos, plantillas, copias de seguridad e INARI.
EOF
# al instalar/quitar, que el menu y los iconos se enteren
cat > "$DEB/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q /usr/share/icons/hicolor || true
EOF
chmod 755 "$DEB/DEBIAN/postinst"
dpkg-deb --root-owner-group --build "$DEB" "dist/fichacsirc_${VER}_all.deb"

# ---------------- AppImage ----------------
APPDIR=build/linux/FichaCSIRC.AppDir
mkdir -p "$APPDIR/usr/share/fichacsirc"
cp -r "$APP"/. "$APPDIR/usr/share/fichacsirc/"
cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/sh
# AppImage de FichaCSIRC: usa el Python y WebKitGTK del sistema (ver fichacsirc_linux.py).
AQUI="$(dirname "$(readlink -f "$0")")"
# el aviso diario debe lanzar el .AppImage, no la carpeta temporal donde se monta
export FICHACSIRC_LANZADOR="${APPIMAGE:-$AQUI/AppRun}"
export FICHACSIRC_CONFIG="${FICHACSIRC_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/FichaCSIRC/config.json}"
mkdir -p "$(dirname "$FICHACSIRC_CONFIG")"
exec python3 "$AQUI/usr/share/fichacsirc/fichacsirc_linux.py" "$@"
EOF
chmod 755 "$APPDIR/AppRun"
printf '%s\n' "$DESKTOP" > "$APPDIR/fichacsirc.desktop"
cp "$ICONO" "$APPDIR/fichacsirc.png"
if [ ! -x build/appimagetool ]; then
  curl -fsSL -o build/appimagetool \
    https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
  chmod +x build/appimagetool
fi
ARCH=x86_64 build/appimagetool --appimage-extract-and-run --no-appstream \
  "$APPDIR" dist/FichaCSIRC-linux-x86_64.AppImage

ls -la dist/fichacsirc_*_all.deb dist/FichaCSIRC-linux-x86_64.AppImage
