import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { listPayers } from "@/server/domains/hmo/payers";
import { formatCalendarDate } from "@/lib/time";
import { PAYER_STATUS, statusText } from "@/lib/billing-labels";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionDialog } from "@/components/forms/action-form";
import { load } from "../../_lib/guard";
import { savePayerAction } from "../actions";
import { payerFields } from "./payer-fields";

export const metadata: Metadata = { title: "Payers & tariffs" };

export default async function PayersPage() {
  const ctx = await requireAuthContext();
  const res = await load(ctx, "/hmo/payers", () => listPayers(ctx));
  if (!res.ok) return <Forbidden message={res.message} />;
  const payers = res.data;
  return (
    <>
      <PageHeader
        title="Payers & tariffs"
        description="HMOs, schemes and corporate sponsors. A provider-directory listing is not a contract: payers stay pending until activated with contract evidence."
        actions={
          can(ctx, "hmo.partner.manage") && (
            <ActionDialog
              action={savePayerAction}
              trigger="Add payer"
              triggerVariant="primary"
              title="Add a payer"
              submitLabel="Save"
              successMessage="Payer saved (pending verification)."
              fields={payerFields()}
            />
          )
        }
      />
      <Card>
        {payers.length === 0 ? (
          <EmptyState title="No payers" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Payer</TH>
                  <TH>Scheme</TH>
                  <TH>Status</TH>
                  <TH>Contract</TH>
                  <TH>Plans</TH>
                  <TH>
                    <span className="sr-only">Open</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {payers.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <span className="font-medium">{p.name}</span>
                      <span className="block font-mono text-xs text-muted">{p.code}</span>
                    </TD>
                    <TD className="text-[13px]">{statusText(p.scheme)}</TD>
                    <TD>
                      <Badge tone={PAYER_STATUS[p.status]!.tone}>{PAYER_STATUS[p.status]!.label}</Badge>
                    </TD>
                    <TD className="text-[13px]">
                      {p.contractStart && p.contractEnd
                        ? `${formatCalendarDate(p.contractStart)} – ${formatCalendarDate(p.contractEnd)}`
                        : "Not recorded"}
                    </TD>
                    <TD className="text-[13px]">{p.plans.map((pl) => pl.name).join(", ") || "—"}</TD>
                    <TD className="text-right">
                      <Button asChild size="sm" variant="secondary">
                        <Link prefetch={false} href={`/hmo/payers/${p.id}`}>
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
