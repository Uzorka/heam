/** Runs once at server start. Refuses to boot with missing/unsafe secrets (fail closed). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("./server/env");
    env();
  }
}
