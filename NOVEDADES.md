# Novedades de FichaCSIRC

Lo que ha ido cambiando en cada versión, contado en corto. La versión que tienes
instalada aparece en el pie de la ventana.

---

## 3.1.0

**Editar un día entero**
- **Botón derecho sobre un día → «Editar día…»**: salen todas las tareas de ese
  día y cambias sus **horas** (y su actividad) ahí mismo, **quitas** alguna con la
  papelera o **añades** otras con «+ Añadir tarea». Arriba ves el total del día
  mientras escribes («6,5h de 7h»). Nada se envía hasta que pulsas **Guardar**, y
  **Deshacer** (Ctrl+Z) lo deja todo como estaba.
- En la vista semanal, al pasar el ratón por una tarea de la ficha salen sus
  botones ✏️ **editar** y 🗑️ **borrar**.

**Añadir, cambiar y borrar sin salir de las fichas**
- **Botón «+» en cada día** (al pasar el ratón, o la tecla **+**): tus tareas
  habituales con las horas ya puestas (lo que te falta, si es menos). Un clic y
  añadida, sin marcar el día ni rellenar el formulario.
- **Botón derecho → «Completar con…»**: rellena lo que le falta al día con una
  de tus tareas habituales. Un clic y el día en verde.
- **Doble clic sobre las horas** de una tarea en la ficha: las cambias ahí
  mismo (Enter guarda, Esc cancela).
- **Arrastra** una tarea a otro día para copiarla (con **Mayús**, para
  moverla), o arrastra una de tus tareas habituales a un día para añadirla.
- **Ctrl+C sobre un día y Ctrl+V** en los días marcados (o botón derecho →
  *Copiar este día* / *Pegar aquí*).
- Tras borrar, editar, mover o añadir sale abajo un aviso con **Deshacer**.
  Ctrl+Z ya deshace también lo añadido, copiado o editado, no solo lo borrado.
- «+N más» en una ficha de la semana despliega el resto de tareas del día.
- En el botón derecho, **«Eliminar apuntes de este día»** pasa a ser la
  tercera opción, destacada.

**PIN de acceso**
- Si compartes el equipo, FichaCSIRC puede **pedir un PIN al abrirse**
  (también el asistente de configuración). Se activa en *Herramientas → PIN de
  acceso…* o en el propio asistente al instalar.
- Si lo olvidas, «He olvidado el PIN» borra la configuración de ese equipo y
  vuelves a empezar con el asistente. **Tus horas en ProyectosTIC no se tocan.**

**Mejoras**
- Después de actualizar, la primera vez que abres FichaCSIRC te enseña **qué hay
  de nuevo** en esa versión. Siempre lo tienes en *Ayuda → Novedades*.

**Correcciones**
- Un día con **parte de permiso imputado como actividad** (p. ej. 2 h de asuntos
  propios + 5 h de trabajo) salía como «7h / 6,5h · +0,5h». El permiso cuenta en
  jornada oficial, así que ese día está **completo** (5 + 2 = 7 h).

---

## 3.0.0

**Nueva ventana**
- FichaCSIRC **estrena aspecto**. Todo sigue en su sitio (la semana arriba, el
  formulario de añadir y la lista de apuntes, y los mismos menús), pero más
  claro, más rápido y con los botones de cada ventana **siempre a la vista**.
- **El configurador va dentro de la app**: *Herramientas → Configuración
  (asistente)*. En Windows sigue estando el acceso *FichaCSIRC - Configurar* del
  menú Inicio. La primera vez se abre solo.
- **En Mac hay una sola aplicación**: puedes mandar a la Papelera la
  *FichaCSIRC-Configurar* antigua que tengas en Aplicaciones.
- **Vista mensual**: el botón **Semana | Mes** cambia las tarjetas de la semana
  por el **calendario del mes** (de lunes a viernes). Cada día dice qué día es
  («Mié 14»), lo que llevas y **en qué lo imputaste**, y arriba ves si vas **al
  día** o cuántas horas te faltan. Se ven de un vistazo los huecos.
  Puedes marcar días de **varias semanas** y añadir, copiar o aplicar una
  plantilla a todos de una vez. La app recuerda la vista que usaste.
- Pasarte de la jornada ya **no sale en rojo**, como si fuera un error: sale en
  **azul** y con cuánto («7h · +0,5h»). El rojo queda para cuando no se pudo leer.
- **Botón derecho sobre un día → «Copiar día anterior»**, la primera opción y
  destacada: copia a ESE día lo del último día con horas, sin tener que marcarlo.
- **Mayús+clic** marca un **rango de días** (unas vacaciones de dos semanas, de
  un clic), en la semana y en el mes.
- **Las tarjetas de la semana enseñan sus apuntes** (tarea y actividad): ves la
  semana entera sin ir marcando día a día.
- **Panel de apuntes con toda la semana** (o el mes), agrupada por días: editas o
  borras cualquier apunte sin marcar antes su día; los marcados van resaltados.
