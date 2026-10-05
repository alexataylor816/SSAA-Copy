/**
 * Mirrors the Lovable `AuthContext` interface so ported components keep working,
 * but resolves everything against the Express backend instead of Supabase.
 *
 * Note the deliberate difference: Postgres had a separate `profiles` table, while
 * our backend keeps that data on `users`. The shape exposed here is unchanged.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { authApi, type SessionUser } from "@/lib/api";
import { getToken, onAuthChange, setToken, supabase } from "@/lib/supabase";

export type PermissionLevel = "basic" | "standard" | "level_1" | "partial" | "full" | "account_holder";

export interface UserRole {
  id: string;
  user_id: string;
  company_id: string | null;
  permission_level: PermissionLevel;
  is_company_creator: boolean;
}

interface AuthContextValue {
  user: SessionUser | null;
  profile: SessionUser | null;
  userRole: UserRole | null;
  loading: boolean;
  rolesLoading: boolean;
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  waitForAccountHolder: (companyId: string, timeoutMs?: number) => Promise<boolean>;
  isMOA: boolean;
  isAccountHolder: boolean;
  hasPartialOrHigher: boolean;
  hasLevel1OrHigher: boolean;
  isBasicUser: boolean;
  permissionLevel: PermissionLevel | null;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  company_id: string | null;
  is_admin: number | boolean;
}

/** `/query` speaks snake_case; the rest of the web app uses camelCase. */
function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    companyId: row.company_id,
    isAdmin: row.is_admin === true || row.is_admin === 1,
  };
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const userRoleRef = useRef<UserRole | null>(null);

  useEffect(() => {
    userRoleRef.current = userRole;
  }, [userRole]);

  const fetchUserRole = useCallback(async (userId: string, companyId: string | null) => {
    if (!companyId) return null;
    return (await supabase
      .from("user_roles")
      .select("*")
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .maybeSingle()) as UserRole | null;
  }, []);

  const loadUserData = useCallback(
    async (userId: string) => {
      setRolesLoading(true);
      const row = (await supabase.from("users").select("*").eq("id", userId).maybeSingle()) as UserRow | null;
      const profileData = row ? toSessionUser(row) : null;
      setUser(profileData);

      let roleData: UserRole | null = null;
      if (profileData?.companyId) {
        // The user_roles row is written moments after a company is created, so
        // poll briefly rather than rendering "no permissions" on first paint.
        roleData = await fetchUserRole(userId, profileData.companyId);
        for (let i = 0; i < 20 && !roleData; i++) {
          await new Promise((r) => setTimeout(r, 250));
          roleData = await fetchUserRole(userId, profileData.companyId);
        }
      }
      setUserRole(roleData);
      setRolesLoading(false);
      return { profileData, roleData };
    },
    [fetchUserRole],
  );

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!getToken()) {
        if (!cancelled) {
          setLoading(false);
          setInitializing(false);
          setRolesLoading(false);
        }
        return;
      }
      try {
        const { user: sessionUser } = await authApi.me();
        if (cancelled) return;
        setUser(sessionUser);
        await loadUserData(sessionUser.id);
      } catch {
        // Token expired or revoked: drop it rather than looping on 401s.
        setToken(null);
        setUser(null);
        setUserRole(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setInitializing(false);
        }
      }
    }

    void restore();
    return onAuthChange((token) => {
      if (!token) {
        setUser(null);
        setUserRole(null);
        setLoading(false);
        setInitializing(false);
      }
    });
  }, [loadUserData]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const sessionUser = await authApi.login({ email: email.trim().toLowerCase(), password });
      setUser(sessionUser);
      await loadUserData(sessionUser.id);
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error("Could not sign in.") };
    }
  }, [loadUserData]);

  const signUp = useCallback(
    async (email: string, password: string, fullName?: string) => {
      try {
        const sessionUser = await authApi.signup({
          email: email.trim().toLowerCase(),
          password,
          fullName: fullName ?? "",
        });
        setUser(sessionUser);
        await loadUserData(sessionUser.id);
        return { error: null };
      } catch (err) {
        return { error: err instanceof Error ? err : new Error("Could not create that account.") };
      }
    },
    [loadUserData],
  );

  const signOut = useCallback(async () => {
    authApi.logout();
    userRoleRef.current = null;
    setUser(null);
    setUserRole(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const uid = user?.id;
    if (uid) await loadUserData(uid);
  }, [user, loadUserData]);

  const waitForAccountHolder = useCallback(
    async (companyId: string, timeoutMs = 30000): Promise<boolean> => {
      const isHolder = (role: UserRole | null) =>
        !!role && role.company_id === companyId && role.permission_level === "account_holder";
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (isHolder(userRoleRef.current)) return true;
        if (user?.id) {
          const fresh = await loadUserData(user.id);
          if (isHolder(fresh.roleData)) return true;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return isHolder(userRoleRef.current);
    },
    [user, loadUserData],
  );

  const value = useMemo<AuthContextValue>(() => {
    const permissionLevel = userRole?.permission_level ?? null;
    return {
      user,
      profile: user,
      userRole,
      loading,
      rolesLoading,
      initializing,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      waitForAccountHolder,
      // Our backend has no MOA role; admins are the closest equivalent and are
      // resolved server-side in `/capabilities`.
      isMOA: user?.isAdmin ?? false,
      isAccountHolder: permissionLevel === "account_holder",
      hasPartialOrHigher: !!permissionLevel && ["partial", "full", "account_holder"].includes(permissionLevel),
      hasLevel1OrHigher:
        !!permissionLevel && ["level_1", "partial", "full", "account_holder"].includes(permissionLevel),
      isBasicUser: permissionLevel === "basic" || permissionLevel === "standard",
      permissionLevel,
    };
  }, [user, userRole, loading, rolesLoading, initializing, signIn, signUp, signOut, refreshProfile, waitForAccountHolder]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}