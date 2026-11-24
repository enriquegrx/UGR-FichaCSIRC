# Tecnología de FichaCSIRC

Con qué está hecha FichaCSIRC y por qué, contado en corto. Arriba, la versión 4;
debajo, cómo estaban hechas las anteriores.

---

## Versión 4: cómo está hecha

**La ventana**
- Es **la misma de la versión 3**, sin reescribir: **HTML, CSS y JavaScript**
  dentro de la aplicación, que no se cargan de ningún servidor. Por eso se ve y
  se maneja igual.
- La muestra **Tauri 2** con el motor de navegador que ya trae el sistema:
  **Microsoft Edge WebView2** en Windows, **WebKit** en Mac y **WebKitGTK** en
  Linux.
- El JavaScript solo pinta y recoge lo que pulsas; no decide nada ni guarda
  datos.

**El motor**
- Toda la lógica está reescrita en **Rust**, un lenguaje moderno, rápido y
  seguro: tu jornada con o sin desayuno, verano, festivos, permisos y su saldo,
  los avisos antes de añadir, las estadísticas y los días por completar.
- Hace **los mismos cálculos** que el motor de Python de la versión 3: se han
  comparado los dos, día a día y campo a campo, con apuntes reales.
- Habla con **ProyectosTIC (OpenProject)** a través de su API oficial (versión 3)
  con tu clave personal (API key), igual que antes. Tus horas viven allí; la
  aplicación solo las lee y las escribe.
- Si ProyectosTIC te da permiso en algún proyecto, también **crea, modifica y
  duplica tareas** allí, siempre con tu clave y con lo que te deje tu rol.

**Tus datos en el equipo**
- El **mismo config.json**, en el mismo sitio: al pasar de la 3 a la 4 no hay
  que configurar nada. La API key, las favoritas, las plantillas, los permisos
  y las preferencias siguen ahí.
- El **PIN** se comprueba con la misma huella cifrada (PBKDF2): el que tenías
  sigue valiendo, y el PIN nunca se guarda.
- Se escribe de forma segura y con **copias de seguridad** automáticas, como en
  la 3.

**Con quién más habla**
- **INARI**, para el teletrabajo de SisGes (si lo activas).
- **GitHub**, para saber si hay una versión nueva: avisa, descarga el
  instalador y lo abre.
- **Windows**, para el aviso diario de fichaje (Programador de tareas), el
  icono junto al reloj y arrancar con el equipo.

## Versión 4: cómo se construye

- **cargo**, el compilador de Rust, produce un programa nativo: **no lleva
  Python dentro**.
- **Tauri** prepara los instaladores: en Windows uno de unos **3 MB** (NSIS);
  en Mac, un **.dmg** para Apple Silicon y otro para Intel; en Linux, **.deb**
  y **AppImage**.
- **GitHub Actions** lo compila en los tres sistemas después de pasar más de
  350 **pruebas automáticas**, entre las del motor y las de la ventana.

## Versión 4: qué cambia para ti

- **Nada que tengas que hacer**: la misma pantalla y la misma configuración,
  sin volver a configurar.
- Un instalador **mucho más pequeño** y un programa **sin Python dentro**:
  adiós a los problemas de archivos bloqueados por Windows al instalar o
  actualizar.
- Lo que queda pendiente: en **Mac y Linux** la versión 4 todavía no tiene el
  aviso diario de fichaje, y las actualizaciones aún no van **firmadas**.

## Versión 3 (histórico): cómo estaba hecha

De la 3.0 a la 3.2. Se deja como se escribió entonces.

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

## Versión 3 (histórico): cómo se construía y se publicaba

- **PyInstaller** mete Python y todo lo necesario dentro de la aplicación: no
  tienes que instalar Python.
- En Windows, un instalador hecho con **Inno Setup**; en Mac, un **.dmg** para
  Apple Silicon y otro para Intel.
- **GitHub Actions** lo compila y lo publica solo con cada versión, después de
  pasar más de 240 **pruebas automáticas** que comprueban los cálculos.

## Por qué así: de Tkinter a Rust

- Hasta la versión 2.9 la ventana usaba **Tkinter**, la que trae Python de
  serie. Era sencilla pero anticuada: botones que Windows pintaba a su manera,
  partes que desaparecían al cambiar el tamaño y diferencias entre Windows y Mac.
- En la 3.0 se cambió a **pywebview** porque permite un diseño moderno y
  rápido manteniendo el motor de Python, que ya estaba probado.
- Y porque la ventana en HTML **se aprovecha tal cual** el día que se cambie el
  motor. Ese día ha sido la versión 4: la ventana es la misma y lo que se ha
  reescrito en **Rust** es el motor.

## Lo que se anunció en la versión 3 (histórico)

Así se contaba en la 3 el paso a Rust y Tauri, antes de hacerlo.

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
