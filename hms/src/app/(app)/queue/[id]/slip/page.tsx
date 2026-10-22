import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { getEncounterForSlip } from "@/server/domains/queue/service";
import { getOrganization } from "@/server/domains/settings/service";
import { formatAge, formatDateTime } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Forbidden } from "@/components/ui/misc";
import { load } from "../../../_lib/guard";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Visit slip" };

export default async function SlipPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const ctx = await requireAuthContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load(ctx, `/queue/${id}/slip`, () => getEncounterForSlip(ctx, id));
  if (!res.ok) return res.kind === "notfound" ? notFound() : <Forbidden />;
  const e = res.data;
  const org = await getOrganization();
  const { new: isNew } = await searchParams;
  return (
    <div className="mx-auto max-w-md space-y-4">
      {isNew && (
        <div className="no-print">
          <Alert tone="success">Checked in. Visit reference {e.ref}.</Alert>
        </div>
      )}
      <div className="no-print flex gap-2">
        <PrintButton />
        <Button asChild variant="secondary">
          <Link prefetch={false} href="/queue">
            Back to queue
          </Link>
        </Button>
      </div>
      <article className="rounded-lg border border-border bg-background p-6 text-[14px] print:border-0 print:p-0">
        <header className="mb-4 border-b border-border pb-3 text-center">
          <p className="font-semibold tracking-[0.18em]">{org.name.toUpperCase()}</p>
          <p className="text-xs text-muted">
            {e.branch.name}
            {e.branch.addressLine ? ` · ${e.branch.addressLine}` : ""}
          </p>
          <p className="mt-2 text-[13px] font-medium">Visit slip</p>
        </header>
        <dl className="grid grid-cols-[120px_1fr] gap-y-1.5">
          <dt className="text-muted">Patient</dt>
          <dd className="font-medium">
            {e.patient.givenName} {e.patient.familyName}
          </dd>
          <dt className="text-muted">MRN</dt>
          <dd className="font-mono">{e.patient.mrn}</dd>
          <dt className="text-muted">Age / sex</dt>
          <dd>
            {e.patient.dateOfBirth ? formatAge(e.patient.dateOfBirth) : "-"} ·{" "}
            {e.patient.sexAtBirth.toLowerCase()}
          </dd>
          <dt className="text-muted">Visit</dt>
          <dd>{e.visitType.name}</dd>
          <dt className="text-muted">Reference</dt>
          <dd className="font-mono">{e.ref}</dd>
          <dt className="text-muted">Arrived</dt>
          <dd>{formatDateTime(e.arrivedAt)}</dd>
          <dt className="text-muted">Clinician</dt>
          <dd>{e.attending?.displayName ?? "To be assigned"}</dd>
        </dl>
        <p className="mt-4 border-t border-border pt-3 text-center text-xs text-muted">
          Please keep this slip and present it at each service point. {org.tagline ?? ""}
        </p>
      </article>
    </div>
  );
}
