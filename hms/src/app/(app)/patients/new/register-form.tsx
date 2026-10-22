"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { AlertTriangle } from "lucide-react";
import { registerPatientSchema, IDENTIFIER_TYPES, NIGERIAN_STATES } from "@/lib/schemas/patient";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { ErrorSummary, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { registerPatientAction } from "../actions";
import type { DuplicateCandidate } from "@/server/domains/patients/service";

type In = z.input<typeof registerPatientSchema>;
type Out = z.output<typeof registerPatientSchema>;

const ID_LABEL: Record<string, string> = {
  NIN: "National Identification Number (NIN)",
  NHIA_NUMBER: "NHIA number",
  PASSPORT: "International passport",
  VOTERS_CARD: "Voter's card",
  DRIVERS_LICENCE: "Driver's licence",
  OTHER: "Other",
};

function flatten(errors: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) {
    if (!v || typeof v !== "object") continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if ("message" in v && typeof (v as { message?: unknown }).message === "string")
      out[key] = (v as { message: string }).message;
    else Object.assign(out, flatten(v as Record<string, unknown>, key));
  }
  return out;
}

export function RegisterForm({ emergency }: { emergency: boolean }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"COMPLETE" | "PROVISIONAL">(emergency ? "PROVISIONAL" : "COMPLETE");
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [serverFields, setServerFields] = React.useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = React.useState<DuplicateCandidate[] | null>(null);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [pending, start] = React.useTransition();
  const summaryRef = React.useRef<HTMLDivElement>(null);

  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(registerPatientSchema),
    defaultValues: {
      registrationStatus: mode,
      dobProvenance: "STATED",
      sexAtBirth: emergency ? "UNKNOWN" : ("" as In["sexAtBirth"]),
      givenName: emergency ? "Unknown" : "",
      familyName: "",
      allergyReviewStatus: "NOT_ASKED",
      privacyNoticeGiven: false,
      smsReminderConsent: false,
      acknowledgedDuplicateIds: [],
      state: "Lagos",
      identifier: { type: "NIN", value: "" },
    },
  });
  const { register, handleSubmit, formState, setValue, watch } = form;
  const errors = { ...flatten(formState.errors as Record<string, unknown>), ...serverFields };
  const useAge = watch("dobProvenance") === "ESTIMATED";

  React.useEffect(() => setValue("registrationStatus", mode), [mode, setValue]);
  React.useEffect(() => {
    if (Object.keys(errors).length || serverError)
      summaryRef.current?.querySelector<HTMLElement>("[role=alert]")?.focus();
  }, [formState.submitCount, serverError]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (values: Out, ackIds: string[] = []) => {
    setServerError(null);
    setServerFields({});
    start(async () => {
      const r = await registerPatientAction({ ...values, acknowledgedDuplicateIds: ackIds });
      if (!r.ok) {
        setServerError(r.error);
        setServerFields(r.fieldErrors ?? {});
        return;
      }
      if (r.data.status === "DUPLICATES_FOUND") {
        setDuplicates(r.data.candidates);
        setAcknowledged(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      router.push(`/patients/${r.data.patientId}?registered=1`);
    });
  };

  return (
    <form
      noValidate
      onSubmit={handleSubmit((v) => submit(v))}
      className="space-y-6"
      aria-describedby="form-intro"
    >
      <p id="form-intro" className="sr-only">
        Fields marked with an asterisk are required.
      </p>
      <div ref={summaryRef} className="space-y-3">
        {serverError && <Alert tone="danger">{serverError}</Alert>}
        {formState.submitCount > 0 && (
          <ErrorSummary errors={flatten(formState.errors as Record<string, unknown>)} />
        )}
      </div>

      {duplicates && (
        <Card className="border-warning/50">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Possible existing record
              </span>
            }
            description="These records look similar. Open them to check before creating a new record. Nothing has been saved yet."
          />
          <CardBody className="space-y-3">
            <ul className="divide-y divide-border rounded-md border border-border">
              {duplicates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div>
                    <p className="font-medium">
                      {d.name} <span className="font-mono text-[13px] text-muted">{d.mrn}</span>
                    </p>
                    <p className="text-[13px] text-muted">
                      Born {d.birthYear ?? "unknown"} · {d.maskedPhone || "no phone"} · Match:{" "}
                      {d.reasons.join(", ")}
                    </p>
                  </div>
                  <Button asChild variant="secondary" size="sm">
                    <Link prefetch={false} href={`/patients/${d.id}`} target="_blank" rel="noopener">
                      Open record
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-2 text-[14px]">
              <Checkbox
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I have checked these records and this is a different person. Create a new record (the match
                will be queued for medical records review).
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={!acknowledged}
                loading={pending}
                onClick={handleSubmit((v) =>
                  submit(
                    v,
                    duplicates.map((d) => d.id),
                  ),
                )}
              >
                Register as new patient
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDuplicates(null)}>
                Edit details
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Registration type" />
        <CardBody>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="sr-only">Registration type</legend>
            {(
              [
                ["COMPLETE", "Full registration", "Identity, contact and privacy notice captured now."],
                [
                  "PROVISIONAL",
                  "Emergency / minimum details",
                  "Treat first; complete identity later. Flagged until completed.",
                ],
              ] as const
            ).map(([v, label, hint]) => (
              <label
                key={v}
                className={`flex min-w-[240px] flex-1 cursor-pointer gap-3 rounded-md border p-3 ${mode === v ? "border-accent bg-accent-soft" : "border-border"}`}
              >
                <input
                  type="radio"
                  name="mode"
                  value={v}
                  checked={mode === v}
                  onChange={() => setMode(v)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="block text-[13px] text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Patient details" />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="First name" htmlFor="givenName" required error={errors.givenName}>
            <Input autoComplete="off" {...register("givenName")} />
          </Field>
          <Field label="Middle name" htmlFor="middleName" error={errors.middleName}>
            <Input autoComplete="off" {...register("middleName")} />
          </Field>
          <Field
            label="Surname"
            htmlFor="familyName"
            required
            error={errors.familyName}
            hint={mode === "PROVISIONAL" ? 'e.g. "Unidentified male ~40"' : undefined}
          >
            <Input autoComplete="off" {...register("familyName")} />
          </Field>
          <Field label="Preferred name" htmlFor="preferredName" error={errors.preferredName}>
            <Input autoComplete="off" {...register("preferredName")} />
          </Field>
          <Field label="Sex at birth" htmlFor="sexAtBirth" required error={errors.sexAtBirth}>
            <Select {...register("sexAtBirth")}>
              <option value="">Select</option>
              <option value="FEMALE">Female</option>
              <option value="MALE">Male</option>
              <option value="INTERSEX">Intersex</option>
              <option value="UNKNOWN">Unknown / not stated</option>
            </Select>
          </Field>
          <Field label="Date of birth source" htmlFor="dobProvenance" required error={errors.dobProvenance}>
            <Select {...register("dobProvenance")}>
              <option value="DOCUMENT">Seen on a document</option>
              <option value="STATED">Stated by patient / relative</option>
              <option value="ESTIMATED">Unknown - estimate age</option>
              <option value="UNKNOWN">Unknown</option>
            </Select>
          </Field>
          {useAge ? (
            <Field
              label="Estimated age (years)"
              htmlFor="estimatedAgeYears"
              required={mode === "COMPLETE"}
              error={errors.estimatedAgeYears}
            >
              <Input
                inputMode="numeric"
                {...register("estimatedAgeYears", {
                  setValueAs: (v) => (v === "" || v === undefined ? undefined : Number(v)),
                })}
              />
            </Field>
          ) : (
            <Field
              label="Date of birth"
              htmlFor="dateOfBirth"
              required={mode === "COMPLETE"}
              error={errors.dateOfBirth}
            >
              <Input type="date" max={new Date().toISOString().slice(0, 10)} {...register("dateOfBirth")} />
            </Field>
          )}
          <Field label="Occupation" htmlFor="occupation" error={errors.occupation}>
            <Input {...register("occupation")} />
          </Field>
          <Field label="Marital status" htmlFor="maritalStatus" error={errors.maritalStatus}>
            <Select {...register("maritalStatus")}>
              <option value="">Not stated</option>
              <option>Single</option>
              <option>Married</option>
              <option>Widowed</option>
              <option>Separated</option>
              <option>Divorced</option>
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Contact" />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Mobile phone"
            htmlFor="phone"
            error={errors.phone}
            hint="Nigerian numbers can start with 0"
          >
            <Input type="tel" inputMode="tel" autoComplete="off" {...register("phone")} />
          </Field>
          <Field label="Alternative phone" htmlFor="altPhone" error={errors.altPhone}>
            <Input type="tel" inputMode="tel" autoComplete="off" {...register("altPhone")} />
          </Field>
          <Field label="Email" htmlFor="email" error={errors.email}>
            <Input type="email" autoComplete="off" {...register("email")} />
          </Field>
          <Field label="Address" htmlFor="addressLine" error={errors.addressLine} className="sm:col-span-2">
            <Input autoComplete="off" {...register("addressLine")} />
          </Field>
          <Field label="Town / city" htmlFor="city" error={errors.city}>
            <Input {...register("city")} />
          </Field>
          <Field label="LGA" htmlFor="lga" error={errors.lga}>
            <Input {...register("lga")} />
          </Field>
          <Field label="State" htmlFor="state" error={errors.state}>
            <Select {...register("state")}>
              <option value="">Not stated</option>
              {NIGERIAN_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Referral source" htmlFor="referralSource" error={errors.referralSource}>
            <Input placeholder="e.g. self, another facility" {...register("referralSource")} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Next of kin" />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" htmlFor="nextOfKin-name" error={errors["nextOfKin.name"]}>
            <Input {...register("nextOfKin.name")} />
          </Field>
          <Field
            label="Relationship"
            htmlFor="nextOfKin-relationship"
            error={errors["nextOfKin.relationship"]}
          >
            <Input placeholder="e.g. Spouse, Mother" {...register("nextOfKin.relationship")} />
          </Field>
          <Field label="Phone" htmlFor="nextOfKin-phone" error={errors["nextOfKin.phone"]}>
            <Input type="tel" inputMode="tel" {...register("nextOfKin.phone")} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Identity document (optional)"
          description="Only record if needed. Stored encrypted and masked on screen."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Document type" htmlFor="identifier-type">
            <Select {...register("identifier.type")}>
              {IDENTIFIER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ID_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Number" htmlFor="identifier-value" error={errors["identifier.value"]}>
            <Input autoComplete="off" {...register("identifier.value")} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Allergies & consent" />
        <CardBody className="space-y-4">
          <Field
            label="Allergies (as reported at the desk)"
            htmlFor="allergyReviewStatus"
            hint="Detailed allergies can be added on the patient record. Clinicians verify them."
          >
            <Select {...register("allergyReviewStatus")}>
              <option value="NOT_ASKED">Not asked yet</option>
              <option value="NO_KNOWN_ALLERGIES">Patient reports no known allergies</option>
              <option value="HAS_ALLERGIES">Patient reports allergies - record details next</option>
            </Select>
          </Field>
          <label className="flex items-start gap-2 text-[14px]" htmlFor="privacyNoticeGiven">
            <Checkbox
              id="privacyNoticeGiven"
              {...register("privacyNoticeGiven")}
              className="mt-0.5"
              aria-invalid={errors.privacyNoticeGiven ? true : undefined}
            />
            <span>
              The patient (or their representative) was given the hospital&apos;s privacy notice explaining
              how their information is used.
              {mode === "COMPLETE" && <span className="text-danger"> *</span>}
              {errors.privacyNoticeGiven && (
                <span className="block text-xs font-medium text-danger">{errors.privacyNoticeGiven}</span>
              )}
            </span>
          </label>
          <label className="flex items-start gap-2 text-[14px]" htmlFor="smsReminderConsent">
            <Checkbox id="smsReminderConsent" {...register("smsReminderConsent")} className="mt-0.5" />
            <span>
              Patient agrees to receive appointment reminders by SMS (no clinical details are ever sent).
            </span>
          </label>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          {mode === "PROVISIONAL" ? "Register (provisional)" : "Register patient"}
        </Button>
        <Button asChild variant="ghost">
          <Link prefetch={false} href="/patients">
            Cancel
          </Link>
        </Button>
      </div>
    </form>
  );
}
