import type { Metadata } from "next";
import Link from "next/link";
import { ListOrdered, LogIn, Printer, Siren } from "lucide-react";
import type { QueueStage } from "@prisma/client";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listQueue } from "@/server/domains/queue/service";
import {
  ACTIVE_STAGES,
  QUEUE_TRANSITIONS,
  STAGE_LABELS,
  STAGES_REQUIRING_NOTE,
  transitionPermission,
} from "@/server/domains/queue/state-machine";
import { listClinicians } from "@/server/domains/staff/clinicians";
import { formatAge, formatTime } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionDialog } from "@/components/forms/action-form";
import { AllergyBadge } from "@/components/patient/banner";
import { load } from "../_lib/guard";
import { assignAttendingAction } from "./actions";
import { AutoRefresh } from "./auto-refresh";
import { StageButtons } from "./stage-buttons";

export const metadata: Metadata = { title: "Visit queue" };

function waited(since: Date) {
  const mins = Math.max(0, Math.round((Date.now() - since.getTime()) / 60_000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; mine?: string }>;
}) {
  const ctx = await requireAuthContext();
  const sp = await searchParams;
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch to view the queue.</Alert>;
  const stage = (ACTIVE_STAGES as string[]).includes(sp.stage ?? "") ? (sp.stage as QueueStage) : undefined;
  const mine = sp.mine === "1";
  const res = await load(ctx, "/queue", () => listQueue(ctx, { stages: stage ? [stage] : undefined, mine }));
  if (!res.ok) return <Forbidden message={res.message} />;
  const all = res.data;
  const branchId = ctx.activeBranchId;
  const clinicians = can(ctx, "queue.manage", { branchId }) ? await listClinicians(branchId) : [];
  const counts = new Map<string, number>();
  for (const r of all) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Visit queue"
        description="Emergency and urgent patients are listed first. Priority is set by staff - the system never triages automatically."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <AutoRefresh />
            {can(ctx, "queue.manage", { branchId }) && (
              <Button asChild>
                <Link prefetch={false} href="/queue/check-in">
                  <LogIn className="h-4 w-4" aria-hidden /> Check in
                </Link>
              </Button>
            )}
          </div>
        }
      />
      <LinkTabs
        label="Filter queue"
        current={mine ? "mine" : (stage ?? "all")}
        tabs={[
          { key: "all", label: "All waiting", href: "/queue", count: stage || mine ? undefined : all.length },
          ...(can(ctx, "clinical.note.write")
            ? [{ key: "mine", label: "My patients", href: "/queue?mine=1" }]
            : []),
          ...ACTIVE_STAGES.filter((s) => s !== "REGISTERED").map((s) => ({
            key: s,
            label: STAGE_LABELS[s],
            href: `/queue?stage=${s}`,
            count: !stage && !mine ? (counts.get(s) ?? 0) : undefined,
          })),
        ]}
      />
      {all.length === 0 ? (
        <Card>
          <EmptyState icon={<ListOrdered className="h-5 w-5" />} title="No one waiting">
            {stage || mine ? "Try another filter." : "Checked-in patients will appear here."}
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-3">
          {all.map((r) => {
            const options = QUEUE_TRANSITIONS[r.stage]
              .filter((to) => can(ctx, transitionPermission(r.stage, to), { branchId }))
              .map((to) => ({
                to,
                label: to === "CANCELLED" ? "Cancel visit" : `→ ${STAGE_LABELS[to]}`,
                needsNote: STAGES_REQUIRING_NOTE.includes(to),
              }));
            return (
              <li key={r.id}>
                <Card
                  className={
                    r.priority === "EMERGENCY"
                      ? "border-danger/50"
                      : r.priority === "URGENT"
                        ? "border-warning/50"
                        : undefined
                  }
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {r.priority !== "ROUTINE" && (
                          <Badge
                            tone={r.priority === "EMERGENCY" ? "danger" : "warning"}
                            icon={<Siren className="h-3.5 w-3.5" aria-hidden />}
                          >
                            {r.priority.toLowerCase()}
                          </Badge>
                        )}
                        {can(ctx, "patient.read") ? (
                          <Link
                            prefetch={false}
                            href={`/patients/${r.patient.id}`}
                            className="text-[15px] font-semibold hover:text-accent hover:underline"
                          >
                            {r.patient.name}
                          </Link>
                        ) : (
                          <span className="text-[15px] font-semibold">{r.patient.name}</span>
                        )}
                        <span className="font-mono text-[13px] text-muted">{r.patient.mrn}</span>
                        <span className="text-[13px] text-muted">
                          {r.patient.dateOfBirth ? formatAge(r.patient.dateOfBirth) : "age ?"} ·{" "}
                          {r.patient.sexAtBirth.slice(0, 1)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                        <Badge tone="accent">{STAGE_LABELS[r.stage]}</Badge>
                        <span>waiting {waited(r.stageSince)}</span>
                        <span>· arrived {formatTime(r.arrivedAt)}</span>
                        <span>· {r.visitType}</span>
                        <span>· {r.attending ? r.attending.displayName : "no clinician assigned"}</span>
                        <span>
                          ·{" "}
                          {r.payerClass === "UNDETERMINED"
                            ? "payer not set"
                            : r.payerClass.toLowerCase().replace("_", " ")}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        <AllergyBadge status={r.patient.allergyReviewStatus} activeCount={0} />
                        {r.patient.registrationStatus === "PROVISIONAL" && (
                          <Badge tone="warning">Provisional registration</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StageButtons encounterId={r.id} version={r.version} options={options} />
                      <div className="flex flex-wrap justify-end gap-1">
                        {clinicians.length > 0 && (
                          <ActionDialog
                            action={assignAttendingAction}
                            fixed={{ encounterId: r.id }}
                            trigger={r.attending ? "Reassign" : "Assign clinician"}
                            triggerVariant="ghost"
                            title="Assign attending clinician"
                            description="Assigning adds the clinician to this visit's care team."
                            submitLabel="Assign"
                            successMessage="Clinician assigned."
                            fields={[
                              {
                                name: "clinicianId",
                                label: "Clinician",
                                type: "select",
                                required: true,
                                defaultValue: r.attending?.id,
                                options: clinicians.map((c) => ({ value: c.id, label: c.displayName })),
                              },
                            ]}
                          />
                        )}
                        {can(ctx, "encounter.read", { branchId }) && (
                          <Button asChild variant="secondary" size="sm">
                            <Link prefetch={false} href={`/encounters/${r.id}`}>
                              Open visit
                            </Link>
                          </Button>
                        )}
                        <Button asChild variant="ghost" size="sm">
                          <Link
                            prefetch={false}
                            href={`/queue/${r.id}/slip`}
                            aria-label={`Print slip for ${r.patient.name}`}
                          >
                            <Printer className="h-4 w-4" aria-hidden /> Slip
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
