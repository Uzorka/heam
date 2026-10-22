import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { formatDateTime } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ConfirmAction } from "@/components/forms/action-form";
import { markAllReadAction } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

/** Templates map to generic, non-clinical messages. Payloads contain ids only. */
const TEMPLATES: Record<string, { text: string; href?: (p: Record<string, unknown>) => string }> = {
  "breakglass.review_needed": {
    text: "An emergency access event needs compliance review.",
    href: () => "/audit/break-glass",
  },
};

export default async function NotificationsPage() {
  const ctx = await requireAuthContext();
  const items = await prisma.notification.findMany({
    where: { userId: ctx.userId, channel: "IN_APP" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Work alerts. Notifications never contain diagnoses, results or other clinical details."
        actions={
          unread > 0 && (
            <ConfirmAction
              action={markAllReadAction}
              trigger="Mark all read"
              title="Mark all as read?"
              description={`${unread} unread`}
              submitLabel="Mark read"
              successMessage="Marked as read."
            />
          )
        }
      />
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<Bell className="h-5 w-5" />} title="No notifications" />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((n) => {
              const t = TEMPLATES[n.template];
              const payload = (n.payload ?? {}) as Record<string, unknown>;
              return (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <p className={n.readAt ? "text-muted" : "font-medium"}>
                      {!n.readAt && (
                        <Badge tone="accent" className="mr-2">
                          New
                        </Badge>
                      )}
                      {t?.text ?? n.template}
                    </p>
                    <p className="text-xs text-muted">{formatDateTime(n.createdAt)}</p>
                  </div>
                  {t?.href && (
                    <Link
                      prefetch={false}
                      href={t.href(payload)}
                      className="text-[13px] text-accent hover:underline"
                    >
                      Open
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
