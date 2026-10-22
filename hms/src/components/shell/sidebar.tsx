"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand/wordmark";
import type { NavGroup } from "@/server/nav";
import { NAV_ICONS } from "./icons";

function isActive(pathname: string, href: string) {
  if (href === "/patients") return pathname === "/patients" || (/^\/patients\/(?!duplicates)/.test(pathname));
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ groups, collapsed, onNavigate }: { groups: NavGroup[]; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="space-y-5">
      {groups.map((g) => (
        <div key={g.label}>
          {!collapsed && <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.label}</p>}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link prefetch={false}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-md px-3 text-[14px] sm:min-h-9",
                      active ? "bg-accent-soft font-medium text-accent" : "text-foreground/80 hover:bg-surface-2 hover:text-foreground",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    {Icon && <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />}
                    <span className={cn(collapsed && "sr-only")}>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("hms.nav.collapsed") === "1");
    } catch {}
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("hms.nav.collapsed", c ? "0" : "1");
      } catch {}
      return !c;
    });
  };
  return (
    <aside
      className={cn(
        "no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface lg:flex",
        collapsed ? "w-[68px]" : "w-64",
      )}
    >
      <div className={cn("flex h-16 items-center border-b border-border px-4", collapsed && "justify-center px-0")}>
        {collapsed ? <span className="text-[15px] font-semibold tracking-[0.18em]">A</span> : <Wordmark />}
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-4">
        <NavList groups={groups} collapsed={collapsed} />
      </div>
      <button
        type="button"
        onClick={toggle}
        className="flex min-h-11 items-center gap-2 border-t border-border px-4 text-[13px] text-muted hover:text-foreground"
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
      >
        {collapsed ? <PanelLeftOpen className="mx-auto h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> Collapse</>}
      </button>
    </aside>
  );
}

export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  React.useEffect(() => setOpen(false), [pathname]);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-surface-2"
        aria-label="Open navigation"
        aria-expanded={open}
      >
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-background shadow-pop animate-fade-in">
            <div className="flex h-16 items-center justify-between border-b border-border px-4">
              <Wordmark />
              <button type="button" onClick={() => setOpen(false)} className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-surface-2" aria-label="Close navigation">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-4">
              <NavList groups={groups} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
