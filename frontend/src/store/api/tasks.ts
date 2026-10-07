import { baseApi } from './baseApi';

/**
 * Tasks have no dedicated REST routes — the Lovable original read and wrote
 * them through `supabase.from('tasks')`, so we talk to the same PostgREST-shaped
 * `/query` endpoint the web facade uses. Row-level scoping and the Foreman-level
 * write check are enforced server-side by the table registry.
 *
 * Note the snake_case field names: `/query` returns the raw column names, which
 * is also what the reference components expect.
 */
export type TaskStatus = 'pending' | 'in_progress' | 'complete';

/** Matches the palette the original picked from when creating a task. */
export const TASK_COLORS = [
  '#0284c7',
  '#16a34a',
  '#dc2626',
  '#9333ea',
  '#ea580c',
  '#0891b2',
] as const;

export interface Task {
  id: string;
  project_id: string;
  assigned_company_id: string | null;
  name: string;
  description: string | null;
  /** YYYY-MM-DD, inclusive. */
  start_date: string;
  /** YYYY-MM-DD, inclusive. */
  end_date: string;
  color: string | null;
  status: TaskStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** `/query` answers with the rows directly under `data`. */
type QueryResponse<T> = { data: T };

export interface CreateTaskInput {
  projectId: string;
  name: string;
  startDate: string;
  endDate: string;
  color?: string;
  description?: string;
  /** Optional explicit ordering; appended to the end when omitted. */
  sortOrder?: number;
}

export type UpdateTaskInput = Partial<
  Pick<Task, 'name' | 'description' | 'start_date' | 'end_date' | 'color' | 'status' | 'sort_order'>
> & { id: string };

export const tasksApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listTasks: build.query<QueryResponse<Task[]>, void>({
      query: () => ({
        url: '/query',
        method: 'POST',
        body: {
          table: 'tasks',
          operation: 'select',
          order: [
            { column: 'sort_order', ascending: true },
            { column: 'start_date', ascending: true },
          ],
        },
      }),
      providesTags: ['Tasks'],
    }),

    createTask: build.mutation<QueryResponse<Task[]>, CreateTaskInput>({
      query: ({ projectId, name, startDate, endDate, color, description, sortOrder }) => ({
        url: '/query',
        method: 'POST',
        body: {
          table: 'tasks',
          operation: 'insert',
          data: {
            project_id: projectId,
            name,
            start_date: startDate,
            end_date: endDate,
            color: color ?? TASK_COLORS[0],
            description: description ?? null,
            ...(sortOrder === undefined ? {} : { sort_order: sortOrder }),
          },
        },
      }),
      invalidatesTags: ['Tasks'],
    }),

    updateTask: build.mutation<QueryResponse<Task[]>, UpdateTaskInput>({
      query: ({ id, ...changes }) => ({
        url: '/query',
        method: 'POST',
        body: {
          table: 'tasks',
          operation: 'update',
          // The executor scopes an update by the `id` in the payload and refuses
          // id-less writes, so this doubles as the row filter.
          data: { id, ...changes },
        },
      }),
      invalidatesTags: ['Tasks'],
    }),

    deleteTask: build.mutation<QueryResponse<Task[]>, { id: string }>({
      query: ({ id }) => ({
        url: '/query',
        method: 'POST',
        body: {
          table: 'tasks',
          operation: 'delete',
          filters: [{ op: 'eq', column: 'id', value: id }],
        },
      }),
      invalidatesTags: ['Tasks'],
    }),
  }),
  overrideExisting: false,
});

export const { useListTasksQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation } =
  tasksApi;