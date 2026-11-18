# StudyCore

Entorno personal de aprendizaje: **Obsidian aporta el conocimiento, Claude Code es el motor.**
Plan, arquitectura y decisiones: [`docs/PLAN.md`](docs/PLAN.md).

## Estado: fases 1-6 implementadas

| Módulo | Qué hace (todo con datos reales) |
|---|---|
| **Vault** | Indexa `.md`, `.txt`, `.pdf` (por páginas) y `.docx`; incremental; búsqueda FTS5 sin acentos con reordenado por cobertura; árbol, visor, etiquetas, enlaces y backlinks. Nunca escribe en el vault |
| **Consultar** | Preguntas libres al vault; citas `[S#]` **verificadas** contra el texto real; conocimiento general separado; conversaciones con memoria |
| **Temas y rutas** | Tema + carpetas → diagnóstico inicial (8 preguntas, «No lo sé») → nivel, lagunas, prerrequisitos → ruta de módulos y lecciones con etapas desbloqueables y proyecto final |
| **Lecciones** | Unidades cortas (intro, definición, explicación, ejemplo, analogía, aplicación, errores comunes, relacionados, comprobaciones, resumen). Botones: más sencillo, otro ejemplo, técnicamente, ejercicio, relacionar, comprueba si lo entendí |
| **Tutor** | Chat socrático por tema que conoce la ruta, el nivel, los conceptos débiles y los últimos resultados |
| **Evaluaciones** | 9 tipos de pregunta; cerradas corregidas al instante, abiertas analizadas por Claude (comprensión, errores de razonamiento, respuesta correcta, qué repasar); modo examen; sin repetir preguntas; dificultad según dominio |
| **Adaptatividad** | Dominio por concepto (media ponderada por dificultad); 2 fallos seguidos → refuerzo con explicación nueva; respeta prerrequisitos al recomendar |
| **Glosario** | Conceptos con definición, explicación, ejemplo, aplicación, relaciones, prerrequisitos, fuentes verificadas, estado y favoritos; generación desde el vault |
| **Tarjetas** | Manuales o generadas; repetición espaciada (SM-2); detección de lo que se olvida; teclado (espacio, 1-4) |
| **Retos** | Basados en problemas, pistas progresivas, criterios, solución oculta; +75 XP solo si se supera sin verla |
| **Gamificación** | XP por eventos verificables (cada uno cobrable una vez), 7 niveles, 10 logros, rachas con bonificación |
| **Estadísticas** | Tiempo efectivo (no tiempo abierto), lecciones, preguntas, acierto, evolución diaria, acierto por tipo, temas, historial de XP |
| **Planificador** | Objetivos diarios/semanales medidos solos, sesiones semanales, cumplimiento, recomendación automática y «Planificar con Claude» según el tiempo disponible |
| **Datos** | SQLite con migraciones, copia de seguridad, exportación JSON + informe Markdown, registro de actividad |

## Uso

```bash
npm install
npm start            # compila y abre la app
npm run dev          # desarrollo (Vite en :5174)
npm test             # 51 pruebas (CLI de Claude simulada; incluye el flujo completo de aprendizaje)
npm run test:real    # flujo completo contra la CLI real y el vault real (consume uso del plan)
node scripts/screenshot.cjs salida.png [topic/1|lesson/2|progress|…]   # captura de la ventana real
```

Datos: `%APPDATA%\studycore\studycore.db` (`STUDYCORE_DATA_DIR` lo cambia).

## Cómo se invoca a Claude

```
claude -p --output-format stream-json --verbose --safe-mode --strict-mcp-config
       --tools Read,Glob,Grep --allowedTools Read,Glob,Grep --permission-mode dontAsk
       --system-prompt <rol> --json-schema <esquema zod> [--resume <sesión> | --session-id <uuid>]
```

cwd = vault. Sin CLAUDE.md/hooks/MCP del usuario, sin escritura ni comandos; leer fuera del vault se deniega.
Cada tarea (`ClaudeGateway`) lleva `TAREA: <nombre>`, valida la salida con zod, reintenta una vez si no cumple,
registra duración y coste, informa del progreso real y se puede cancelar.

## Estructura

```
electron/main            ventana, IPC (canales de fase 1 + canal "rpc" validado)
electron/core
  db/                    SQLite + migraciones 1-5
  vault/                 escaneo, Markdown, PDF/DOCX, índice FTS5, guardas de rutas
  claude/                ClaudeClient (proceso aislado) y ClaudeGateway (tareas estructuradas)
  tutor/                 consultas y conversaciones con contexto, citas verificadas
  learning/              temas, diagnóstico, rutas, lecciones, conceptos, glosario, esquemas y prompts
  assess/                preguntas (9 tipos), corrección, evaluaciones, adaptatividad
  game/                  XP, niveles, logros, rachas, estadísticas
  memory/                tarjetas y repetición espaciada
  practice/              retos
  planner/               objetivos, sesiones, recomendaciones, dashboard
  data/                  exportación
  rpc.ts                 tabla de métodos de la interfaz con validación zod
shared/                  tipos compartidos (types.ts, learning.ts)
src/                     interfaz React (pages, components, hooks, lib)
tests/unit               51 pruebas · tests/real: CLI real
```

## Notas técnicas

- En el Chromium de Electron 45, `scrollIntoView()` devuelve una Promise: nunca la devuelvas desde un `useEffect`.
- `--json-schema` rechaza la cabecera `$schema` de zod (`toCliSchema` la elimina).
- La interfaz nunca recibe las soluciones de las preguntas: solo la retroalimentación ya corregida.
- `unpdf` es ESM: se carga con `import()` dinámico desde el proceso principal (CommonJS).
