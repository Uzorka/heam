import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus, Users } from "lucide-react";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { searchPatients } from "@/server/domains/patients/service";
import { searchPatientsSchema } from "@/lib/schemas/patient";
import { formatDate } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Forbidden, PageHeader, Pagination } from "@/components/ui/misc";
import { load } from "../_lib/guard";
import { PatientsTable } from "./patients-table";

export const metadata: Metadata = { title: "Patients" };

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; inactive?: string; provisional?: string }>;
}) {
  const ctx = await requireAuthContext();
  const sp = await searchParams;
  const input = searchPatientsSchema.parse({
    q: sp.q ?? "",
    page: sp.page ?? 1,
    includeInactive: sp.inactive === "1",
    provisionalOnly: sp.provisional === "1",
  });
  const res = await load(ctx, "/patients", () => searchPatients(ctx, input));
  if (!res.ok) return <Forbidden message={res.message} />;
  const { rows, total, page, pageSize } = res.data;
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (input.q) u.set("q", input.q);
    if (input.includeInactive) u.set("inactive", "1");
    if (input.provisionalOnly) u.set("provisional", "1");
    u.set("page", String(p));
    return `/patients?${u.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Patients"
        description="Search by MRN, name or phone number. Phone numbers are masked in search results."
        actions={
          can(ctx, "patient.create") && (
            <Button asChild>
              <Link prefetch={false} href="/patients/new">
                <UserPlus className="h-4 w-4" aria-hidden /> Register patient
              </Link>
            </Button>
          )
        }
      />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-border p-4" method="get" role="search">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="q" className="mb-1 block text-[13px] font-medium">
              Search
            </label>
            <Input id="q" name="q" defaultValue={input.q} placeholder="e.g. ADK0000018, 0809 000 0101, Bakare" autoComplete="off" />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-[13px] sm:min-h-9">
            <input type="checkbox" name="inactive" value="1" defaultChecked={input.includeInactive} className="h-4 w-4" /> Include inactive
          </label>
          <label className="flex min-h-11 items-center gap-2 text-[13px] sm:min-h-9">
            <input type="checkbox" name="provisional" value="1" defaultChecked={input.provisionalOnly} className="h-4 w-4" /> Provisional only
          </label>
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title={input.q ? "No matching patients" : "No patients yet"}>
            {input.q
              ? "Check the spelling, try the phone number or MRN, or register a new patient. Always search before registering to avoid duplicate records."
              : "Registered patients will appear here."}
          </EmptyState>
        ) : (
          <>
            <PatientsTable
              canOpen={can(ctx, "patient.read")}
              rows={rows.map((r) => ({ ...r, lastVisit: r.lastVisitAt ? formatDate(r.lastVisitAt) : null }))}
            />
            <Pagination page={page} pageSize={pageSize} total={total} hrefFor={qs} />
          </>
        )}
      </Card>
    </>
  );
}
