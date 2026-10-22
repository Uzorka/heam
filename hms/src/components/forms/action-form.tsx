"use client";
import * as React from "react";
import type { ActionResult } from "@/server/action";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useServerAction } from "./use-action";
import { useToast } from "./toaster";
import { cn } from "@/lib/utils";

export type FieldSpec =
  | { name: string; label: string; type: "text" | "password" | "tel" | "email" | "date" | "time" | "number"; required?: boolean; hint?: string; placeholder?: string; defaultValue?: string; span?: 2; max?: string; min?: string }
  | { name: string; label: string; type: "textarea"; required?: boolean; hint?: string; placeholder?: string; defaultValue?: string; span?: 2 }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; required?: boolean; hint?: string; defaultValue?: string; span?: 2; placeholder?: string }
  | { name: string; label: string; type: "checkbox"; hint?: string; defaultChecked?: boolean; span?: 2 }
  | { name: string; label: string; type: "multicheck"; options: { value: string; label: string; hint?: string }[]; hint?: string; defaultValues?: string[]; span?: 2 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- server actions have heterogeneous input types
type AnyAction = (input: any) => Promise<ActionResult<unknown>>;

function fieldId(prefix: string, name: string) {
  return `${prefix}-${name.replace(/\./g, "-")}`;
}

/** Convert form values into a (possibly nested) object. Empty strings become undefined. */
function collect(form: HTMLFormElement, fields: FieldSpec[]): Record<string, unknown> {
  const fd = new FormData(form);
  const out: Record<string, unknown> = {};
  const set = (path: string, v: unknown) => {
    const parts = path.split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]!] = (cur[parts[i]!] as Record<string, unknown>) ?? {};
      cur = cur[parts[i]!] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]!] = v;
  };
  for (const f of fields) {
    if (f.type === "checkbox") set(f.name, fd.get(f.name) === "on");
    else if (f.type === "multicheck") set(f.name, fd.getAll(f.name).map(String));
    else {
      const v = fd.get(f.name);
      const s = typeof v === "string" ? v.trim() : "";
      set(f.name, s === "" ? undefined : f.type === "number" ? Number(s) : s);
    }
  }
  return out;
}

export function FormFields({ fields, prefix, errors }: { fields: FieldSpec[]; prefix: string; errors: Record<string, string> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const id = fieldId(prefix, f.name);
        const cls = cn(f.span === 2 || f.type === "textarea" || f.type === "multicheck" || f.type === "checkbox" ? "sm:col-span-2" : "");
        if (f.type === "checkbox") {
          return (
            <label key={f.name} htmlFor={id} className={cn("flex items-start gap-2 text-[14px]", cls)}>
              <Checkbox id={id} name={f.name} defaultChecked={f.defaultChecked} className="mt-0.5" />
              <span>
                {f.label}
                {f.hint && <span className="block text-xs text-muted">{f.hint}</span>}
                {errors[f.name] && <span className="block text-xs font-medium text-danger">{errors[f.name]}</span>}
              </span>
            </label>
          );
        }
        if (f.type === "multicheck") {
          return (
            <fieldset key={f.name} className={cls}>
              <legend className="mb-2 text-[13px] font-medium">{f.label}</legend>
              {f.hint && <p className="mb-2 text-xs text-muted">{f.hint}</p>}
              <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-md border border-border p-3">
                {f.options.map((o) => (
                  <label key={o.value} className="flex items-start gap-2 text-[13px]">
                    <Checkbox name={f.name} value={o.value} defaultChecked={f.defaultValues?.includes(o.value)} className="mt-0.5" />
                    <span>
                      <span className="font-mono">{o.label}</span>
                      {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
                    </span>
                  </label>
                ))}
              </div>
              {errors[f.name] && <p className="mt-1 text-xs font-medium text-danger">{errors[f.name]}</p>}
            </fieldset>
          );
        }
        return (
          <Field key={f.name} label={f.label} htmlFor={id} required={f.required} hint={f.hint} error={errors[f.name]} className={cls}>
            {f.type === "select" ? (
              <Select name={f.name} defaultValue={f.defaultValue ?? ""}>
                {!f.required || !f.defaultValue ? <option value="">{f.placeholder ?? "Select"}</option> : null}
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : f.type === "textarea" ? (
              <Textarea name={f.name} defaultValue={f.defaultValue} placeholder={f.placeholder} />
            ) : (
              <Input
                name={f.name}
                type={f.type}
                defaultValue={f.defaultValue}
                placeholder={f.placeholder}
                inputMode={f.type === "tel" ? "tel" : f.type === "number" ? "numeric" : undefined}
                {...("max" in f && f.max ? { max: f.max } : {})}
                {...("min" in f && f.min ? { min: f.min } : {})}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}

interface CommonProps {
  action: AnyAction;
  fields: FieldSpec[];
  fixed?: Record<string, unknown>;
  submitLabel: string;
  successMessage: string;
  tone?: "primary" | "danger";
  intro?: React.ReactNode;
  onDone?: (data: unknown) => void;
}

function useActionFormState(p: CommonProps) {
  const toast = useToast();
  const { run, pending, error, fieldErrors } = useServerAction(p.action);
  const submit = (form: HTMLFormElement, after?: (data: unknown) => void) => {
    const values = { ...collect(form, p.fields), ...p.fixed };
    run(values, (data) => {
      toast(p.successMessage);
      after?.(data);
      p.onDone?.(data);
    });
  };
  return { submit, pending, error, fieldErrors };
}

export function ActionForm(p: CommonProps & { className?: string; resetOnSuccess?: boolean }) {
  const prefix = React.useId();
  const ref = React.useRef<HTMLFormElement>(null);
  const { submit, pending, error, fieldErrors } = useActionFormState(p);
  return (
    <form
      ref={ref}
      noValidate
      className={cn("space-y-4", p.className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget, () => p.resetOnSuccess && ref.current?.reset());
      }}
    >
      {p.intro}
      {error && <Alert tone="danger">{error}</Alert>}
      <FormFields fields={p.fields} prefix={prefix} errors={fieldErrors} />
      <Button type="submit" variant={p.tone === "danger" ? "danger" : "primary"} loading={pending}>
        {p.submitLabel}
      </Button>
    </form>
  );
}

export function ActionDialog(
  p: CommonProps & {
    trigger: React.ReactNode;
    triggerVariant?: "primary" | "secondary" | "ghost" | "danger" | "link";
    triggerSize?: "sm" | "md";
    title: string;
    description?: string;
  },
) {
  const [open, setOpen] = React.useState(false);
  const prefix = React.useId();
  const { submit, pending, error, fieldErrors } = useActionFormState(p);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={p.triggerVariant ?? "secondary"} size={p.triggerSize ?? "sm"}>
          {p.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent title={p.title} description={p.description}>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(e.currentTarget, () => setOpen(false));
          }}
        >
          {p.intro}
          {error && <Alert tone="danger">{error}</Alert>}
          <FormFields fields={p.fields} prefix={prefix} errors={fieldErrors} />
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={p.tone === "danger" ? "danger" : "primary"} loading={pending}>
              {p.submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A single-click action with a confirmation dialog (no fields). */
export function ConfirmAction(
  p: Omit<CommonProps, "fields"> & { trigger: React.ReactNode; title: string; description: string; triggerVariant?: "primary" | "secondary" | "ghost" | "danger" },
) {
  return <ActionDialog {...p} fields={[]} />;
}
