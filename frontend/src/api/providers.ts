import { apiFetch } from "./client";
import type {
  ProtocolType,
  ProviderCreatePayload,
  ProviderItem,
  ProviderPreset,
  ProviderTestResult,
} from "../types/api";

export const providersApi = {
  presets: () => apiFetch<ProviderPreset[]>("/api/v1/providers/presets", {}, true),

  list: () => apiFetch<ProviderItem[]>("/api/v1/providers"),

  create: (payload: ProviderCreatePayload) =>
    apiFetch<ProviderItem>("/api/v1/providers", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  update: (providerId: number, patch: Partial<ProviderCreatePayload>) =>
    apiFetch<ProviderItem>(`/api/v1/providers/${providerId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  delete: (providerId: number) =>
    apiFetch<{ deleted: boolean; provider_id: number }>(
      `/api/v1/providers/${providerId}`,
      { method: "DELETE" }
    ),

  fetchModels: (
    payload:
      | { provider_id: number }
      | { protocol: ProtocolType; base_url: string; api_key: string }
  ) =>
    apiFetch<{ models: string[] }>("/api/v1/providers/fetch-models", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  test: (
    payload:
      | { provider_id: number }
      | { protocol: ProtocolType; base_url: string; api_key: string; model_name: string }
  ) =>
    apiFetch<ProviderTestResult>("/api/v1/providers/test", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
