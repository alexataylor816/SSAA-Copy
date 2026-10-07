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

export interface RequestPasswordResetRequest {
  email: string;
}

export interface RequestPasswordResetResponse {
  success: true;
  /** Dev-only: the backend has no email provider yet, so it echoes the code back. */
  devCode?: string;
}

export interface VerifyResetCodeRequest {
  email: string;
  code: string;
  newPassword: string;
}

export interface RequestUsernameReminderRequest {
  email: string;
}

export interface RequestUsernameReminderResponse {
  success: true;
  /** False when the server has no email provider configured. */
  delivered: boolean;
}

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    signUp: build.mutation<AuthResponse, SignUpRequest>({
      query: (body) => ({ url: '/auth/signup', method: 'POST', body }),
    }),
    signIn: build.mutation<AuthResponse, SignInRequest>({
      query: (body) => ({ url: '/auth/signin', method: 'POST', body }),
    }),
    requestPasswordReset: build.mutation<RequestPasswordResetResponse, RequestPasswordResetRequest>({
      query: (body) => ({ url: '/auth/request-password-reset', method: 'POST', body }),
    }),
    verifyResetCode: build.mutation<{ success: true }, VerifyResetCodeRequest>({
      query: (body) => ({ url: '/auth/verify-reset-code', method: 'POST', body }),
    }),
    requestUsernameReminder: build.mutation<RequestUsernameReminderResponse, RequestUsernameReminderRequest>({
      query: (body) => ({ url: '/auth/request-username-reminder', method: 'POST', body }),
    }),
  }),
  overrideExisting: false,
});

export const {
  useSignUpMutation,
  useSignInMutation,
  useRequestPasswordResetMutation,
  useVerifyResetCodeMutation,
  useRequestUsernameReminderMutation,
} = authApi;
