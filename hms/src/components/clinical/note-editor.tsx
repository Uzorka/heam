"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { ConfirmAction } from "@/components/forms/action-form";
import { saveNoteAction, signNoteAction, discardNoteAction } from "@/app/(app)/encounters/actions";
import { SignDialog } from "./sign-dialog";

export function NoteEditor({
  noteId,
  initialVersion,
  sections,
  initialContent,
  canSign,
}: {
  noteId: string;
  initialVersion: number;
  sections: { key: string; label: string }[];
  initialContent: Record<string, string>;
  canSign: boolean;
}) {
  const router = useRouter();
  const [content, setContent] = React.useState<Record<string, string>>(initialContent);
  const [version, setVersion] = React.useState(initialVersion);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = React.useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaving(true);
    setError(null);
    try {
      const r = await saveNoteAction({ noteId, version, content });
      if (!r.ok) {
        setError(r.error);
        return false;
      }
      setVersion(r.data.version);
      setDirty(false);
      setSavedAt(new Date());
      return true;
    } catch {
      setError("Could not reach the server. Your text is still here - try saving again.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [content, dirty, noteId, version]);

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {sections.map((s) => (
        <div key={s.key}>
          <label htmlFor={`note-${noteId}-${s.key}`} className="mb-1 block text-[13px] font-medium">
            {s.label}
          </label>
          <Textarea
            id={`note-${noteId}-${s.key}`}
            value={content[s.key] ?? ""}
            rows={s.key === "body" || s.key === "plan" || s.key === "history" ? 5 : 3}
            onChange={(e) => {
              setContent((c) => ({ ...c, [s.key]: e.target.value }));
              setDirty(true);
            }}
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" loading={saving} disabled={!dirty} onClick={save}>
          <Save className="h-4 w-4" aria-hidden /> Save draft
        </Button>
        {canSign && (
          <SignDialog
            action={signNoteAction}
            input={{ id: noteId }}
            trigger="Sign note"
            title="Sign clinical note"
            statement="Signing confirms you wrote this note and it is accurate. Signed notes cannot be changed; corrections are added as signed addenda."
            successMessage="Note signed."
            beforeSign={save}
          />
        )}
        <ConfirmAction
          action={discardNoteAction}
          fixed={{ noteId }}
          trigger={
            <>
              <Trash2 className="h-4 w-4" aria-hidden /> Discard draft
            </>
          }
          triggerVariant="ghost"
          title="Discard this draft?"
          description="The draft is kept in the audit history but removed from the record."
          submitLabel="Discard"
          tone="danger"
          successMessage="Draft discarded."
          onDone={() => router.refresh()}
        />
        <span className="text-xs text-muted" aria-live="polite">
          {dirty
            ? "Unsaved changes"
            : savedAt
              ? `Saved ${savedAt.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" })}`
              : "Draft"}
        </span>
      </div>
    </div>
  );
}
