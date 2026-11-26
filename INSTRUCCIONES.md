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
   (en el apartado *Assets*). Ocupa unos 3 MB. La propia aplicación te avisará
   🔔 cuando haya una versión nueva, así que esto solo lo haces una vez.

2. **Haz doble clic** en el instalador, mejor desde el Explorador de archivos
   (la carpeta *Descargas*) que desde la lista de descargas del navegador.

   - Si Windows muestra un aviso azul de **SmartScreen** («Windows protegió su
     equipo»), pulsa **Más información → Ejecutar de todas formas**. Es normal en
     aplicaciones internas sin firma comercial; solo pasa la primera vez. 🛡️

3. **Sigue el asistente** (Siguiente → Instalar). Sin sustos:

   - **No pide permisos de administrador** 🙅: se instala solo para tu usuario.
   - Al terminar, deja marcado que **abra FichaCSIRC**. Si es tu **primera
     instalación**, arranca el asistente de configuración (necesitarás tu
     **API key**: tenla a mano, sección 2). Si es una **actualización**, se
     abre con todo lo tuyo. 🔁

4. En el menú Inicio (y en el escritorio, si dejas marcado el acceso directo)
   tienes **FichaCSIRC**. El asistente de configuración va dentro de la app,
   en *Herramientas*.

   > 🔁 **¿Tenías la versión 3?** No tienes que hacer nada: el instalador la
   > cierra, la retira y deja la 4 en su sitio, con tu API key, tus favoritas,
   > plantillas, permisos, PIN y el aviso diario a la misma hora. Si te dice que
   > FichaCSIRC sigue abierta, ciérrala (botón derecho sobre su icono junto al
   > reloj → *Salir*) y pulsa *Reintentar*.

   > 🧩 Necesita **Microsoft Edge WebView2**, que ya viene con Windows 11 y con
   > Windows 10 actualizado.

   > 🗑️ **Para desinstalar:** *Configuración de Windows → Aplicaciones →
   > FichaCSIRC → Desinstalar*. Tu configuración y tus horas no se tocan.

### 🐧 Linux

