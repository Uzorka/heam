import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven tabs (server-rendered, linkable, keyboard accessible as a nav landmark). */
export function LinkTabs({
  tabs,
  current,
  label,
}: {
  tabs: { key: string; label: string; href: string; count?: number }[];
  current: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="-mx-1 mb-5 overflow-x-auto border-b border-border">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => {
          const active = t.key === current;
          return (
            <li key={t.key}>
              <Link
                prefetch={false}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-[14px] sm:min-h-10",
                  active
                    ? "border-accent font-medium text-foreground"
                    : "border-transparent text-muted hover:text-foreground",
                )}
              >
                {t.label}
                {t.count !== undefined && (
                  <span className="tabular rounded-full bg-surface-2 px-1.5 text-xs">{t.count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
