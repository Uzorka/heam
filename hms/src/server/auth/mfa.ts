import { authenticator } from "otplib";
import QRCode from "qrcode";
import { decryptField, encryptField } from "../crypto";

authenticator.options = { window: 1, step: 30, digits: 6 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret(20);
}

export function encryptTotpSecret(secret: string): string {
  return encryptField(secret);
}

export function verifyTotp(encryptedSecret: string, code: string): boolean {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    return authenticator.check(cleaned, decryptField(encryptedSecret));
  } catch {
    return false;
  }
}

export async function totpQrDataUrl(secret: string, accountLabel: string): Promise<string> {
  const uri = authenticator.keyuri(accountLabel, "Aduraking HMS", secret);
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}

/** For tests only. */
export function currentTotp(secret: string): string {
  return authenticator.generate(secret);
}
