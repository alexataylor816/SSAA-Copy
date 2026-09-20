import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type PermissionLevel = Database['public']['Enums']['permission_level'];

interface Profile {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: 'moa' | 'admin' | 'project_manager' | 'superintendent' | 'worker';
  company_id: string | null;
  force_password_change: boolean;
  language: string;
}

interface UserRole {
  id: string;
  user_id: string;
  company_id: string | null;
  permission_level: PermissionLevel;
  is_company_creator: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  userRole: UserRole | null;
  loading: boolean;
  rolesLoading: boolean;
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null; data: { user: User | null } | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  waitForAccountHolder: (companyId: string, timeoutMs?: number) => Promise<boolean>;
  isMOA: boolean;
  isAccountHolder: boolean;
  hasPartialOrHigher: boolean;
  hasLevel1OrHigher: boolean;
  isBasicUser: boolean;
  permissionLevel: PermissionLevel | null;
  isOMO: boolean;
  isReadOnlyOperator: boolean;
  isMainOperator: boolean;
  operatorLevel: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [operatorLevel, setOperatorLevel] = useState<string | null>(null);
  const userRoleRef = useRef<UserRole | null>(null);
  const profileRef = useRef<Profile | null>(null);
  useEffect(() => { userRoleRef.current = userRole; }, [userRole]);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }
    return data as Profile | null;
  };

  const fetchUserRole = async (userId: string, companyId: string | null) => {
    if (!companyId) return null;
    
    const { data, error } = await supabase
      .from('user_roles')
      .select('*')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .maybeSingle();
    
    if (error) {
      console.error('Error fetching user role:', error);
      return null;
    }
    return data as UserRole | null;
  };

  const fetchOperatorLevel = async (userId: string) => {
    const { data, error } = await supabase
      .from('operators')
      .select('operator_level')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (error) {
      setOperatorLevel(null);
      return null;
    }
    const level = data?.operator_level || null;
    setOperatorLevel(level);
    return level;
  };

  const loadUserData = async (userId: string) => {
    setRolesLoading(true);
    const profileData = await fetchProfile(userId);
    setProfile(profileData);
    let roleData: UserRole | null = null;

    if (profileData?.company_id) {
      // Retry with backoff so a freshly created user_roles row (right after
      // onboarding/company creation) is reliably picked up before any UI
      // makes permission decisions. The realtime subscription below will also
      // re-trigger loadUserData when the row eventually arrives, so this is
      // belt-and-suspenders against the post-signup race condition that
      // caused "Manage My Company Account" to be missing on first load.
      roleData = await fetchUserRole(userId, profileData.company_id);
      for (let i = 0; i < 40 && !roleData; i++) {
        await new Promise(r => setTimeout(r, 250));
        roleData = await fetchUserRole(userId, profileData.company_id);
      }
      setUserRole(roleData);
    } else {
      setUserRole(null);
    }

    // Check operator status for ALL users (not just moa) so we catch
    // users who were just promoted but profile hasn't reflected yet
    await fetchOperatorLevel(userId);
    setRolesLoading(false);
    return { profileData, roleData };
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        setTimeout(async () => {
          await loadUserData(session.user.id);
          setLoading(false);
        }, 0);
      } else {
        setProfile(null);
        setUserRole(null);
        setOperatorLevel(null);
        setRolesLoading(false);
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        loadUserData(session.user.id).then(() => {
          setLoading(false);
          setInitializing(false);
        });
      } else {
        setRolesLoading(false);
        setLoading(false);
        setInitializing(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Subscribe to profile and operator changes for live refresh
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('profile-operator-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `user_id=eq.${user.id}`,
        },
        async () => {
          await loadUserData(user.id);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'operators',
          filter: `user_id=eq.${user.id}`,
        },
        async () => {
          await loadUserData(user.id);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_roles',
          filter: `user_id=eq.${user.id}`,
        },
        async () => {
          await loadUserData(user.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    return { error };
  };

  const signUp = async (email: string, password: string, fullName?: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const { error, data } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName }
      }
    });
    return { error, data: data ? { user: data.user } : null };
  };

  const signOut = async () => {
    try {
      sessionStorage.removeItem('ssaa_impersonated_user');
      sessionStorage.removeItem('ssaa_impersonated_company');
    } catch { /* ignore */ }
    await supabase.auth.signOut();
    setProfile(null);
    setUserRole(null);
    setOperatorLevel(null);
  };


  const refreshProfile = async () => {
    const uid = user?.id || session?.user?.id;
    if (!uid) return;
    await loadUserData(uid);
  };

  const waitForAccountHolder = async (companyId: string, timeoutMs = 30000): Promise<boolean> => {
    const start = Date.now();
    const isHolder = (r: UserRole | null) =>
      !!r && r.company_id === companyId && (r.permission_level === 'account_holder' || r.is_company_creator === true);
    while (Date.now() - start < timeoutMs) {
      if (isHolder(userRoleRef.current) && profileRef.current?.company_id === companyId) return true;
      const uid = user?.id || session?.user?.id;
      if (uid) {
        const fresh = await loadUserData(uid);
        if (isHolder(fresh.roleData) && fresh.profileData?.company_id === companyId) return true;
        if (isHolder(userRoleRef.current) && profileRef.current?.company_id === companyId) return true;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return isHolder(userRoleRef.current) && profileRef.current?.company_id === companyId;
  };

  const isMOA = profile?.role === 'moa';
  const isAccountHolder = userRole?.permission_level === 'account_holder' || userRole?.is_company_creator === true;
  const hasPartialOrHigher = isMOA || ['partial', 'full', 'account_holder'].includes(userRole?.permission_level || '');
  const hasLevel1OrHigher = isMOA || ['level_1', 'partial', 'full', 'account_holder'].includes(userRole?.permission_level || '');
  const isBasicUser = userRole?.permission_level === 'basic' || userRole?.permission_level === 'standard';
  const permissionLevel = userRole?.permission_level || null;
  
  const isOMO = isMOA && profile?.email?.toLowerCase() === 'lukepaaron@gmail.com';
  const isReadOnlyOperator = isMOA && operatorLevel === 'operator';
  const isMainOperator = isMOA && operatorLevel === 'main_operator';

  return (
    <AuthContext.Provider value={{ 
      user, 
      session, 
      profile, 
      userRole,
      loading, 
      rolesLoading,
      initializing, 
      signIn, 
      signUp, 
      signOut, 
      refreshProfile,
      waitForAccountHolder,
      isMOA,
      isAccountHolder,
      hasPartialOrHigher,
      hasLevel1OrHigher,
      isBasicUser,
      permissionLevel,
      isOMO,
      isReadOnlyOperator,
      isMainOperator,
      operatorLevel
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
