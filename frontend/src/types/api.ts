export type UserRole = "admin" | "user";
export type AppMode = "novel" | "document";
export type ProtocolType = "openai_compat" | "anthropic" | "gemini";

export interface User {
  id: number;
  username: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface RegistrationStatus {
  allow_registration: boolean;
  invite_code_required: boolean;
  has_admin: boolean;
}

export interface AdminSettings {
  allow_registration: boolean;
  invite_code: string;
  max_upload_mb: number;
}

export interface Book {
  id: number;
  user_id?: number;
  title: string;
  author: string;
  total_volumes: number;
  total_chapters: number;
  total_chars: number;
  read_progress_ch: number;
  has_cover?: boolean;
  cover_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookDetail extends Book {
  alias_count: number;
  wiki_count: number;
}

export interface VolumeSummaryProgress {
  completed_chunks?: number;
  total_chunks?: number;
  error?: string;
}

export interface Volume {
  id: number;
  volume_num: number;
  title: string;
  start_chapter: number;
  end_chapter: number;
  summary_status: "none" | "generating" | "paused" | "ready" | "error";
  summary_locked: boolean;
  summary_md: string;
  summary_progress: VolumeSummaryProgress | null;
}

export interface VolumeSplitItem {
  title: string;
  start_chapter: number;
  end_chapter: number;
}

export interface VolumeStatusResponse {
  running: boolean;
  volumes: Array<{
    id: number;
    volume_num: number;
    title: string;
    summary_status: Volume["summary_status"];
    summary_progress: VolumeSummaryProgress | null;
  }>;
}

export interface ChapterListItem {
  id: number;
  volume_id: number;
  chapter_num: number;
  title: string;
  char_count: number;
}

export interface ChapterListResponse {
  total: number;
  page: number;
  page_size: number;
  items: ChapterListItem[];
}

export interface HighlightPosition {
  start: number;
  end: number;
}

export interface ChapterDetail {
  id: number;
  book_id: number;
  volume_id: number;
  chapter_num: number;
  title: string;
  content: string;
  char_count: number;
  volume_num: number;
  volume_title: string;
  highlight_positions: HighlightPosition[];
}

export interface AliasItem {
  id: number;
  canonical_name: string;
  aliases: string[];
}

export interface WikiNote {
  id: number;
  entity_name: string;
  category: string;
  content_md: string;
  source_chapters: number[];
  updated_at: string;
}

export interface DocumentItem {
  id: number;
  user_id?: number;
  filename: string;
  file_type: "pdf" | "pptx" | "docx" | "md" | "txt";
  total_pages: number;
  total_chars: number;
  has_scanned_pages: boolean;
  scanned_page_count: number;
  retrieval_mode: "direct" | "paginated_fts";
  created_at: string;
}

export interface DocPageOutline {
  page_num: number;
  heading: string;
  char_count: number;
  text_density: number;
  is_scanned_suspect: boolean;
}

export interface DocumentDetail extends DocumentItem {
  has_ocr_assets?: boolean;
  pages_outline: DocPageOutline[];
}

export interface DocOcrStatus {
  running: boolean;
  total_pages: number;
  completed_pages: number;
  failed_pages: number;
  current_page: number | null;
  last_error: string;
  has_ocr_assets: boolean;
}

export interface DocPageDetail {
  id: number;
  doc_id: number;
  page_num: number;
  heading: string;
  content: string;
  char_count: number;
  text_density: number;
  is_scanned_suspect: boolean;
}

export interface ProviderPreset {
  id: string;
  name: string;
  protocol: ProtocolType;
  base_url: string;
  default_model: string;
  description: string;
}

export interface ProviderItem {
  id: number;
  name: string;
  protocol: ProtocolType;
  base_url: string;
  api_key_masked: string;
  model_name: string;
  is_default: boolean;
  supports_tools: boolean;
  use_react_fallback: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderCreatePayload {
  name: string;
  protocol: ProtocolType;
  base_url: string;
  api_key: string;
  model_name: string;
  is_default?: boolean;
  supports_tools?: boolean;
  use_react_fallback?: boolean;
}

export interface ProviderTestResult {
  connectivity_ok: boolean;
  latency_ms: number;
  supports_tools: boolean;
  recommended_react_fallback: boolean;
  detail: string;
}

export interface ChatSession {
  id: number;
  user_id: number;
  mode: AppMode;
  target_id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ToolTraceItem {
  round?: number;
  tool?: string;
  arguments?: Record<string, unknown>;
  result_chars?: number;
  total_tool_chars?: number;
  mode?: string;
  total_chars?: number;
  status?: "running" | "done";
}

export interface ChapterCitation {
  type: "chapter";
  chapter_num: number;
  title: string;
  volume_num: number;
  volume_title: string;
}

export interface PageCitation {
  type: "page";
  page_num: number;
  heading: string;
  is_scanned_suspect: boolean;
}

export type Citation = ChapterCitation | PageCitation;

export interface ChatMessage {
  id: number;
  session_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  tool_trace: ToolTraceItem[];
  citations: Citation[];
  created_at: string;
}

export interface ChatStreamRequest {
  mode: AppMode;
  target_id: number;
  message: string;
  session_id?: number | null;
  provider_id?: number | null;
  max_chapter?: number | null;
}

export interface SSEHandlers {
  onSession?: (sessionId: number) => void;
  onToolStart?: (data: ToolTraceItem) => void;
  onToolDone?: (data: ToolTraceItem) => void;
  onDelta?: (text: string) => void;
  onCitations?: (citations: Citation[]) => void;
  onDone?: (data: { session_id: number; message_id: number }) => void;
  onError?: (detail: string) => void;
}

declare global {
  interface Window {
    ScrollLensApp?: {
      openServerConfig: () => void;
      getServerUrl?: () => string;
      getAppVersion?: () => string;
      setSystemTheme?: (isDark: boolean) => void;
    };
    __scrollLensHandleBack?: () => boolean;
  }
}
