import { z } from "zod";

const base64Key = (name: string, minBytes: number) =>
  z
    .string()
    .min(1, `${name} is required`)
    .refine((v) => {
      try {
        return Buffer.from(v, "base64").length >= minBytes;
      } catch {
        return false;
      }
    }, `${name} must be base64 encoding at least ${minBytes} bytes`);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATA_ENCRYPTION_KEY: base64Key("DATA_ENCRYPTION_KEY", 32),
  BLIND_INDEX_KEY: base64Key("BLIND_INDEX_KEY", 32),
  MFA_ENFORCE: z.enum(["true", "false"]).default("false"),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(24).default(12),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  EMAIL_PROVIDER: z.string().default("disabled"),
  SMS_PROVIDER: z.string().default("disabled"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

/** Validate an env object. Production additionally refuses insecure configuration. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration - refusing to start. ${issues}`);
  }
  const env = result.data;
  if (env.NODE_ENV === "production") {
    const problems: string[] = [];
    if (!env.APP_URL.startsWith("https://")) problems.push("APP_URL must use https in production");
    if (env.STORAGE_DRIVER === "local") problems.push("STORAGE_DRIVER=local is not permitted in production");
    if (env.DATA_ENCRYPTION_KEY === env.BLIND_INDEX_KEY) problems.push("encryption and blind-index keys must differ");
    if (/hms_dev_password/.test(env.DATABASE_URL)) problems.push("DATABASE_URL uses the development password");
    if (problems.length) throw new Error(`Unsafe production configuration - refusing to start. ${problems.join("; ")}`);
    env.MFA_ENFORCE = "true";
  }
  return env;
}

let cached: Env | undefined;
export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
