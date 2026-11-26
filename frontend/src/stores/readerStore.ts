import { create } from "zustand";
import { booksApi } from "../api/books";
import { documentsApi } from "../api/documents";
import type { ChapterDetail, DocPageDetail } from "../types/api";

interface ReaderState {
  chapterData: ChapterDetail | null;
  docPageData: DocPageDetail | null;
  highlightKeyword: string;
  loading: boolean;
  error: string | null;

  openChapter: (bookId: number, chapterNum: number, highlight?: string) => Promise<void>;
  openDocPage: (docId: number, pageNum: number) => Promise<void>;
  clearReader: () => void;
}

export const useReaderStore = create<ReaderState>((set) => ({
  chapterData: null,
  docPageData: null,
  highlightKeyword: "",
  loading: false,
  error: null,

  openChapter: async (bookId, chapterNum, highlight = "") => {
    set({ loading: true, error: null, highlightKeyword: highlight });
    try {
      const chapterData = await booksApi.readChapter(bookId, chapterNum, highlight);
      set({ chapterData, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "加载章节原文失败",
      });
    }
  },

  openDocPage: async (docId, pageNum) => {
    set({ loading: true, error: null });
    try {
      const docPageData = await documentsApi.readPage(docId, pageNum);
      set({ docPageData, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "加载文档页面失败",
      });
    }
  },

  clearReader: () => set({ chapterData: null, docPageData: null, error: null }),
}));