- **Tus tareas habituales**, bajo el formulario: una barra por tarea con la parte
  de tu tiempo que le dedicas y sus horas de cada día. Clic en una tarea rellena
  el formulario; su botón **«+ 6,5h»** la añade directamente a los días marcados.
- **Franja de resumen** bajo los días: cómo va el mes (y el anterior, si quedó a
  medias), lo que te queda de cada permiso y tus vacaciones. Cada dato te lleva
  a su sitio con un clic.
- Si en tu servicio los asuntos propios se imputan como actividad y la tienes
  enlazada (*Herramientas → Permisos*), **un día entero de permiso sale como
  «Permiso ✔»**, no como «7h · +0,5h».
- **Más compacta**: el formulario y los apuntes van **uno al lado del otro**, y
  cada apunte tiene sus botones de **editar** y **borrar**. El botón de añadir
  dice a qué días lo hace («Añadir a lun 26/10», «Añadir a 3 días»).
- En **portátiles y pantallas pequeñas** la ventana se compacta sola (cabecera
  más baja, sin la leyenda de colores) para que quepa todo sin desplazar.

**Mejoras**
- El **resumen del mes** y **exportar a CSV** van mucho más rápido: consultan
  todo el periodo de una vez en lugar de día a día.
- El **asistente explica cuánto fichas** y cuánto vale un día de permiso si
  descuentas el desayuno (jornada 7 h − 0,5 h = fichas 6,5 h; un día de permiso
  cuenta 7 h).
- El **botón derecho** funciona igual en Windows y en Mac.
- Tu **API key** y el token de INARI **ya no se muestran** en pantalla: si dejas
  el campo vacío, se conserva el guardado.

**Requisitos**
- En Windows necesita **Microsoft Edge WebView2**, que ya viene con Windows 11 y
  con Windows 10 actualizado. Si faltara, el instalador te lo dice.

## 2.9.2

**Mejoras**
- **Permisos: lo que no usas ya no se pierde en enero.** El saldo es continuo:
  a partir del 1 de enero la app te ofrece **añadir los permisos del año nuevo**
  (con las horas del año anterior ya puestas) y se **suman a lo que te quede**.
  Es opcional y lo tienes también en *Herramientas → Permisos (horas)*.
- **Permisos que se imputan como actividad.** Si en tu servicio los asuntos
  propios se imputan en ProyectosTic con una actividad dentro de una tarea,
  indícalo en *Herramientas → Permisos (horas)* («Se imputa como actividad») y
  esas horas también te descontarán del saldo.
- **Mac: ahora se instala con un `.dmg`.** Lo abres y arrastras las apps a
  Aplicaciones. Las actualizaciones se descargan solas y sustituyen a la versión
  anterior, en vez de dejar otra copia (y otro icono en Launchpad).

**Correcciones**
- **En Mac no se abría ningún menú con el botón derecho** (festivos, permisos,
  guardia, plantillas…). Ya funciona, también con **Ctrl+clic**.
- Si la conexión fallaba en el momento justo, la app podía mostrar en tu día
  **apuntes de otras personas** del proyecto. Ya no: si no puede saber quién
  eres, no consulta.
- Si no se podía consultar la lista de actividades, el apunte se guardaba con
  **otra actividad** sin avisar. Ahora te avisa del error y no guarda nada.
- **Copiar día, copiar semana y plantillas** ya no escriben en un día que no se
  ha podido leer (podían duplicar apuntes): ese día se salta y se avisa.
- El **aviso diario de fichaje** dejaba de saltar si se activó con una versión
  antigua. Ahora la app lo detecta al abrirse y lo reprograma sola.
- El **CSV exportado** pone los decimales con coma (6,5) para que Excel los sume.
- En Mac, *Abrir el archivo* tras exportar no hacía nada, y *Ayuda → Novedades*
  salía en blanco.
- Pequeños: las tarjetas decían «7.0h» en vez de «7h», y al borrar un slot de
  INARI el mensaje decía «0 apuntes eliminados».
- La configuración se guarda de forma segura: un corte de luz a mitad ya no
  puede dejarla estropeada.

## 2.9.1

**Correcciones**
- Vuelve a generarse la versión para **Mac con procesador Intel**, que llevaba
  varias versiones sin publicarse.

## 2.9.0

**Mejoras**
- **Botón derecho sobre un día → Apuntes del día**, con dos acciones nuevas:
  - *Guardar este día como plantilla*: crea la plantilla directamente desde el
    día, sin tener que marcarlo ni buscar el botón.
  - *Eliminar apuntes de este día*: te lista lo que tiene ese día y eliges **uno,
    varios o todos** con casillas. Se puede deshacer, como siempre.
- La ventana de **Plantillas**, cuando no tienes ninguna, ahora **explica cómo
  crear la primera** en vez de mostrar un recuadro vacío, y deja *Aplicar* y
  *Eliminar* desactivados hasta que haya algo que aplicar o borrar.

## 2.8.1

