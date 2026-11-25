# Novedades de FichaCSIRC

Lo que ha ido cambiando en cada versión, contado en corto. La versión que tienes
instalada aparece en el pie de la ventana.

---

## 4.0.0

**Nuevo motor: Rust y Tauri**
- FichaCSIRC está **reescrita por dentro** en Rust. La ventana es la misma y
  **no tienes que hacer nada**: tu API key, favoritas, plantillas, permisos,
  PIN y preferencias siguen como estaban.
- El instalador ocupa unos **3 MB** y la aplicación **ya no lleva Python
  dentro**: adiós a los problemas de archivos bloqueados por Windows al
  instalar o actualizar.
- Los cálculos son los mismos: se han comparado con los de la versión 3, día a
  día, con apuntes reales. Lo cuenta *Ayuda → Tecnología utilizada*.

**Nuevo diseño**
- **Semana**: cada día enseña sus horas con una barra por tarea, cada tarea de
  su color.
- **Mes**: un calendario donde se ve de un vistazo cómo va cada día. Los
  completos van rellenos; los que tienen horas por fichar, con una franja y la
  cifra en ámbar.
- La **barra de arriba** se adapta a ventanas estrechas: los botones se quedan
  en su icono en vez de partirse en dos líneas.
- **Exportar a CSV** pasa al menú *Archivo*.
- Botón **Salir** a la vista, arriba a la derecha (también *Archivo → Salir*
  y Ctrl+Q): cierra el programa del todo. Con el icono junto al reloj, la X
  solo esconde la ventana.
- Botón **Bloquear** al lado del de Salir (también *Archivo → Bloquear con el
  PIN* y Ctrl+L): tapa la ventana hasta que escribas el PIN. Si no tienes PIN,
  te lleva a activarlo.
- **PIN de acceso**: el tiempo de bloqueo va en su propio apartado y se cambia
  sin tener que cambiar el PIN.
- **Comentario**: al entrar en el campo salen los últimos que usaste con esa
  tarea, para elegirlos sin volver a escribirlos.
- En *Añadir apunte*, cada botón dice de qué habla: **«Buscar tarea…»** y
  **«Añadir apunte a…»** el día marcado.
- **Buscar tarea**, siempre en árbol: se abre con **tus proyectos**, cada uno
  se despliega al pulsarlo y enseña sus tareas, cada una debajo de la que
  cuelga. Las tareas con otras debajo se recogen con su flecha. Al escribir en
  el filtro busca en todos tus proyectos a la vez, sin tildes, y al borrarlo
  vuelves al árbol. Si no encuentra nada, ofrece buscar también entre las
  tareas cerradas.
- El campo **Tarea** (en *Añadir apunte* y en *Editar día*) enseña, debajo de
  tus habituales y favoritas, **«Tus proyectos»**: pulsas uno y eliges la tarea
  en su árbol, sin abrir nada más.
- **Proyectos visibles** (*Herramientas*): si te salen proyectos en los que no
  fichas, quítalos de en medio. También desde el propio árbol, con **«No
  mostrar»** al pasar por el proyecto. Solo dejan de salir al buscar tareas:
  en ProyectosTIC no cambia nada.
- **Botón derecho sobre un día**: *Copiar día anterior*, *Copiar este día* y
  *Pegar aquí* van juntos, arriba del todo.

**Estadísticas**
- Botón **📊 Estadísticas**, dentro de la propia ventana: **Semanal, Mensual o
  Anual**, con tus tareas más realizadas, la jornada cumplida y el año mes a
  mes.
- El bloque **«Cómo va»** sustituye al *Resumen del mes*: estado, objetivos y
  los días que te quedan por completar, cada uno con su enlace.
- **Informe del periodo** en una página para imprimir o guardar como PDF.

**Por completar**
- Botón **🧩 Por completar** con el número de días del año sin completar (hasta
  ayer), en fichas por mes: la que eliges filtra la lista.
