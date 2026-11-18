export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  vaultPath: string;
  outputDir: string;
  model: string;
  effort: '' | 'low' | 'medium' | 'high';
  theme: Theme;
}

export interface ClaudeStatus {
  executable: string | null;
  version: string | null;
  loggedIn: boolean | null;
  detail: string;
  checkedAt: string;
}

export interface VaultStats {
  configured: boolean;
  vaultPath: string;
  documents: number;
  indexedDocuments: number;
  sections: number;
  words: number;
  pending: number;
  lastIndexedAt: string | null;
  topFolders: { folder: string; documents: number }[];
}

export interface IndexProgress {
  phase: 'scanning' | 'indexing' | 'done' | 'error';
  processed: number;
  total: number;
  current?: string;
  added?: number;
  updated?: number;
  removed?: number;
  message?: string;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  ext?: string;
  indexed?: boolean;
  children?: TreeNode[];
  documents?: number;
}

export interface DocumentSection {
  id: number;
  heading: string;
  headingPath: string;
  level: number;
  content: string;
  startLine: number;
}

export interface DocumentView {
  path: string;
  title: string;
  ext: string;
  words: number;
  tags: string[];
  links: string[];
  backlinks: string[];
  sections: DocumentSection[];
  status: 'indexed' | 'unsupported';
  error: string | null;
}

export interface SearchHit {
  sectionId: number;
  path: string;
  title: string;
  headingPath: string;
  snippet: string;
  score: number;
}

export type ClaudeErrorKind =
  | 'not_found'
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'cancelled'
  | 'invalid_output'
  | 'session'
  | 'execution';

export interface MessageSource {
  ref: string;
  path: string;
  heading: string;
  quote: string;
  verified: boolean;
  reason?: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  complementary: string;
  notInVault: string[];
  sources: MessageSource[];
  createdAt: string;
}

export interface ConversationSummary {
  id: number;
  title: string;
  updatedAt: string;
  messages: number;
}

export interface Conversation extends ConversationSummary {
  messages_: ChatMessage[];
}

export interface AskInput {
  conversationId: number | null;
  question: string;
  requestId: string;
}

export type AskResult =
  | { ok: true; conversationId: number; message: ChatMessage }
  | { ok: false; conversationId: number | null; errorKind: ClaudeErrorKind; error: string };

export interface ClaudeProgress {
  requestId: string;
  text: string;
}

export interface ActivityEntry {
  id: number;
  at: string;
  level: 'info' | 'warn' | 'error';
  category: string;
  message: string;
}

export interface DashboardData {
  vault: VaultStats;
  claude: ClaudeStatus | null;
  conversations: ConversationSummary[];
  activity: ActivityEntry[];
  usage: { runs: number; failed: number; costUsd: number; avgSeconds: number };
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface StudyCoreApi {
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Result<Settings>>;
  chooseFolder(title: string): Promise<string | null>;
  claudeStatus(refresh: boolean): Promise<ClaudeStatus>;
  dashboard(): Promise<DashboardData>;
  vaultStats(): Promise<VaultStats>;
  reindex(): Promise<Result<IndexProgress>>;
  vaultTree(): Promise<TreeNode | null>;
  openDocument(path: string): Promise<Result<DocumentView>>;
  search(query: string, limit?: number): Promise<SearchHit[]>;
  ask(input: AskInput): Promise<AskResult>;
  cancel(requestId: string): Promise<void>;
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: number): Promise<Conversation | null>;
  renameConversation(id: number, title: string): Promise<void>;
  saveMessageAsNote(messageId: number): Promise<Result<string>>;
  backup(): Promise<Result<string>>;
  revealPath(target: string): Promise<void>;
  onIndexProgress(cb: (p: IndexProgress) => void): () => void;
  onClaudeProgress(cb: (p: ClaudeProgress) => void): () => void;
  /** Motor educativo: invoca un método de `Rpc` (shared/learning.ts). */
  call(method: string, ...args: unknown[]): Promise<unknown>;
  onReward(cb: (r: import('./learning').Reward) => void): () => void;
}
