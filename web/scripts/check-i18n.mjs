#!/usr/bin/env node
// Checks the English/Spanish text in src/i18n/translations.ts:
//   - every t("key") / tr("key") used in src/ exists
//   - every entry has both English and Spanish
//   - placeholders ({name}) match between the two languages
// Run: npm run check:i18n   (exits 1 on problems)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..", "src");
const dict = readFileSync(join(root, "i18n", "translations.ts"), "utf8");

const entries = new Map();
const re = /^\s*"([\w.]+)": \{ en: ("(?:\\.|[^"\\])*"), es: ("(?:\\.|[^"\\])*") \},$/gm;
for (const m of dict.matchAll(re)) entries.set(m[1], { en: JSON.parse(m[2]), es: JSON.parse(m[3]) });

const problems = [];
const holders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for (const [key, { en, es }] of entries) {
  if (!en || !es) problems.push(`${key}: missing ${!en ? "English" : "Spanish"}`);
  else if (holders(en) !== holders(es)) problems.push(`${key}: placeholders differ (en: ${holders(en) || "none"}, es: ${holders(es) || "none"})`);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
let uses = 0;
for (const file of walk(root)) {
  if (file.includes(join("i18n", "translations.ts"))) continue;
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/(?<![\w.])(?:t|tr)\(\s*"([a-zA-Z]+\.[\w.]+)"/g)) {
    uses++;
    if (!entries.has(m[1])) problems.push(`${relative(root, file)}: unknown key "${m[1]}"`);
  }
  // keys chosen at runtime: t(cond ? "a" : "b")
  for (const m of src.matchAll(/(?<![\w.])(?:t|tr)\([^()]*?\?\s*"([a-zA-Z]+\.[\w.]+)"\s*:\s*"([a-zA-Z]+\.[\w.]+)"/g)) {
    for (const k of [m[1], m[2]]) {
      uses++;
      if (!entries.has(k)) problems.push(`${relative(root, file)}: unknown key "${k}"`);
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`i18n OK: ${entries.size} entries, ${uses} uses checked.`);
