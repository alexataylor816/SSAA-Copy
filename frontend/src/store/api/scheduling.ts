import { baseApi } from './baseApi';

export interface Project {
  id: string;
  name: string;
  address: string | null;
  companyId: string;
  connectionCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface Availability {
  id: string;
  employeeId: string;
  projectId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  allProjects: boolean;
  createdAt: string;
}

export type ScheduleRequestStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

export interface ScheduleRequest {
  id: string;
  projectId: string;
  requestingCompanyId: string;
  subCompanyId: string;
  employeeIds: string[];
  date: string;
  startTime: string | null;
  endTime: string | null;
  description: string | null;
  status: ScheduleRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export const schedulingApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listProjects: build.query<{ projects: Project[] }, void>({
      query: () => '/projects',
      providesTags: ['Projects'],
    }),
    createProject: build.mutation<Project, { name: string; address?: string }>({
      query: (body) => ({ url: '/projects', method: 'POST', body }),
      invalidatesTags: ['Projects'],
    }),
    connectProject: build.mutation<Project, { code: string }>({
      query: (body) => ({ url: '/projects/connect', method: 'POST', body }),
      invalidatesTags: ['Projects'],
    }),
    listAvailability: build.query<{ availability: Availability[] }, { start: string; end: string }>({
      query: ({ start, end }) => `/availability?start=${start}&end=${end}`,
      providesTags: ['Availability'],
    }),
    setAvailability: build.mutation<
      Availability,
      { date: string; startTime: string; endTime: string; projectId?: string; allProjects?: boolean }
    >({
      query: (body) => ({ url: '/availability', method: 'POST', body }),
      invalidatesTags: ['Availability'],
    }),
    deleteAvailability: build.mutation<{ success: true }, { id: string }>({
      query: ({ id }) => ({ url: `/availability/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Availability'],
    }),
    listProjectConnections: build.query<{ companies: { id: string; name: string }[] }, { projectId: string }>({
      query: ({ projectId }) => `/projects/${projectId}/connections`,
      providesTags: ['Projects'],
    }),
    listScheduleRequests: build.query<{ requests: ScheduleRequest[] }, { start: string; end: string }>({
      query: ({ start, end }) => `/schedule-requests?start=${start}&end=${end}`,
      providesTags: ['ScheduleRequests'],
    }),
    createScheduleRequest: build.mutation<
      ScheduleRequest,
      {
        projectId: string;
        subCompanyId: string;
        employeeIds: string[];
        date: string;
        startTime?: string;
        endTime?: string;
        description?: string;
      }
    >({
      query: (body) => ({ url: '/schedule-requests', method: 'POST', body }),
      invalidatesTags: ['ScheduleRequests'],
    }),
    updateScheduleRequestStatus: build.mutation<ScheduleRequest, { id: string; status: ScheduleRequestStatus }>({
      query: ({ id, status }) => ({ url: `/schedule-requests/${id}`, method: 'PATCH', body: { status } }),
      invalidatesTags: ['ScheduleRequests'],
    }),
  }),
  overrideExisting: false,
});

export const {
  useListProjectsQuery,
  useCreateProjectMutation,
  useConnectProjectMutation,
  useListAvailabilityQuery,
  useSetAvailabilityMutation,
  useDeleteAvailabilityMutation,
  useListProjectConnectionsQuery,
  useListScheduleRequestsQuery,
  useCreateScheduleRequestMutation,
  useUpdateScheduleRequestStatusMutation,
} = schedulingApi;
