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
   - Al terminar, si es tu **primera instalación**, puedes dejar marcada
     **«Configurar FichaCSIRC ahora (necesario la primera vez)»** para abrir el asistente
     (necesitarás tu **API key**: tenla a mano, sección 2). Si es una
     **actualización**, verás **«Abrir FichaCSIRC al terminar»** y la app se
     reabrirá sola. 🔁

4. Quedan instalados **dos programas** (en el menú Inicio y, si lo marcaste, el
   de registro también en el escritorio):

   - 📝 **FichaCSIRC (Registrar horas)** — la que usarás cada día.
   - 🔧 **FichaCSIRC - Configurar** — el asistente de configuración (una vez).

   > 🗑️ **Para desinstalar:** *Configuración de Windows → Aplicaciones →
   > FichaCSIRC → Desinstalar*. Tu configuración y tus horas no se tocan.

### 🍎 macOS

1. **Descarga** el ZIP de tu Mac desde:
   **https://github.com/enriquegrx/UGR-FichaCSIRC/releases/latest**

   - Apple Silicon (M1/M2/M3/M4): `FichaCSIRC-mac-arm64.zip`
   - Intel: `FichaCSIRC-mac-x64.zip`

2. Descomprime el ZIP. Dentro hay dos aplicaciones:

   - 📝 **FichaCSIRC.app** — la de cada día.
   - 🔧 **FichaCSIRC-Configurar.app** — el asistente de configuración.

3. Abre primero **FichaCSIRC-Configurar.app**. Si macOS avisa de que la app no
   está firmada, haz **clic derecho → Abrir → Abrir**. Solo la primera vez. 🔓

4. Cuando termines la configuración, abre **FichaCSIRC.app** para fichar.

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

Abre **FichaCSIRC - Configurar** y sigue el asistente:

- 🔌 **Conexión**: la dirección ya viene puesta (`https://proyectostic.ugr.es`);
  pega tu **API key** y pulsa **Probar conexión** — debe saludarte con tu nombre. 👋
- ⏰ **Jornada**: horas por día en horario normal (ej. 7) y de verano (ej. 5), con
  sus fechas. Admite medias horas (4,5).
- ⭐ **Tareas favoritas**: elige tu proyecto y marca las tareas que uses a menudo
  (Ctrl o Mayús para varias). Elige también tu actividad por defecto (ej. «soporte»).
- 💾 **Finalizar** para guardar.

Ya puedes cerrar el asistente. Solo tendrás que volver si cambia tu jornada o
quieres retocar las favoritas.

---

## 4. 📅 Uso diario (medio minuto)

Abre **FichaCSIRC (Registrar horas)**:

1. Cada día de la semana es una **tarjeta** 🗂️ con una barra de progreso
   (🟢 verde = día completo, 🟠 ámbar = a medias). Haz **clic en el día** que
   quieras rellenar (hoy ya viene marcado).
2. Elige la **tarea**, revisa las **horas** (vienen pre-rellenas con lo que te
   falta) y la **actividad**, y pulsa **Añadir a días marcados** (o Enter). ↵
3. Listo. La tarjeta se pone verde cuando completas tu jornada. 🎉

### ✨ Trucos que ahorran tiempo

- 🗓️ **Toda la semana**: marca los 5 días y añade el mismo apunte a todos de golpe.
- 🔄 **Copiar semana anterior**: repite la semana pasada entera, día a día.
- 📄 **Copiar día anterior**: repite el último día que fichaste en los días marcados.
- 🧩 **Plantillas…**: guarda tu «día típico» y aplícalo con un clic.
- ✏️ **Doble clic** en un apunte lo edita; **Supr** lo borra (con botón *Deshacer* 🔙).
- 🖱️ **Botón derecho** sobre un día: marcarlo como festivo, vacaciones, guardia o
  teletrabajo, o **añadir un permiso por horas** (los colores y etiquetas te lo
  recuerdan de un vistazo).
- 🏖️ **Importar festivos** (*Herramientas*): marca de golpe los festivos del año
  (nacionales, de Andalucía y de Granada), calculados solos, para que no te los pida.
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
- **Usadas** se calculan solas con los permisos que marcas en los días.
- **Disponibles** = total − usadas. En rojo si te pasas.
- ⏳ La app **avisa** cuando una concesión está a punto de caducar, y ⚠️ marca las
  ya caducadas — pero **no te resta horas sola**: tú decides qué hacer.

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
| «Acceso denegado (401)» | Tu API key ya no vale: genera otra (sección 2) y vuelve a pasar el configurador. |
| «No tienes permiso para ver las tareas de este proyecto» (403) | Es normal: solo ves los proyectos en los que participas. Elige otro. |
| El indicador **● INARI** está en rojo | Revisa tu token en *Herramientas → Integraciones (INARI)…* y prueba la conexión (solo aplica a SisGes). |
| Cualquier otra cosa rara 🐛 | Junto a tu configuración (`%APPDATA%\FichaCSIRC` en Windows, `~/Library/Application Support/FichaCSIRC` en macOS) hay un archivo `fichacsirc.log`: adjúntalo al pedir ayuda. |

---

*¿Dudas o sugerencias? Contacta con quien te pasó la aplicación.* 🙂
