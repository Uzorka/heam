import Link from "next/link";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/time";
import { FlagBadge, ORDER_STATUS_LABEL } from "./flag-badge";

type OrderLike = {
  id: string;
  ref: string;
  kind: string;
  description: string;
  status: string;
  priority: string;
  orderedAt: Date;
  verifiedAt: Date | null;
  reviewedAt: Date | null;
  cancelReason: string | null;
  releasedToPortalAt?: Date | null;
  clinicalIndication: string | null;
  orderedBy: { displayName: string };
  reviewedBy: { displayName: string } | null;
  results: {
    id: string;
    valueText: string;
    unit: string | null;
    referenceText: string | null;
    flag: string;
    supersededAt: Date | null;
    amendmentReason: string | null;
    verifiedAt: Date | null;
    component: { name: string; sortOrder: number };
    verifiedBy: { displayName: string } | null;
  }[];
  imagingReports: {
    id: string;
    findings: string;
    impression: string;
    signedAt: Date | null;
    amendmentReason: string | null;
    signedBy: { displayName: string } | null;
  }[];
  criticalAlerts: { id: string; acknowledgedAt: Date | null }[];
  documents: {
    id: string;
    title: string;
    filename: string;
    source: string;
    sourceDescription: string | null;
    scanStatus: string;
    releasedToPortalAt?: Date | null;
  }[];
};

/** Read-only rendering of an order with verified results / signed reports. */
export function OrderResults({
  o,
  actions,
  documentActions,
}: {
  o: OrderLike;
  actions?: React.ReactNode;
  /** Optional per-document controls (e.g. release to the patient portal). */
  documentActions?: (d: OrderLike["documents"][number]) => React.ReactNode;
}) {
  const current = o.results
    .filter((r) => !r.supersededAt)
    .sort((a, b) => a.component.sortOrder - b.component.sortOrder);
  const superseded = o.results.filter((r) => r.supersededAt);
  const latestReport = o.imagingReports[o.imagingReports.length - 1];
  return (
    <article className="rounded-md border border-border p-3" aria-label={`${o.description} ${o.ref}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {o.description}{" "}
            {o.priority !== "ROUTINE" && (
              <Badge tone={o.priority === "STAT" ? "danger" : "warning"}>{o.priority.toLowerCase()}</Badge>
            )}
          </p>
          <p className="text-xs text-muted">
            <span className="font-mono">{o.ref}</span> · ordered {formatDateTime(o.orderedAt)} by{" "}
            {o.orderedBy.displayName}
            {o.clinicalIndication ? ` · ${o.clinicalIndication}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            tone={
              o.status === "CANCELLED"
                ? "outline"
                : o.status === "VERIFIED" || o.status === "COMPLETED"
                  ? "success"
                  : "accent"
            }
          >
            {ORDER_STATUS_LABEL[o.status]}
          </Badge>
          {o.criticalAlerts.some((a) => !a.acknowledgedAt) && (
            <Badge tone="danger">Critical - not acknowledged</Badge>
          )}
          {o.status === "VERIFIED" &&
            (o.reviewedAt ? (
              <Badge tone="neutral">Reviewed by {o.reviewedBy?.displayName}</Badge>
            ) : (
              <Badge tone="warning">Not yet reviewed</Badge>
            ))}
          {o.releasedToPortalAt && <Badge tone="info">On patient portal</Badge>}
          {actions}
        </div>
      </div>
      {o.status === "CANCELLED" && o.cancelReason && (
        <p className="mt-1 text-xs text-muted">Cancelled: {o.cancelReason}</p>
      )}
      {current.length > 0 && (
        <table className="mt-2 w-full text-[13px]">
          <caption className="sr-only">Results for {o.description}</caption>
          <thead className="text-left text-xs text-muted">
            <tr>
              <th scope="col" className="py-1 font-medium">
                Test
              </th>
              <th scope="col" className="py-1 font-medium">
                Result
              </th>
              <th scope="col" className="py-1 font-medium">
                Reference
              </th>
              <th scope="col" className="py-1 font-medium">
                Flag
              </th>
            </tr>
          </thead>
          <tbody>
            {current.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1.5">{r.component.name}</td>
                <td className="tabular py-1.5 font-medium">
                  {r.valueText} {r.unit}
                  {r.amendmentReason && (
                    <span className="block text-xs font-normal text-warning">
                      Amended: {r.amendmentReason}
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-muted">{r.referenceText ?? "No approved range"}</td>
                <td className="py-1.5">
                  <FlagBadge flag={r.flag} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {current[0]?.verifiedBy && (
        <p className="mt-1 text-xs text-muted">
          Verified by {current[0].verifiedBy.displayName}
          {current[0].verifiedAt ? ` · ${formatDateTime(current[0].verifiedAt)}` : ""}
          {superseded.length ? ` · ${superseded.length} earlier value(s) superseded` : ""}
        </p>
      )}
      {latestReport && (
        <div className="mt-2 space-y-1 text-[14px]">
          <p>
            <span className="text-xs font-medium uppercase text-muted">Findings</span>
            <span className="block whitespace-pre-wrap">{latestReport.findings}</span>
          </p>
          <p>
            <span className="text-xs font-medium uppercase text-muted">Impression</span>
            <span className="block whitespace-pre-wrap font-medium">{latestReport.impression}</span>
          </p>
          <p className="text-xs text-muted">
            Signed by {latestReport.signedBy?.displayName}
            {latestReport.signedAt ? ` · ${formatDateTime(latestReport.signedAt)}` : ""}
            {latestReport.amendmentReason ? ` · amended report (${latestReport.amendmentReason})` : ""}
          </p>
        </div>
      )}
      {o.documents.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {o.documents.map((d) => (
            <li key={d.id}>
              <Link
                prefetch={false}
                href={`/api/documents/${d.id}`}
                className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden /> {d.title}
                {d.source === "EXTERNAL" && (
                  <span className="text-muted"> (external: {d.sourceDescription})</span>
                )}
                {d.scanStatus === "NOT_SCANNED" && <span className="text-muted"> · not virus-scanned</span>}
              </Link>
              {d.releasedToPortalAt && (
                <Badge tone="info" className="ml-1">
                  on portal
                </Badge>
              )}
              {documentActions?.(d)}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
