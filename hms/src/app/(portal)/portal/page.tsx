import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthContext } from "@/server/auth/session";
import { portalHome } from "@/server/domains/portal/service";
import { ForbiddenError } from "@/server/errors";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "My health record" };

export default async function PortalHome() {
  const ctx = await requireAuthContext();
  let home;
  try {
    home = await portalHome(ctx);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Alert tone="danger">{e.message}</Alert>;
    throw e;
  }
  const rel = new Map(home.relationships.map((r) => [r.dependentPatientId, r.relationship]));
  const people = [...home.people].sort((a, b) => (a.id === home.selfId ? -1 : b.id === home.selfId ? 1 : 0));
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold">Welcome</h1>
      <p className="mb-5 text-[14px] text-muted">Choose whose record to view.</p>
      <ul className="space-y-3">
        {people.map((p) => (
          <li key={p.id}>
            <Card className="p-0">
              <Link
                prefetch={false}
                href={`/portal/${p.id}`}
                className="flex items-center justify-between gap-3 rounded-xl p-4 hover:bg-surface-2"
              >
                <span>
                  <span className="block font-medium">
                    {p.preferredName ?? p.givenName} {p.familyName}
                  </span>
                  <span className="text-[13px] text-muted">
                    {p.id === home.selfId ? "You" : `Your ${rel.get(p.id)?.toLowerCase() ?? "dependant"}`} ·{" "}
                    <span className="font-mono">{p.mrn}</span>
                  </span>
                </span>
                <span aria-hidden>→</span>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
