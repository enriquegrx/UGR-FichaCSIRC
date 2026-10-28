# FichaCSIRC — Guía rápida para empezar 🕐

FichaCSIRC es una pequeña aplicación de escritorio para **registrar tus horas de
trabajo en ProyectosTIC (OpenProject)** sin pelearte con la web: marcas el día,
eliges la tarea, pones las horas y listo. ✅

Y si eres de **SisGes**, también sabe fichar tus **días de teletrabajo en INARI**
(ver la sección 6). El resto de mortales puede ignorar tranquilamente esa parte. 😉

---

## 1. 💾 Instalación (solo la primera vez)

### 🪟 Windows

1. **Descarga** el instalador **`FichaCSIRC-Instalador.exe`** desde:
   **https://github.com/enriquegrx/UGR-FichaCSIRC/releases/latest**
   (en el apartado *Assets*). La propia aplicación te avisará 🔔 cuando haya una
   versión nueva, así que esto solo lo haces una vez.

2. **Haz doble clic** en el instalador descargado.

   - Si Windows muestra un aviso azul de **SmartScreen** («Windows protegió su
     equipo»), pulsa **Más información → Ejecutar de todas formas**. Es normal en
     aplicaciones internas sin firma comercial; solo pasa la primera vez. 🛡️

3. **Sigue el asistente** (Siguiente → Siguiente → Instalar). Sin sustos:

   - **No pide permisos de administrador** 🙅: se instala solo para tu usuario.
   - Deja marcada **«Crear un acceso directo en el escritorio»** si quieres el
     icono a mano (viene marcada).
   - Al terminar, si es tu **primera instalación**, deja marcada **«Abrir
     FichaCSIRC y configurarlo»**: la app arranca directamente el asistente
     (necesitarás tu **API key**: tenla a mano, sección 2). Si es una
     **actualización**, verás **«Abrir FichaCSIRC al terminar»** y la app se
     reabrirá sola con todo lo tuyo. 🔁

4. En el menú Inicio (y, si lo marcaste, en el escritorio) tienes:

   - 📝 **FichaCSIRC (Registrar horas)** — la que usarás cada día.
   - 🔧 **FichaCSIRC - Configurar** — abre directamente el asistente de
     configuración (también está dentro de la app, en *Herramientas*).

   > 🧩 Necesita **Microsoft Edge WebView2**, que ya viene con Windows 11 y con
   > Windows 10 actualizado. Si faltara, el instalador te avisa.

   > 🗑️ **Para desinstalar:** *Configuración de Windows → Aplicaciones →
   > FichaCSIRC → Desinstalar*. Tu configuración y tus horas no se tocan.

### 🍎 macOS

1. **Descarga** el `.dmg` de tu Mac desde:
   **https://github.com/enriquegrx/UGR-FichaCSIRC/releases/latest**

   - Apple Silicon (M1/M2/M3/M4): `FichaCSIRC-mac-arm64.dmg`
   - Intel: `FichaCSIRC-mac-x64.dmg`

2. Ábrelo. Verás **FichaCSIRC.app** y un acceso a **Aplicaciones**.
   **Arrástrala a Aplicaciones** 📂 (si ya la tenías, elige **«Reemplazar»**).
   No la abras desde el propio `.dmg` ni desde Descargas: así cada actualización
   sustituye a la anterior en vez de dejar otra copia.

3. Ábrela desde Aplicaciones. Como no está firmada por Apple, la primera vez
   macOS la bloquea: ve a **Ajustes del Sistema → Privacidad y seguridad** y
   pulsa **«Abrir igualmente»**. Solo la primera vez. 🔓 La primera vez arranca
   sola el asistente de configuración.

> 🧹 **¿Vienes de una versión anterior a la 3.0?** Ya no hay
> *FichaCSIRC-Configurar.app*: el asistente va dentro de la app (*Herramientas →
> Configuración*). Puedes mandar la antigua a la Papelera.

> 🔄 **Actualizar en Mac:** cuando haya versión nueva, la app te ofrece
> descargarla. Se abre el instalador y la app se cierra; arrastra FichaCSIRC a
> Aplicaciones y elige **«Reemplazar»**.
>
> 🧹 **¿Te salen varios iconos de FichaCSIRC en Launchpad?** Son copias viejas
> (de cuando se distribuía en `.zip`). Deja solo las de **Aplicaciones** y manda
> el resto a la Papelera desde el Finder; suelen estar en **Descargas**. Si
> Launchpad sigue mostrándolas, ejecuta `killall Dock` en Terminal.
>
> 🖱️ En Mac, el **botón derecho** de estas instrucciones es el clic secundario
> (dos dedos en el trackpad) o **Ctrl+clic**.