- Marca uno, varios o todos y **rellénalos de una vez**: completar lo que falta
  con una tarea, repartirlo entre varias, aplicar una plantilla o copiar un
  día. Antes de hacerlo te enseña un resumen, y todo se deshace de una vez.
- Desde la misma lista se marca un día como **vacaciones, festivo, baja o
  permiso**.
- **«Te pasas»**: los días con horas de más y los apuntes repetidos, con el
  botón para quitar ahí mismo el que sobra.
- Los avisos de la semana y de cierre de mes traen **«Completar ahora»**.
- **Plantillas de semana**: guarda de lunes a viernes, cada día con sus
  apuntes, y aplícala entera.
- **Buscar en mis apuntes** del año (Ctrl+F).

**Aviso diario de fichaje**
- **Campana en la barra** con la hora del aviso («🔔 14:00»). Un clic para
  activarlo, cambiar la hora o quitarlo; la hora se queda hasta que la cambies.
- Se propone a las **14:00** (antes, a las 16:00). Si ya lo tenías activado,
  conservas tu hora.
- La **ventanita del aviso**, rediseñada: el total que te falta en el título,
  hoy el primero, **«Fichar todo»** cuando son varios días y la campana para
  cambiar la hora o desactivarlo desde ahí.
- **«Probar el aviso ahora»**, en la ventana de la campana: enseña la
  ventanita aunque hoy no te falte nada (el aviso de verdad solo sale si
  faltan horas). Desde la prueba no se ficha.

**Crear, modificar y duplicar tareas de ProyectosTIC**
- Solo si ProyectosTIC te da permiso para crear tareas en algún proyecto. Si
  no lo tienes, no aparece nada de esto y la ventana sigue como siempre.
- Botón **«Tareas»**, en la barra de arriba junto a *Por completar*: desde
  ahí se crean, se modifican y se duplican. Va aparte de *Añadir apunte*
  porque una tarea no es un apunte: la tarea es lo que hay en ProyectosTIC y
  el apunte, las horas que fichas en ella.
- **Nueva tarea** (también Ctrl+N y *Archivo*): crea una tarea sin salir de
  FichaCSIRC, con su título, proyecto, tipo, descripción y tiempo estimado.
  Antes de crearla ves cómo va a quedar y, al crearla, queda en el formulario
  lista para fichar.
- **De cuál cuelga**: eliges la tarea madre en el árbol de tareas abiertas del
  proyecto. Si no eliges ninguna, cuelga directamente del proyecto.
- Desde **Buscar tarea**: si la que buscas no existe, **＋ Nueva tarea…** la
  crea con lo que hayas escrito en el filtro.
- **Plantillas de tarea**: guarda lo que repites (proyecto, tipo, de cuál
  cuelga, tiempo estimado, descripción) y rellena la tarea con un clic. Un
  asterisco en el título marca lo que cambia cada vez, como el número de
  ticket: queda seleccionado para escribir encima.
- **Modificar una tarea** (botón «Tareas», o *Archivo*): título, de
  cuál cuelga, tiempo estimado y descripción. Sirve para ponerle la tarea madre
  que se te olvidó. Solo se cambia lo que tocas y lo ves antes de guardar.
- **Duplicar una tarea con todas las que cuelgan de ella**, en el mismo
  proyecto o en otro: con otro nombre, cambiando un texto en todos los títulos
  (2026 por 2027) y sin horas imputadas. Ves el árbol antes de crear nada; si
  una tarea falla, se para ahí y puedes seguir desde esa.
- Si ProyectosTIC pide un dato que FichaCSIRC no rellena (un campo propio
  obligatorio), te lo dice antes y te lleva a la web.
- En la cabecera, en broma: **Nivel dios** si puedes crear tareas y **Nivel
  loser** si no. Al pasar el ratón explica cada nivel y dice en qué proyectos
  puedes crearlas.
- Si ProyectosTIC te deja modificar tareas pero no crearlas, el botón
  «Tareas» aparece igualmente, solo con *Modificar una tarea*.
