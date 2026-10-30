/**
 * Gives an existing account operator access (the SSAA Operator Dashboard: Manage SSAA, every user and
 * company, "view as"). The account must already exist: sign up first, then run
 *
 *   npm run make-operator -- luke@example.com                  (main operator: full access)
 *   npm run make-operator -- luke@example.com --level=owner    (owner: also manages operators)
 *   npm run make-operator -- luke@example.com --level=view_only
 *   npm run make-operator -- luke@example.com --revoke
 *
 * Uses the app's own database settings (DB_CLIENT / MYSQL_* from backend/.env).
 */
const email = process.argv.slice(2).find((a) => !a.startsWith("--"));
const revoke = process.argv.includes("--revoke");
const level = process.argv.find((a) => a.startsWith("--level="))?.slice("--level=".length) ?? "main_operator";
if (!email || !["owner", "main_operator", "view_only"].includes(level)) {
  console.error("Usage: npm run make-operator -- <email> [--level=owner|main_operator|view_only] [--revoke]");
  process.exit(1);
}

const { ensureSchema } = await import("../src/models/index.js");
const { findUserByEmail, setUserIsAdmin } = await import("../src/models/users.js");
await ensureSchema();

const user = await findUserByEmail(email);
if (!user) {
  console.error(`No account for ${email}. Sign up in the app first, then run this again.`);
  process.exit(1);
}
await setUserIsAdmin(user.id, !revoke, level as "owner" | "main_operator" | "view_only");
console.log(`${user.email} ${revoke ? "is no longer an operator" : `is now an operator (${level.replace("_", " ")})`}.`);
process.exit(0);
