# Tecnología de FichaCSIRC

Con qué está hecha FichaCSIRC y por qué, contado en corto.

---

## Cómo está hecha

**La ventana**
- Está dibujada con **HTML, CSS y JavaScript**, las mismas piezas que una página
  web, pero **no es una web**: va dentro de la aplicación y no se carga de
  ningún servidor.
- La muestra **pywebview** usando el motor de navegador que ya trae el sistema:
  **Microsoft Edge WebView2** en Windows y **WebKit** (el de Safari) en Mac. Por
  eso se ve igual de nítida que el navegador y no hace falta instalar nada más.
- El JavaScript solo pinta y recoge lo que pulsas; no decide nada ni guarda
  datos.

**El motor**
- Toda la lógica está escrita en **Python 3.12**: tu jornada con o sin desayuno,
  verano, festivos, permisos y su saldo, los avisos antes de añadir y lo que
  sale en cada día.
- Habla con **ProyectosTIC (OpenProject)** a través de su API oficial (versión 3)
  con tu clave personal (API key). Tus horas viven allí; la aplicación solo las
  lee y las escribe.

**Tus datos en el equipo**
- La configuración (tus favoritas, plantillas, festivos, permisos y
  preferencias) se guarda en un archivo **config.json** en tu carpeta de
  usuario. Si activas el PIN, de él solo se guarda una huella cifrada
  (PBKDF2), nunca el PIN.
- Se escribe de forma segura: un corte de luz a mitad no lo deja roto.

**Con quién más habla**
- **INARI**, para el teletrabajo de SisGes (si lo activas).
- **GitHub**, para saber si hay una versión nueva y descargarla.
- El **Programador de tareas** de Windows o **launchd** en Mac, para el aviso
  diario de fichaje.

## Cómo se construye y se publica

- **PyInstaller** mete Python y todo lo necesario dentro de la aplicación: no
  tienes que instalar Python.
- En Windows, un instalador hecho con **Inno Setup**; en Mac, un **.dmg** para
  Apple Silicon y otro para Intel.
- **GitHub Actions** lo compila y lo publica solo con cada versión, después de
  pasar más de 240 **pruebas automáticas** que comprueban los cálculos.

## Por qué así

- Hasta la versión 2.9 la ventana usaba **Tkinter**, la que trae Python de
  serie. Era sencilla pero anticuada: botones que Windows pintaba a su manera,
  partes que desaparecían al cambiar el tamaño y diferencias entre Windows y Mac.
- En la 3.0 se cambió a **pywebview** porque permite un diseño moderno y
  rápido manteniendo el motor de Python, que ya estaba probado.
- Y porque la ventana en HTML **se aprovecha tal cual** el día que se cambie el
  motor (siguiente apartado).

## El futuro: Rust y Tauri

- Está previsto migrar FichaCSIRC a **Tauri**, un sistema para hacer
  aplicaciones de escritorio con **Rust**, un lenguaje moderno, muy rápido y
  seguro.
- La **ventana se quedará casi igual**: Tauri usa el mismo motor (WebView2 y
  WebKit) y el mismo HTML, CSS y JavaScript de ahora. Lo que se reescribe en
  Rust es el motor que hoy está en Python.
- Qué se gana: un instalador **más pequeño**, un arranque **más rápido**, menos
  memoria, **sin Python dentro** (adiós a los problemas de archivos bloqueados
  por Windows) y actualizaciones **firmadas** que se instalan solas.
- Para ti no cambiará nada: la misma pantalla y la **misma configuración**, sin
  volver a configurar. Se hará sin prisa y con las mismas pruebas automáticas,
  para que los cálculos den exactamente lo mismo.
