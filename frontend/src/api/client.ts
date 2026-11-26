export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const TOKEN_STORAGE_KEY = "scroll_lens_token";

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  skipAuth = false
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!skipAuth) {
    const token = getStoredToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (!isFormData && options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const resp = await fetch(path, { ...options, headers });
  if (resp.status === 401 && !skipAuth && unauthorizedHandler) {
    unauthorizedHandler();
  }

  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const errJson = (await resp.json()) as { detail?: string };
      if (errJson.detail) detail = errJson.detail;
    } catch {
      const txt = await resp.text().catch(() => "");
      if (txt) detail = txt.slice(0, 200);
    }
    throw new ApiError(resp.status, detail);
  }

  return (await resp.json()) as T;
}
