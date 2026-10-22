"use client";
import * as React from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useServerAction } from "@/components/forms/use-action";
import { createUserAction } from "../../actions";

interface Option {
  id: string;
  name: string;
}
interface RoleRow {
  roleId: string;
  branchId: string;
  allBranches: boolean;
}

export function NewUserForm({ roles, branches, defaultBranchId }: { roles: (Option & { requiresMfa: boolean })[]; branches: Option[]; defaultBranchId: string }) {
  const { run, pending, error, fieldErrors, result } = useServerAction(createUserAction, { refresh: false });
  const [rows, setRows] = React.useState<RoleRow[]>([{ roleId: "", branchId: defaultBranchId, allBranches: false }]);
  const [copied, setCopied] = React.useState(false);

  if (result) {
    return (
      <Card className="max-w-2xl">
        <CardHeader title="Account created" description="Share this one-time link with the staff member in person or through a secure channel. It is shown only once." />
        <CardBody className="space-y-3">
          <Alert tone="warning">
            The link lets the holder set the account password. It expires at {new Date(result.expiresAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}.
          </Alert>
          <div className="flex gap-2">
            <Input readOnly value={result.setupLink} aria-label="One-time setup link" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.setupLink);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button asChild>
            <Link prefetch={false} href={`/admin/users/${result.userId}`}>Open account</Link>
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <form
      noValidate
      className="max-w-3xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const g = (k: string) => String(fd.get(k) ?? "").trim() || undefined;
        run({
          email: g("email") ?? "",
          givenName: g("givenName") ?? "",
          familyName: g("familyName") ?? "",
          displayName: g("displayName"),
          phone: g("phone"),
          jobTitle: g("jobTitle"),
          staffNumber: g("staffNumber"),
          defaultBranchId: g("defaultBranchId") ?? "",
          roles: rows.map((r) => ({ roleId: r.roleId, branchId: r.allBranches ? undefined : r.branchId, allBranches: r.allBranches })),
        });
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <Card>
        <CardHeader title="Person" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="givenName" required error={fieldErrors.givenName}>
            <Input name="givenName" />
          </Field>
          <Field label="Surname" htmlFor="familyName" required error={fieldErrors.familyName}>
            <Input name="familyName" />
          </Field>
          <Field label="Work email" htmlFor="email" required error={fieldErrors.email} hint="Used to sign in">
            <Input name="email" type="email" autoComplete="off" />
          </Field>
          <Field label="Phone" htmlFor="phone" error={fieldErrors.phone}>
            <Input name="phone" type="tel" />
          </Field>
          <Field label="Job title" htmlFor="jobTitle" error={fieldErrors.jobTitle}>
            <Input name="jobTitle" />
          </Field>
          <Field label="Staff number" htmlFor="staffNumber" error={fieldErrors.staffNumber}>
            <Input name="staffNumber" />
          </Field>
          <Field label="Display name" htmlFor="displayName" hint="Defaults to first name + surname">
            <Input name="displayName" />
          </Field>
          <Field label="Home branch" htmlFor="defaultBranchId" required error={fieldErrors.defaultBranchId}>
            <Select name="defaultBranchId" defaultValue={defaultBranchId}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Roles" description="Staff often hold several roles. Each is scoped to a branch. Roles marked MFA require two-step verification." />
        <CardBody className="space-y-3">
          {fieldErrors.roles && <p className="text-xs font-medium text-danger">{fieldErrors.roles}</p>}
          {rows.map((r, i) => (
            <fieldset key={i} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
              <legend className="sr-only">Role {i + 1}</legend>
              <Field label="Role" htmlFor={`role-${i}`} error={fieldErrors[`roles.${i}.roleId`]}>
                <Select value={r.roleId} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, roleId: e.target.value } : y)))}>
                  <option value="">Select role</option>
                  {roles.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {o.requiresMfa ? " (MFA)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Branch" htmlFor={`branch-${i}`} error={fieldErrors[`roles.${i}.branchId`]}>
                <Select value={r.branchId} disabled={r.allBranches} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, branchId: e.target.value } : y)))}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="flex min-h-11 items-center gap-2 text-[13px] sm:min-h-9">
                <Checkbox checked={r.allBranches} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, allBranches: e.target.checked } : y)))} /> All branches
              </label>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove role ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </fieldset>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => setRows((x) => [...x, { roleId: "", branchId: defaultBranchId, allBranches: false }])}>
            <Plus className="h-4 w-4" aria-hidden /> Add another role
          </Button>
        </CardBody>
      </Card>
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          Create account
        </Button>
        <Button asChild variant="ghost">
          <Link prefetch={false} href="/admin/users">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
