"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";
import { parseNairaToKobo } from "@/lib/money";
import { createPurchaseOrderAction, createRequisitionAction } from "../actions";

interface Product {
  id: string;
  label: string;
  unit: string;
}
interface Line {
  key: string;
  productId: string;
  quantity: string;
  cost: string;
}

// Keys feed element ids, so they must match between server render and hydration (no random UUIDs).
const blank = (key: string, p?: Partial<Line>): Line => ({
  key,
  productId: "",
  quantity: "",
  cost: "",
  ...p,
});

/**
 * Requisition (quantities + justification) or purchase order (supplier + unit cost per line).
 * Costs are typed in naira from the supplier's quotation and converted to integer kobo.
 */
export function LineItemsForm({
  mode,
  branchId,
  products,
  suppliers = [],
  requisitionId,
  initial = [],
  onDone,
}: {
  mode: "requisition" | "order";
  branchId: string;
  products: Product[];
  suppliers?: { id: string; name: string }[];
  requisitionId?: string;
  initial?: { productId: string; quantity: number }[];
  onDone?: () => void;
}) {
  const toast = useToast();
  const req = useServerAction(createRequisitionAction);
  const po = useServerAction(createPurchaseOrderAction);
  const { pending, error, fieldErrors } = mode === "requisition" ? req : po;
  const idp = React.useId();
  const nextKey = React.useRef(initial.length + 1);
  const fresh = () => blank(String(nextKey.current++));
  const [lines, setLines] = React.useState<Line[]>(() =>
    initial.length
      ? initial.map((i, n) => blank(String(n), { productId: i.productId, quantity: String(i.quantity) }))
      : [blank("0")],
  );
  const [text, setText] = React.useState("");
  const [supplierId, setSupplierId] = React.useState("");
  const [costError, setCostError] = React.useState<string | null>(null);
  const update = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setCostError(null);
        if (mode === "requisition") {
          req.run(
            {
              branchId,
              justification: text,
              items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) || 0 })),
            },
            () => {
              toast("Requisition submitted for approval.");
              setLines([fresh()]);
              setText("");
              onDone?.();
            },
          );
        } else {
          let items;
          try {
            items = lines.map((l) => ({
              productId: l.productId,
              quantity: Number(l.quantity) || 0,
              unitCostKobo: Number(parseNairaToKobo(l.cost)),
            }));
          } catch {
            setCostError("Enter each unit cost in naira, e.g. 1250 or 1,250.50.");
            return;
          }
          po.run({ branchId, supplierId, requisitionId, notes: text.trim() || undefined, items }, () => {
            toast("Purchase order created as a draft.");
            setLines([fresh()]);
            setText("");
            onDone?.();
          });
        }
      }}
    >
      {(error || costError) && <Alert tone="danger">{costError ?? error}</Alert>}
      {mode === "order" && (
        <Field label="Supplier" htmlFor={`${idp}-supplier`} required error={fieldErrors.supplierId}>
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Choose…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {lines.map((l, idx) => {
        const p = products.find((x) => x.id === l.productId);
        return (
          <div key={l.key} className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_9rem_auto]">
            <Field
              label={`Item ${idx + 1}`}
              htmlFor={`${idp}-${l.key}-p`}
              required
              error={fieldErrors[`items.${idx}.productId`]}
            >
              <Select value={l.productId} onChange={(e) => update(l.key, { productId: e.target.value })}>
                <option value="">Choose…</option>
                {products.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={`Quantity${p ? ` (${p.unit})` : ""}`}
              htmlFor={`${idp}-${l.key}-q`}
              required
              error={fieldErrors[`items.${idx}.quantity`]}
            >
              <Input
                type="number"
                min={1}
                value={l.quantity}
                onChange={(e) => update(l.key, { quantity: e.target.value })}
              />
            </Field>
            {mode === "order" ? (
              <Field label="Unit cost (₦)" htmlFor={`${idp}-${l.key}-c`} required>
                <Input
                  inputMode="decimal"
                  value={l.cost}
                  onChange={(e) => update(l.key, { cost: e.target.value })}
                />
              </Field>
            ) : (
              <span />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              aria-label={`Remove item ${idx + 1}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        );
      })}
      <Button type="button" variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, fresh()])}>
        <Plus className="h-4 w-4" aria-hidden /> Add item
      </Button>
      <Field
        label={mode === "requisition" ? "Justification" : "Notes (optional)"}
        htmlFor={`${idp}-text`}
        required={mode === "requisition"}
        error={fieldErrors.justification}
      >
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Button type="submit" loading={pending}>
        {mode === "requisition" ? "Submit requisition" : "Create purchase order"}
      </Button>
    </form>
  );
}
