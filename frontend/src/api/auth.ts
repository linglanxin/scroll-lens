import { apiFetch } from "./client";
import type {
  AdminSettings,
  AuthResponse,
  RegistrationStatus,
  User,
  UserRole,
} from "../types/api";

export const authApi = {
  registrationStatus: () =>
    apiFetch<RegistrationStatus>("/api/v1/auth/registration-status", {}, true),

  register: (username: string, password: string, inviteCode = "") =>
    apiFetch<AuthResponse>(
      "/api/v1/auth/register",
      {
        method: "POST",
        body: JSON.stringify({ username, password, invite_code: inviteCode }),
      },
      true
    ),

  login: (username: string, password: string) =>
    apiFetch<AuthResponse>(
      "/api/v1/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ username, password }),
      },
      true
    ),

  me: () => apiFetch<User>("/api/v1/auth/me"),

  getAdminSettings: () => apiFetch<AdminSettings>("/api/v1/admin/settings"),

  updateAdminSettings: (patch: Partial<AdminSettings>) =>
    apiFetch<AdminSettings>("/api/v1/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  listUsers: () => apiFetch<User[]>("/api/v1/admin/users"),

  updateUser: (userId: number, patch: { is_active?: boolean; role?: UserRole }) =>
    apiFetch<User>(`/api/v1/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};