---

## 2. 🔑 Consigue tu clave de acceso (API key) de OpenProject

La aplicación necesita una clave personal para registrar horas **en tu nombre**.
Se saca de tu propio perfil de OpenProject:

1. Entra en **https://proyectostic.ugr.es** con tu usuario de siempre.
2. Haz clic en tu **avatar** (foto o iniciales, arriba a la derecha) → **Mi cuenta**.
3. En el menú de la izquierda, entra en **Tokens de acceso**.
4. En la fila **API**, pulsa el botón de **generar** (icono **+**).
5. Copia el token y guárdalo un momento (un bloc de notas vale). 📋

> ⚠️ **Importante:**
> - El token **solo se muestra una vez**. Si lo pierdes, no pasa nada: genera
>   otro desde el mismo sitio (el antiguo deja de valer).
> - Es **personal e intransferible** 🔒: no lo compartas con nadie. Equivale a tu
>   usuario y contraseña para registrar horas.

---

## 3. ⚙️ Configuración inicial (2 minutos)

La primera vez que abres FichaCSIRC arranca solo el asistente. Para volver a
él más adelante: **Herramientas → Configuración (asistente)** (o, en Windows,
el acceso **FichaCSIRC - Configurar**).

- 🔌 **Conexión**: la dirección ya viene puesta (`https://proyectostic.ugr.es`);
  pega tu **API key** y pulsa **Probar conexión** — debe saludarte con tu nombre. 👋
- ⏰ **Jornada**: tu jornada **oficial** (ej. 7) y, si media hora es de desayuno
  y no se ficha, marca **Descontar desayuno** (0,5): el asistente te dice cuánto
  fichas (6,5 h) y cuánto vale un día de permiso (7 h). Después, la de verano
  (ej. 5) con sus fechas. Admite medias horas (4,5).
- ⭐ **Tareas favoritas**: elige tu proyecto y marca las tareas que uses a menudo
  (Ctrl o Mayús para varias). Elige también tu actividad por defecto (ej. «soporte»).
- 💾 **Finalizar** para guardar.

Al finalizar pasas directamente a la ventana de fichar. Solo tendrás que volver
al asistente si cambia tu jornada o quieres retocar las favoritas. La API key
no se vuelve a mostrar: si dejas su campo vacío, se conserva la guardada.

---

## 4. 📅 Uso diario (medio minuto)

Abre **FichaCSIRC (Registrar horas)**:

1. Cada día de la semana es una **tarjeta** 🗂️ con una barra de progreso
   (🟢 verde = día completo, 🟠 ámbar = a medias). Haz **clic en el día** que
   quieras rellenar (hoy ya viene marcado).
2. Elige la **tarea**, revisa las **horas** (vienen pre-rellenas con lo que te
   falta) y la **actividad**, y pulsa **Añadir a…** (o Enter). ↵ El botón dice a
   qué días va: «Añadir a lun 26/10», «Añadir a 3 días».
3. Listo. La tarjeta se pone verde cuando completas tu jornada. 🎉

A la derecha del formulario ves los **apuntes de los días marcados**, cada uno
con su ✏️ **editar** y 🗑️ **borrar**.

### 📆 Vista mensual

Arriba, el botón **Semana | Mes** cambia las tarjetas por el **calendario del
mes** (de lunes a viernes). Cada día enseña lo que llevas y, arriba, ves si vas
**al día ✔** o cuántas horas te faltan: los huecos saltan a la vista. Funciona
igual que la semana: marcas días (de **cualquier semana**) y añades, copias o
aplicas una plantilla a todos a la vez. Las flechas ← → y *Hoy* cambian de mes.
La app recuerda la vista que dejaste.

### ✨ Trucos que ahorran tiempo

- 🗓️ **Toda la semana** (o **Todo el mes**): marca todos los días y añade el
  mismo apunte de golpe.
- ⇧ **Mayús+clic** sobre un día marca **todo el rango** desde el último que
  pulsaste: unas vacaciones de dos semanas, de un clic.
- 🔄 **Copiar semana anterior**: repite la semana pasada entera, día a día.
- 📄 **Copiar día anterior**: repite el último día que fichaste en los días marcados.
- 🧩 **Plantillas**: guarda tu «día típico» y aplícalo con un clic. La forma
  más rápida de crear una: **botón derecho sobre el día** → *Apuntes del día*
  → *Guardar este día como plantilla*.
- 🗑️ **Eliminar apuntes de un día**: botón derecho sobre el día → *Apuntes del
  día* → *Eliminar apuntes de este día*. Te los lista y eliges uno, varios o
  todos (se puede deshacer).
