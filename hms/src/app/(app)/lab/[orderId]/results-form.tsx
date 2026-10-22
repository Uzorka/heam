"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";
import { enterResultsAction } from "../actions";

interface Component {
  id: string;
  name: string;
  unit: string | null;
  resultType: "NUMERIC" | "TEXT" | "CODED";
  decimals: number | null;
  allowedValues: string[];
  reference: string | null;
  draft: string;
}

export function ResultsForm({ orderId, components }: { orderId: string; components: Component[] }) {
  const toast = useToast();
  const { run, pending, error, fieldErrors } = useServerAction(enterResultsAction);
  const [values, setValues] = React.useState<Record<string, string>>(
    Object.fromEntries(components.map((c) => [c.id, c.draft])),
  );
  const submit = (submitForVerification: boolean) =>
    run(
      {
        orderId,
        results: components.map((c) => ({ componentId: c.id, value: values[c.id] ?? "" })),
        submit: submitForVerification,
      },
      () => toast(submitForVerification ? "Submitted for verification." : "Draft results saved."),
    );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(true);
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <table className="w-full text-[14px]">
        <caption className="sr-only">Result entry</caption>
        <thead className="text-left text-xs uppercase text-muted">
          <tr>
            <th scope="col" className="py-2 font-medium">
              Component
            </th>
            <th scope="col" className="py-2 font-medium">
              Result
            </th>
            <th scope="col" className="py-2 font-medium">
              Reference (approved)
            </th>
          </tr>
        </thead>
        <tbody>
          {components.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="py-2 pr-3">
                <label htmlFor={`r-${c.id}`}>{c.name}</label>
              </td>
              <td className="py-2 pr-3">
                <div className="flex items-center gap-2">
                  {c.resultType === "CODED" ? (
                    <Select
                      id={`r-${c.id}`}
                      value={values[c.id] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
                      aria-invalid={fieldErrors[c.id] ? true : undefined}
                      className="max-w-56"
                    >
                      <option value="">Select</option>
                      {c.allowedValues.map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      id={`r-${c.id}`}
                      inputMode={c.resultType === "NUMERIC" ? "decimal" : undefined}
                      value={values[c.id] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
                      aria-invalid={fieldErrors[c.id] ? true : undefined}
                      className="max-w-40"
                    />
                  )}
                  {c.unit && <span className="text-[13px] text-muted">{c.unit}</span>}
                </div>
                {c.resultType === "NUMERIC" && c.decimals !== null && (
                  <span className="text-xs text-muted">Up to {c.decimals} decimal place(s)</span>
                )}
              </td>
              <td className="py-2 text-[13px] text-muted">
                {c.reference ?? "No approved range - no flag will be shown"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" loading={pending} onClick={() => submit(false)}>
          Save draft
        </Button>
        <Button type="submit" loading={pending}>
          Submit for verification
        </Button>
      </div>
    </form>
  );
}
