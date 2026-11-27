import { apiFetch } from "./client";
import type {
  DocOcrStatus,
  DocPageDetail,
  DocumentDetail,
  DocumentItem,
} from "../types/api";

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

  startOcr: (docId: number, providerId?: number | null, pageNums?: number[]) =>
    apiFetch<{ started: boolean; queued_pages: number[]; total_pages: number }>(
      `/api/v1/docs/${docId}/ocr`,
      {
        method: "POST",
        body: JSON.stringify({
          ...(providerId ? { provider_id: providerId } : {}),
          ...(pageNums && pageNums.length > 0 ? { page_nums: pageNums } : {}),
        }),
      }
    ),

  ocrStatus: (docId: number) =>
    apiFetch<DocOcrStatus>(`/api/v1/docs/${docId}/ocr-status`),

  cancelOcr: (docId: number) =>
    apiFetch<{ cancel_requested: boolean }>(`/api/v1/docs/${docId}/ocr-cancel`, {
      method: "POST",
    }),
};
