import { apiFetch } from "./client";
import type { DocPageDetail, DocumentDetail, DocumentItem } from "../types/api";

export const documentsApi = {
  list: () => apiFetch<DocumentItem[]>("/api/v1/docs"),

  get: (docId: number) => apiFetch<DocumentDetail>(`/api/v1/docs/${docId}`),

  upload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiFetch<DocumentItem>("/api/v1/docs", { method: "POST", body: fd });
  },

  delete: (docId: number) =>
    apiFetch<{ deleted: boolean; doc_id: number }>(`/api/v1/docs/${docId}`, {
      method: "DELETE",
    }),

  readPage: (docId: number, pageNum: number) =>
    apiFetch<DocPageDetail>(`/api/v1/docs/${docId}/pages/${pageNum}`),
};
