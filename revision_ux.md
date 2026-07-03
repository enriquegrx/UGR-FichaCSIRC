# Prompt para revisión UX — FichaCSIRC

> Pega este prompt a un modelo de IA (o dáselo a un/a revisor/a UX). Si puedes, adjunta capturas o un vídeo corto del flujo de registro para que la evaluación sea sobre la interfaz real.

---

**Rol:** Actúa como ingeniero/a UX senior especializado en aplicaciones de escritorio y productividad interna. Vas a hacer una evaluación heurística de usabilidad de una app.

**Contexto del producto:** "FichaCSIRC" es una app de escritorio (Windows, hecha en Python/Tkinter) para que el personal de la Universidad de Granada registre sus horas de trabajo en OpenProject (instancia "ProyectosTic") vía su API. El registro es obligatorio, y el público objetivo son empleados **no técnicos** que quieren fichar rápido y sin fricción. Tiene dos partes:

1. *Configurador (asistente Siguiente/Atrás/Finalizar):* pasos Bienvenida → Conexión (URL + API key + "Probar conexión") → Jornada (horas normales/verano + fechas) → Tareas favoritas (elegir proyecto y marcar tareas) + actividad por defecto → Resumen → Finalizar.
2. *Ventana de registro:* navegación por semanas; casillas de los 5 días laborables con estado (horas registradas / jornada); tabla de apuntes del día; formulario para añadir apunte (tarea con desplegable de favoritas + botón "Buscar…" que abre proyecto→tareas con filtro; horas; actividad; comentario); botones de añadir y eliminar; diálogos de confirmación/resultado; exportación a CSV por rango de fechas.

**Concepto clave:** cada día laborable hay que imputar el total de la jornada (p. ej. 7 h normales, 5 h en verano) repartido entre una o varias tareas. Se puede aplicar el mismo apunte a varios días a la vez.

**Tu tarea:** Evalúa si la app es **amigable y fácil de usar**, con foco en el flujo de registrar horas (la tarea que el usuario repite a diario).

Concretamente:

- Aplica las 10 heurísticas de Nielsen e identifica problemas de usabilidad.
- Recorre estos flujos y señala fricciones, pasos innecesarios, riesgos de error y puntos de confusión: (a) primera configuración, (b) fichar un día completo, (c) fichar toda la semana de golpe, (d) corregir/eliminar un apunte, (e) exportar horas de un mes.
- Evalúa claridad de textos y etiquetas, feedback ante acciones y errores (incluida falta de conexión y permisos 403), prevención de errores (p. ej. que el total no cuadre con la jornada), accesibilidad básica (tamaños, contraste, navegación por teclado) y la curva de aprendizaje para alguien no técnico.
- Ten en cuenta que es una app interna, sencilla, no un producto comercial: prioriza mejoras de alto impacto y bajo esfuerzo.

**Formato de salida:**

1. *Resumen ejecutivo* (3–5 líneas): ¿es fácil de usar? impresión general.
2. *Hallazgos priorizados* en tabla: problema | flujo afectado | severidad (crítica/alta/media/baja) | heurística | recomendación concreta.
3. *Quick wins* (5–8 mejoras rápidas de alto impacto).
4. *Sugerencias de mejora mayores* (rediseños opcionales), si aplican.
5. Una *checklist* de 8–10 puntos para validar la usabilidad con un usuario real (test de guerrilla).

Sé específico y práctico; propón el "qué" y el "cómo". Si algo no puedes evaluar sin ver la interfaz, indícalo y di qué necesitarías (capturas, vídeo del flujo, etc.).
