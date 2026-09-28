import { baseApi } from './baseApi';

export interface HealthResponse {
  status: string;
  db: string;
}

export const healthApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getHealth: build.query<HealthResponse, void>({
      query: () => '/health',
      providesTags: ['Health'],
    }),
  }),
  overrideExisting: false,
});

export const { useGetHealthQuery } = healthApi;