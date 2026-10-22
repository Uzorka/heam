"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";
import { createLabTestAction } from "./actions";

interface Row {
  code: string;
  name: string;
  unit: string;
  resultType: "NUMERIC" | "TEXT" | "CODED";
  decimals: string;
  allowed: string;
}
const blank = (): Row => ({
  code: "",
  name: "",
  unit: "",
  resultType: "NUMERIC",
  decimals: "1",
  allowed: "",
});

export function LabTestForm() {
  const toast = useToast();
  const { run, pending, error } = useServerAction(createLabTestAction);
  const [rows, setRows] = React.useState<Row[]>([blank()]);
  const set = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const form = e.currentTarget;
        run(
          {
            code: String(fd.get("code") ?? ""),
            name: String(fd.get("name") ?? ""),
            specimenType: String(fd.get("specimenType") ?? ""),
            turnaroundHours: fd.get("turnaroundHours") ? Number(fd.get("turnaroundHours")) : undefined,
            components: rows.map((r) => ({
              code: r.code,
              name: r.name,
              unit: r.unit || undefined,
              resultType: r.resultType,
              decimals: r.resultType === "NUMERIC" && r.decimals !== "" ? Number(r.decimals) : undefined,
              allowedValues:
                r.resultType === "CODED"
                  ? r.allowed
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : [],
            })),
          },
          () => {
            toast("Test added to the catalogue.");
            form.reset();
            setRows([blank()]);
          },
        );
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Code" htmlFor="lt-code" required>
          <Input name="code" placeholder="FBC" />
        </Field>
        <Field label="Name" htmlFor="lt-name" required className="sm:col-span-2">
          <Input name="name" placeholder="Full blood count" />
        </Field>
        <Field label="Turnaround (h)" htmlFor="lt-tat">
          <Input name="turnaroundHours" type="number" min={1} />
        </Field>
        <Field label="Specimen" htmlFor="lt-spec" required className="sm:col-span-2">
          <Input name="specimenType" placeholder="EDTA blood" />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium">Components</legend>
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[90px_1fr_90px_120px_1fr_auto] sm:items-end"
          >
            <Field label="Code" htmlFor={`c-code-${i}`}>
              <Input value={r.code} onChange={(e) => set(i, { code: e.target.value })} />
            </Field>
            <Field label="Name" htmlFor={`c-name-${i}`}>
              <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
            </Field>
            <Field label="Unit" htmlFor={`c-unit-${i}`}>
              <Input value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} />
            </Field>
            <Field label="Type" htmlFor={`c-type-${i}`}>
              <Select
                value={r.resultType}
                onChange={(e) => set(i, { resultType: e.target.value as Row["resultType"] })}
              >
                <option value="NUMERIC">Number</option>
                <option value="CODED">Choice list</option>
                <option value="TEXT">Free text</option>
              </Select>
            </Field>
            {r.resultType === "CODED" ? (
              <Field label="Options (comma separated)" htmlFor={`c-allowed-${i}`}>
                <Input
                  value={r.allowed}
                  onChange={(e) => set(i, { allowed: e.target.value })}
                  placeholder="Negative, Positive"
                />
              </Field>
            ) : r.resultType === "NUMERIC" ? (
              <Field label="Decimals" htmlFor={`c-dec-${i}`}>
                <Input
                  type="number"
                  min={0}
                  max={4}
                  value={r.decimals}
                  onChange={(e) => set(i, { decimals: e.target.value })}
                />
              </Field>
            ) : (
              <span />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove component ${i + 1}`}
              disabled={rows.length === 1}
              onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" onClick={() => setRows((x) => [...x, blank()])}>
          <Plus className="h-4 w-4" aria-hidden /> Add component
        </Button>
      </fieldset>
      <Button type="submit" loading={pending}>
        Add test
      </Button>
    </form>
  );
}
