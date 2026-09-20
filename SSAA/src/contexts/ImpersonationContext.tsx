import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';


export type ImpersonationPermissionLevel =
  | 'account_holder' | 'full' | 'partial' | 'level_1' | 'basic' | 'standard';

export interface ImpersonatedUserState {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string;
  company_id: string | null;
  company_name: string | null;
  company_type: 'gc' | 'sub' | null;
  permission_level: ImpersonationPermissionLevel | null;
}

export interface ImpersonatedCompanyState {
  id: string;
  name: string;
  company_type?: 'gc' | 'sub';
  address?: string | null;
  is_guest?: boolean;
  [key: string]: any;
}

interface ImpersonationContextType {
  impersonatedUser: ImpersonatedUserState | null;
  impersonatedCompany: ImpersonatedCompanyState | null;
  setImpersonatedUser: (u: ImpersonatedUserState | null) => void;
  setImpersonatedCompany: (c: ImpersonatedCompanyState | null) => void;
  clearImpersonation: () => void;
}

const USER_KEY = 'ssaa_impersonated_user';
const COMPANY_KEY = 'ssaa_impersonated_company';

type Stored<T> = { ownerUserId: string | null; value: T };

const read = <T,>(key: string): Stored<T> | null => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Legacy (unowned) entries are untrusted — discard them.
    if (!parsed || typeof parsed !== 'object' || !('ownerUserId' in parsed)) return null;
    return parsed as Stored<T>;
  } catch {
    return null;
  }
};

const write = (key: string, ownerUserId: string | null, value: unknown) => {
  try {
    if (value === null || value === undefined || !ownerUserId) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify({ ownerUserId, value }));
  } catch {
    /* ignore */
  }
};

export const clearStoredImpersonation = () => {
  try {
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(COMPANY_KEY);
  } catch {
    /* ignore */
  }
};

const ImpersonationContext = createContext<ImpersonationContextType | undefined>(undefined);

export const ImpersonationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isMOA, loading } = useAuth();
  const [impersonatedUser, setImpersonatedUserState] = useState<ImpersonatedUserState | null>(null);
  const [impersonatedCompany, setImpersonatedCompanyState] = useState<ImpersonatedCompanyState | null>(null);
  const hydratedFor = useRef<string | null>(null);

  // Hydrate stored state only for the operator that created it.
  useEffect(() => {
    if (!user) {
      hydratedFor.current = null;
      clearStoredImpersonation();
      setImpersonatedUserState(null);
      setImpersonatedCompanyState(null);
      return;
    }
    if (hydratedFor.current === user.id) return;
    hydratedFor.current = user.id;

    const su = read<ImpersonatedUserState>(USER_KEY);
    const sc = read<ImpersonatedCompanyState>(COMPANY_KEY);
    const ownedUser = su && su.ownerUserId === user.id ? su.value : null;
    const ownedCompany = sc && sc.ownerUserId === user.id ? sc.value : null;
    if (!ownedUser && !ownedCompany) clearStoredImpersonation();
    setImpersonatedUserState(ownedUser);
    setImpersonatedCompanyState(ownedCompany);
  }, [user?.id]);

  // Only operators may ever impersonate; drop anything else once roles resolve.
  useEffect(() => {
    if (loading || !user) return;
    if (!isMOA && (impersonatedUser || impersonatedCompany)) {
      clearStoredImpersonation();
      setImpersonatedUserState(null);
      setImpersonatedCompanyState(null);
    }
  }, [loading, isMOA, user?.id, impersonatedUser, impersonatedCompany]);

  useEffect(() => { write(USER_KEY, user?.id ?? null, impersonatedUser); }, [impersonatedUser, user?.id]);
  useEffect(() => { write(COMPANY_KEY, user?.id ?? null, impersonatedCompany); }, [impersonatedCompany, user?.id]);

  const clearImpersonation = () => {
    clearStoredImpersonation();
    setImpersonatedUserState(null);
    setImpersonatedCompanyState(null);
  };

  const allowed = !!user && (isMOA || loading);

  return (
    <ImpersonationContext.Provider
      value={{
        impersonatedUser: allowed ? impersonatedUser : null,
        impersonatedCompany: allowed ? impersonatedCompany : null,
        setImpersonatedUser: setImpersonatedUserState,
        setImpersonatedCompany: setImpersonatedCompanyState,
        clearImpersonation,
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
};


export const useImpersonation = () => {
  const ctx = useContext(ImpersonationContext);
  if (!ctx) throw new Error('useImpersonation must be used within an ImpersonationProvider');
  return ctx;
};
