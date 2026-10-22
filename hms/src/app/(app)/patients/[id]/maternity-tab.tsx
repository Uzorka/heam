import Link from "next/link";
import { can, type AuthContext } from "@/server/authz/context";
import { familyLinks, patientPregnancies } from "@/server/domains/maternity/service";
import { ForbiddenError } from "@/server/errors";
import { formatCalendarDate, todayLocal } from "@/lib/time";
import { statusText } from "@/lib/billing-labels";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/misc";
import { ActionDialog } from "@/components/forms/action-form";
import { openPregnancyAction } from "../../maternity/actions";

export async function MaternityTab({
  ctx,
  patientId,
  sex,
}: {
  ctx: AuthContext;
  patientId: string;
  sex: string;
}) {
  let pregnancies: Awaited<ReturnType<typeof patientPregnancies>> | null = null;
  try {
    pregnancies = await patientPregnancies(ctx, patientId);
  } catch (e) {
    if (!(e instanceof ForbiddenError)) throw e;
  }
  const links = await familyLinks(patientId);
  return (
    <div className="space-y-5">
      {links.mother && (
        <Alert tone="info" title="Born at this facility">
          Mother:{" "}
          <Link
            prefetch={false}
            href={`/patients/${links.mother.id}`}
            className="text-accent hover:underline"
          >
            {links.mother.givenName} {links.mother.familyName} ({links.mother.mrn})
          </Link>{" "}
          · delivery {links.birth?.delivery.ref} · baby {links.birth?.birthOrder}
        </Alert>
      )}
      {links.babies.length > 0 && (
        <Card>
          <CardHeader title="Babies born here" />
          <CardBody>
            <ul className="space-y-1 text-[14px]">
              {links.babies.map((n) => (
                <li key={n.id}>
                  <Link
                    prefetch={false}
                    href={`/patients/${n.baby!.id}`}
                    className="text-accent hover:underline"
                  >
                    {n.baby!.givenName} {n.baby!.familyName}
                    {n.baby!.preferredName && ` (${n.baby!.preferredName})`}
                  </Link>{" "}
                  <span className="font-mono text-[13px] text-muted">{n.baby!.mrn}</span> · {n.delivery.ref}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      {sex !== "MALE" && (
        <Card>
          <CardHeader
            title="Pregnancies"
            actions={
              pregnancies !== null &&
              can(ctx, "maternity.write") &&
              !pregnancies.some((p) => p.status === "ACTIVE") && (
                <ActionDialog
                  action={openPregnancyAction}
                  fixed={{ patientId }}
                  trigger="Open pregnancy record"
                  triggerVariant="primary"
                  title="Book a pregnancy"
                  description="Gravida includes this pregnancy. Dating is added on the pregnancy record."
                  submitLabel="Open record"
                  successMessage="Pregnancy record opened."
                  fields={[
                    { name: "gravida", label: "Gravida", type: "number", required: true },
                    { name: "para", label: "Para", type: "number", required: true, defaultValue: "0" },
                    {
                      name: "bookingDate",
                      label: "Booking date",
                      type: "date",
                      required: true,
                      defaultValue: todayLocal(),
                    },
                    { name: "bloodGroup", label: "Blood group (if known)", type: "text" },
                    { name: "riskNotes", label: "Risk factors noted", type: "textarea" },
                  ]}
                />
              )
            }
          />
          {pregnancies === null ? (
            <CardBody>
              <p className="text-[14px] text-muted">
                Maternity records are visible to the patient&apos;s care team.
              </p>
            </CardBody>
          ) : pregnancies.length === 0 ? (
            <EmptyState title="No pregnancy records" />
          ) : (
            <CardBody>
              <ul className="divide-y divide-border">
                {pregnancies.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]"
                  >
                    <span>
                      <Link
                        prefetch={false}
                        href={`/maternity/${p.id}`}
                        className="font-mono text-accent hover:underline"
                      >
                        {p.ref}
                      </Link>{" "}
                      · G{p.gravida} P{p.para} · booked {formatCalendarDate(p.bookingDate)}
                      {p.edd && ` · EDD ${formatCalendarDate(p.edd)}`}
                    </span>
                    <Badge
                      tone={
                        p.status === "ACTIVE" ? "accent" : p.status === "DELIVERED" ? "success" : "outline"
                      }
                    >
                      {statusText(p.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          )}
        </Card>
      )}
    </div>
  );
}
