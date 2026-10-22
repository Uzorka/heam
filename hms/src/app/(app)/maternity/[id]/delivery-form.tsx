"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";
import { deliveryAction } from "../actions";

interface Baby {
  key: string;
  outcome: "LIVE_BIRTH" | "FRESH_STILLBIRTH" | "MACERATED_STILLBIRTH";
  sex: "FEMALE" | "MALE" | "INTERSEX" | "UNKNOWN";
  birthTime: string;
  birthWeightG: string;
  apgar1: string;
  apgar5: string;
  resuscitation: string;
}

const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

/** Delivery record with one block per baby (twins and more). Signing uses the clinician's password. */
export function DeliveryForm({
  episodeId,
  today,
  motherAdmitted,
}: {
  episodeId: string;
  today: string;
  motherAdmitted: boolean;
}) {
  const toast = useToast();
  const { run, pending, error, fieldErrors } = useServerAction(deliveryAction);
  const idp = React.useId();
  const next = React.useRef(1);
  const blank = (): Baby => ({
    key: String(next.current++),
    outcome: "LIVE_BIRTH",
    sex: "UNKNOWN",
    birthTime: "",
    birthWeightG: "",
    apgar1: "",
    apgar5: "",
    resuscitation: "",
  });
  const [babies, setBabies] = React.useState<Baby[]>(() => [
    {
      key: "0",
      outcome: "LIVE_BIRTH",
      sex: "UNKNOWN",
      birthTime: "",
      birthWeightG: "",
      apgar1: "",
      apgar5: "",
      resuscitation: "",
    },
  ]);
  const [date, setDate] = React.useState(today);
  const [mode, setMode] = React.useState("SVD");
  const [bloodLoss, setBloodLoss] = React.useState("");
  const [placenta, setPlacenta] = React.useState(true);
  const [perineum, setPerineum] = React.useState("");
  const [complications, setComplications] = React.useState("");
  const [attendants, setAttendants] = React.useState("");
  const [rooming, setRooming] = React.useState(true);
  const [password, setPassword] = React.useState("");
  const update = (key: string, patch: Partial<Baby>) =>
    setBabies((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          {
            episodeId,
            deliveryDate: date,
            mode: mode as never,
            bloodLossMl: num(bloodLoss),
            placentaComplete: placenta,
            perineum: perineum.trim() || undefined,
            complications: complications.trim() || undefined,
            attendants: attendants.trim() || undefined,
            admitBabiesWithMother: rooming,
            password,
            babies: babies.map((b, i) => ({
              birthOrder: i + 1,
              outcome: b.outcome,
              sex: b.sex,
              birthTime: b.birthTime,
              birthWeightG: num(b.birthWeightG),
              apgar1: num(b.apgar1),
              apgar5: num(b.apgar5),
              resuscitation: b.resuscitation.trim() || undefined,
            })),
          },
          (r) => {
            toast(`Delivery ${r.ref} signed. ${r.babies} baby record(s) created.`);
            setPassword("");
          },
        );
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Delivery date" htmlFor={`${idp}-date`} required error={fieldErrors.deliveryDate}>
          <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Mode of delivery" htmlFor={`${idp}-mode`} required>
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="SVD">Spontaneous vaginal</option>
            <option value="ASSISTED_VACUUM">Assisted - vacuum</option>
            <option value="ASSISTED_FORCEPS">Assisted - forceps</option>
            <option value="BREECH">Vaginal breech</option>
            <option value="CAESAREAN_EMERGENCY">Caesarean - emergency</option>
            <option value="CAESAREAN_ELECTIVE">Caesarean - elective</option>
          </Select>
        </Field>
        <Field label="Estimated blood loss (mL)" htmlFor={`${idp}-ebl`} error={fieldErrors.bloodLossMl}>
          <Input type="number" min={0} value={bloodLoss} onChange={(e) => setBloodLoss(e.target.value)} />
        </Field>
        <Field label="Perineum" htmlFor={`${idp}-per`}>
          <Input
            value={perineum}
            onChange={(e) => setPerineum(e.target.value)}
            placeholder="e.g. intact, 1st-degree tear"
          />
        </Field>
        <Field label="Attendants" htmlFor={`${idp}-att`}>
          <Input value={attendants} onChange={(e) => setAttendants(e.target.value)} />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-[14px]">
          <Checkbox checked={placenta} onChange={(e) => setPlacenta(e.target.checked)} /> Placenta and
          membranes complete
        </label>
        <Field label="Complications / interventions" htmlFor={`${idp}-comp`} className="sm:col-span-3">
          <Textarea rows={2} value={complications} onChange={(e) => setComplications(e.target.value)} />
        </Field>
      </div>
      {babies.map((b, idx) => {
        const err = (f: string) => fieldErrors[`babies.${idx}.${f}`];
        const id = (f: string) => `${idp}-${b.key}-${f}`;
        return (
          <fieldset key={b.key} className="rounded-md border border-border p-3">
            <legend className="px-1 text-[13px] font-medium">
              Baby {idx + 1}
              {babies.length > 1 ? " (birth order)" : ""}
            </legend>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Outcome" htmlFor={id("out")} required>
                <Select
                  value={b.outcome}
                  onChange={(e) => update(b.key, { outcome: e.target.value as Baby["outcome"] })}
                >
                  <option value="LIVE_BIRTH">Live birth</option>
                  <option value="FRESH_STILLBIRTH">Fresh stillbirth</option>
                  <option value="MACERATED_STILLBIRTH">Macerated stillbirth</option>
                </Select>
              </Field>
              <Field label="Sex" htmlFor={id("sex")} required>
                <Select value={b.sex} onChange={(e) => update(b.key, { sex: e.target.value as Baby["sex"] })}>
                  <option value="UNKNOWN">Not determined</option>
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                  <option value="INTERSEX">Intersex</option>
                </Select>
              </Field>
              <Field label="Time of birth" htmlFor={id("time")} required error={err("birthTime")}>
                <Input
                  type="time"
                  value={b.birthTime}
                  onChange={(e) => update(b.key, { birthTime: e.target.value })}
                />
              </Field>
              <Field label="Birth weight (g)" htmlFor={id("wt")} error={err("birthWeightG")}>
                <Input
                  type="number"
                  value={b.birthWeightG}
                  onChange={(e) => update(b.key, { birthWeightG: e.target.value })}
                />
              </Field>
              <Field label="Apgar 1 min" htmlFor={id("a1")} error={err("apgar1")}>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={b.apgar1}
                  onChange={(e) => update(b.key, { apgar1: e.target.value })}
                />
              </Field>
              <Field label="Apgar 5 min" htmlFor={id("a5")} error={err("apgar5")}>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={b.apgar5}
                  onChange={(e) => update(b.key, { apgar5: e.target.value })}
                />
              </Field>
              <Field label="Resuscitation" htmlFor={id("res")} className="sm:col-span-2">
                <Input
                  value={b.resuscitation}
                  onChange={(e) => update(b.key, { resuscitation: e.target.value })}
                  placeholder="e.g. none, bag-mask"
                />
              </Field>
            </div>
            {babies.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setBabies((bs) => bs.filter((x) => x.key !== b.key))}
              >
                <Trash2 className="h-4 w-4" aria-hidden /> Remove baby {idx + 1}
              </Button>
            )}
          </fieldset>
        );
      })}
      {fieldErrors.babies && <p className="text-xs font-medium text-danger">{fieldErrors.babies}</p>}
      <Button type="button" variant="secondary" size="sm" onClick={() => setBabies((bs) => [...bs, blank()])}>
        <Plus className="h-4 w-4" aria-hidden /> Add another baby (multiple birth)
      </Button>
      {motherAdmitted && (
        <label className="flex items-start gap-2 text-[14px]">
          <Checkbox checked={rooming} onChange={(e) => setRooming(e.target.checked)} className="mt-0.5" />
          Admit live-born babies with the mother (rooming-in), each on their own record
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your password (signature)" htmlFor={`${idp}-pw`} required error={fieldErrors.password}>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </div>
      <p className="text-[13px] text-muted">
        Signed delivery records cannot be edited. Each live-born baby gets a separate hospital number linked
        to the mother.
      </p>
      <Button type="submit" loading={pending} disabled={!password}>
        Sign delivery record
      </Button>
    </form>
  );
}
