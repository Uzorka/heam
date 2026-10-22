import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 /* Argon2id */ } as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Used to keep login timing similar when the account does not exist.
let dummyHash: Promise<string> | undefined;
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword("dummy-password-for-timing-equalisation");
  await verifyPassword(await dummyHash, password);
}

const COMMON = new Set([
  "password",
  "password123",
  "123456789012",
  "qwertyuiop",
  "letmein",
  "welcome",
  "iloveyou",
  "admin",
  "aduraking",
  "hospital",
]);

/** Returns a list of human-readable problems; empty means acceptable. */
export function passwordProblems(
  password: string,
  context: { email?: string; name?: string } = {},
): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push("Use at least 12 characters.");
  if (password.length > 128) problems.push("Use at most 128 characters.");
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || [...COMMON].some((c) => c.length >= 6 && lower === c + "1")) {
    problems.push("This password is too common.");
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < 3) problems.push("Mix at least three of: lowercase, uppercase, numbers, symbols.");
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) problems.push("Do not include your email name.");
  return problems;
}
