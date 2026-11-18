import type { ClaudeErrorKind, MessageSource } from './types';

/* ───────── Temas, rutas y lecciones (Fase 2) ───────── */

export type TopicStatus = 'diagnosing' | 'active' | 'mastered';
export type Level = 'principiante' | 'intermedio' | 'avanzado';
export type StageStatus = 'locked' | 'available' | 'in_progress' | 'completed';

export interface TopicSummary {
  id: number;
  title: string;
  objective: string;
  level: Level | null;
  status: TopicStatus;
  progress: number;
  lessonCount: number;
  completedLessons: number;
  moduleCount: number;
  completedModules: number;
  concepts: number;
  masteredConcepts: number;
  createdAt: string;
  updatedAt: string;
}

export interface Diagnosis {
  summary: string;
  known: string[];
  gaps: string[];
  missingPrerequisites: string[];
}

export interface LessonSummary {
  id: number;
  ord: number;
  title: string;
  summary: string;
  difficulty: number;
  status: StageStatus;
  generated: boolean;
  currentUnit: number;
  unitCount: number;
  concepts: string[];
}

export interface ModuleView {
  id: number;
  ord: number;
  title: string;
  objective: string;
  status: StageStatus;
  lessons: LessonSummary[];
  quiz: { bestScore: number | null; passed: boolean; attempts: number };
}

export interface TopicDetail extends TopicSummary {
  summary: string;
  scope: string[];
  difficulty: number;
  diagnosis: Diagnosis | null;
  diagnosticAssessmentId: number | null;
  modules: ModuleView[];
  finalChallengeId: number | null;
  tutorConversationId: number | null;
  weakConcepts: { id: number; name: string; mastery: number }[];
}

export type UnitKind = 'intro' | 'definition' | 'explanation' | 'example' | 'analogy' | 'application' | 'mistakes' | 'related' | 'check' | 'summary';

export interface LessonUnit {
  kind: UnitKind;
  title: string;
  body: string;
  check: QuestionView | null;
}

export interface LessonView extends LessonSummary {
  topicId: number;
  topicTitle: string;
  moduleId: number;
  moduleTitle: string;
  units: LessonUnit[];
  sources: MessageSource[];
  complementary: string;
  conversationId: number | null;
  nextLessonId: number | null;
  isLastInModule: boolean;
}

export type LessonAction = 'simpler' | 'example' | 'technical' | 'exercise' | 'relate';

/* ───────── Evaluaciones (Fase 3) ───────── */

export type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer' | 'fill_blank' | 'matching' | 'problem' | 'essay' | 'case_analysis' | 'code';
export type AssessmentKind = 'diagnostic' | 'lesson_check' | 'lesson_quiz' | 'module_quiz' | 'practice' | 'reinforcement' | 'exam';
export type Verdict = 'correcta' | 'parcial' | 'incorrecta' | 'pendiente';

export interface Feedback {
  analysis: string;
  reasoningErrors: string[];
  correctAnswer: string;
  reviewSuggestion: string;
}

export interface AnswerView {
  response: unknown;
  score: number;
  verdict: Verdict;
  feedback: Feedback | null;
}

export interface QuestionView {
  id: number;
  ord: number;
  type: QuestionType;
  prompt: string;
  concept: string | null;
  difficulty: number;
  points: number;
  options?: string[];
  blanks?: number;
  left?: string[];
  right?: string[];
  scenario?: string;
  language?: string;
  starterCode?: string;
  answer: AnswerView | null;
}

export interface AssessmentView {
  id: number;
  kind: AssessmentKind;
  mode: 'practice' | 'exam';
  status: 'in_progress' | 'graded';
  title: string;
  topicId: number | null;
  topicTitle: string | null;
  moduleId: number | null;
  lessonId: number | null;
  difficulty: number;
  score: number | null;
  passed: boolean | null;
  questions: QuestionView[];
  createdAt: string;
  finishedAt: string | null;
  review: string[];
  intro: string;
}

