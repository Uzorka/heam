"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useToast } from "@/components/forms/toaster";
import { uploadDocumentAction } from "@/app/(app)/documents-actions";

export function UploadForm({
  orderId,
  encounterId,
  defaultKind,
}: {
  orderId?: string;
  encounterId?: string;
  defaultKind: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [source, setSource] = React.useState("INTERNAL");
  const ref = React.useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (orderId) fd.set("orderId", orderId);
        if (encounterId) fd.set("encounterId", encounterId);
        setError(null);
        start(async () => {
          const r = await uploadDocumentAction(fd);
          if (!r.ok) return setError(r.error);
          toast("Document uploaded.");
          ref.current?.reset();
          setSource("INTERNAL");
          router.refresh();
        });
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-3">
        <Field label="File (PDF, PNG or JPEG, max 10 MB)" htmlFor={`file-${orderId ?? encounterId}`} required>
          <Input type="file" name="file" accept="application/pdf,image/png,image/jpeg" className="py-1.5" />
        </Field>
        <Field label="Title" htmlFor={`title-${orderId ?? encounterId}`}>
          <Input name="title" />
        </Field>
        <Field label="Type" htmlFor={`kind-${orderId ?? encounterId}`}>
          <Select name="kind" defaultValue={defaultKind}>
            <option value="LAB_REPORT">Lab report</option>
            <option value="IMAGING">Imaging</option>
            <option value="REFERRAL">Referral letter</option>
            <option value="CONSENT">Signed consent</option>
            <option value="CLINICAL_OTHER">Other clinical</option>
          </Select>
        </Field>
        <Field label="Origin" htmlFor={`source-${orderId ?? encounterId}`}>
          <Select name="source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="INTERNAL">Produced here</option>
            <option value="EXTERNAL">From another facility</option>
          </Select>
        </Field>
        {source === "EXTERNAL" && (
          <Field label="Source facility / author" htmlFor={`sd-${orderId ?? encounterId}`} required>
            <Input name="sourceDescription" />
          </Field>
        )}
      </div>
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        <Upload className="h-4 w-4" aria-hidden /> Upload
      </Button>
    </form>
  );
}
