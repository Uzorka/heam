"use client";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/forms/use-action";
import { useToast } from "@/components/forms/toaster";
import { ActionDialog } from "@/components/forms/action-form";
import { transitionAction } from "./actions";

export interface StageOption {
  to: string;
  label: string;
  needsNote: boolean;
}

export function StageButtons({ encounterId, version, options }: { encounterId: string; version: number; options: StageOption[] }) {
  const toast = useToast();
  const { run, pending, error } = useServerAction(transitionAction);
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {options.map((o) =>
        o.needsNote ? (
          <ActionDialog
            key={o.to}
            action={transitionAction}
            fixed={{ encounterId, version, toStage: o.to }}
            trigger={o.label}
            triggerVariant="ghost"
            title={o.label}
            submitLabel="Confirm"
            tone="danger"
            successMessage="Visit updated."
            fields={[{ name: "note", label: "Reason", type: "textarea", required: true, placeholder: "e.g. Left before being seen" }]}
          />
        ) : (
          <Button
            key={o.to}
            size="sm"
            variant={o.to === "IN_CONSULTATION" || o.to === "COMPLETED" ? "primary" : "secondary"}
            loading={pending}
            onClick={() => run({ encounterId, version, toStage: o.to as "COMPLETED" }, () => toast(`Moved to ${o.label.replace(/^→ /, "")}.`))}
          >
            {o.label}
          </Button>
        ),
      )}
      {error && (
        <p role="alert" className="w-full text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
