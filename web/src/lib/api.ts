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
  get: <T,>(path: string, init?: RequestInit) => request<T>(path, init),
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
  phone?: string | null;
  language?: string | null;
  profilePictureUrl?: string | null;
  companyId: string | null;
  isAdmin: boolean;
  /** Snake_case mirrors, because the components ported from the Lovable app
   *  read `profile.full_name` / `profile.company_id`. Both spellings are kept
   *  in sync rather than editing every ported component. */
  full_name?: string | null;
  company_id?: string | null;
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

  /**
   * Exchanges a Google ID token (from Google Identity Services) for our own
   * session. `created` is true when this minted a brand-new SSAA account.
   */
  google: async (credential: string) => {
    const res = await request<{ token: string; user: SessionUser; created: boolean }>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    });
    setToken(res.token);
    return { user: res.user, created: res.created };
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

  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<{ success: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getProfile: () => request<{ employeeNumber: string | null; hasEmployeeRecord: boolean }>("/auth/profile"),
  updateProfile: (body: {
    fullName?: string;
    phone?: string | null;
    language?: string;
    profilePictureUrl?: string | null;
    employeeNumber?: string | null;
  }) =>
    request<{ user: SessionUser; employeeNumber?: string | null }>("/auth/profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};