export interface AssessmentSummary {
  id: number;
  kind: AssessmentKind;
  mode: 'practice' | 'exam';
  title: string;
  topicTitle: string | null;
  score: number | null;
  passed: boolean | null;
  questions: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface QuizRequest {
  topicId: number;
  kind: 'lesson_quiz' | 'module_quiz' | 'practice' | 'reinforcement' | 'exam';
  mode: 'practice' | 'exam';
  lessonId?: number | null;
  moduleId?: number | null;
  conceptIds?: number[];
  count?: number;
  types?: QuestionType[];
}

/* ───────── Conceptos y glosario ───────── */

export type ConceptStatus = 'not_studied' | 'learning' | 'understood' | 'mastered';

export interface ConceptSummary {
  id: number;
  topicId: number;
  topicTitle: string;
  name: string;
  shortDefinition: string;
  status: ConceptStatus;
  favorite: boolean;
  mastery: number;
}

export interface ConceptView extends ConceptSummary {
  explanation: string;
  example: string;
  application: string;
  related: { id: number; name: string }[];
  prerequisites: { id: number; name: string; status: ConceptStatus }[];
  sources: MessageSource[];
  attempts: number;
  correct: number;
  lessons: { id: number; title: string }[];
}

export interface ConceptMap {
  nodes: { id: number; name: string; status: ConceptStatus; mastery: number; depth: number }[];
  edges: { from: number; to: number; kind: 'prerequisite' | 'related' }[];
}

/* ───────── Gamificación (Fase 4) ───────── */

export interface LevelInfo {
  n: number;
  name: string;
  min: number;
  next: number | null;
}

export interface AchievementView {
  code: string;
  name: string;
  description: string;
  unlockedAt: string | null;
  progress: { value: number; target: number };
}

export interface GameState {
  xp: number;
  level: LevelInfo;
  progressToNext: number;
  streak: { current: number; best: number; activeToday: boolean };
  achievements: AchievementView[];
}

export interface Reward {
  xp: number;
  reason: string;
  levelUp: { n: number; name: string } | null;
  achievements: { code: string; name: string }[];
}

export interface XpEvent {
  id: number;
  kind: string;
  reason: string;
  amount: number;
  createdAt: string;
}

export interface DailyStat {
  day: string;
  xp: number;
  minutes: number;
  questions: number;
  correct: number;
  lessons: number;
  cards: number;
}

export interface Stats {
  totals: {
    xp: number;
    minutes: number;
    lessons: number;
    questions: number;
    correctPct: number | null;
    topicsMastered: number;
    topicsPending: number;
    cardsReviewed: number;
    challengesCompleted: number;
    conceptsMastered: number;
  };
  streak: GameState['streak'];
  daily: DailyStat[];
  topics: { id: number; title: string; progress: number; mastery: number; accuracy: number | null }[];
  questionTypes: { type: QuestionType; answered: number; accuracy: number }[];
  xpLog: XpEvent[];
}

/* ───────── Memoria, práctica y planificación (Fase 5) ───────── */

export interface Flashcard {
  id: number;
  topicId: number | null;
  topicTitle: string | null;
  conceptId: number | null;
  conceptName: string | null;
  front: string;
  back: string;
  explanation: string;
  category: string;
  difficulty: number;
  sourcePath: string | null;
  sourceHeading: string | null;
  origin: 'manual' | 'claude';
  dueAt: string;
  intervalDays: number;
  reps: number;
  lapses: number;
  ease: number;
  lastReviewedAt: string | null;
}

export type CardRating = 1 | 2 | 3 | 4;

export interface CardInput {
  topicId: number | null;
  front: string;
  back: string;
  explanation?: string;
  category?: string;
  difficulty?: number;
}

export interface ReviewOverview {
  due: number;
  total: number;
  learning: number;
  forgetting: { conceptId: number | null; name: string; lapses: number }[];
  upcoming: { day: string; count: number }[];
}

export interface ChallengeAttempt {
  id: number;
  response: string;
  passed: boolean;
  score: number;
  criteria: { criterion: string; met: boolean; comment: string }[];
  feedback: string;
  nextSteps: string[];
  createdAt: string;
}

export interface ChallengeView {
  id: number;
  topicId: number;
  topicTitle: string;
  title: string;
  description: string;
  objectives: string[];
  level: number;
  hintsTotal: number;
  hints: string[];
  criteria: string[];
  xp: number;
  status: 'open' | 'completed';
  isFinalProject: boolean;
  solution: string | null;
  solutionRevealed: boolean;
  canRevealSolution: boolean;
  attempts: ChallengeAttempt[];
  createdAt: string;
}

export interface ChallengeSummary {
  id: number;
  topicTitle: string;
  title: string;
  level: number;
  xp: number;
  status: 'open' | 'completed';
  isFinalProject: boolean;
  attempts: number;
}

export type GoalMetric = 'xp' | 'lessons' | 'questions' | 'minutes' | 'cards';

export interface Goal {
  id: number;
  period: 'daily' | 'weekly';
  metric: GoalMetric;
  target: number;
  current: number;
  done: boolean;
}

export interface PlannedSession {
  id: number;
  topicId: number | null;
  topicTitle: string | null;
  title: string;
  date: string;
  minutes: number;
  status: 'planned' | 'done' | 'skipped';
  notes: string;
}

export type RecommendationAction = 'diagnostic' | 'lesson' | 'module_quiz' | 'review_cards' | 'reinforce_concept' | 'challenge' | 'tutor' | 'new_topic';

export interface Recommendation {
  action: RecommendationAction;
  title: string;
  reason: string;
  minutes: number;
  topicId: number | null;
  targetId: number | null;
  source: 'sistema' | 'claude';
}

export interface ContinueItem {
  kind: 'lesson' | 'assessment' | 'diagnostic' | 'conversation';
  id: number;
  title: string;
  subtitle: string;
  progress: number;
}

export interface Home {
  game: GameState;
  continue: ContinueItem | null;
  topics: TopicSummary[];
  review: ReviewOverview;
  goals: Goal[];
  recommendations: Recommendation[];
  recentAssessments: AssessmentSummary[];
  today: { minutes: number; xp: number; questions: number };
  week: DailyStat[];
}

/* ───────── RPC ───────── */

export type Gen<T> = { ok: true; value: T } | { ok: false; errorKind: ClaudeErrorKind | 'validation'; error: string };

/**
 * Métodos que la interfaz puede invocar. El proceso principal valida los argumentos de cada uno con zod.
 * Los que llaman a Claude reciben un requestId para informar del progreso y poder cancelarse.
 */
export interface Rpc {
  home(): Promise<Home>;
  // temas
  topicsList(): Promise<TopicSummary[]>;
  topicGet(id: number): Promise<TopicDetail | null>;
  topicCreate(input: { title: string; goal: string; scope: string[] }, requestId: string): Promise<Gen<{ topicId: number; assessmentId: number }>>;
  topicSubmitDiagnostic(assessmentId: number, requestId: string): Promise<Gen<TopicDetail>>;
  topicDelete(id: number): Promise<void>;
  // lecciones
  lessonGet(id: number): Promise<LessonView | null>;
  lessonGenerate(id: number, requestId: string, regenerate?: boolean): Promise<Gen<LessonView>>;
  lessonSetUnit(id: number, unit: number): Promise<void>;
  lessonComplete(id: number): Promise<Gen<LessonView>>;
  lessonAction(id: number, action: LessonAction, requestId: string, extra?: string): Promise<Gen<{ conversationId: number }>>;
  lessonConversation(id: number): Promise<number>;
  tutorOpen(topicId: number): Promise<number>;
  // evaluaciones
  quizCreate(req: QuizRequest, requestId: string): Promise<Gen<AssessmentView>>;
  assessmentGet(id: number): Promise<AssessmentView | null>;
  assessmentList(topicId?: number | null): Promise<AssessmentSummary[]>;
  answerSave(questionId: number, response: unknown): Promise<Gen<QuestionView>>;
  answerCheck(questionId: number, response: unknown, requestId: string): Promise<Gen<QuestionView>>;
  assessmentSubmit(id: number, requestId: string): Promise<Gen<AssessmentView>>;
  // conceptos
  conceptsList(filter: { topicId?: number | null; status?: string | null; favorites?: boolean; query?: string }): Promise<ConceptSummary[]>;
  conceptGet(id: number): Promise<ConceptView | null>;
  conceptMap(topicId: number): Promise<ConceptMap>;
  conceptSetStatus(id: number, status: ConceptStatus): Promise<void>;
  conceptToggleFavorite(id: number): Promise<boolean>;
  conceptExpand(id: number, requestId: string): Promise<Gen<ConceptView>>;
  glossaryGenerate(topicId: number, requestId: string): Promise<Gen<{ added: number; updated: number }>>;
  // gamificación y estadísticas
  game(): Promise<GameState>;
  stats(): Promise<Stats>;
  trackTime(seconds: number, kind: string): Promise<void>;
  // tarjetas
  cardsOverview(): Promise<ReviewOverview>;
  cardsDue(topicId?: number | null, limit?: number): Promise<Flashcard[]>;
  cardsList(topicId?: number | null): Promise<Flashcard[]>;
  cardCreate(input: CardInput): Promise<Gen<Flashcard>>;
  cardUpdate(id: number, input: CardInput): Promise<Gen<Flashcard>>;
  cardDelete(id: number): Promise<void>;
  cardReview(id: number, rating: CardRating): Promise<Flashcard>;
  cardsGenerate(input: { topicId: number; lessonId?: number | null; count?: number }, requestId: string): Promise<Gen<{ created: number }>>;
  // retos
  challengesList(topicId?: number | null): Promise<ChallengeSummary[]>;
  challengeGet(id: number): Promise<ChallengeView | null>;
  challengeCreate(input: { topicId: number; moduleId?: number | null; focus?: string }, requestId: string): Promise<Gen<ChallengeView>>;
  challengePrepare(id: number, requestId: string): Promise<Gen<ChallengeView>>;
  challengeHint(id: number): Promise<ChallengeView>;
  challengeSubmit(id: number, response: string, requestId: string): Promise<Gen<ChallengeView>>;
  challengeRevealSolution(id: number): Promise<ChallengeView>;
  // planificador
  goalsList(): Promise<Goal[]>;
  goalSave(goal: { id?: number; period: 'daily' | 'weekly'; metric: GoalMetric; target: number }): Promise<Goal[]>;
  goalDelete(id: number): Promise<Goal[]>;
  sessionsList(from: string, to: string): Promise<PlannedSession[]>;
  sessionSave(s: { id?: number; topicId: number | null; title: string; date: string; minutes: number; status?: PlannedSession['status']; notes?: string }): Promise<PlannedSession>;
  sessionDelete(id: number): Promise<void>;
  recommendations(): Promise<Recommendation[]>;
  recommendWithClaude(minutes: number, requestId: string): Promise<Gen<Recommendation[]>>;
  plannerStats(): Promise<{ planned: number; done: number; skipped: number; compliance: number | null; weekMinutes: number; weekGoalMinutes: number | null }>;
  // datos
  exportData(): Promise<Gen<string>>;
}
