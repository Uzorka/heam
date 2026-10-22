"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Bell, LogOut, Moon, Search, Shield, Sun } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { setThemeAction, switchBranchAction } from "@/app/(app)/shell-actions";
import type { NavGroup } from "@/server/nav";
import { MobileNav } from "./sidebar";

interface Props {
  groups: NavGroup[];
  user: { displayName: string; jobTitle: string | null; roles: string[] };
  branches: { id: string; name: string; pending: boolean }[];
  activeBranchId: string | null;
  canSearchPatients: boolean;
  unread: number;
  theme: "light" | "dark";
}

export function TopBar({ groups, user, branches, activeBranchId, canSearchPatients, unread, theme }: Props) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [branchError, setBranchError] = React.useState<string | null>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !(
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement
        )
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="no-print sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur sm:gap-3 sm:px-6">
      <MobileNav groups={groups} />
      {canSearchPatients ? (
        <form
          role="search"
          className="relative min-w-0 flex-1 sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            const q = searchRef.current?.value.trim();
            router.push(q ? `/patients?q=${encodeURIComponent(q)}` : "/patients");
          }}
        >
          <label htmlFor="global-search" className="sr-only">
            Find patient by MRN, name or phone
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            id="global-search"
            ref={searchRef}
            type="search"
            placeholder="Find patient - MRN, name, phone"
            className="h-11 w-full rounded-md border border-border bg-surface pl-9 pr-10 text-[14px] placeholder:text-muted/80 sm:h-9"
            autoComplete="off"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[11px] text-muted sm:block">
            /
          </kbd>
        </form>
      ) : (
        <div className="flex-1" />
      )}
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {branches.length > 0 && (
          <div className="hidden md:block">
            <label htmlFor="branch-select" className="sr-only">
              Active branch
            </label>
            <select
              id="branch-select"
              value={activeBranchId ?? ""}
              disabled={pending}
              onChange={(e) => {
                const branchId = e.target.value;
                setBranchError(null);
                start(async () => {
                  const r = await switchBranchAction({ branchId });
                  if (!r.ok) setBranchError(r.error);
                  router.refresh();
                });
              }}
              className="h-9 max-w-[220px] rounded-md border border-border bg-background px-2 text-[13px]"
              aria-describedby={branchError ? "branch-error" : undefined}
            >
              {!activeBranchId && <option value="">Select branch</option>}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.pending ? " (unverified)" : ""}
                </option>
              ))}
            </select>
            {branchError && (
              <span id="branch-error" role="alert" className="sr-only">
                {branchError}
              </span>
            )}
          </div>
        )}
        <Link
          prefetch={false}
          href="/notifications"
          className="relative inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-surface-2 sm:h-9 sm:w-9"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        >
          <Bell className="h-[18px] w-[18px]" aria-hidden />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white dark:text-background">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
        <DM.Root>
          <DM.Trigger
            className="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-surface-2 sm:min-h-9"
            aria-label="Account menu"
          >
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent"
              aria-hidden
            >
              {user.displayName
                .split(" ")
                .map((p) => p[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span className="hidden text-left leading-tight lg:block">
              <span className="block text-[13px] font-medium">{user.displayName}</span>
              <span className="block max-w-[180px] truncate text-[11px] text-muted">
                {user.jobTitle ?? user.roles.join(", ")}
              </span>
            </span>
          </DM.Trigger>
          <DM.Portal>
            <DM.Content
              align="end"
              sideOffset={6}
              className="z-50 min-w-56 rounded-lg border border-border bg-background p-1 shadow-pop"
            >
              <div className="px-3 py-2">
                <p className="text-[13px] font-medium">{user.displayName}</p>
                <p className="text-xs text-muted">{user.roles.join(" · ") || "No active roles"}</p>
              </div>
              <DM.Separator className="my-1 h-px bg-border" />
              <DM.Item asChild>
                <Link
                  prefetch={false}
                  href="/account/security"
                  className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 text-[14px] outline-none data-[highlighted]:bg-surface-2"
                >
                  <Shield className="h-4 w-4" aria-hidden /> Security & sessions
                </Link>
              </DM.Item>
              <DM.Item
                onSelect={() => start(() => setThemeAction(theme === "dark" ? "light" : "dark"))}
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 text-[14px] outline-none data-[highlighted]:bg-surface-2"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" aria-hidden />
                ) : (
                  <Moon className="h-4 w-4" aria-hidden />
                )}
                {theme === "dark" ? "Light appearance" : "Dark appearance"}
              </DM.Item>
              <DM.Separator className="my-1 h-px bg-border" />
              <DM.Item
                onSelect={() => start(() => logoutAction())}
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 text-[14px] text-danger outline-none data-[highlighted]:bg-danger-soft"
              >
                <LogOut className="h-4 w-4" aria-hidden /> Sign out
              </DM.Item>
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      </div>
    </header>
  );
}
