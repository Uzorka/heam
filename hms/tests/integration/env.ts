import "dotenv/config";

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set for integration tests");
  if (url === process.env.DATABASE_URL_ORIGINAL || !/test/i.test(url)) {
    throw new Error("Refusing to run integration tests against a database whose name does not contain 'test'");
  }
  return url;
}