- «Nueva tarea» se abre en el último proyecto en el que creaste una; la primera
  vez, en el de la tarea que tengas puesta en *Añadir apunte*.

**Icono junto al reloj**
- **«Completar hoy con…»** tu tarea habitual, desde el menú del icono y sin
  abrir la ventana. El icono dice también cuántos días tienes por completar.
- **Una sola FichaCSIRC abierta**: si estaba escondida junto al reloj, el
  acceso del escritorio la muestra en vez de abrir otra que no se veía.

---

## 3.2.2

**Correcciones**
- En la 3.2.0, al guardar dos cosas a la vez, la configuración podía quedarse
  **sin la conexión con ProyectosTIC** (y sin favoritas, plantillas…): al
  abrir, todos los días decían «sin conexión». Ahora, si pasa, **se recupera
  sola** de la última copia de seguridad buena y te lo dice; lo que cambiaste
  después (los días marcados) se conserva.
- Si la configuración no se puede leer en ese momento, la app **ya no escribe
  encima**: avisa y no guarda, en vez de empezar de cero.
- **Restaurar una copia** también devuelve la conexión (y el PIN que tenía)
  cuando la configuración actual se ha quedado sin ella.
- La última copia de seguridad buena **ya no se borra** aunque después se hagan
  muchas copias.

**Mejoras**
- **Guardia y teletrabajo** también dicen **(local)** en el menú del día y,
  como festivos, vacaciones o bajas, avisan antes de marcar que solo se guarda
  en tu FichaCSIRC. Si tienes en ProyectosTIC una tarea de guardias o de
  teletrabajo, te ofrecen imputar ahí.
- **Elige tú la tarea** de cada cosa (permisos, bajas, vacaciones, guardias,
  teletrabajo) en *Herramientas → Permisos → ¿Dónde se imputa en
  ProyectosTIC?*: cada servicio la llama distinto y la app ya no tiene que
  adivinarla. «Ninguna» deja de ofrecerla.
- El **+** de cada día trae ahora **Copiar día anterior**, **Pegar** (si has
  copiado un día) y tus **plantillas**, para aplicarlas a ese día con un clic.
- **«Sin conexión» ahora dice por qué**: una franja arriba distingue si estás
  fuera de la UGR sin la VPN, si la API key ha caducado (con el botón para
  poner una nueva), si ProyectosTIC está caído o si no hay Internet.
- **Ayuda → Copiar diagnóstico**: un texto para pegar en un correo cuando algo
  no va (versión, configuración resumida, qué responde ProyectosTIC y el
  registro). Nunca lleva la API key ni el PIN.
- **Cierre de mes**: los últimos días del mes, un aviso con los días que te
  quedan por completar, cada uno con su enlace.
- **Etiquetas de guardia, teletrabajo y permiso**: rellenas si está imputado en
  ProyectosTIC; con borde y «· local» si solo está marcado en tu equipo.
- En *Permisos*, **«Se imputa como actividad»** es ahora un desplegable con
  todas tus actividades de verdad (p. ej. «Asuntos propios»). Antes solo
  enseñaba «— solo se marca en el día —» y no dejaba buscar.
- **Deshacer** sale del pie y pasa arriba, en el centro de la caja *Días*:
  «↶ Deshacer cambios realizados», con cuántos cambios puedes deshacer.

---

## 3.2.1

**Correcciones**
- Al marcar un día (festivo, vacaciones…) con «No volver a preguntarme», salía
  «Algo ha fallado… config.json.tmp». Era la app guardando dos cosas a la vez;
  ahora se guardan por turnos y ningún cambio se pierde.
- En el aviso de «solo en este equipo» de un festivo aparecía un «null» suelto.

**Mejoras**
- **Buscar en todo** ya no pide tres letras: con el filtro **vacío** lista
  todas tus tareas abiertas de todos los proyectos, y con una o dos letras
  también busca. El campo **Tarea** busca en todo ProyectosTIC desde la
  primera letra.

