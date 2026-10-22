import { execSync } from "node:child_process";
import { testDatabaseUrl } from "./env";

/**
 * Non-destructive: applies pending migrations to the dedicated test database and upserts base
 * fixtures. Tests create uniquely named data, so no reset is needed between runs. CI starts from a
 * fresh database service; locally, drop/recreate the test database yourself if it grows large.
 */
export default async function setup() {
  const url = testDatabaseUrl();
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { stdio: "pipe", env });
  execSync("npx tsx tests/integration/bootstrap.ts", { stdio: "inherit", env });
}
