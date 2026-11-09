export interface ParsedScheduleTask {
  name: string;
  start_date: string;
  end_date: string;
  duration?: string;
  predecessors?: string;
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error("The CSV has an unclosed quoted field.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function dateValue(value: string): string | null {
  const v = value.trim().replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?\s+/i, "").replace(/\s+\d{1,2}:\d{2}(?:\s*[AP]M)?$/i, "");
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (!match) match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v);
  if (!match) return null;
  const [parsedYear, month, day] = match[1].length === 4 ? [Number(match[1]), Number(match[2]), Number(match[3])] : [Number(match[3]), Number(match[1]), Number(match[2])];
  const year = parsedYear < 100 ? parsedYear + 2000 : parsedYear;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseScheduleCsv(text: string): ParsedScheduleTask[] {
  const rows = parseRows(text);
  if (rows.length < 2) throw new Error("CSV must contain a header row and at least one task.");
  const headers = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  const find = (...names: string[]) => headers.findIndex((h) => names.includes(h));
  const nameIndex = find("task", "taskname", "name", "activity", "activityname");
  const startIndex = find("start", "startdate", "startday");
  const endIndex = find("end", "enddate", "finish", "finishdate");
  if (nameIndex < 0 || startIndex < 0 || endIndex < 0) {
    throw new Error("Add Task (or Activity), Start Date, and End Date columns to the CSV.");
  }
  const durationIndex = find("duration", "originalduration");
  const predecessorIndex = find("predecessors", "predecessor", "dependencies");
  const tasks: ParsedScheduleTask[] = [];
  rows.slice(1).forEach((row, i) => {
    const name = row[nameIndex]?.trim();
    const start_date = dateValue(row[startIndex] ?? "");
    const end_date = dateValue(row[endIndex] ?? "");
    if (!name || !start_date || !end_date || end_date < start_date) {
      throw new Error(`Row ${i + 2} needs a task name and valid start/end dates (MM/DD/YYYY or YYYY-MM-DD).`);
    }
    tasks.push({ name, start_date, end_date, ...(durationIndex >= 0 ? { duration: row[durationIndex] ?? "" } : {}), ...(predecessorIndex >= 0 ? { predecessors: row[predecessorIndex] ?? "" } : {}) });
  });
  if (tasks.length === 0) throw new Error("No schedule tasks were found in this CSV.");
  return tasks;
}
