import { Prisma } from "@prisma/client";

/** True if the error is a violation of the named DB constraint/index (unique, exclusion or check). */
export function isConstraintViolation(e: unknown, constraintName: string): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const target = e.meta?.target;
    if (Array.isArray(target) ? target.includes(constraintName) : target === constraintName) return true;
    if (typeof e.meta?.constraint === "string" && e.meta.constraint === constraintName) return true;
  }
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes(constraintName);
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}
