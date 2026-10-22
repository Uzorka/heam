import { cookies } from "next/headers";
import { prisma } from "@/server/db";
import { requireAuthContext } from "@/server/auth/session";
import { can } from "@/server/authz/context";
import { buildNav } from "@/server/nav";
import { env } from "@/server/env";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/topbar";
import { Alert } from "@/components/ui/alert";
import Link from "next/link";

// No group-level loading.tsx here: with Next 15.5 a route-group Suspense boundary intermittently
// stalled client navigations between sibling pages (reproduced 6/6, fixed 0/6). Use scoped
// <Suspense> + <LoadingBlock> inside slow pages instead.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuthContext();
  const groups = buildNav(ctx);
  const theme = (await cookies()).get("hms_theme")?.value === "dark" ? "dark" : "light";
  const hasAll = ctx.grants.some((g) => g.branchId === null);
  const branchIds = [...new Set(ctx.grants.map((g) => g.branchId).filter((x): x is string => !!x))];
  const [branches, unread, user] = await Promise.all([
    prisma.branch.findMany({
      where: { status: { not: "INACTIVE" }, ...(hasAll ? {} : { id: { in: branchIds } }) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true, verificationStatus: true },
    }),
    prisma.notification.count({ where: { userId: ctx.userId, channel: "IN_APP", readAt: null } }),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { mustChangePassword: true, isDemo: true } }),
  ]);
  const activeBranch = branches.find((b) => b.id === ctx.activeBranchId);
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar groups={groups} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          groups={groups}
          user={{
            displayName: ctx.displayName,
            jobTitle: ctx.jobTitle,
            roles: [...new Set(ctx.grants.map((g) => g.roleName.split(" /")[0]!))],
          }}
          branches={branches.map((b) => ({
            id: b.id,
            name: b.name,
            pending: b.verificationStatus !== "VERIFIED",
          }))}
          activeBranchId={ctx.activeBranchId}
          canSearchPatients={can(ctx, "patient.search")}
          unread={unread}
          theme={theme}
        />
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="no-print mb-4 space-y-2 empty:hidden">
            {env().NODE_ENV !== "production" && user?.isDemo && (
              <Alert tone="warning" title="Demonstration environment">
                Fictional data only. Do not enter real patient information.
              </Alert>
            )}
            {user?.mustChangePassword && (
              <Alert tone="warning" title="Set a new password">
                Your account requires a password change.{" "}
                <Link prefetch={false} className="underline" href="/account/security">
                  Change it now
                </Link>
                .
              </Alert>
            )}
            {ctx.suspendedGrants.length > 0 && (
              <Alert tone="warning" title="Two-step verification required">
                Your {ctx.suspendedGrants.map((g) => g.roleName).join(", ")} access is paused until you{" "}
                <Link prefetch={false} className="underline" href="/account/security">
                  turn on two-step verification
                </Link>
                .
              </Alert>
            )}
            {activeBranch && activeBranch.verificationStatus !== "VERIFIED" && can(ctx, "settings.read") && (
              <Alert tone="info">
                Details for <strong>{activeBranch.name}</strong> are awaiting verification in the{" "}
                <Link prefetch={false} className="underline" href="/admin/setup">
                  setup checklist
                </Link>
                .
              </Alert>
            )}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
