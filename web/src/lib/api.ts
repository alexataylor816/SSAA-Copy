/**
 * Thin wrapper over the Express REST API. The Lovable app leaned on Supabase
 * edge functions for these; here they are ordinary endpoints on our own server.
 */

import { getToken, setToken } from "./supabase";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(payload.error ?? `Request failed with ${res.status}.`, res.status);
  }
  return payload as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
};

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  companyId: string | null;
  isAdmin: boolean;
}

export const authApi = {
  signup: async (body: { email: string; password: string; fullName: string }) => {
    const res = await request<{ token: string; user: SessionUser }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setToken(res.token);
    return res.user;
  },

  /** The backend calls this "signin". */
  login: async (body: { email: string; password: string }) => {
    const res = await request<{ token: string; user: SessionUser }>("/auth/signin", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setToken(res.token);
    return res.user;
  },

  me: () => request<{ user: SessionUser }>("/auth/me"),

  logout: () => setToken(null),

  requestPasswordReset: (email: string) =>
    request<{ success: boolean; devCode?: string }>("/auth/request-password-reset", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  verifyResetCode: (body: { email: string; code: string; newPassword: string }) =>
    request<{ success: boolean }>("/auth/verify-reset-code", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Always resolves; `delivered` is false when no email provider is configured. */
  requestUsernameReminder: (email: string) =>
    request<{ success: boolean; delivered: boolean }>("/auth/request-username-reminder", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
};