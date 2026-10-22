import { z } from "zod";
import { normalizePhone } from "../phone";

export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const requiredText = (label: string, max = 120) =>
  z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);

export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD");
export const localTime = z.string().regex(/^\d{2}:\d{2}$/, "Use the format HH:MM");

export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid phone number (e.g. 0803 123 4567)" });
      return z.NEVER;
    }
    return n;
  });

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.string().email("Enter a valid email address").optional());

export const uuid = z.string().uuid("Invalid identifier");
export const reason = (label = "Reason") => requiredText(label, 500).refine((v) => v.length >= 5, `${label} must be at least 5 characters`);
