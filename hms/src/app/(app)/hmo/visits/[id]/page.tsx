import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { canAny } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { formatDateTime } from "@/lib/time";
import { statusText } from "@/lib/billing-labels";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { PayerPanel } from "../../../encounters/[id]/payer-panel";

export const metadata: Metadata = { title: "Visit payer & billing" };

/**
 * Non-clinical view of a visit for HMO and billing staff: payer, cover, pre-authorisations and the
 * bill. No notes, results or diagnoses are shown here.
 */
export default async function HmoVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const enc = await prisma.encounter.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, mrn: true, givenName: true, familyName: true } },
      visitType: { select: { name: true } },
    },
  });
  if (!enc) notFound();
  if (!canAny(ctx, ["hmo.read", "billing.read"], { branchId: enc.branchId })) return <Forbidden />;
  await recordAudit(prisma, {
    actorType: "USER",
    actorUserId: ctx.userId,
    action: "hmo.visit.view",
    resourceType: "Encounter",
    resourceId: enc.id,
    patientId: enc.patientId,
    meta: ctx.meta,
  });
  return (
    <>
      <Link prefetch={false} href="/hmo" className="text-[13px] text-muted hover:text-foreground">
        ← HMO desk
      </Link>
      <PageHeader
        title={`${enc.patient.givenName} ${enc.patient.familyName}`}
        description={
          <>
            <span className="font-mono">{enc.patient.mrn}</span> · visit{" "}
            <span className="font-mono">{enc.ref}</span> · {enc.visitType.name} ·{" "}
            {formatDateTime(enc.arrivedAt)} · {statusText(enc.status)}
          </>
        }
      />
      <PayerPanel ctx={ctx} enc={enc} />
    </>
  );
}