- ✏️ **Doble clic** en un apunte lo edita; **Supr** lo borra (con botón *Deshacer* 🔙).
- 🖱️ **Botón derecho** sobre un día (en Mac, **Ctrl+clic**): marcarlo como
  festivo, vacaciones, guardia o teletrabajo, o **añadir un permiso por horas**
  (los colores y etiquetas te lo recuerdan de un vistazo).
- 🏖️ **Importar festivos** (*Herramientas*): marca de golpe los festivos del año
  (nacionales, de Andalucía y de Granada), calculados solos, para que no te los pida.
- 🔗 **Asociar una actividad con su tarea**: pulsa **botón derecho sobre el
  desplegable de Actividad** y elige *Asociar*. A partir de ahí, al seleccionar
  esa actividad la tarea cambia sola a la que corresponde (te avisa abajo). Muy
  útil para los permisos: asocia «Asuntos propios» con la tarea de *Permisos* y
  no se te volverá a ir a la tarea equivocada.
- 🆕 **Ayuda → Novedades**: qué ha cambiado en cada versión, dentro de la propia
  aplicación.
- 📊 **Resumen del mes**: cuántas horas llevas, tu objetivo y qué días te faltan.
- 📤 **Exportar CSV**: tus horas en un archivo que abre Excel.
- ⏰ **Aviso diario de fichaje** (*Herramientas*): si sueles olvidarte, actívalo y
  el sistema te avisará a la hora que elijas (por defecto las **16:00**), solo si
  te faltan horas (Windows y macOS).

---

## 5. 🕐 Permisos por horas

Casi todos los permisos del portal de personal se miden **en horas**, no en días
enteros: asuntos particulares, conciliación de la vida laboral y familiar, o la
compensación por servicios mínimos. FichaCSIRC lo tiene en cuenta.

**Cómo se usa:** botón derecho sobre el día → **Añadir permiso por horas…**,
eliges el tipo y las horas (por ejemplo `3:00`). Ese día el objetivo baja solo:
si tu jornada es de 7 h y coges 3 h de permiso, la app solo te pedirá **4 h**. 👌

¿Te coges el **día entero**? Pulsa el botón **«Día completo»** y te rellena tu
jornada de ese día: el objetivo queda a 0 y se te descuentan esas horas del cupo
(los asuntos particulares son «días fraccionables», así que un día entero son
simplemente las horas de tu jornada).

**Las horas las pones tú**, copiándolas de tu portal de personal (no hay forma de
leerlas automáticamente). Ve a **Herramientas → Permisos (horas)**.

Ojo, porque esto es importante: las horas de un permiso **no son un cupo fijo**.
Te las van **concediendo** (por ejemplo, por servicios extraordinarios), y cada
concesión puede traer **su propia fecha de caducidad**. Por eso cada tipo tiene
una lista de **concesiones**, y el total es su suma:

```
Compensación por servicios mínimos     Total 56:00 · Usadas 38:00 · Disponibles 18:00
    28:00   caduca 2027-01-07
    28:00   caduca 2027-04-06
    ＋ Añadir concesión
```

- **＋ Añadir concesión** 🎁: cuando te concedan horas nuevas, las añades ahí con
  su fecha límite (déjala vacía si no caduca). Se guarda al momento.
- **Usadas** se calculan solas (ver abajo).
- **Te quedan** = todo lo concedido − todo lo usado. En rojo si te pasas.

**Lo que no usas no se pierde** 🔁: el saldo es continuo. A partir del **1 de
enero**, al abrir la app te ofrece **añadir los permisos del año nuevo**, que se
**suman a lo que te quede**. Viene con las horas del año anterior ya puestas;
corrígelas o deja en blanco las que no te toquen. Es opcional: *Más tarde* te lo
vuelve a preguntar al siguiente arranque y *No este año* no insiste más. También
lo tienes a mano en *Herramientas → Permisos (horas) → Añadir los permisos de…*.

**¿Cómo se cuentan las usadas?** Depende de tu servicio:

- Si tus permisos **solo los marcas en el día** (botón derecho → *Añadir permiso
  por horas…*), se cuentan esos. Es la opción por defecto.
- Si en tu servicio los asuntos propios (u otro permiso) **se imputan en
  ProyectosTic como una actividad** dentro de una tarea, dile a la app cuál: en
  *Herramientas → Permisos (horas)*, en ese permiso, elige la actividad en
  **«Se imputa como actividad»** (por ejemplo *Asuntos propios*). Desde entonces
  las horas que imputes con esa actividad también te descuentan del saldo. 🔗
  En ese caso no marques además el permiso en el día, o contará dos veces.
