/**
 * Migraciones versionadas (PRAGMA user_version). Nunca se edita una migración ya publicada:
 * cada fase añade la suya.
 */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE vault_documents (
        id          INTEGER PRIMARY KEY,
        rel_path    TEXT NOT NULL UNIQUE,
        title       TEXT NOT NULL,
        ext         TEXT NOT NULL,
        size        INTEGER NOT NULL,
        mtime_ms    INTEGER NOT NULL,
        word_count  INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL CHECK (status IN ('indexed','unsupported','error')),
        error       TEXT,
        indexed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE vault_sections (
        id           INTEGER PRIMARY KEY,
        document_id  INTEGER NOT NULL REFERENCES vault_documents(id) ON DELETE CASCADE,
        ord          INTEGER NOT NULL,
        heading      TEXT NOT NULL,
        heading_path TEXT NOT NULL,
        level        INTEGER NOT NULL,
        content      TEXT NOT NULL,
        start_line   INTEGER NOT NULL,
        word_count   INTEGER NOT NULL
      );
      CREATE INDEX idx_sections_document ON vault_sections(document_id, ord);

      CREATE VIRTUAL TABLE vault_fts USING fts5(
        section_id UNINDEXED, title, heading_path, content,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TABLE vault_tags (
        document_id INTEGER NOT NULL REFERENCES vault_documents(id) ON DELETE CASCADE,
        tag         TEXT NOT NULL,
        PRIMARY KEY (document_id, tag)
      );

      CREATE TABLE vault_links (
        document_id INTEGER NOT NULL REFERENCES vault_documents(id) ON DELETE CASCADE,
        target      TEXT NOT NULL,
        PRIMARY KEY (document_id, target)
      );
      CREATE INDEX idx_links_target ON vault_links(target);

      CREATE TABLE claude_runs (
        id            INTEGER PRIMARY KEY,
        kind          TEXT NOT NULL,
        session_id    TEXT,
        model         TEXT,
        status        TEXT NOT NULL CHECK (status IN ('running','ok','error')),
        error_kind    TEXT,
        error_message TEXT,
        duration_ms   INTEGER,
        cost_usd      REAL,
        prompt_chars  INTEGER NOT NULL,
        started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        finished_at   TEXT
      );

      CREATE TABLE activity_log (
        id       INTEGER PRIMARY KEY,
        at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        level    TEXT NOT NULL CHECK (level IN ('info','warn','error')),
        category TEXT NOT NULL,
        message  TEXT NOT NULL,
        data     TEXT
      );
      CREATE INDEX idx_activity_at ON activity_log(at DESC);

      CREATE TABLE conversations (
        id         INTEGER PRIMARY KEY,
        kind       TEXT NOT NULL DEFAULT 'ask',
        title      TEXT NOT NULL,
        session_id TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE messages (
        id              INTEGER PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content         TEXT NOT NULL,
        complementary   TEXT NOT NULL DEFAULT '',
        not_in_vault    TEXT NOT NULL DEFAULT '[]',
        run_id          INTEGER REFERENCES claude_runs(id),
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_messages_conversation ON messages(conversation_id, id);

      CREATE TABLE message_sources (
        id         INTEGER PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        ref        TEXT NOT NULL,
        section_id INTEGER,
        path       TEXT NOT NULL,
        heading    TEXT NOT NULL,
        quote      TEXT NOT NULL,
        verified   INTEGER NOT NULL,
        reason     TEXT
      );
    `,
  },
  {
    // Fase 2 — motor educativo
    version: 2,
    sql: `
      CREATE TABLE topics (
        id          INTEGER PRIMARY KEY,
        title       TEXT NOT NULL,
        goal        TEXT NOT NULL DEFAULT '',
        objective   TEXT NOT NULL DEFAULT '',
        summary     TEXT NOT NULL DEFAULT '',
        scope       TEXT NOT NULL DEFAULT '[]',
        level       TEXT CHECK (level IN ('principiante','intermedio','avanzado')),
        difficulty  INTEGER NOT NULL DEFAULT 1,
        status      TEXT NOT NULL DEFAULT 'diagnosing' CHECK (status IN ('diagnosing','active','mastered')),
        diagnosis   TEXT,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        mastered_at TEXT
      );

      CREATE TABLE modules (
        id           INTEGER PRIMARY KEY,
        topic_id     INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        ord          INTEGER NOT NULL,
        title        TEXT NOT NULL,
        objective    TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','available','in_progress','completed')),
        completed_at TEXT
      );
      CREATE INDEX idx_modules_topic ON modules(topic_id, ord);

      CREATE TABLE lessons (
        id            INTEGER PRIMARY KEY,
        module_id     INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
        ord           INTEGER NOT NULL,
        title         TEXT NOT NULL,
        summary       TEXT NOT NULL DEFAULT '',
        difficulty    INTEGER NOT NULL DEFAULT 1,
        status        TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','available','in_progress','completed')),
        content       TEXT,
        sources       TEXT NOT NULL DEFAULT '[]',
        complementary TEXT NOT NULL DEFAULT '',
        current_unit  INTEGER NOT NULL DEFAULT 0,
        generated_at  TEXT,
        started_at    TEXT,
        opened_at     TEXT,
        completed_at  TEXT
      );
      CREATE INDEX idx_lessons_module ON lessons(module_id, ord);

      CREATE TABLE concepts (
        id               INTEGER PRIMARY KEY,
        topic_id         INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        name             TEXT NOT NULL,
        short_definition TEXT NOT NULL DEFAULT '',
        explanation      TEXT NOT NULL DEFAULT '',
        example          TEXT NOT NULL DEFAULT '',
        application      TEXT NOT NULL DEFAULT '',
        status           TEXT NOT NULL DEFAULT 'not_studied' CHECK (status IN ('not_studied','learning','understood','mastered')),
        manual_status    INTEGER NOT NULL DEFAULT 0,
        favorite         INTEGER NOT NULL DEFAULT 0,
        mastery          REAL NOT NULL DEFAULT 0,
        attempts         INTEGER NOT NULL DEFAULT 0,
        correct          INTEGER NOT NULL DEFAULT 0,
        fail_streak      INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE UNIQUE INDEX idx_concepts_name ON concepts(topic_id, lower(name));

      CREATE TABLE concept_sources (
        id         INTEGER PRIMARY KEY,
        concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
        path       TEXT NOT NULL,
        heading    TEXT NOT NULL,
        quote      TEXT NOT NULL,
        verified   INTEGER NOT NULL,
        reason     TEXT
      );

      CREATE TABLE concept_relations (
        concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
        related_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('prerequisite','related')),
        PRIMARY KEY (concept_id, related_id, kind)
      );

      CREATE TABLE lesson_concepts (
        lesson_id  INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
        PRIMARY KEY (lesson_id, concept_id)
      );

      ALTER TABLE conversations ADD COLUMN topic_id INTEGER REFERENCES topics(id) ON DELETE CASCADE;
      ALTER TABLE conversations ADD COLUMN lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE;
    `,
  },
  {
    // Fase 3 — evaluaciones
    version: 3,
    sql: `
      CREATE TABLE assessments (
        id          INTEGER PRIMARY KEY,
        topic_id    INTEGER REFERENCES topics(id) ON DELETE CASCADE,
        module_id   INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        lesson_id   INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('diagnostic','lesson_check','lesson_quiz','module_quiz','practice','reinforcement','exam')),
        mode        TEXT NOT NULL CHECK (mode IN ('practice','exam')),
        title       TEXT NOT NULL,
        difficulty  INTEGER NOT NULL DEFAULT 2,
        status      TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','graded')),
        score       REAL,
        passed      INTEGER,
        review      TEXT NOT NULL DEFAULT '[]',
        intro       TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        finished_at TEXT
      );
      CREATE INDEX idx_assessments_topic ON assessments(topic_id, created_at DESC);

      CREATE TABLE questions (
        id            INTEGER PRIMARY KEY,
        assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        ord           INTEGER NOT NULL,
        type          TEXT NOT NULL,
        prompt        TEXT NOT NULL,
        data          TEXT NOT NULL DEFAULT '{}',
        solution      TEXT NOT NULL DEFAULT '{}',
        explanation   TEXT NOT NULL DEFAULT '',
        concept_id    INTEGER REFERENCES concepts(id) ON DELETE SET NULL,
        concept_name  TEXT,
        difficulty    INTEGER NOT NULL DEFAULT 2,
        points        REAL NOT NULL DEFAULT 1,
        fingerprint   TEXT NOT NULL
      );
      CREATE INDEX idx_questions_assessment ON questions(assessment_id, ord);
      CREATE INDEX idx_questions_fingerprint ON questions(fingerprint);

      CREATE TABLE answers (
        id          INTEGER PRIMARY KEY,
        question_id INTEGER NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
        response    TEXT NOT NULL,
        score       REAL,
        verdict     TEXT NOT NULL DEFAULT 'pendiente',
        feedback    TEXT,
        graded_by   TEXT,
        answered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        graded_at   TEXT
      );
    `,
  },
  {
    // Fase 4 — gamificación y estadísticas
    version: 4,
    sql: `
      CREATE TABLE xp_events (
        id         INTEGER PRIMARY KEY,
        kind       TEXT NOT NULL,
        ref_type   TEXT NOT NULL,
        ref_id     TEXT NOT NULL,
        amount     INTEGER NOT NULL CHECK (amount > 0),
        reason     TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (kind, ref_type, ref_id)
      );

      CREATE TABLE user_achievements (
        code        TEXT PRIMARY KEY,
        unlocked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE study_days (
        day            TEXT PRIMARY KEY,
        active_seconds INTEGER NOT NULL DEFAULT 0,
        lessons        INTEGER NOT NULL DEFAULT 0,
        questions      INTEGER NOT NULL DEFAULT 0,
        correct        INTEGER NOT NULL DEFAULT 0,
        cards          INTEGER NOT NULL DEFAULT 0,
        challenges     INTEGER NOT NULL DEFAULT 0,
        qualified      INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    // Fase 5 — memoria, práctica y planificación
    version: 5,
    sql: `
      CREATE TABLE flashcards (
        id               INTEGER PRIMARY KEY,
        topic_id         INTEGER REFERENCES topics(id) ON DELETE CASCADE,
        concept_id       INTEGER REFERENCES concepts(id) ON DELETE SET NULL,
        lesson_id        INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
        front            TEXT NOT NULL,
        back             TEXT NOT NULL,
        explanation      TEXT NOT NULL DEFAULT '',
        category         TEXT NOT NULL DEFAULT '',
        difficulty       INTEGER NOT NULL DEFAULT 2,
        source_path      TEXT,
        source_heading   TEXT,
        origin           TEXT NOT NULL CHECK (origin IN ('manual','claude')),
        due_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        interval_days    REAL NOT NULL DEFAULT 0,
        ease             REAL NOT NULL DEFAULT 2.5,
        reps             INTEGER NOT NULL DEFAULT 0,
        lapses           INTEGER NOT NULL DEFAULT 0,
        last_reviewed_at TEXT,
        created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_cards_due ON flashcards(due_at);

      CREATE TABLE card_reviews (
        id            INTEGER PRIMARY KEY,
        card_id       INTEGER NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
        rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
        interval_days REAL NOT NULL,
        reviewed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE challenges (
        id                INTEGER PRIMARY KEY,
        topic_id          INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        module_id         INTEGER REFERENCES modules(id) ON DELETE SET NULL,
        title             TEXT NOT NULL,
        description       TEXT NOT NULL,
        objectives        TEXT NOT NULL DEFAULT '[]',
        level             INTEGER NOT NULL DEFAULT 2,
        hints             TEXT NOT NULL DEFAULT '[]',
        hints_revealed    INTEGER NOT NULL DEFAULT 0,
        criteria          TEXT NOT NULL DEFAULT '[]',
        solution          TEXT NOT NULL DEFAULT '',
        solution_revealed INTEGER NOT NULL DEFAULT 0,
        xp                INTEGER NOT NULL DEFAULT 75,
        status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
        is_final          INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        completed_at      TEXT
      );

      CREATE TABLE challenge_attempts (
        id           INTEGER PRIMARY KEY,
        challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        response     TEXT NOT NULL,
        passed       INTEGER NOT NULL,
        score        REAL NOT NULL,
        evaluation   TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE goals (
        id         INTEGER PRIMARY KEY,
        period     TEXT NOT NULL CHECK (period IN ('daily','weekly')),
        metric     TEXT NOT NULL CHECK (metric IN ('xp','lessons','questions','minutes','cards')),
        target     INTEGER NOT NULL CHECK (target > 0),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (period, metric)
      );

      CREATE TABLE planned_sessions (
        id         INTEGER PRIMARY KEY,
        topic_id   INTEGER REFERENCES topics(id) ON DELETE SET NULL,
        title      TEXT NOT NULL,
        date       TEXT NOT NULL,
        minutes    INTEGER NOT NULL CHECK (minutes > 0),
        status     TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','skipped')),
        notes      TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_sessions_date ON planned_sessions(date);
    `,
  },
];
