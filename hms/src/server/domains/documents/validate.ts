/** Upload rules: type decided by file signature (not the client-supplied type or extension). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

export function sniffType(bytes: Buffer): { mime: string; ext: string } | null {
  const s = SIGNATURES.find((x) => x.test(bytes));
  return s ? { mime: s.mime, ext: s.ext } : null;
}

export function safeFilename(name: string, ext: string): string {
  const base = name
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .trim()
    .slice(0, 80);
  return `${base || "document"}.${ext}`;
}

export type ScanResult = "NOT_SCANNED" | "CLEAN" | "INFECTED";

/**
 * Malware scanning hook. No scanner is bundled; deployments should plug in ClamAV or the storage
 * provider's scanning and return CLEAN/INFECTED. Until then files are marked NOT_SCANNED and the UI
 * says so.
 */
export async function scanUpload(_bytes: Buffer): Promise<ScanResult> {
  return "NOT_SCANNED";
}
