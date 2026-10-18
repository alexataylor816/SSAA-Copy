/**
 * Invite links that other people open, often on a phone.
 *
 * A phone can't open "localhost", so on a dev PC links use the PC's LAN
 * address (vite.config.ts). VITE_PUBLIC_URL overrides both once the app is
 * hosted somewhere public.
 */
export function shareOrigin(): string {
  const configured = import.meta.env.VITE_PUBLIC_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, "");
  const { hostname, origin } = window.location;
  if ((hostname === "localhost" || hostname === "127.0.0.1") && __SSAA_LAN_ORIGIN__) return __SSAA_LAN_ORIGIN__;
  return origin;
}

/** Opened by a subcontractor to connect their company to a GC's project. */
export const projectJoinUrl = (code: string) => `${shareOrigin()}/join/project/${encodeURIComponent(code)}`;

/** Opened by a new crew member to ask to join a company. */
export const companyJoinUrl = (companyId: string) => `${shareOrigin()}/join/company/${encodeURIComponent(companyId)}`;

/*
 * Where to go once signed in. An invite link may first need sign-in, sign-up
 * and company setup; this remembers the link through all of that (this tab only).
 */
const NEXT_KEY = "ssaa.next";

export function rememberNext(path: string) {
  try {
    sessionStorage.setItem(NEXT_KEY, path);
  } catch {
    // Private mode etc.: the user just lands on the dashboard instead.
  }
}

/** The remembered path (left in place), or null. Only same-site paths count. */
export function peekNext(): string | null {
  try {
    const path = sessionStorage.getItem(NEXT_KEY);
    return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}

export function clearNext() {
  try {
    sessionStorage.removeItem(NEXT_KEY);
  } catch {
    // nothing to clear
  }
}
