import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.LOG_LEVEL === "debug"
        ? ["query", "warn", "error"]
        : process.env.VITEST
          ? ["warn"]
          : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;
export type DbClient = PrismaClient | Tx;

/** Run fn inside a transaction, or reuse the caller's transaction. */
export async function withTx<T>(db: DbClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if ("$transaction" in db) {
    return (db as PrismaClient).$transaction(fn, { isolationLevel: "ReadCommitted", timeout: 15_000 });
  }
  return fn(db as Tx);
}
