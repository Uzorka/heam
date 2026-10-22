import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { portalRecord } from "@/server/domains/portal/service";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { formatDateTime } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { FlagBadge } from "@/components/clinical/flag-badge";

export const metadata: Metadata = { title: "Health record" };

export default async function PortalRecordPage({ params }: { params: Promise<{ patientId: string }> }) {
  const ctx = await requireAuthContext();
  const { patientId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(patientId)) notFound();
  let rec;
  try {
    rec = await portalRecord(ctx, patientId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <Alert tone="danger">{e.message}</Alert>;
    throw e;
  }
  const p = rec.patient;
  return (
    <>
      <Link prefetch={false} href="/portal" className="text-[13px] text-muted hover:text-foreground">
        ← Back
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold">
        {p.preferredName ?? p.givenName} {p.familyName}
      </h1>
      <p className="mb-5 font-mono text-[13px] text-muted">{p.mrn}</p>
      <div className="space-y-5">
        <Card>
          <CardHeader title="Upcoming appointments" />
          <CardBody>
            {rec.appointments.length === 0 ? (
              <p className="text-[14px] text-muted">No upcoming appointments.</p>
            ) : (
              <ul className="space-y-2 text-[14px]">
                {rec.appointments.map((a) => (
                  <li key={a.id}>
                    <span className="font-medium">{formatDateTime(a.startAt)}</span> · {a.visitType.name}
                    <span className="ml-1 font-mono text-[13px] text-muted">{a.ref}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Results"
            description="Results appear here after a clinician has reviewed and released them. Ask your care team to explain anything unclear."
          />
          <CardBody className="space-y-4">
            {rec.results.length === 0 ? (
              <p className="text-[14px] text-muted">No released results.</p>
            ) : (
              rec.results.map((o) => (
                <section
                  key={o.id}
                  className="rounded-md border border-border p-3"
                  aria-label={o.description}
                >
                  <p className="font-medium">{o.description}</p>
                  <p className="mb-2 text-xs text-muted">
                    {o.verifiedAt ? `Verified ${formatDateTime(o.verifiedAt)}` : ""}
                  </p>
                  {o.results.length > 0 && (
                    <table className="w-full text-[14px]">
                      <caption className="sr-only">Results for {o.description}</caption>
                      <thead>
                        <tr className="text-left text-xs text-muted">
                          <th className="py-1 font-medium">Test</th>
                          <th className="py-1 font-medium">Result</th>
                          <th className="py-1 font-medium">Reference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.results.map((r) => (
                          <tr key={r.id} className="border-t border-border">
                            <td className="py-1.5">{r.component.name}</td>
                            <td className="py-1.5">
                              {r.valueText} {r.component.unit ?? ""} <FlagBadge flag={r.flag} />
                            </td>
                            <td className="py-1.5 text-muted">{r.referenceText ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {o.imagingReports[0] && (
                    <p className="text-[14px]">
                      <span className="block text-xs font-medium uppercase text-muted">Impression</span>
                      {o.imagingReports[0].impression}
                    </p>
                  )}
                </section>
              ))
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Documents" />
          <CardBody>
            {rec.documents.length === 0 ? (
              <p className="text-[14px] text-muted">No released documents.</p>
            ) : (
              <ul className="space-y-2">
                {rec.documents.map((d) => (
                  <li key={d.id}>
                    <a
                      href={`/api/portal/documents/${d.id}`}
                      className="inline-flex items-center gap-1.5 text-[14px] text-accent hover:underline"
                    >
                      <FileText className="h-4 w-4" aria-hidden /> {d.title}
                    </a>
                    <span className="ml-2 text-[13px] text-muted">
                      released {formatDateTime(d.releasedToPortalAt!)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
