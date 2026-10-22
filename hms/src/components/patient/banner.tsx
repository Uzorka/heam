import { AlertTriangle, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatPhone } from "@/lib/phone";

const SEX: Record<string, string> = { FEMALE: "Female", MALE: "Male", INTERSEX: "Intersex", UNKNOWN: "Sex not recorded" };

export interface BannerPatient {
  mrn: string;
  givenName: string;
  middleName: string | null;
  familyName: string;
  sexAtBirth: string;
  phoneE164: string | null;
  status: string;
  registrationStatus: string;
  allergyReviewStatus: string;
  dobProvenance: string;
}

export function AllergyBadge({ status, activeCount }: { status: string; activeCount: number }) {
  if (status === "HAS_ALLERGIES" || activeCount > 0) {
    return (
      <Badge tone="danger" icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden />}>
        Allergies: {activeCount || "see record"}
      </Badge>
    );
  }
  if (status === "NO_KNOWN_ALLERGIES") {
    return (
      <Badge tone="success" icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}>
        No known allergies
      </Badge>
    );
  }
  return (
    <Badge tone="warning" icon={<ShieldQuestion className="h-3.5 w-3.5" aria-hidden />}>
      Allergies not yet asked
    </Badge>
  );
}

export function PatientBanner({ p, age, activeAllergies, allergyNames }: { p: BannerPatient; age: string | null; activeAllergies: number; allergyNames: string[] }) {
  return (
    <section aria-label="Patient summary" className="mb-5 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-7">
            {p.givenName} {p.middleName ? `${p.middleName} ` : ""}
            {p.familyName}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted">
            <span className="font-mono text-foreground">{p.mrn}</span>
            <span>
              {age ?? "Age unknown"}
              {p.dobProvenance === "ESTIMATED" ? " (estimated)" : ""}
            </span>
            <span>{SEX[p.sexAtBirth]}</span>
            {p.phoneE164 && <span className="tabular">{formatPhone(p.phoneE164)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <AllergyBadge status={p.allergyReviewStatus} activeCount={activeAllergies} />
          {p.registrationStatus === "PROVISIONAL" && (
            <Badge tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}>
              Provisional registration
            </Badge>
          )}
          {p.status !== "ACTIVE" && <Badge tone="neutral">{p.status === "MERGED" ? "Merged record" : p.status.toLowerCase()}</Badge>}
        </div>
      </div>
      {allergyNames.length > 0 && (
        <p className="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px]">
          <strong className="text-danger">Allergies:</strong> {allergyNames.join(", ")}
        </p>
      )}
    </section>
  );
}