- ⏳ La app **avisa** cuando una concesión está a punto de caducar, y ⚠️ marca las
  ya caducadas — pero **no te resta horas sola**: tú decides qué hacer.

> ☕ **Si descuentas el desayuno, léete esto.** Una cosa es lo que **fichas** cada
> día y otra lo que **vale un día de permiso**. Si tu jornada oficial son 7 h pero
> media hora es de desayuno, fichas 6,5 h… pero un día entero de asuntos propios
> (o de baja, o de conciliación) **cuenta como 7 h**, que es como lo descuenta el
> portal. Indícalo en el asistente de configuración: pon tu jornada **oficial** y
> marca *Descontar desayuno*. Si no lo haces, el cupo se te queda corto (media
> hora de más por cada día de permiso).

> 💡 Las **vacaciones** siguen contándose **en días** (su cupo está en
> *Herramientas → Vacaciones y teletrabajo*), porque así las mide el portal.

---

## 6. 🏡 Teletrabajo con INARI (solo SisGes)

> 🏢 **Esto es solo para el servicio de SisGes.** Si no eres de Sistemas de
> Gestión, sáltate esta sección tan tranquilo: no te afecta en nada y la
> integración viene **desactivada** de fábrica. 🙂

En SisGes, las horas de los **días de teletrabajo** se llevan en **INARI**
(el Kanboard del servicio), no en ProyectosTIC. FichaCSIRC puede hacerlo por ti
para que no tengas que saltar de una herramienta a otra.

### 🔗 Activar la integración (una vez)

1. Consigue tu **token personal de INARI** desde tu perfil de usuario en INARI
   (es tu clave de API, igual de personal que la de OpenProject 🔒).
2. En FichaCSIRC, ve a **Herramientas → Integraciones (INARI)…**.
3. Marca **«Activar la integración con INARI»** y rellena:
   - **URL**: ya viene puesta.
   - **Usuario** y **Token**. Truco 💡: puedes pegar `usuario:token` de una vez en
     el campo Usuario y se separan solos.
4. Pulsa **Probar conexión** ✅ y elige tu **proyecto** y los valores **por
   defecto** de columna, carril y categoría (luego los podrás cambiar en cada
   franja).

### 🖊️ Fichar un día de teletrabajo

1. **Botón derecho** sobre el día → **Marcar teletrabajo** 🏡.
2. **Botón derecho** de nuevo → **Registrar slot en INARI…**.
3. Indica **inicio** y **fin** de la franja, una **descripción** y, si ese rato
   fue de otra cosa, cambia **columna / carril / categoría** (vienen con lo último
   que usaste, así que normalmente no tocas nada). Pulsa **Registrar**.
4. Repite para cada tramo del día. Cada franja se guarda como su propia tarjeta
   en INARI. 🧾

### 👀 Cómo saber que va todo bien

- En el **pie de la ventana** tienes dos semáforos: **● ProyectosTIC** y
  **● INARI**. En verde 🟢 = conectado.
- El **Resumen del mes** cuenta esos días como *teletrabajo* y suma sus horas de
  INARI, así que el total sigue cuadrando. 🧮

> 🧭 **Regla de oro:** un día de teletrabajo va a **INARI o a ProyectosTIC, nunca
> a los dos** — así no se duplican horas.

---

## 7. 🆘 Si algo no va

| Problema | Solución |
|---|---|
| «Sin conexión con ProyectosTic» | Comprueba que tienes red de la UGR (o la VPN encendida 🌐). |
| «Acceso denegado (401)» | Tu API key ya no vale: genera otra (sección 2) y pégala en *Herramientas → Configuración (asistente)*. |
| «No tienes permiso para ver las tareas de este proyecto» (403) | Es normal: solo ves los proyectos en los que participas. Elige otro. |
| Varios iconos de FichaCSIRC en Launchpad (Mac) | Son copias viejas en Descargas: deja solo las de Aplicaciones (ver sección 1, macOS). |
| El aviso diario de fichaje no salta | Abre FichaCSIRC una vez: si el aviso apuntaba a una instalación vieja, la app lo reprograma sola a la misma hora. |
| El indicador **● INARI** está en rojo | Revisa tu token en *Herramientas → Integraciones (INARI)…* y prueba la conexión (solo aplica a SisGes). |
| Cualquier otra cosa rara 🐛 | Junto a tu configuración (`%APPDATA%\FichaCSIRC` en Windows, `~/Library/Application Support/FichaCSIRC` en macOS) hay un archivo `fichacsirc.log`: adjúntalo al pedir ayuda. |

---

*¿Dudas o sugerencias? Contacta con quien te pasó la aplicación.* 🙂
