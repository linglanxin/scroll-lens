import { apiFetch } from "./client";
import type {
  AliasItem,
  Book,
  BookDetail,
  ChapterDetail,
  ChapterListResponse,
  DiscoveredEntity,
  NovelCard,
  NovelCardType,
  Volume,
  VolumeSplitItem,
  VolumeStatusResponse,
  WikiNote,
} from "../types/api";

export const booksApi = {
  list: () => apiFetch<Book[]>("/api/v1/books"),

  get: (bookId: number) => apiFetch<BookDetail>(`/api/v1/books/${bookId}`),

  upload: (file: File, title?: string, author?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (title?.trim()) fd.append("title", title.trim());
    if (author?.trim()) fd.append("author", author.trim());
    return apiFetch<Book>("/api/v1/books", { method: "POST", body: fd });
  },

  append: (bookId: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiFetch<{ appended_chapters: number; new_total_chapters: number; book: Book }>(
      `/api/v1/books/${bookId}/append`,
      { method: "POST", body: fd }
    );
  },

  delete: (bookId: number) =>
    apiFetch<{ deleted: boolean; book_id: number }>(`/api/v1/books/${bookId}`, {
      method: "DELETE",
    }),

  updateSettings: (
    bookId: number,
    patch: { title?: string; author?: string; read_progress_ch?: number }
  ) =>
    apiFetch<Book>(`/api/v1/books/${bookId}/settings`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  listVolumes: (bookId: number) => apiFetch<Volume[]>(`/api/v1/books/${bookId}/volumes`),

  splitVolumes: (bookId: number, volumes: VolumeSplitItem[]) =>
    apiFetch<Volume[]>(`/api/v1/books/${bookId}/volumes/split`, {
      method: "POST",
      body: JSON.stringify({ volumes }),
    }),

  summarizeVolume: (bookId: number, volumeId: number, providerId?: number | null) =>
    apiFetch<{ started: boolean; queued_volume_ids: number[] }>(
      `/api/v1/books/${bookId}/volumes/${volumeId}/summarize`,
      {
        method: "POST",
        body: JSON.stringify(providerId ? { provider_id: providerId } : {}),
      }
    ),

  summarizeAll: (bookId: number, providerId?: number | null) =>
    apiFetch<{ started: boolean; queued_volume_ids: number[]; message?: string }>(
      `/api/v1/books/${bookId}/volumes/summarize-all`,
      {
        method: "POST",
        body: JSON.stringify(providerId ? { provider_id: providerId } : {}),
      }
    ),

  pauseSummarize: (bookId: number) =>
    apiFetch<{ pause_requested: boolean }>(
      `/api/v1/books/${bookId}/volumes/summarize-pause`,
      { method: "POST" }
    ),

  summarizeStatus: (bookId: number) =>
    apiFetch<VolumeStatusResponse>(`/api/v1/books/${bookId}/volumes/summarize-status`),

  listChapters: (bookId: number, page = 1, pageSize = 50, volumeId?: number) => {
    const qs = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    if (volumeId !== undefined) qs.set("volume_id", String(volumeId));
    return apiFetch<ChapterListResponse>(`/api/v1/books/${bookId}/chapters?${qs}`);
  },

  readChapter: (bookId: number, chapterNum: number, highlight?: string) => {
    const qs = highlight?.trim()
      ? `?highlight=${encodeURIComponent(highlight.trim())}`
      : "";
    return apiFetch<ChapterDetail>(`/api/v1/books/${bookId}/chapters/${chapterNum}${qs}`);
  },

  listAliases: (bookId: number) => apiFetch<AliasItem[]>(`/api/v1/books/${bookId}/aliases`),

  upsertAlias: (
    bookId: number,
    canonicalName: string,
    aliases: string[],
    reindex = true
  ) =>
    apiFetch<AliasItem>(`/api/v1/books/${bookId}/aliases`, {
      method: "POST",
      body: JSON.stringify({
        canonical_name: canonicalName,
        aliases,
        reindex,
      }),
    }),

  deleteAlias: (bookId: number, aliasId: number) =>
    apiFetch<{ deleted: boolean }>(`/api/v1/books/${bookId}/aliases/${aliasId}`, {
      method: "DELETE",
    }),

  reindexAliases: (bookId: number) =>
    apiFetch<{ reindexed_chapters: number }>(`/api/v1/books/${bookId}/aliases/reindex`, {
      method: "POST",
    }),

  listWiki: (bookId: number) => apiFetch<WikiNote[]>(`/api/v1/books/${bookId}/wiki`),

  upsertWiki: (
    bookId: number,
    payload: {
      entity_name: string;
      category: string;
      content_md: string;
      source_chapters: number[];
    }
  ) =>
    apiFetch<WikiNote>(`/api/v1/books/${bookId}/wiki`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteWiki: (bookId: number, wikiId: number) =>
    apiFetch<{ deleted: boolean }>(`/api/v1/books/${bookId}/wiki/${wikiId}`, {
      method: "DELETE",
    }),

  listCards: (bookId: number, cardType?: NovelCardType) => {
    const qs = new URLSearchParams({ include_activity: "true" });
    if (cardType) qs.set("card_type", cardType);
    return apiFetch<NovelCard[]>(`/api/v1/books/${bookId}/cards?${qs}`);
  },

  getCard: (bookId: number, cardId: number) =>
    apiFetch<NovelCard>(`/api/v1/books/${bookId}/cards/${cardId}`),

  generateCard: (
    bookId: number,
    payload: {
      query_name: string;
      card_type?: NovelCardType;
      provider_id?: number | null;
      max_chapter?: number | null;
      card_id?: number;
    }
  ) =>
    apiFetch<NovelCard>(`/api/v1/books/${bookId}/cards/generate`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  discoverCards: (
    bookId: number,
    payload?: { provider_id?: number | null; max_chapter?: number | null }
  ) =>
    apiFetch<{ candidates: DiscoveredEntity[] }>(`/api/v1/books/${bookId}/cards/discover`, {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    }),

  updateCard: (
    bookId: number,
    cardId: number,
    payload: Partial<
      Pick<
        NovelCard,
        | "card_type"
        | "real_name"
        | "role_badge"
        | "aliases"
        | "titles"
        | "status_summary"
        | "summary"
        | "attributes"
        | "timeline"
        | "relations"
      >
    >
  ) =>
    apiFetch<NovelCard>(`/api/v1/books/${bookId}/cards/${cardId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  syncCardAliases: (bookId: number, cardId: number) =>
    apiFetch<{ canonical_name: string; aliases: string[]; reindexed_chapters: number }>(
      `/api/v1/books/${bookId}/cards/${cardId}/sync-aliases`,
      { method: "POST" }
    ),

  deleteCard: (bookId: number, cardId: number) =>
    apiFetch<{ deleted: boolean; card_id: number }>(
      `/api/v1/books/${bookId}/cards/${cardId}`,
      { method: "DELETE" }
    ),
};
