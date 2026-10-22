export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}

export function maskIdentifier(last4: string): string {
  return `••••${last4}`;
}

/** Initial + family name, e.g. "A. Okonkwo" - used where full names are unnecessary. */
export function shortName(given: string, family: string): string {
  return `${given.slice(0, 1).toUpperCase()}. ${family}`;
}
