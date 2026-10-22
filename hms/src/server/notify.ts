import type { DbClient } from "./db";

/**
 * In-app work notifications. Payloads hold identifiers only; message text is generated from the
 * template at display time and never contains results, diagnoses or other clinical details.
 */
export async function notifyUsers(db: DbClient, userIds: (string | null | undefined)[], template: string, payload: Record<string, string>) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await db.notification.createMany({
    data: ids.map((userId) => ({
      channel: "IN_APP" as const,
      template,
      recipient: userId,
      userId,
      payload,
      status: "SENT" as const,
      sentAt: new Date(),
    })),
  });
}
