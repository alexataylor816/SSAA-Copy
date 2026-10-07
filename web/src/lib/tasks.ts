import { supabase } from "./supabase";

/**
 * Tasks have no dedicated REST route — the original Lovable app read them with
 * `supabase.from('tasks')`, so they go through the same `POST /query` facade.
 * Rows come back snake_case, matching the table definition in
 * `backend/src/query/projectTables.ts`.
 */
export interface Task {
  id: string;
  project_id: string;
  assigned_company_id: string | null;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  color: string | null;
  status: string;
  sort_order: number;
}

export type TaskStatus = "pending" | "in_progress" | "complete";

/**
 * CalendarPanel reads id/name/dates/color; LeftPanel also shows status and
 * project_id, so the shared shape carries those and guarantees a non-null
 * color for the inline bar backgrounds.
 */
export interface CalendarTask {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  color: string;
  status?: string;
  project_id?: string;
}

export function toCalendarTask(task: Task): CalendarTask {
  return {
    id: task.id,
    name: task.name,
    start_date: task.start_date,
    end_date: task.end_date,
    // The column is nullable in the schema; Lovable's bars are styled with an
    // inline background, so fall back rather than rendering a transparent bar.
    color: task.color || "#0284c7",
    status: task.status,
    project_id: task.project_id,
  };
}

/**
 * The facade resolves `{ data, error }` like supabase-js does, so every call
 * site unwraps here and re-throws. That keeps this module's contract simple
 * for callers, which already wrap these calls in try/catch.
 */
function unwrap<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function listTasks(projectId: string): Promise<Task[]> {
  const rows = await supabase
    .from("tasks")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });
  return (unwrap(rows) ?? []) as Task[];
}

export async function listTasksForProjects(projectIds: string[]): Promise<Task[]> {
  if (projectIds.length === 0) return [];
  const rows = await supabase
    .from("tasks")
    .select("*")
    .in("project_id", projectIds)
    .order("sort_order", { ascending: true });
  return (unwrap(rows) ?? []) as Task[];
}

export async function createTask(
  projectId: string,
  input: { name: string; start_date: string; end_date: string; color?: string | null },
): Promise<void> {
  unwrap(
    await supabase.from("tasks").insert({
      project_id: projectId,
      name: input.name,
      start_date: input.start_date,
      end_date: input.end_date,
      color: input.color ?? "#0284c7",
    }),
  );
}

export async function updateTask(
  taskId: string,
  changes: Partial<Pick<Task, "name" | "start_date" | "end_date" | "color" | "status" | "sort_order">>,
): Promise<void> {
  unwrap(await supabase.from("tasks").update(changes).eq("id", taskId));
}

export async function deleteTask(taskId: string): Promise<void> {
  unwrap(await supabase.from("tasks").delete().eq("id", taskId));
}