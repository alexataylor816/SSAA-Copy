import AsyncStorage from '@react-native-async-storage/async-storage';

import { baseApi } from '@/store/api/baseApi';
import { clearCredentials, setCredentials, setHydrated, type AuthUser } from '@/store/authSlice';
import type { AppDispatch } from '@/store/store';

const STORAGE_KEY = 'ssaa_auth';

interface StoredAuth {
  token: string;
  user: AuthUser;
}

export function persistAuth(payload: StoredAuth) {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => {});
}

export function clearPersistedAuth() {
  AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

export async function loadPersistedAuth(dispatch: AppDispatch) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      dispatch(setCredentials(JSON.parse(raw) as StoredAuth));
    }
  } catch {
    // malformed storage — fall through to signed-out state
  } finally {
    dispatch(setHydrated());
  }
}

export function signOut(dispatch: AppDispatch) {
  clearPersistedAuth();
  dispatch(clearCredentials());
  dispatch(baseApi.util.resetApiState());
}
