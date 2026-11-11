/**
 * Operator "view as" (Luke's impersonation): the operator gets a session for another user from
 * POST /admin/view-as and sees the app exactly as they do. The operator's own session is kept here so
 * "Exit" goes straight back to the operator dashboard.
 */
import { api } from "@/lib/api";
import { getToken, setToken } from "@/lib/supabase";

const OPERATOR_TOKEN_KEY = "ssaa.operatorToken";
const VIEWING_AS_KEY = "ssaa.viewingAs";

export interface ViewAsTarget {
  userId: string;
  name: string;
  email: string;
  companyName: string | null;
}

const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private browsing: view-as still works for this page load */
  }
};

/** The `act` claim: set only on a view-as session. Decoding (not verifying) is enough to drive the UI. */
function operatorIdIn(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.act === "string" ? payload.act : null;
  } catch {
    return null;
  }
}

/** Who the operator is viewing as right now, or null. */
export function currentViewAs(): ViewAsTarget | null {
  if (!operatorIdIn(getToken())) return null;
  try {
    return JSON.parse(read(VIEWING_AS_KEY) ?? "null") as ViewAsTarget | null;
  } catch {
    return null;
  }
}

export function isViewingAs(): boolean {
  return operatorIdIn(getToken()) !== null;
}

/** A view-only operator's session: the server refuses every change, so the banner says so up front. */
export function isReadOnlyViewAs(): boolean {
  const token = getToken();
  if (!operatorIdIn(token)) return false;
  try {
    return JSON.parse(atob(token!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).ro === true;
  } catch {
    return false;
  }
}

export async function startViewAs(target: ViewAsTarget): Promise<void> {
  const { token } = await api.post<{ token: string }>("/admin/view-as", { userId: target.userId });
  write(OPERATOR_TOKEN_KEY, getToken());
  write(VIEWING_AS_KEY, JSON.stringify(target));
  setToken(token);
  // A full reload so every page and cache starts fresh as the new person.
  window.location.assign("/dashboard");
}

export function exitViewAs(): void {
  const operatorToken = read(OPERATOR_TOKEN_KEY);
  clearViewAs();
  setToken(operatorToken);
  window.location.assign(operatorToken ? "/operator" : "/signin");
}

export function clearViewAs(): void {
  write(OPERATOR_TOKEN_KEY, null);
  write(VIEWING_AS_KEY, null);
}
