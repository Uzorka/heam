import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { listMySessions } from "@/server/domains/security/account";
import { formatDateTime } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/misc";
import { ActionForm, ConfirmAction, ActionDialog } from "@/components/forms/action-form";
import { changePasswordAction, disableMfaAction, revokeMySessionAction } from "../actions";
import { MfaEnroll } from "./mfa-enroll";

export const metadata: Metadata = { title: "Security & sessions" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const ctx = await requireAuthContext();
  const { required } = await searchParams;
  const [user, sessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { mfaEnabled: true, mustChangePassword: true, passwordChangedAt: true } }),
    listMySessions(ctx),
  ]);
  return (
    <>
      <PageHeader title="Security & sessions" description="Your password, two-step verification and signed-in devices." />
      {(required === "password" || user.mustChangePassword) && (
        <Alert tone="warning" className="mb-5" title="Please set a new password">
          Your account requires a new password before you continue working.
        </Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Password" description={user.passwordChangedAt ? `Last changed ${formatDateTime(user.passwordChangedAt)}` : undefined} />
          <CardBody>
            <ActionForm
              action={changePasswordAction}
              submitLabel="Change password"
              successMessage="Password changed. Other sessions were signed out."
              resetOnSuccess
              fields={[
                { name: "currentPassword", label: "Current password", type: "password", required: true },
                { name: "newPassword", label: "New password", type: "password", required: true, hint: "12+ characters; mix three of lowercase, uppercase, numbers, symbols." },
                { name: "confirmPassword", label: "Confirm new password", type: "password", required: true },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Two-step verification"
            description="A code from your phone in addition to your password."
            actions={user.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge tone="outline">Off</Badge>}
          />
          <CardBody className="space-y-3">
            {ctx.suspendedGrants.length > 0 && (
              <Alert tone="warning">Your {ctx.suspendedGrants.map((g) => g.roleName).join(", ")} access is paused until this is on.</Alert>
            )}
            {user.mfaEnabled ? (
              <ActionDialog
                action={disableMfaAction}
                trigger="Turn off"
                title="Turn off two-step verification"
                description="Not allowed if your role requires it."
                submitLabel="Turn off"
                tone="danger"
                successMessage="Two-step verification turned off."
                fields={[
                  { name: "password", label: "Password", type: "password", required: true },
                  { name: "code", label: "Current 6-digit code", type: "text", required: true },
                ]}
              />
            ) : (
              <MfaEnroll />
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Signed-in sessions" description="Sessions end after inactivity and at a maximum length. End any session you don't recognise." />
          <ul className="divide-y divide-border">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[13px]">
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.id === ctx.sessionId ? <Badge tone="accent">This device</Badge> : null} Signed in {formatDateTime(s.createdAt)}
                  </p>
                  <p className="truncate text-muted">
                    Last active {formatDateTime(s.lastSeenAt)} · {s.ip ?? "unknown IP"} · {s.userAgent ?? "unknown device"}
                  </p>
                </div>
                {s.id !== ctx.sessionId && (
                  <ConfirmAction
                    action={revokeMySessionAction}
                    fixed={{ sessionId: s.id }}
                    trigger="End session"
                    triggerVariant="ghost"
                    title="End this session?"
                    description="That device will be signed out."
                    submitLabel="End session"
                    tone="danger"
                    successMessage="Session ended."
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
