import type { AuthUser } from '@/store/authSlice';

import { baseApi } from './baseApi';

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface SignUpRequest {
  email: string;
  password: string;
  fullName: string;
}

export interface SignInRequest {
  email: string;
  password: string;
}

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    signUp: build.mutation<AuthResponse, SignUpRequest>({
      query: (body) => ({ url: '/auth/signup', method: 'POST', body }),
    }),
    signIn: build.mutation<AuthResponse, SignInRequest>({
      query: (body) => ({ url: '/auth/signin', method: 'POST', body }),
    }),
  }),
  overrideExisting: false,
});

export const { useSignUpMutation, useSignInMutation } = authApi;
