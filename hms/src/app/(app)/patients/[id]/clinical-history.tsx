import Link from "next/link";
import type { getClinicalHistory } from "@/server/domains/clinical/workspace";
import { NOTE_TEMPLATES, SECTION_LABELS } from "@/server/domains/clinical/templates";
import { formatDate, formatDateTime } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/misc";
import { OrderResults } from "@/components/clinical/order-results";
import { FlagBadge } from "@/components/clinical/flag-badge";

type Data = Awaited<ReturnType<typeof getClinicalHistory>>;

export function ClinicalHistory({ data }: { data: Data }) {
  return (
    <div className="space-y-5">
      {data.access.basis === "BREAK_GLASS" && (
        <Alert tone="warning" title="Emergency access in use">
          Expires {data.access.breakGlassExpiresAt ? formatDateTime(data.access.breakGlassExpiresAt) : "soon"}
          . This access is reviewed by compliance.
        </Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Problem list" />
          <CardBody className="text-[14px]">
            {data.problemList.length === 0 ? (
              <p className="text-muted">None recorded.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.problemList.map((d) => (
                  <li key={d.id}>
                    {d.description} {d.code && <span className="font-mono text-xs text-muted">{d.code}</span>}{" "}
                    <Badge tone={d.certainty === "CONFIRMED" ? "success" : "warning"}>
                      {d.certainty.toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Recent vital signs" description="Units: °C, bpm, /min, mmHg, %" />
          {data.vitals.length === 0 ? (
            <EmptyState title="No vitals recorded" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-border text-left text-xs uppercase text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium" scope="col">
                      When
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      Temp
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      Pulse
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      RR
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      BP
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      SpO₂
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      Weight kg
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.vitals.slice(0, 10).map((v) => (
                    <tr key={v.id} className="border-b border-border last:border-0">
                      <td className="whitespace-nowrap px-4 py-1.5">{formatDateTime(v.measuredAt)}</td>
                      <td className="px-4 py-1.5">
                        {v.values.temperatureC ?? "-"} <FlagBadge flag={v.flags.temperatureC} />
                      </td>
                      <td className="px-4 py-1.5">
                        {v.values.pulseBpm ?? "-"} <FlagBadge flag={v.flags.pulseBpm} />
                      </td>
                      <td className="px-4 py-1.5">{v.values.respRatePerMin ?? "-"}</td>
                      <td className="px-4 py-1.5">
                        {v.values.systolicMmHg ? `${v.values.systolicMmHg}/${v.values.diastolicMmHg}` : "-"}
                      </td>
                      <td className="px-4 py-1.5">{v.values.spo2Pct ?? "-"}</td>
                      <td className="px-4 py-1.5">{v.values.weightKg ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title="Results" description="Verified laboratory results and signed imaging reports" />
        {data.results.length === 0 ? (
          <EmptyState title="No results" />
        ) : (
          <CardBody className="space-y-3">
            {data.results.map((o) => (
              <OrderResults key={o.id} o={o} />
            ))}
          </CardBody>
        )}
      </Card>
      <Card>
        <CardHeader title="Visits" description="Signed notes and diagnoses by visit" />
        {data.encounters.length === 0 ? (
          <EmptyState title="No visits" />
        ) : (
          <ul className="divide-y divide-border">
            {data.encounters.map((e) => (
              <li key={e.id} className="space-y-2 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {formatDate(e.arrivedAt)} · {e.visitType.name}
                    <span className="ml-2 text-[13px] font-normal text-muted">
                      {e.attending?.displayName ?? ""}
                    </span>
                  </p>
                  <Link
                    prefetch={false}
                    href={`/encounters/${e.id}`}
                    className="text-[13px] text-accent hover:underline"
                  >
                    Open visit
                  </Link>
                </div>
                {e.diagnoses.length > 0 && (
                  <p className="text-[13px]">
                    <span className="text-muted">Diagnoses: </span>
                    {e.diagnoses
                      .map(
                        (d) =>
                          `${d.description}${d.certainty === "PROVISIONAL" ? " (provisional)" : d.certainty === "REFUTED" ? " (refuted)" : ""}`,
                      )
                      .join("; ")}
                  </p>
                )}
                {e.notes.map((n) => {
                  const c = (n.content ?? {}) as Record<string, string>;
                  const summary = c.assessment || c.body || c.chiefComplaint || "";
                  return (
                    <details key={n.id} className="rounded-md border border-border px-3 py-2 text-[13px]">
                      <summary className="cursor-pointer">
                        {n.type === "ADDENDUM"
                          ? "Addendum"
                          : NOTE_TEMPLATES[n.type as keyof typeof NOTE_TEMPLATES]?.label}{" "}
                        · {n.author.displayName} · {n.signedAt ? formatDateTime(n.signedAt) : ""}{" "}
                        <span className="text-muted">{summary.slice(0, 80)}</span>
                      </summary>
                      <dl className="mt-2 space-y-2">
                        {Object.entries(c)
                          .filter(([, v]) => v?.trim())
                          .map(([k, v]) => (
                            <div key={k}>
                              <dt className="text-xs font-medium uppercase text-muted">
                                {SECTION_LABELS[k as keyof typeof SECTION_LABELS] ?? k}
                              </dt>
                              <dd className="whitespace-pre-wrap">{v}</dd>
                            </div>
                          ))}
                      </dl>
                    </details>
                  );
                })}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
