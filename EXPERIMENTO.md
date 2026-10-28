# Experimento: interfaz HTML con pywebview

Rama **`experimento/pywebview`**. Es una prueba para decidir si la interfaz pasa
de Tkinter a HTML. **No es una versión publicada**: no tiene etiqueta, no crea
release y el actualizador de la app no la ve. Solo la usa quien la descarga a
propósito.

## Qué es

- `registrar_web.py`: la ventana principal con pywebview. La clase `Api` es lo
  único que ve el JavaScript; toda la lógica sigue en Python y el motor
  (`rellenar_horas.py`, `destinos.py`, `inari.py`) **no se ha tocado**.
- `web/`: `index.html`, `app.css` y `app.js`, sin librerías externas (funciona
  sin internet). `demo.js` solo se activa abriendo la página con `?demo`.
- La app Tkinter (`registrar_gui.py`) sigue intacta en la rama para comparar.

## Qué incluye el prototipo

Lo mismo que la app de verdad:

- **Ventana principal:** semana con tarjetas, totales y chips; marcar días (clic,
  *Toda la semana*, Alt+1..5); añadir apuntes con **los mismos avisos** (día sin
  leer, no laborable, tarea repetida, jornada superada); lista con selección
  múltiple, eliminar y deshacer; barra de menús (Archivo, Herramientas, Ayuda).
- **Diálogos** (`web/dialogos.js`): editar apunte (doble clic), buscar tareas
  (por proyecto o en todos) y añadirlas a favoritas, copiar día/semana anterior,
  plantillas, resumen del mes, exportar CSV, importar festivos, vacaciones y
  teletrabajo, permisos (saldo, concesiones, enlace a actividad, permisos del
  año nuevo), integración INARI y registro de slots, novedades, atajos, acerca de.
- **Botón derecho** sobre un día (festivo, vacaciones, permiso, guardia,
  teletrabajo, guardar como plantilla, eliminar apuntes del día, slot de INARI)
  y sobre Actividad (asociarla con la tarea).

Mejoras respecto a la app Tkinter que ya vienen de serie:

- **Resumen del mes y exportar CSV hacen una sola consulta** por rango en vez de
  una por día (el resumen de un mes: ~0,5 s frente a 22 consultas).
- El **token de INARI nunca llega a la ventana**: solo se sabe si hay uno guardado.
- El **pie de botones de cada diálogo siempre se ve**, se encoja lo que se encoja.
- El **botón derecho funciona igual en Windows y en Mac** (lo resuelve el visor
  web, sin el lío de Button-2/Button-3 de Tk).

- **Asistente de configuración** (`web/configurar.html`) dentro de la misma app:
  se abre **solo la primera vez** (sin config, en lugar de un error) y desde
  *Herramientas → Configuración*. Al guardar recarga el motor sin reiniciar. La
  API key no viaja a la pantalla (campo vacío = se conserva la guardada).
- **Aviso diario** (`FichaCSIRC-Web.exe --recordatorio`, `web/aviso.html`) y su
  configuración, y **actualizaciones** (comprobar, descargar e instalar).

## El interruptor `EXPERIMENTO`

`registrar_web.py` tiene `EXPERIMENTO = True`. Mientras lo esté:

- usa su **propia configuración** (ver abajo);
- **comprueba** si hay versión nueva pero **no la instala** (instalaría la de
  producción encima);
- **no programa ni repara el aviso diario**: es la misma tarea programada que la
  app de verdad y la secuestraría. La ventanita del aviso sí se puede lanzar a
  mano para verla: `FichaCSIRC-Web.exe --recordatorio`;
- no avisa en Mac de mover la app a Aplicaciones.

Pasarla a producción = `EXPERIMENTO = False` y empaquetarla en lugar de la
Tkinter (instalador de Inno Setup y `.dmg`, con un solo `.app`: el asistente ya
va dentro).

## Ojo al probarlo

- Usa **su propia configuración** (`%APPDATA%\FichaCSIRC-experimento` o
  `~/Library/Application Support/FichaCSIRC-experimento`), copiada de la real la
  primera vez. Lo que marques en local (festivos, guardias…) no toca la app de
  verdad. Para empezar de cero, borra esa carpeta.
- Los **apuntes sí van a ProyectosTic**: es tu cuenta real.
- No comprueba actualizaciones (no debe ofrecer instalar la de producción).

## Cómo probarlo

**Descargado de GitHub:** *Actions → Prototipo web → el último run → Artifacts*.
En Windows, `FichaCSIRC-Web-windows` → **antes de descomprimir: clic derecho en el
zip → Propiedades → Desbloquear** → descomprimir → `FichaCSIRC-Web.exe`.

> Sin desbloquear falla con *«Failed to resolve Python.Runtime.Loader.Initialize»*:
> Windows marca como «descargado de internet» todo lo que sale del zip y .NET
> (que pywebview usa para abrir la ventana) se niega a cargar una DLL marcada.
> No afecta a una versión real instalada con el instalador de Inno Setup: los
> ficheros que copia un instalador no llevan esa marca.

En Mac,
`FichaCSIRC-Web-mac-arm64` (zip dentro de zip) → la primera vez *Ajustes del
Sistema → Privacidad y seguridad → Abrir igualmente*.

**Desde el código:**

```bash
pip install -r requirements-web.txt
python registrar_web.py
```

Para ver solo el diseño en un navegador, sin red ni pywebview:
`python -m http.server 8765 --directory web` y abrir
`http://localhost:8765/index.html?demo`.

## Medido hasta ahora (Windows 11)

- Ejecutable `--onedir`: **25 MB** sin comprimir, como la app actual.
- Con datos reales pinta la semana en **~2,5 s** (contando las 5 consultas).
- Requiere WebView2 (viene con Windows 10/11 actualizados).
