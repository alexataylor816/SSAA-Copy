import { baseApi } from './baseApi';

export type CompanyType = 'gc' | 'sub';
export type PermissionLevel = 'basic' | 'level_1' | 'partial' | 'full' | 'account_holder';

export interface Company {
  id: string;
  name: string;
  companyType: CompanyType;
  address: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserRole {
  id: string;
  userId: string;
  companyId: string;
  permissionLevel: PermissionLevel;
  isCompanyCreator: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JoinRequest {
  id: string;
  userId: string;
  companyId: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

export interface CompanyMember {
  userId: string;
  email: string;
  fullName: string;
  permissionLevel: PermissionLevel;
  isCompanyCreator: boolean;
}

export interface Employee {
  id: string;
  companyId: string;
  name: string;
  email: string | null;
  phone: string | null;
  linkedUserId: string | null;
  createdAt: string;
}

/**
 * Resolved server-side so the UI stops re-deriving permissions and guessing
 * wrong (a `partial` user used to see join-request controls that always 403'd).
 */
export interface UserCapabilities {
  canApproveJoinRequests: boolean;
  canRemoveAnyAvailability: boolean;
  canSchedulePeople: boolean;
  canRespondToScheduleRequests: boolean;
  canManageTeam: boolean;
  isReadOnlyScheduling: boolean;
}

export interface UserContext {
  isAdmin: boolean;
  company: Company | null;
  permissionLevel: PermissionLevel | null;
  isAccountHolder: boolean;
  hasPartialOrHigher: boolean;
  hasLevel1OrHigher: boolean;
  isBasicUser: boolean;
  visiblePermissions: PermissionLevel[];
  capabilities: UserCapabilities;
}

export const rbacApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getMe: build.query<UserContext, void>({
      query: () => '/rbac/me',
      providesTags: ['Me'],
    }),
    listCompanies: build.query<{ companies: Company[] }, { type: CompanyType }>({
      query: ({ type }) => `/companies?type=${type}`,
    }),
    createCompany: build.mutation<
      { company: Company; role: UserRole },
      { name: string; companyType: CompanyType; address?: string }
    >({
      query: (body) => ({ url: '/companies', method: 'POST', body }),
      invalidatesTags: ['Me'],
    }),
    requestJoinCompany: build.mutation<JoinRequest, { companyId: string }>({
      query: ({ companyId }) => ({ url: `/companies/${companyId}/join-requests`, method: 'POST' }),
    }),
    listJoinRequests: build.query<{ requests: JoinRequest[] }, { companyId: string }>({
      query: ({ companyId }) => `/companies/${companyId}/join-requests`,
      providesTags: ['JoinRequests'],
    }),
    approveJoinRequest: build.mutation<
      UserRole,
      { companyId: string; requestId: string; permissionLevel: PermissionLevel }
    >({
      query: ({ companyId, requestId, permissionLevel }) => ({
        url: `/companies/${companyId}/join-requests/${requestId}/approve`,
        method: 'POST',
        body: { permissionLevel },
      }),
      invalidatesTags: ['JoinRequests', 'Members'],
    }),
    rejectJoinRequest: build.mutation<{ success: true }, { companyId: string; requestId: string }>({
      query: ({ companyId, requestId }) => ({
        url: `/companies/${companyId}/join-requests/${requestId}/reject`,
        method: 'POST',
      }),
      invalidatesTags: ['JoinRequests'],
    }),
    listCompanyMembers: build.query<{ members: CompanyMember[] }, { companyId: string }>({
      query: ({ companyId }) => `/companies/${companyId}/members`,
      providesTags: ['Members'],
    }),
    listEmployees: build.query<{ employees: Employee[] }, { companyId: string }>({
      query: ({ companyId }) => `/companies/${companyId}/employees`,
      providesTags: ['Members'],
    }),
    listConnectedEmployees: build.query<{ employees: Employee[] }, { companyId: string }>({
      query: ({ companyId }) => `/companies/${companyId}/connected-employees`,
    }),
    assignPermission: build.mutation<
      UserRole,
      { companyId: string; userId: string; permissionLevel: PermissionLevel }
    >({
      query: ({ companyId, userId, permissionLevel }) => ({
        url: `/companies/${companyId}/members/${userId}`,
        method: 'PATCH',
        body: { permissionLevel },
      }),
      invalidatesTags: ['Members'],
    }),
    // `employees` has no dedicated REST surface, so it goes through /query the
    // same way the reference client does. Delete needs an explicit filter, and
    // update needs `id` inside `data`, because the executor matches rows by the
    // columns present rather than by the response envelope.
    createEmployee: build.mutation<
      { changes: number; lastInsertRowid: number },
      { companyId: string; name: string; email?: string | null; phone?: string | null }
    >({
      query: ({ companyId, name, email, phone }) => ({
        url: '/query',
        method: 'POST',
        body: {
          table: 'employees',
          operation: 'insert',
          data: { company_id: companyId, name, email: email ?? null, phone: phone ?? null },
        },
      }),
      invalidatesTags: ['Members'],
    }),
    removeEmployee: build.mutation<{ changes: number }, { employeeId: string }>({
      query: ({ employeeId }) => ({
        url: '/query',
        method: 'POST',
        body: {
          table: 'employees',
          operation: 'delete',
          filters: [{ op: 'eq', column: 'id', value: employeeId }],
        },
      }),
      invalidatesTags: ['Members'],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetMeQuery,
  useListCompaniesQuery,
  useCreateCompanyMutation,
  useRequestJoinCompanyMutation,
  useListJoinRequestsQuery,
  useApproveJoinRequestMutation,
  useRejectJoinRequestMutation,
  useListCompanyMembersQuery,
  useListEmployeesQuery,
  useListConnectedEmployeesQuery,
  useAssignPermissionMutation,
  useCreateEmployeeMutation,
  useRemoveEmployeeMutation,
} = rbacApi;
