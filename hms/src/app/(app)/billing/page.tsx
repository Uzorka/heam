import type { Metadata } from "next";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { prisma } from "@/server/db";
import { searchPatients } from "@/server/domains/patients/service";
import { cashierQueue, currentShift, expectedCash } from "@/server/domains/billing/payments";
import { formatNaira } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { allowed, load } from "../_lib/guard";
import { closeShiftAction, openShiftAction } from "./actions";

export const metadata: Metadata = { title: "Cashier desk" };

export default async function CashierPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/billing", ["billing.payment.collect", "billing.invoice.manage"])))
    return <Forbidden />;
  if (!ctx.activeBranchId) return <Alert tone="warning">Select a branch.</Alert>;
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const res = await load(ctx, "/billing", async () => {
    const shift = await currentShift(prisma, ctx.userId);
    return {
      queue: await cashierQueue(ctx),
      shift,
      expected: shift ? await expectedCash(prisma, shift.id) : null,
      found:
        q.length >= 2 && can(ctx, "patient.search")
          ? (
              await searchPatients(ctx, {
                q,
                page: 1,
                pageSize: 10,
                includeInactive: false,
                provisionalOnly: false,
              })
            ).rows
          : [],
    };
  });
  if (!res.ok) return <Forbidden message={res.message} />;
  const { queue, shift, expected, found } = res.data;
  const canShift = can(ctx, "cashier.shift.manage", { branchId: ctx.activeBranchId });
  return (
    <>
      <PageHeader
        title="Cashier desk"
        description="Open bills for this branch. Amounts shown are the patient's share; HMO shares are claimed separately."
      />
      {canShift && (
        <Card className="mb-5">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            {shift ? (
              <>
                <p className="text-[14px]">
                  <Badge tone="success">Shift open</Badge> since {formatDateTime(shift.openedAt)} · float{" "}
                  {formatNaira(shift.openingFloatKobo)} · cash expected in drawer{" "}
                  <span className="font-semibold tabular-nums">{formatNaira(expected!)}</span>
                </p>
                <ActionDialog
                  action={closeShiftAction}
                  fixed={{ shiftId: shift.id }}
                  trigger="Close shift"
                  title="Close your shift"
                  description="Count the cash in the drawer. The variance is recorded and a supervisor approves the close."
                  submitLabel="Close shift"
                  successMessage="Shift closed and sent for approval."
                  fields={[
                    { name: "countedCashKobo", label: "Cash counted", type: "money", required: true },
                    { name: "note", label: "Note", type: "textarea" },
                  ]}
                />
              </>
            ) : (
              <>
                <p className="text-[14px]">
                  <Badge tone="warning">No open shift</Badge> Cash can only be taken during an open shift.
                </p>
                <ActionDialog
                  action={openShiftAction}
                  trigger="Open shift"
                  triggerVariant="primary"
                  title="Open a cashier shift"
                  submitLabel="Open shift"
                  successMessage="Shift opened."
                  fields={[
                    {
                      name: "openingFloatKobo",
                      label: "Opening float (cash in drawer)",
                      type: "money",
                      required: true,
                      defaultValue: "0",
                    },
                  ]}
                />
              </>
            )}
          </CardBody>
        </Card>
      )}
      <Card className="mb-5">
        <CardHeader title="Find a patient" />
        <CardBody>
          <form action="/billing" className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="billing-q">
              Name, hospital number or phone
            </label>
            <Input
              id="billing-q"
              name="q"
              defaultValue={q}
              placeholder="Name, hospital number or phone"
              className="max-w-sm"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
          {q.length >= 2 && (
            <ul className="mt-3 divide-y divide-border rounded-md border border-border">
              {found.length === 0 && <li className="p-3 text-[14px] text-muted">No matching patients.</li>}
              {found.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 p-3 text-[14px]">
                  <span>
                    <span className="font-medium">{p.name}</span>{" "}
                    <span className="font-mono text-[13px] text-muted">{p.mrn}</span>
                  </span>
                  <Button asChild size="sm" variant="secondary">
                    <Link prefetch={false} href={`/billing/patients/${p.id}`}>
                      Account
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Bills with a balance or needing attention" />
        {queue.length === 0 ? (
          <EmptyState icon={<Wallet className="h-5 w-5" />} title="Nothing outstanding" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Patient</TH>
                  <TH>Invoice</TH>
                  <TH className="text-right">Patient share</TH>
                  <TH className="text-right">Paid</TH>
                  <TH className="text-right">Outstanding</TH>
                  <TH>
                    <span className="sr-only">Open</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {queue.map((i) => (
                  <TR key={i.id}>
                    <TD>
                      <span className="font-medium">
                        {i.patient.givenName} {i.patient.familyName}
                      </span>
                      <span className="block font-mono text-[13px] text-muted">{i.patient.mrn}</span>
                    </TD>
                    <TD className="text-[13px]">
                      <span className="font-mono">{i.ref}</span>
                      <span className="block text-muted">
                        {i.encounter.payerClass.toLowerCase().replace("_", " ")} · {i.status.toLowerCase()}
                      </span>
                      {i.totals.unresolved > 0 && (
                        <Badge tone="danger">{i.totals.unresolved} to resolve</Badge>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{formatNaira(i.totals.patientTotal)}</TD>
                    <TD className="text-right tabular-nums">{formatNaira(i.totals.paid)}</TD>
                    <TD className="text-right font-semibold tabular-nums">
                      {formatNaira(i.totals.outstanding)}
                    </TD>
                    <TD className="text-right">
                      <Button asChild size="sm" variant="secondary">
                        <Link prefetch={false} href={`/billing/invoices/${i.id}`}>
                          Open
                        </Link>
                      </Button>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
