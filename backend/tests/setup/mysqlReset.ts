/**
 * Runs before each test file. On MySQL it starts every file from empty tables,
 * the way each SQLite file starts from its own in-memory database. On SQLite
 * it does nothing.
 */
import { config } from "../../src/config.js";
import { database } from "../../src/db.js";
import { ensureSchema } from "../../src/models/index.js";

if (database.dialect === "mysql") {
  // Safety first: this empties every table, so never point it at a real database.
  if (!config.mysql.database.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against MySQL database "${config.mysql.database}": ` +
        'the name must end with "_test" (e.g. MYSQL_DATABASE=ssaa_test).',
    );
  }

  await ensureSchema();
  const tables = await database.all<{ name: string }>(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
  );
  // FOREIGN_KEY_CHECKS is per connection and the pool hands out a different
  // one per query, so all of it goes as one script on one connection.
  await database.execScript(
    [
      "SET FOREIGN_KEY_CHECKS=0;",
      ...tables.map(({ name }) => `TRUNCATE TABLE \`${name}\`;`),
      "SET FOREIGN_KEY_CHECKS=1;",
    ].join("\n"),
  );
}
