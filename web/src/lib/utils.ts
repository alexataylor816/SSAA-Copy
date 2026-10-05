/**
 * Ported from SSAA/src/lib/utils.ts. Verbatim except for the header comment,
 * so shadcn components port across without edits.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}