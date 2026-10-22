/**
 * Structured JSON logger with redaction. Never log passwords, tokens, clinical text or patient
 * identifiers; redaction is a safety net, not a licence to pass PHI here.
 */
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_KEYS =
  /pass(word)?|secret|token|authorization|cookie|otp|code|nin|identifier|phone|email|name|address|dob|dateOfBirth|note|diagnosis|member/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    if (value instanceof Error) return { name: value.name, message: value.message };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const min = (process.env.LOG_LEVEL as Level) || "info";
  if (order[level] < order[min]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(redact(fields ?? {}) as object),
  });
  if (level === "error" || level === "warn") console.error(line);
  else process.stdout.write(line + "\n");
}

export const logger = {
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};

/** Error monitoring adapter. Disabled by default; a real provider must be configured with PHI scrubbing. */
export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  logger.error("unhandled_error", { error, ...context });
}
