import { redirect } from "next/navigation";
import { requireAuthContext } from "@/server/auth/session";
import { isDemoEnvironment } from "@/server/env";
import { prisma } from "@/server/db";
import { Wordmark } from "@/components/brand/wordmark";
import { Alert } from "@/components/ui/alert";
import { PortalSignOut } from "./sign-out";

/** Patient portal shell: deliberately separate from the staff application. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuthContext();
  if (ctx.kind !== "PORTAL") redirect("/dashboard");
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { isDemo: true } });
  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Wordmark />
          <div className="flex items-center gap-3 text-[14px]">
            <span className="hidden text-muted sm:inline">{ctx.displayName}</span>
            <PortalSignOut />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-6">
        {isDemoEnvironment() && user?.isDemo && (
          <Alert tone="warning" title="Demonstration environment" className="mb-4">
            Fictional data only.
          </Alert>
        )}
        {children}
        <p className="mt-10 text-center text-xs text-muted">
          This portal shows results and documents your care team has released to you. For urgent concerns,
          call the hospital or attend the emergency unit. Access is recorded.
        </p>
      </main>
    </div>
  );
}
