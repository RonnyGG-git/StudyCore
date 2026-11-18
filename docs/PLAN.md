# StudyCore — Documento de planificación

> Entorno personal de aprendizaje: **Obsidian aporta el conocimiento, Claude Code es el motor,
> StudyCore lo convierte en aprendizaje estructurado, evaluable y progresivo.**
> Regla principal: nada simulado. Un botón visible funciona; un número visible sale de la base de datos.

## 1. Análisis del entorno (2026-11-18)

| Elemento | Hallazgo | Consecuencia |
|---|---|---|
| Claude Code CLI | v2.1.322, sesión OAuth (sin API key) | Se usa la CLI directamente; no hace falta API externa ni exponer claves |
| Modo no interactivo | `claude -p --output-format stream-json --verbose` | Eventos línea a línea: progreso, herramientas, resultado, coste, `session_id` |
| Salida estructurada | `--json-schema` → `structured_output` | Lecciones, quizzes y correcciones llegan como JSON validado (zod en nuestro lado) |
| Aislamiento | `--safe-mode --strict-mcp-config --tools "Read,Glob,Grep" --permission-mode dontAsk` | Probado: sin hooks/MCP/CLAUDE.md del usuario, solo lectura, y un `Read` fuera del vault queda **denegado** |
| Sesiones | `--session-id <uuid>` / `--resume <id>` | Conversaciones del tutor con memoria; si una sesión se pierde se reconstruye el contexto desde la BD |
| Prompt de sistema | `--system-prompt` reemplaza el de Claude Code | Personalidad de profesor y reglas de citación propias; menos tokens |
| Node en Electron 45 | Node 24.22 con `node:sqlite` + FTS5 (`remove_diacritics`) | SQLite **sin módulos nativos** (nada que recompilar para Electron) |
| Proyecto previo | `dual-agent-desktop` (Electron 45, React 19, TS 7, Vite 8, Tailwind 3, zod 4) | Mismas versiones (ya en caché de npm) y patrones probados: resolución de `claude.exe`, ejecución sin shell, `taskkill /T` |
| Vault | `C:\RONNY\MIND\CEREBRO`, Markdown + algunos PDF/DOCX | Se indexa en una BD propia; el vault **nunca** se escribe |

## 2. Arquitectura

```
┌──────────────── Renderer (React, sandbox, sin Node) ────────────────┐
│ Sidebar · Dashboard · Biblioteca (Vault) · Consultar · Ajustes · …  │
└──────────────▲───────────────────────────────────────┬──────────────┘
               │ eventos (claude:progress, vault:index)│ invoke tipado (zod)
┌──────────────┴──── preload: window.studycore ────────▼──────────────┐
┌──────────────┴──────────── Proceso principal ────────▼──────────────┐
│ ipc.ts ── valida cada petición y la enruta a un servicio            │
│ ├─ core/db        SQLite (node:sqlite), migraciones versionadas     │
│ ├─ core/vault     escaneo, troceado por encabezados, FTS5, guardas  │
│ ├─ core/claude    ClaudeClient (proceso aislado), esquemas, prompts │
│ ├─ core/learning  temas, diagnóstico, rutas, lecciones   (Fase 2)   │
│ ├─ core/assess    quizzes, corrección, adaptatividad      (Fase 3)  │
│ ├─ core/game      XP, niveles, logros, rachas             (Fase 4)  │
│ ├─ core/memory    flashcards + repetición espaciada       (Fase 5)  │
│ ├─ core/stats     agregados para dashboard y gráficas               │
│ └─ core/log       registro de actividad (BD + archivo)              │
└─────────────────────────────────────────────────────────────────────┘
        │ spawn sin shell, cwd = vault, solo Read/Glob/Grep
        ▼
   claude.exe -p … (una ejecución por petición; --resume para conversaciones)
```

### Por qué así
- **Electron** y no web local: necesita lanzar `claude.exe`, leer el disco y elegir carpetas con
  diálogos nativos; una web local exigiría un servidor con esos mismos permisos y más superficie.
- **SQLite** y no JSON: el dominio es relacional (temas → módulos → lecciones → conceptos → preguntas →
  respuestas → XP) y las estadísticas son consultas agregadas. `node:sqlite` evita módulos nativos.
- **Recuperación + citas verificadas**: antes de llamar a Claude, StudyCore busca en el índice FTS5 los
  fragmentos relevantes y se los entrega con un identificador (`[S3]`). Claude debe citar esos
  identificadores. Cada cita se **comprueba** contra el índice: si no existe o la frase citada no
  aparece en el documento, se marca como *no verificada*. El contenido complementario (conocimiento
  general de Claude) va en un campo separado y se muestra con otra etiqueta.
