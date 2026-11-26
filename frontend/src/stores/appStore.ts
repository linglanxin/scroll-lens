import { create } from "zustand";
import { booksApi } from "../api/books";
import { documentsApi } from "../api/documents";
import { providersApi } from "../api/providers";
import type {
  AppMode,
  Book,
  DocumentItem,
  ProviderItem,
  ProviderPreset,
} from "../types/api";

export type RightPanelTab = "volumes" | "reader" | "aliases" | "wiki";
export type ActiveView = "workspace" | "settings";
export type ThemeMode = "light" | "dark";

const THEME_KEY = "scroll_lens_theme";

function loadInitialTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_KEY);
  const theme: ThemeMode = saved === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  return theme;
}

interface AppState {
  mode: AppMode;
  activeView: ActiveView;
  theme: ThemeMode;
  mobileSidebarOpen: boolean;
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab;

  books: Book[];
  docs: DocumentItem[];
  providers: ProviderItem[];
  presets: ProviderPreset[];

  selectedBookId: number | null;
  selectedDocId: number | null;
  selectedProviderId: number | null;

  loadingBooks: boolean;
  loadingDocs: boolean;
  uploading: boolean;
  actionError: string | null;

  setMode: (mode: AppMode) => void;
  setActiveView: (view: ActiveView) => void;
  toggleTheme: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  selectBook: (bookId: number | null) => void;
  selectDoc: (docId: number | null) => void;
  selectProvider: (providerId: number | null) => void;
  clearActionError: () => void;

  loadAll: () => Promise<void>;
  refreshBooks: () => Promise<void>;
  refreshDocs: () => Promise<void>;
  refreshProviders: () => Promise<void>;

  uploadBook: (file: File, title?: string, author?: string) => Promise<Book>;
  appendBook: (bookId: number, file: File) => Promise<{ appended_chapters: number }>;
  deleteBook: (bookId: number) => Promise<void>;
  updateReadProgress: (bookId: number, chapterNum: number) => Promise<void>;

  uploadDoc: (file: File) => Promise<DocumentItem>;
  deleteDoc: (docId: number) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  mode: "novel",
  activeView: "workspace",
  theme: loadInitialTheme(),
  mobileSidebarOpen: false,
  rightPanelOpen: true,
  rightPanelTab: "volumes",

  books: [],
  docs: [],
  providers: [],
  presets: [],

  selectedBookId: null,
  selectedDocId: null,
  selectedProviderId: null,

  loadingBooks: false,
  loadingDocs: false,
  uploading: false,
  actionError: null,

  setMode: (mode) => set({ mode, mobileSidebarOpen: false }),
  setActiveView: (activeView) => set({ activeView, mobileSidebarOpen: false }),
  toggleTheme: () => {
    const next: ThemeMode = get().theme === "light" ? "dark" : "light";
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.dataset.theme = next;
    set({ theme: next });
  },
  setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
  setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab, rightPanelOpen: true }),
  selectBook: (selectedBookId) => set({ selectedBookId, mobileSidebarOpen: false }),
  selectDoc: (selectedDocId) => set({ selectedDocId, mobileSidebarOpen: false }),
  selectProvider: (selectedProviderId) => set({ selectedProviderId }),
  clearActionError: () => set({ actionError: null }),

  loadAll: async () => {
    await Promise.all([
      get().refreshBooks(),
      get().refreshDocs(),
      get().refreshProviders(),
      providersApi
        .presets()
        .then((presets) => set({ presets }))
        .catch(() => {}),
    ]);
  },

  refreshBooks: async () => {
    set({ loadingBooks: true });
    try {
      const books = await booksApi.list();
      const curId = get().selectedBookId;
      const nextId =
        curId && books.some((b) => b.id === curId) ? curId : (books[0]?.id ?? null);
      set({ books, selectedBookId: nextId, loadingBooks: false });
    } catch (err) {
      set({
        loadingBooks: false,
        actionError: err instanceof Error ? err.message : "加载书架失败",
      });
    }
  },

  refreshDocs: async () => {
    set({ loadingDocs: true });
    try {
      const docs = await documentsApi.list();
      const curId = get().selectedDocId;
      const nextId =
        curId && docs.some((d) => d.id === curId) ? curId : (docs[0]?.id ?? null);
      set({ docs, selectedDocId: nextId, loadingDocs: false });
    } catch (err) {
      set({
        loadingDocs: false,
        actionError: err instanceof Error ? err.message : "加载文档列表失败",
      });
    }
  },

  refreshProviders: async () => {
    try {
      const providers = await providersApi.list();
      const cur = get().selectedProviderId;
      const valid = cur && providers.some((p) => p.id === cur);
      const def = providers.find((p) => p.is_default) ?? providers[0];
      set({
        providers,
        selectedProviderId: valid ? cur : (def?.id ?? null),
      });
    } catch {
      // non-fatal
    }
  },

  uploadBook: async (file, title, author) => {
    set({ uploading: true, actionError: null });
    try {
      const book = await booksApi.upload(file, title, author);
      await get().refreshBooks();
      set({ selectedBookId: book.id, uploading: false });
      return book;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "上传书籍失败";
      set({ uploading: false, actionError: msg });
      throw err;
    }
  },

  appendBook: async (bookId, file) => {
    set({ uploading: true, actionError: null });
    try {
      const res = await booksApi.append(bookId, file);
      await get().refreshBooks();
      set({ uploading: false });
      return { appended_chapters: res.appended_chapters };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "追更追加失败";
      set({ uploading: false, actionError: msg });
      throw err;
    }
  },

  deleteBook: async (bookId) => {
    try {
      await booksApi.delete(bookId);
      await get().refreshBooks();
    } catch (err) {
      set({ actionError: err instanceof Error ? err.message : "删除失败" });
    }
  },

  updateReadProgress: async (bookId, chapterNum) => {
    try {
      const updated = await booksApi.updateSettings(bookId, {
        read_progress_ch: chapterNum,
      });
      set((s) => ({
        books: s.books.map((b) => (b.id === bookId ? updated : b)),
      }));
    } catch (err) {
      set({ actionError: err instanceof Error ? err.message : "更新阅读进度失败" });
    }
  },

  uploadDoc: async (file) => {
    set({ uploading: true, actionError: null });
    try {
      const doc = await documentsApi.upload(file);
      await get().refreshDocs();
      set({ selectedDocId: doc.id, uploading: false });
      return doc;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "上传文档失败";
      set({ uploading: false, actionError: msg });
      throw err;
    }
  },

  deleteDoc: async (docId) => {
    try {
      await documentsApi.delete(docId);
      await get().refreshDocs();
    } catch (err) {
      set({ actionError: err instanceof Error ? err.message : "删除文档失败" });
    }
  },
}));
