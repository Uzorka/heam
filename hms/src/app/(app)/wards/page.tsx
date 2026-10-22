import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { availableBeds, wardBoard } from "@/server/domains/inpatient/service";
import { formatDateTime } from "@/lib/time";
import { statusText } from "@/lib/billing-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { ActionDialog, ConfirmAction } from "@/components/forms/action-form";
import { load } from "../_lib/guard";
import { AutoRefresh } from "../queue/auto-refresh";
import { bedReadyAction, moveBedAction } from "./actions";

export const metadata: Metadata = { title: "Ward board" };

const BED_TONE = {
  FREE: "success",
  OCCUPIED: "accent",
  CLEANING: "warning",
  RESERVED: "neutral",
  UNAVAILABLE: "outline",
} as const;

export default async function WardBoardPage() {
  const ctx = await requireAuthContext();
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch.</Alert>;
  const res = await load(ctx, "/wards", async () => ({
    board: await wardBoard(ctx),
    free: await availableBeds(ctx),
  }));
  if (!res.ok) return <Forbidden message={res.message} />;
  const { board, free } = res.data;
  const manage = can(ctx, "admission.manage", { branchId: ctx.activeBranchId });
  const bedOptions = free.map((b) => ({ value: b.id, label: `${b.ward.name} - ${b.label}` }));
  const name = (p: { givenName: string; familyName: string; preferredName: string | null }) =>
    `${p.givenName} ${p.familyName}${p.preferredName ? ` (${p.preferredName})` : ""}`;
  return (
    <>
      <PageHeader
        title="Ward board"
        description="Beds and current inpatients in this branch. Patients are admitted from their visit; open a stay for moves, medication and discharge."
        actions={<AutoRefresh />}
      />
      {board.unassigned.length > 0 && (
        <Card className="mb-5">
          <CardHeader
            title="Admitted without a bed"
            description="e.g. babies rooming-in with their mothers, or awaiting a bed."
          />
          <CardBody>
            <ul className="divide-y divide-border">
              {board.unassigned.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]">
                  <span>
                    <Link
                      prefetch={false}
                      href={`/admissions/${a.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {name(a.patient)}
                    </Link>{" "}
                    <span className="font-mono text-[13px] text-muted">{a.patient.mrn}</span>
                    <span className="block text-[13px] text-muted">
                      {a.ref} · {a.reason} · since {formatDateTime(a.admittedAt)}
                    </span>
                  </span>
                  {manage && bedOptions.length > 0 && (
                    <ActionDialog
                      action={moveBedAction}
                      fixed={{ admissionId: a.id }}
                      trigger="Assign bed"
                      title={`Assign a bed to ${name(a.patient)}`}
                      submitLabel="Assign"
                      successMessage="Bed assigned."
                      fields={[
                        { name: "bedId", label: "Bed", type: "select", required: true, options: bedOptions },
                      ]}
                    />
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      {board.wards.length === 0 ? (
        <EmptyState icon={<BedDouble className="h-5 w-5" />} title="No wards configured">
          Add wards and beds in Administration → Departments & beds.
        </EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {board.wards.map((w) => {
            const occupied = w.beds.filter((b) => b.status === "OCCUPIED").length;
            return (
              <Card key={w.id}>
                <CardHeader
                  title={w.name}
                  description={`${statusText(w.kind)} · ${occupied}/${w.beds.length} occupied${w.isDemo ? " · DEMO" : ""}`}
                />
                <CardBody>
                  {w.beds.length === 0 ? (
                    <p className="text-[14px] text-muted">No beds.</p>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {w.beds.map((b) => {
                        const occ = b.assignments[0]?.admission;
                        return (
                          <li key={b.id} className="rounded-md border border-border p-2 text-[14px]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{b.label}</span>
                              <Badge tone={BED_TONE[b.status]}>{statusText(b.status)}</Badge>
                            </div>
                            {occ ? (
                              <Link
                                prefetch={false}
                                href={`/admissions/${occ.id}`}
                                className="mt-1 block text-accent hover:underline"
                              >
                                {name(occ.patient)}
                                <span className="block font-mono text-xs text-muted">
                                  {occ.patient.mrn} · {occ.ref}
                                  {occ.status === "DISCHARGE_AUTHORISED" && " · discharge authorised"}
                                </span>
                              </Link>
                            ) : (
                              b.status === "CLEANING" &&
                              manage && (
                                <span className="mt-1 block">
                                  <ConfirmAction
                                    action={bedReadyAction}
                                    fixed={{ bedId: b.id }}
                                    trigger="Mark ready"
                                    triggerVariant="ghost"
                                    title={`Is ${b.label} clean and ready?`}
                                    description="It becomes available for the next patient."
                                    submitLabel="Mark ready"
                                    successMessage="Bed ready."
                                  />
                                </span>
                              )
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