1. En Ubuntu o Debian, descarga el **`.deb`** de la página de versiones
   (https://github.com/enriquegrx/UGR-FichaCSIRC/releases/latest).
2. **Doble clic** sobre él → *Instalar* (o en una terminal:
   `sudo apt install ./FichaCSIRC_*.deb`). Instala solo lo que le falte.
3. Ábrela desde el menú de aplicaciones: **FichaCSIRC**.

¿Otra distribución? Usa **FichaCSIRC-linux-x86_64.AppImage**: dale permiso de
ejecución (botón derecho → *Propiedades* → *Permitir ejecutar*) y ábrelo.

Tu configuración se guarda en `~/.config/FichaCSIRC`. Al salir una versión
nueva, la app te avisa y abre la página para descargarla. En Linux no hay
aviso diario de fichaje ni icono junto al reloj.

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

> 🔄 **Actualizar en Mac:** cuando haya versión nueva, la app te avisa y abre
> la página para descargarla. Baja el `.dmg`, arrastra FichaCSIRC a
> Aplicaciones y elige **«Reemplazar»**.
>
> 🍏 En Mac no hay todavía aviso diario de fichaje ni icono en la barra de
> menús.
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
él más adelante: **Herramientas → Configuración (asistente)**.

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

Abre **FichaCSIRC**:

1. Cada día de la semana es una **tarjeta** 🗂️ con una barra de progreso
   (🟢 verde = día completo, 🟠 ámbar = a medias). Haz **clic en el día** que
   quieras rellenar (hoy ya viene marcado).
2. Elige la **tarea**, revisa las **horas** (vienen pre-rellenas con lo que te
   falta) y la **actividad**, y pulsa **Añadir apunte a…** (o Enter). ↵ El
   botón dice a qué días va: «Añadir apunte a lun 26/10», «Añadir apunte a 3
   días».
3. Listo. La tarjeta se pone verde cuando completas tu jornada. 🎉

**Para elegir la tarea** tienes tres caminos:

- 🔎 **El campo Tarea**: al entrar salen tus tareas habituales, las de la
  semana y tus favoritas. Escribe parte del nombre o el número y busca en
  todos tus proyectos. Con **Intro** eliges lo que ves: si solo queda una
  tarea, esa; si quedan varias, se marca la primera (cambia con las flechas) y
  otro Intro la elige.
- 🌳 **«Tus proyectos»**, al final de esa misma lista: pulsa un proyecto y se
  despliegan sus tareas en árbol, cada una debajo de la que cuelga.
- 🗂️ **Buscar tarea…**: lo mismo, en grande. Se abre con tus proyectos; cada
  uno se despliega al pulsarlo, y las tareas con otras debajo se recogen con su
  flecha. El filtro busca en todos a la vez y, si no encuentra nada, ofrece
  mirar también entre las **cerradas**. Con Ctrl o Mayús marcas varias.

El árbol **se queda como lo dejas**: los proyectos que despliegues salen
desplegados la próxima vez, también al volver a abrir la app. Al pasar por una
tarea sale una **☆** al final de su fila para hacerla favorita (★) sin elegirla. Y si
alguien acaba de crear una tarea en ProyectosTIC y aún no la ves, pulsa
**⟳ Actualizar** (o F5 dentro de *Buscar tarea*).

¿Te salen proyectos en los que nunca fichas? Pasa el ratón por el proyecto y
pulsa **No mostrar**, o ve a **Herramientas → Proyectos visibles…** y desmarca
los que sobren. Ahí mismo los vuelves a marcar. Solo dejan de salir al buscar
tareas: en ProyectosTIC no cambia nada y el botón *Tareas* sigue ofreciéndolos.

Cada tarjeta enseña **lo que imputaste ese día**. A la derecha del formulario
tienes **todos los apuntes de la semana** (o del mes) agrupados por día, cada uno
con su ✏️ **editar** y 🗑️ **borrar**; los días marcados van resaltados y pulsar la
cabecera de un día lo marca.

Debajo del formulario hay una caja con dos pestañas (se abre en la que dejaste;
con el teclado, las flechas cambian de una a otra):

- **Habituales**: una barra por tarea con lo que le dedicas. **Clic** en una
  rellena el formulario con su tarea, actividad y horas de siempre; el botón
  **«+»** la añade directamente a los días marcados. ⚡
- **Favoritas**: todas las tareas que has marcado con la ☆, con su número y su
  nombre. **Clic** rellena el formulario con esa tarea; **«+»** la añade a los
  días marcados con las horas que le faltan a cada uno (a los que ya están
  completos no les añade nada); la **★** la quita de favoritas, y abajo sale
  *Deshacer* por si no querías.

Para **ordenar tus favoritas**, pulsa **Gestionar…** (en la pestaña *Favoritas*,
junto a «Favoritas y buscadas» en la lista del campo Tarea, o en **Herramientas
→ Mis favoritas…**). Se abre **Mis favoritas** con todas en una lista: las
subes y las bajas con **↑** y **↓** (o Alt + flecha arriba o abajo), las quitas
con **×** y añades otras con el buscador de abajo. Cada cambio vale al momento.
El orden que les des es el de la pestaña y el del campo Tarea, que enseña las
primeras.

Bajo los días, la **franja de resumen** te dice cómo va el mes (y el anterior si
quedó a medias), lo que te queda de cada permiso y tus vacaciones. Pulsa
cualquiera para ir a su sitio.

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
- 📄 **Copiar día anterior**: repite el último día que fichaste. Lo más rápido:
  **botón derecho sobre el día → «Copiar día anterior»** (la primera opción, en
  negrita): lo copia a ese día sin tener que marcarlo. También desde *Copiar /
  Plantillas*, a todos los días marcados.
- ✎ **Editar un día entero**: botón derecho sobre el día → **Editar día…**.
  Cambias las horas de cada tarea ahí mismo, quitas alguna (papelera) o añades
  otras; el total del día se actualiza mientras escribes. Se guarda todo junto
  al pulsar *Guardar* y *Deshacer* lo devuelve a como estaba.
- 🖱️ En la vista semanal, al pasar el ratón por una tarea de la ficha salen sus
  botones ✏️ editar y 🗑️ borrar.
- ➕ **El «+» de cada día** (sale al pasar el ratón; o pulsa **+** con el día
  seleccionado): **Copiar día anterior**, tus tareas habituales con las horas
  ya puestas y tus **plantillas**. Un clic y añadido a ese día.
- ✅ **Completar con…** (botón derecho sobre un día al que le faltan horas):
  rellena lo que falta con una de tus tareas habituales.
- 🔢 **Doble clic sobre las horas** de una tarea en la ficha para cambiarlas ahí
  mismo (Enter guarda, Esc cancela).
- 🫳 **Arrastra** una tarea a otro día: la copia (con **Mayús** pulsada, la
  mueve). Arrastrar una de tus tareas habituales a un día la añade.
- 📋 **Ctrl+C** sobre un día y **Ctrl+V** en los marcados: copia ese día tal
  cual (también con botón derecho → *Copiar este día* / *Pegar aquí*, que van
  arriba del todo, junto a *Copiar día anterior*).
- 📋 **Varios días de una vez**: marca los días y pulsa **Ctrl+C** (o botón
  derecho sobre uno de los marcados → *Copiar estos N días*). Se copian, por
  orden de fecha, los que tienen apuntes; la barra de abajo te dice cuántos.
  Luego:
  - marca **varios días** y pulsa **Ctrl+V**: el primero copiado va al primero
    marcado, el segundo al segundo… Con más días marcados que copiados, se
    repiten; con menos, se pegan solo los primeros;
  - o marca **un solo día** (o botón derecho sobre él → *Pegar desde aquí*):
    se pegan a partir de ese día en los días laborables siguientes, saltando
    fines de semana, festivos, vacaciones y días no laborables.

  Antes de escribir te pregunta, enseñando qué día va a cuál; un día nunca se
  pega sobre sí mismo y las tareas que ya estén en el día de destino se
  saltan. Un solo **Deshacer** lo quita todo. Lo copiado se conserva al
  cambiar de semana, así que puedes copiar esta semana, pasar a la siguiente
  con **Ctrl+→**, marcar y pegar; en la vista de mes lo haces sin moverte.
- ↩️ Después de borrar, editar, mover o añadir, arriba, en el centro de la
  caja *Días*, sale el botón **↶ Deshacer cambios realizados** (con cuántos
  quedan), y también un aviso abajo; o pulsa **Ctrl+Z**. **Otra vez** deshace
  lo anterior, hasta 20 acciones; si falla la conexión, vuelve a pulsarlo para
  reintentar.
- 🔴 **Si sale «sin conexión»**, una franja roja arriba dice **por qué** y qué
  hacer: fuera de la UGR sin la VPN, la API key caducada (con el botón al
  asistente), ProyectosTIC caído o sin Internet.
- 🩺 **Ayuda → Copiar diagnóstico**: si algo no va, copia ese texto y pégalo
  en un correo a quien te ayude. No lleva tu API key ni tu PIN.
- 📅 **Cierre de mes**: en los últimos días del mes (y los primeros del
  siguiente) te avisa de los días del mes con horas pendientes, con un enlace
  a cada uno.
- 🏷️ **Guardia, teletrabajo y permiso**: la etiqueta **rellena** es que está
  imputado en ProyectosTIC; **con borde y «· local»**, que solo está marcado
  en este equipo.
- 🖥 Lo que lleva **«(local)»** en el botón derecho de un día (festivo,
  vacaciones, apertura de curso, baja, permiso por horas, guardia,
  teletrabajo) se guarda **solo en tu FichaCSIRC**: no va a ProyectosTIC. Si
  tienes una tarea de permisos, bajas, guardias o teletrabajo, la app te
  ofrece imputarlo ahí. Cuál es esa tarea en tu servicio lo eliges en
  *Herramientas → Permisos → ¿Dónde se imputa en ProyectosTIC?* (si no, la
  app la deduce por el nombre).
- 💾 **Copias de seguridad** (*Herramientas*): tu configuración se copia sola
  cuando cambias favoritas, plantillas, permisos o festivos. Desde ahí vuelves
  a una copia anterior, o **exportas** la configuración para llevártela a otro
  equipo (sin API key ni PIN) e **importas** allí. Si alguna vez la
  configuración se queda sin la conexión con ProyectosTIC (todos los días en
  «sin conexión» aunque la web funcione), la app la **recupera sola** de la
  última copia buena al abrirse y te avisa.
- 🪟 **Deja a la vista solo lo que uses**: las cajas de abajo se minimizan
  (**–**) o se cierran (**×**), y el menú **Ver** las vuelve a poner (también
  la franja de resumen y la leyenda de colores).
- 🌙 **Tema oscuro** y 🔍 **tamaño de letra**: menú *Ver* (o Ctrl + / Ctrl − /
  Ctrl 0).
- 📅 **Días propios de la UGR**: *Importar festivos* los propone calculados
  (cierre de Navidad, Semana Santa, San Pascual, Feria); compáralos con el
  calendario laboral del PTGAS y desmarca los que no coincidan.
- 🧰 **Icono junto al reloj** (Windows, *Herramientas → Bandeja del sistema*):
  cerrar la ventana la esconde junto al reloj, y puede arrancar con Windows ya
  escondida. El icono dice cuántos días tienes por completar y su menú trae
  **«Completar hoy con…»** tu tarea habitual, sin abrir la ventana.
- 🧩 **Plantillas**: guarda tu «día típico» y aplícalo con un clic. La forma
  más rápida de crear una: **botón derecho sobre el día** → *Guardar este día
  como plantilla*.
- 🗑️ **Eliminar apuntes de un día**: botón derecho sobre el día → *Eliminar
  apuntes de este día*. Te los lista y eliges uno, varios o todos (se puede
  deshacer).
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
  aplicación. Tras actualizar, sale sola la primera vez.
- 🔒 **PIN de acceso** (*Herramientas*, o en el asistente al instalar): si
  compartes el equipo, FichaCSIRC pide un PIN de 4 a 8 cifras al abrirse y,
  si la dejas abierta, tras 15 minutos sin usarla (configurable). Si lo
  olvidas, *He olvidado el PIN* borra la configuración de ese equipo y vuelves a
  configurar con el asistente (tus horas en ProyectosTIC no se pierden;
  reinstalar no sirve, la configuración no está en la carpeta del programa).
- 📊 **Estadísticas** (botón 📊 de la barra): semanal, mensual o anual, con tus
  tareas más realizadas y la jornada cumplida. El bloque **«Cómo va»** dice
  cuántas horas llevas, tu objetivo y qué días te faltan, cada uno con su
  enlace. *Informe del periodo* lo deja en una página para imprimir o guardar
  como PDF.
- 🧩 **Por completar** (botón 🧩, con el número de días): los días del año a los
  que les faltan horas, en fichas por mes. Marca uno, varios o todos y
  **rellénalos de una vez**: completar con una tarea, repartir entre varias,
  aplicar una plantilla o copiar un día. Antes te enseña un resumen y todo se
  deshace junto. En **«Te pasas»** salen los días con horas de más y los
  apuntes repetidos.
- 🗓️ **Plantillas de semana**: guarda de lunes a viernes, cada día con sus
  apuntes, y aplícala entera.
- 🔍 **Buscar en mis apuntes** (Ctrl+F): en qué días fichaste una tarea o un
  comentario a lo largo del año.
- 📤 **Exportar CSV** (*Archivo*): tus horas en un archivo que abre Excel.
- ⏰ **Aviso diario de fichaje** (Windows): la **campana 🔔 de la barra** lo
  activa, cambia la hora o lo quita. Se propone a las **14:00** y solo salta
  si te faltan horas. **Desde el propio aviso puedes fichar**: cada día con
  huecos trae tu tarea habitual y las horas que faltan; un clic y listo, o
  **«Fichar todo»** si son varios días. *Probar el aviso ahora* te lo enseña
  aunque hoy no te falte nada.
- 🚪 **Salir y Bloquear**, arriba a la derecha: *Salir* (Ctrl+Q) cierra el
  programa del todo; *Bloquear* (Ctrl+L) tapa la ventana hasta que escribas
  tu PIN.
- 📣 Al abrir, si la **semana pasada** quedó con huecos, un aviso te dice qué días
  y te lleva allí.

### 🛠️ Crear, modificar y duplicar tareas (solo con permiso)

Si en ProyectosTIC tienes permiso para **crear tareas** en algún proyecto, la
cabecera dice **Nivel dios** y en la barra de arriba, junto a *Por completar*,
aparece el botón **🗂️ Tareas**.
Si no lo tienes, dice **Nivel loser** y no verás nada de este apartado: el
permiso lo da quien administra cada proyecto. Al pasar el ratón por el nivel
verás en qué proyectos puedes crear tareas: basta con uno. Modificar es un
permiso aparte: si puedes cambiar tareas pero no crearlas, tendrás el botón
**Tareas** solo con *Modificar una tarea*, aunque el nivel sea loser.

Una **tarea** es lo que existe en ProyectosTIC; un **apunte**, las horas que
fichas en ella un día. Por eso este botón va aparte del panel *Añadir apunte*.

- ➕ **Crear una tarea**: **Tareas → Nueva tarea…** (o Ctrl+N). Escribe el título, elige el
  proyecto y el tipo y, si quieres, la tarea de la que cuelga, el tiempo
  estimado y la descripción. Abajo ves cómo va a quedar. Al crearla, queda en
  el formulario para fichar en ella.
- 👤 **Asignada a**: de entrada, a ti. Puedes dejarla sin asignar («Nadie») o
  dársela a otra persona del proyecto: salen los miembros de ese proyecto a
  los que ProyectosTIC deja asignar tareas (personas, no grupos). Al cambiar
  de proyecto cambia la lista. ProyectosTIC avisa a esa persona como si la
  hubieras creado en la web.
- 🌳 **De cuál cuelga**: al pulsar en ese campo sale el árbol de tareas
  abiertas del proyecto. Si lo dejas vacío, la tarea cuelga del proyecto.
- 🔎 **Desde Buscar tarea**: si la que buscas no existe, **＋ Nueva tarea…**
  (abajo a la izquierda) la crea con lo que hayas escrito en el filtro.
- 🧩 **Plantillas de tarea**: con el diálogo relleno, **Guardar como
  plantilla…**. La próxima vez, un clic en su nombre lo rellena todo. Pon un
  asterisco en el título donde vaya lo que cambia cada vez (el número de
  ticket, por ejemplo): al elegir la plantilla queda marcado para escribir
  encima. La plantilla guarda si la tarea es para ti, no para qué otra
  persona: eso se elige cada vez.
- ✏️ **Modificar una tarea**: **Tareas → Modificar una tarea…**. Parte de la
  tarea que tengas puesta en *Añadir apunte*, o eliges otra arriba. Cambia el
  título, de cuál cuelga, el tiempo estimado, a quién está asignada o la
  descripción. Abajo sale lo que va a cambiar antes de guardar.
- 📑 **Duplicar una tarea con las que cuelgan de ella**: **Tareas → Duplicar
  una tarea…**. Elige el proyecto de destino, el nombre de la copia
  y, si quieres, un texto que cambiar en todos los títulos (2026 por 2027).
  Se copian el título, el tipo, la descripción, la prioridad y el tiempo
  estimado; **no** las horas, a quién está asignada, las fechas, los adjuntos
  ni las relaciones. Si una tarea falla, se para ahí y puedes seguir.
- ⚠️ Crear y duplicar **no se deshacen desde FichaCSIRC**: si te equivocas, la
  tarea se borra o se corrige en la web de ProyectosTIC.

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
  las horas que imputes con esa actividad también te descuentan del saldo, y un
  día entero imputado así sale como **«Permiso ✔»** en el calendario (en vez de
  «7h · +0,5h», porque el permiso cuenta la jornada oficial). 🔗
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
- El resumen del mes (**«Cómo va»**, en *Estadísticas*) cuenta esos días como *teletrabajo* y suma sus horas de
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
| Al instalar dice que «FichaCSIRC sigue abierta» | Ciérrala: botón derecho sobre su icono junto al reloj → *Salir*. Si no tiene icono ni ventana, en el Administrador de tareas (Ctrl+Mayús+Esc) → *FichaCSIRC* → *Finalizar tarea*. Después, *Reintentar*. |
| «FichaCSIRC no ha podido abrir su ventana» | Pasa si la abre un instalador lanzado desde las descargas del navegador. Cierra el aviso y ábrela desde el escritorio o el menú Inicio. |
| Varios iconos de FichaCSIRC en Launchpad (Mac) | Son copias viejas: deja solo la de Aplicaciones y manda el resto a la Papelera (suelen estar en Descargas). Si siguen saliendo, `killall Dock` en Terminal. |
| El aviso diario de fichaje no salta | Abre FichaCSIRC una vez: si el aviso apuntaba a una instalación vieja, la app lo reprograma sola a la misma hora. |
| He olvidado el PIN | En la pantalla del PIN, *He olvidado el PIN*: se borra la configuración de este equipo y empiezas de nuevo con el asistente (necesitarás tu API key, sección 2). Tus horas no se tocan. |
| El indicador **● INARI** está en rojo | Revisa tu token en *Herramientas → Integraciones (INARI)…* y prueba la conexión (solo aplica a SisGes). |
| Cualquier otra cosa rara 🐛 | *Ayuda → Copiar diagnóstico* copia un texto con el estado de la aplicación (sin tu API key ni tu PIN): pégalo en un correo a quien te ayude. |

---

*¿Dudas o sugerencias? Contacta con quien te pasó la aplicación.* 🙂
