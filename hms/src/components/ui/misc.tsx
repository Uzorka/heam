import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Lock, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-6 space-y-2">
      {back && (
        <Link prefetch={false} href={back.href} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-foreground">
          <ChevronLeft className="h-4 w-4" aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-[14px] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-3 rounded-full bg-surface-2 p-3 text-muted" aria-hidden>
        {icon ?? <SearchX className="h-5 w-5" />}
      </div>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-[13px] text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Forbidden({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-lg py-16">
      <EmptyState icon={<Lock className="h-5 w-5" />} title="You don't have access to this">
        {message ??
          "Your current roles do not include permission for this page or record. If you need access, ask your hospital administrator. Access requests are reviewed and recorded."}
      </EmptyState>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} aria-hidden />;
}

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 p-5">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-[13px]">
      <span className="text-muted">
        Page {page} of {pages} · {total} records
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link prefetch={false} className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 hover:bg-surface-2 sm:min-h-8" href={hrefFor(page - 1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link prefetch={false} className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 hover:bg-surface-2 sm:min-h-8" href={hrefFor(page + 1)}>
            Next <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function DescriptionList({ items, className }: { items: [string, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-[14px]">{v ?? <span className="text-muted">Not recorded</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatTile({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  href?: string;
  tone?: "default" | "warning" | "danger";
}) {
  const content = (
    <>
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-[28px] font-semibold leading-8 tabular",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
  const cls = "block rounded-lg border border-border bg-background p-4 shadow-card";
  return href ? (
    <Link prefetch={false} href={href} className={cn(cls, "transition-colors hover:border-accent/40")}>
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
}
