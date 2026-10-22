import { cn } from "@/lib/utils";

/** Text wordmark. The official logo is not fabricated; an approved logo can be uploaded later. */
export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("leading-none", className)}>
      <span className="block text-[15px] font-semibold tracking-[0.18em]">ADURAKING</span>
      {!compact && <span className="mt-1 block text-[11px] font-medium tracking-wide text-muted">Hospital &amp; Maternity</span>}
    </div>
  );
}