- **Claude con lo mínimo**: solo herramientas de lectura, cwd = vault, sin MCP, sin hooks, sin
  CLAUDE.md del usuario, `dontAsk` (lo que pediría permiso se deniega). Claude nunca ejecuta comandos.

### Seguridad
- El vault se abre solo en lectura; toda ruta pedida desde la interfaz se resuelve y se comprueba que
  está **dentro** del vault (`realpath` + prefijo) — sin `..`, sin enlaces que salgan.
- La carpeta de salida (resúmenes, exportaciones, copias) es otra, configurable, y no puede estar dentro
  del vault.
- Renderer con `contextIsolation`, `sandbox`, sin navegación externa; IPC validado con zod.
- No se guardan credenciales: la autenticación es la de Claude Code.

## 3. Modelo de datos (resumen)

| Fase | Tablas |
|---|---|
| 1 | `settings`, `vault_documents`, `vault_sections` + `vault_fts`, `claude_runs`, `activity_log`, `conversations`, `messages`, `message_sources` |
| 2 | `topics`, `topic_documents`, `diagnostics`, `paths`, `modules`, `lessons`, `lesson_progress`, `concepts`, `concept_sources`, `concept_prerequisites` |
| 3 | `assessments`, `questions`, `attempts`, `answers`, `concept_mastery` |
| 4 | `xp_events` (fuente única de la XP; nivel derivado), `achievements`, `user_achievements`, `study_days` |
| 5 | `flashcards`, `card_reviews` (SM-2/FSRS simplificado), `challenges`, `challenge_attempts`, `goals`, `study_sessions` |

`xp_events` registra cada recompensa con el evento que la origina (`lesson_progress.id`, `attempt.id`…),
y una restricción única impide cobrar dos veces lo mismo: la XP solo nace de actividad verificable.

## 4. Fases

| Fase | Contenido | Criterio de cierre |
|---|---|---|
| **1 — Fundación** | Estructura, shell de UI (sidebar, claro/oscuro), configuración del vault, indexado + explorador + búsqueda, ClaudeClient aislado con cancelación/errores, **Consultar al vault** con citas verificadas, persistencia, registro de actividad | typecheck + tests unitarios + prueba real con la CLI + captura de la app |
| **2 — Motor educativo** | Temas, diagnóstico inicial, ruta con prerrequisitos y etapas desbloqueables, lecciones en unidades con botones de reexplicación, tutor socrático con contexto de la ruta | Flujo tema → diagnóstico → ruta → lección completo con datos reales |
| **3 — Evaluación** | Quizzes (9 tipos), corrección razonada, modo examen, adaptatividad por concepto, historial | Fallos repetidos generan refuerzo; dominio sube dificultad |
| **4 — Gamificación** | XP, 7 niveles, logros, rachas, estadísticas y gráficas | Toda la XP trazable a un evento |
| **5 — Memoria y práctica** | Flashcards con repetición espaciada, retos con pistas progresivas, planificador | Repasos programados aparecen en el dashboard |
| **6 — Refinamiento** | Animaciones, PDF/semántica, exportar/copia de seguridad, rendimiento, pruebas E2E | Regresión completa en verde |

Al cerrar cada fase se vuelve a ejecutar toda la batería anterior.

## 5. Estado (2026-11-18)

Las seis fases están implementadas y conectadas: el diagnóstico alimenta el dominio por concepto, el dominio
ajusta la dificultad y dispara refuerzos, los refuerzos respetan los prerrequisitos, las evaluaciones de módulo
desbloquean la ruta, cada logro real otorga XP una sola vez y todo alimenta el dashboard, las estadísticas y el
planificador. Verificación: 51 pruebas automáticas (incluido el flujo completo de la sección 16 del requisito)
y pruebas contra la CLI real.

## 6. Limitaciones conocidas (honestas)

- **Búsqueda "por significado"**: BM25 (FTS5) sin acentos + reordenado por cobertura de términos, más la
  capacidad de Claude de buscar por su cuenta (Grep/Read). No hay embeddings semánticos locales: exigirían
  descargar un modelo (~100 MB) y más RAM; queda como mejora opcional.
- **PDF escaneados** (imagen sin capa de texto) no se pueden extraer: se marcan como tal, no se fingen indexados.
- Cada llamada a Claude tarda ~10-90 s según la tarea y consume uso del plan; la interfaz muestra el progreso
  real y permite cancelar.
