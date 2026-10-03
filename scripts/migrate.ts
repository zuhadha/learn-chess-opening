/**
 * Apply the local schema. `--fresh` deletes the database file first.
 *
 *   npm run db:migrate
 *   npm run db:migrate -- --fresh
 */
import fs from "node:fs";

import { DATABASE_FILE, LocalStore } from "@/lib/db/local-store";

const fresh = process.argv.includes("--fresh");

if (fresh) {
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${DATABASE_FILE}${suffix}`;
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      console.log(`removed ${file}`);
    }
  }
}

const store = new LocalStore(DATABASE_FILE);
const result = store.migrate();
console.log(
  `schema at v${result.version} (${DATABASE_FILE})` +
    (result.applied > 0 ? ` — applied ${result.applied} statement(s)` : " — already up to date"),
);
store.close();