---

## 3.2.0

**FichaCSIRC para Linux (Ubuntu)**
- Nuevo **.deb** para Ubuntu y Debian (doble clic y se instala con lo que
  necesita) y **AppImage** (un solo archivo, sin instalar).
- Todo funciona igual que en Windows y Mac, incluido el aviso diario de
  fichaje. La bandeja del sistema, de momento, solo en Windows.
- Las actualizaciones avisan como siempre y abren la página de descarga.

**Copias de seguridad**
- FichaCSIRC guarda sola una **copia de tu configuración** cada vez que cambian
  tus favoritas, plantillas, permisos, vacaciones o festivos: las 10 últimas y
  una por día de la última semana.
- *Herramientas → Copias de seguridad…* para **volver a una copia anterior**.
  Tu API key, el token de INARI y el PIN no cambian, y antes se guarda una
  copia de cómo estás, así que también se puede volver atrás.
- **Exportar e importar** la configuración para llevártela a otro equipo (el
  archivo no incluye la API key, el token ni el PIN).
- «He olvidado el PIN» ya no te hace perder las favoritas y plantillas: las
  copias se conservan y puedes restaurarlas (sin el PIN antiguo).

**Lo que solo queda en tu equipo, avisado**
- En el botón derecho de un día, **festivo, vacaciones, apertura de curso,
  baja y permiso por horas** llevan **«(local)»**: se guardan solo en tu
  FichaCSIRC y no se envían a ProyectosTIC.
- Al marcarlos, la app te lo recuerda y, si tienes en ProyectosTIC una **tarea
  de permisos o bajas**, te ofrece **imputarlo ahí** con un clic (abre *Editar
  día* con esa tarea y las horas puestas). Con «No volver a preguntarme» deja
  de avisar; en *Herramientas* puedes volver a activarlo.
- El **asistente de configuración** marca cada paso como **«Solo en este
  equipo»** y dice en qué carpeta se guarda: nada de lo que configuras ahí
  (jornada, favoritas, PIN, API key) cambia ProyectosTIC.
- **Completar con…** dice la actividad de cada tarea (ya no salen dos
  «Mantenimientos» que parecían la misma) y **Añadir otra tarea…** vuelve a
  funcionar (el menú se cerraba solo).

**Deshacer en varios niveles**
- **Ctrl+Z** (o *Deshacer*) deshace lo último; **otra vez**, lo anterior, hasta
  20 acciones: borrar, cambiar horas, editar un día, añadir, mover o copiar.
- Te dice qué ha deshecho y qué viene después («Deshecho: borrar 2 apuntes del
  martes 10/11. Ctrl+Z otra vez: cambiar…»).
- Si algo no se puede deshacer porque falla la conexión, **no se pierde**:
  vuelve a pulsar Ctrl+Z para reintentarlo.

---

## 3.1.4

**Buscar tareas, por fin cómodo**
- El campo **Tarea** (en *Añadir apunte* y en *Editar día*) es ahora un
  **buscador**: mientras escribes salen al momento tus tareas habituales, las
  que usaste esa semana y tus favoritas; con tres letras o un número busca
  además en **todo ProyectosTIC**.
- Se puede buscar por el **número de la tarea** (12345 o #12345).
- Cada resultado dice su **proyecto y su tarea padre**: se distinguen las
  distintas «Mantenimientos» que cuelgan de padres diferentes.
- La **☆** de cada resultado la marca o la **quita** de favoritas.

**Correcciones**
- En **Editar día → + Añadir tarea**, la lista de tareas salía **vacía** si no
  tenías tareas favoritas. Con el buscador nuevo ya no pasa.

---

*Las novedades de las versiones anteriores a la 3.1.4 están en la página de versiones: https://github.com/enriquegrx/UGR-FichaCSIRC/releases*

*¿Algo no va o se te ocurre una mejora? Escribe a quique@ugr.es*
