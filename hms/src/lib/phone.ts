import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/**
 * Normalise a phone number to E.164, defaulting to Nigeria (+234).
 * Returns null if the value is not a valid number.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, "NG");
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** Display format, e.g. "+234 803 123 4567". */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

/** Masked display for non-clinical summaries: "+234 *** *** 4567". */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const last4 = e164.slice(-4);
  return `${e164.slice(0, 4)} *** *** ${last4}`;
}
