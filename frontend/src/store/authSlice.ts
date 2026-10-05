import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
}

export interface AuthState {
  token: string | null;
  user: AuthUser | null;
  hydrated: boolean;
}

const initialState: AuthState = { token: null, user: null, hydrated: false };

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials(state, action: PayloadAction<{ token: string; user: AuthUser }>) {
      state.token = action.payload.token;
      state.user = action.payload.user;
    },
    clearCredentials(state) {
      state.token = null;
      state.user = null;
    },
    setHydrated(state) {
      state.hydrated = true;
    },
  },
});

export const { setCredentials, clearCredentials, setHydrated } = authSlice.actions;
export default authSlice.reducer;
