# FichaCSIRC — Guía rápida para empezar

FichaCSIRC es una pequeña aplicación de escritorio para **registrar tus horas de
trabajo en OpenProject (ProyectosTic)** sin pelearte con la web: marcas el día,
eliges la tarea, pones las horas y listo.

---

## 1. Instalación (solo la primera vez)

1. **Descarga** el instalador **`FichaCSIRC-Instalador.exe`** desde:
   **https://github.com/enriquegrx/UGR-FichaCSIRC/releases/latest**
   (en el apartado *Assets*, es el archivo más grande). La propia aplicación te
   avisará cuando haya una versión nueva.

2. **Haz doble clic** en el instalador descargado.

   - Si Windows muestra un aviso azul de **SmartScreen** ("Windows protegió su
     equipo"), pulsa **Más información → Ejecutar de todas formas**. Solo pasa
     la primera vez; es normal en aplicaciones internas sin firma comercial.

3. **Sigue el asistente** (Siguiente → Siguiente → Instalar). Sin complicaciones:

   - **No pide permisos de administrador**: se instala solo para tu usuario.
   - Deja marcada la casilla **"Crear un acceso directo en el escritorio"** si
     quieres el icono en el escritorio (viene marcada).
   - Al terminar, si dejas marcado **"Configurar FichaCSIRC ahora"** se abrirá el
     asistente de configuración. Para completarlo necesitarás tu **API key**:
     tenla a mano (sección 2) o cierra el asistente y ábrelo luego.

4. Al instalar quedan **dos programas** (los tienes en el menú Inicio y, si lo
   dejaste marcado, el de registro también en el escritorio):

   - **FichaCSIRC (Registrar horas)** — la que usarás cada día.
   - **FichaCSIRC - Configurar** — el asistente de configuración (una vez).

   > 💡 ¿Prefieres no instalar nada? En la misma página de descargas están
   > también `FichaCSIRC.exe` y `FichaCSIRC-Configurar.exe` sueltos (versión
   > portable): se ejecutan con doble clic, sin instalar.

   > 🗑️ Para desinstalar: *Configuración de Windows → Aplicaciones → FichaCSIRC
   > → Desinstalar* (tu configuración y tus horas no se tocan).

## 2. Consigue tu clave de acceso (API key) de OpenProject

La aplicación necesita una clave personal para registrar horas **en tu nombre**.
Se saca de tu propio perfil de OpenProject:

1. Entra en **https://proyectostic.ugr.es** con tu usuario de siempre.
2. Haz clic en tu **avatar** (tu foto o iniciales, arriba a la derecha)
   → **Mi cuenta**.
3. En el menú de la izquierda, entra en **Tokens de acceso**.
4. En la fila **API**, pulsa el botón de **generar** (icono **+**).
5. Copia el token que aparece y guárdalo un momento (un bloc de notas vale).

> ⚠️ **Importante:**
> - El token **solo se muestra una vez**. Si lo pierdes, no pasa nada: genera
>   otro nuevo desde el mismo sitio (el antiguo deja de valer).
> - Es **personal e intransferible**: no lo compartas con nadie. Equivale a tu
>   usuario y contraseña para registrar horas.

## 3. Configuración inicial (2 minutos)

1. Abre **`FichaCSIRC-Configurar.exe`** y sigue el asistente:
   - **Conexión**: la dirección ya viene puesta
     (`https://proyectostic.ugr.es`); pega tu **API key** y pulsa
     **Probar conexión** — debe saludarte con tu nombre.
   - **Jornada**: horas por día en horario normal (ej. 7) y de verano (ej. 5),
     con sus fechas.
   - **Tareas favoritas**: elige tu proyecto y marca las tareas que uses
     habitualmente (Ctrl o Mayús para marcar varias). Elige también tu
     actividad por defecto (ej. "soporte").
   - **Finalizar** para guardar.
2. Ya puedes cerrar el asistente. Solo tendrás que volver a él si cambia tu
   jornada o quieres retocar las favoritas.

## 4. Uso diario (medio minuto)

Abre **`FichaCSIRC.exe`**:

1. Cada día de la semana es una **tarjeta** con una barra de progreso
   (verde = día completo, ámbar = a medias). Haz **clic en el día** que quieras
   rellenar (hoy ya viene marcado).
2. Elige la **tarea**, revisa las **horas** (vienen pre-rellenas con lo que te
   falta) y la **actividad**, y pulsa **Añadir a días marcados** (o tecla Enter).
3. Listo. La tarjeta se pondrá verde cuando completes tu jornada.

Trucos que ahorran tiempo:

- **Toda la semana**: marca los 5 días y añade el mismo apunte a todos de golpe.
- **Copiar semana anterior**: repite la semana pasada entera, día a día.
- **Copiar día anterior**: repite el último día que fichaste en los días marcados.
- **Plantillas…**: guarda tu "día típico" y aplícalo con un clic.
- **Doble clic** en un apunte lo edita; **Supr** lo borra (con botón *Deshacer*).
- **Botón derecho** sobre un día: marcarlo como festivo/vacaciones para que no
  te lo pida.
- **Resumen mes**: cuántas horas llevas y qué días tienes incompletos.
- **Exportar CSV…**: tus horas en un archivo que abre Excel.
- **Aviso diario** (menú *Herramientas → Aviso diario de fichaje*): si sueles
  olvidarte, actívalo y Windows te avisará cada tarde solo si te faltan horas.

## 5. Si algo no va

| Problema | Solución |
|---|---|
| "Sin conexión con ProyectosTic" | Comprueba que tienes red de la UGR (o la VPN encendida). |
| "Acceso denegado (401)" | Tu API key ya no vale: genera otra (sección 2) y vuelve a pasar el configurador. |
| "No tienes permiso para ver las tareas de este proyecto" (403) | Es normal: solo ves los proyectos en los que participas. Elige otro proyecto. |
| Cualquier otra cosa rara | Junto a tu configuración (`%APPDATA%\FichaCSIRC`) hay un archivo `fichacsirc.log`: adjúntalo al pedir ayuda. |

*¿Dudas o sugerencias? Contacta con quien te pasó la aplicación.* 🙂
