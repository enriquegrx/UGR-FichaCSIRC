# Prompt para revisión UI — FichaCSIRC

> Pega este prompt a un modelo de IA o dáselo a un/a diseñador/a UI. Si puedes,
> adjunta capturas de la ventana principal, el asistente de configuración y los
> diálogos secundarios en Windows y macOS. Este prompt se centra en diseño visual,
> no en rediseñar el producto desde cero.

---

**Rol:** Actúa como diseñador/a senior de interfaces para aplicaciones de
escritorio internas y herramientas de productividad. Tienes buen criterio para
mejorar una app sobria sin convertirla en una landing page ni en un producto
visual excesivo.

**Contexto del producto:** "FichaCSIRC" es una app de escritorio en
Python/Tkinter para que personal de la Universidad de Granada registre sus horas
de trabajo en OpenProject (instancia "ProyectosTic"). La usa personal no técnico
que quiere fichar rápido, con seguridad y sin fricción. Funciona en Windows y
macOS; se distribuye como instalador/ejecutables en Windows y como apps `.app`
en macOS (Apple Silicon/ARM64 e Intel/x64).

La app tiene dos superficies principales:

1. *Configurador inicial tipo asistente:* Bienvenida → Conexión → Jornada →
   Tareas favoritas → Resumen → Finalizar.
2. *Ventana diaria de registro:* cabecera con logo/nombre/usuario, navegación
   semanal, tarjetas de días laborables con progreso, tabla de apuntes,
   formulario para añadir horas, acciones como copiar día anterior, copiar
   semana, plantillas, exportar CSV, resumen mes y eliminar/deshacer.

**Stack y límites realistas:**

- La interfaz actual usa `tkinter` y `ttk`.
- No hay CSS real como en HTML, pero sí se puede mejorar con `ttk.Style()`,
  estilos de widgets, espaciado, jerarquía, iconos, colores de estado,
  agrupación visual y reorganización.
- Se pueden proponer mejoras con `ttkbootstrap` o `customtkinter` si aportan
  valor claro, indicando coste/riesgo.
- Se pueden mencionar alternativas mayores como PySide/PyQt o Tauri, pero solo
  como opción estratégica; prioriza mejoras aplicables sin reescritura.

**Objetivo:** Evalúa si la interfaz parece clara, cuidada, profesional y fácil
de escanear para usuarios no técnicos. No evalúes solo si "funciona": céntrate
en cómo se ve, cómo se percibe y si la interfaz comunica bien prioridad, estado
y acción.

**Revisa específicamente:**

- Jerarquía visual: qué llama la atención primero y qué debería tener más/menos
  peso.
- Distribución: espaciado, alineación, densidad, equilibrio entre zonas y
  lectura en ventanas pequeñas.
- Tarjetas de días: tamaño, color, barra de progreso, selección, estado "hoy",
  estado completo/parcial/error/no laborable y dependencia excesiva del color.
- Botones: etiquetas, agrupación, prioridad visual, tamaño, consistencia,
  acciones primarias/secundarias y posibles iconos.
- Campos de formulario: tarea, horas, actividad, comentario; orden, anchura,
  foco inicial, validación visible y claridad.
- Tabla de apuntes: legibilidad, anchuras, columnas, acciones asociadas,
  selección y lectura de comentarios largos.
- Menús y acciones secundarias: si están donde el usuario espera y si sobran en
  la pantalla principal.
- Feedback visual: carga, éxito, error, sin conexión, permisos 403, jornada
  superada, día incompleto, deshacer disponible.
- Consistencia Windows/macOS: convenciones visuales, tamaños, menús, icono,
  primera impresión y comportamiento esperado.
- Accesibilidad visual: contraste, tamaño de texto, foco de teclado, estados no
  dependientes solo del color y uso de tooltips.
- Uso de iconos: dónde ayudarían, dónde sobrarían y qué acciones se beneficiarían
  de icono + texto.
- Modernización posible dentro de Tkinter/ttk sin perder sobriedad ni rapidez.

**Formato de salida:**

1. *Diagnóstico visual general* (5-8 líneas): impresión global, claridad,
   profesionalidad y principales debilidades visuales.
2. *Hallazgos priorizados* en tabla:
   zona | problema visual | impacto | severidad (alta/media/baja) |
   recomendación concreta.
3. *Quick wins aplicables en Tkinter/ttk* sin reescritura (5-10 mejoras).
4. *Mejoras medianas* usando `ttk.Style`, iconos, temas, reorganización o
   pequeños componentes propios.
5. *Mejoras mayores* si se acepta cambiar de toolkit o usar librerías como
   `ttkbootstrap`, `customtkinter`, PySide/PyQt o Tauri.
6. *Propuesta de layout ideal* para la ventana principal, descrita por secciones
   y orden visual.
7. *Checklist visual* para validar con capturas en Windows y macOS.

Sé específico y práctico. Propón el "qué" y el "cómo". Prioriza una herramienta
interna sobria, clara, rápida y confiable frente a una interfaz llamativa. Si
algo no puedes evaluar sin capturas, dilo claramente y especifica qué captura o
flujo necesitarías ver.