**Correcciones**
- Al pulsar *Ayuda → Comprobar actualizaciones*, si no se puede consultar (sin
  red, o porque se ha alcanzado el **límite de consultas de GitHub**) la app te
  lo dice. Antes se quedaba callada y respondía «ya tienes la última versión»
  aunque hubiera una más nueva publicada.

## 2.8.0

**Mejoras**
- **Asociar una actividad con su tarea.** Pulsa **botón derecho sobre Actividad**
  y elige *Asociar*. A partir de ahí, al seleccionar esa actividad la tarea
  cambia sola a la que le corresponde (te avisa abajo). Útil para los permisos:
  asocia «Asuntos propios» con la tarea de *Permisos* y no volverá a irse a la
  tarea equivocada.
- **El desayuno ya no descuadra los permisos.** En el asistente puedes indicar tu
  jornada oficial (por ejemplo 7 h) y marcar *Descontar desayuno* (0,5 h): fichas
  6,5 h al día, pero **un día completo de permiso cuenta como 7 h**, que es como
  lo descuenta el portal de personal. Antes se consumía media hora de menos por
  cada día de permiso.

## 2.7.6

**Correcciones**
- Ya puedes imputar **dos veces la misma tarea el mismo día** (por ejemplo 6 h de
  trabajo y 1 h de asuntos propios). Antes el segundo apunte se descartaba sin
  avisar y simplemente no aparecía. Ahora la app te pregunta si quieres añadirlo.

**Mejoras**
- En **Ayuda → Acerca de** aparecen los datos de contacto del desarrollador.

## 2.7.5

**Mejoras**
- Pulsando **botón derecho sobre el desplegable de Actividad** puedes fijar la
  actividad que quieras para esa tarea. Así no tienes que acordarte cada vez.
- Nueva ventana **Ayuda → Novedades**: esto que estás leyendo, sin salir de la
  aplicación ni necesitar internet.

## 2.7.4

**Mejoras**
- Al cambiar de tarea, el desplegable de **Actividad** se actualiza con las que
  admite esa tarea, y la app **recuerda la que sueles usar con cada una**.

## 2.7.3

**Correcciones**
- En las ventanas de *Vacaciones y teletrabajo* e *Integraciones*, los botones
  **Guardar** y **Cancelar** podían quedarse fuera si encogías la ventana.

## 2.7.2

**Correcciones**
- El pie de la ventana (los indicadores de conexión y la versión) ya **se ve
  siempre**, aunque no la tengas maximizada.
- La aplicación **se abre maximizada**.

## 2.7.1

**Correcciones**
- En el asistente de configuración, los botones **Atrás** y **Finalizar** ya se
  ven sin tener que maximizar la ventana.

## 2.7.0

**Mejoras**
- **Permisos por horas**. Los permisos se miden en horas, no en días enteros:
  asuntos particulares, conciliación o compensación por servicios mínimos. Botón
  derecho sobre un día → *Añadir permiso por horas*. Ese día la app te pedirá
  solo las horas que te queden de jornada.
- Si coges el día entero, el botón **Día completo** rellena tu jornada.
- Nueva ventana **Herramientas → Permisos (horas)** con tus saldos: total, horas
  usadas y disponibles. Las horas se van **concediendo en bolsas**, cada una con
  su fecha límite, y se añaden con *Añadir concesión*. La app avisa cuando alguna
  está a punto de caducar.

## 2.6.x

**Mejoras**
- **Teletrabajo en INARI** (solo SisGes, y hay que activarlo): en los días de
  teletrabajo puedes registrar las horas en INARI en vez de en ProyectosTIC. Al
  registrar cada franja eliges su columna, carril y categoría.
- En el pie verás **dos indicadores de conexión**: ProyectosTIC e INARI.

**Correcciones**
- Arreglada la actualización, que en algunos equipos daba un error al terminar de
  instalar.

## 2.4.x

**Mejoras**
- **Días especiales**: marca un día como festivo, vacaciones o baja; como día de
  **guardia** (te rellena solo el comentario) o de **teletrabajo**.
- **Importar festivos** del año (nacionales, de Andalucía y de Granada) de una vez.
- Contador de **vacaciones** y de días de teletrabajo.
- Cada día lleva su color y su etiqueta, con la leyenda debajo de la semana.

## 2.3.x

**Mejoras**
- **Resumen del mes**: horas registradas, objetivo y días incompletos; con doble
  clic vas a esa semana.
- **Buscar en todo**: encuentra una tarea en cualquier proyecto.
- **Copiar** el día anterior o la semana anterior entera, y **plantillas** para tu
  día típico.
- **Aviso diario de fichaje** (Windows y macOS), a la hora que elijas.
- Atajos de teclado: Ctrl + flechas para cambiar de semana, Alt + 1..5 para marcar
  días.
- La jornada admite medias horas (por ejemplo 6,5 h).

---

*¿Algo no va o se te ocurre una mejora? Escribe a quique@ugr.es*
