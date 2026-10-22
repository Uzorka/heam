import { Wordmark } from "@/components/brand/wordmark";
import { env } from "@/server/env";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Wordmark className="inline-block text-left" />
        </div>
        {env().HMS_DEMO_SITE === "true" && (
          <p
            role="note"
            className="mb-4 rounded-lg border border-warning bg-warning-soft px-4 py-3 text-[13px] text-warning"
          >
            Demonstration site with fictional data only. Do not enter real patient information.
          </p>
        )}
        <div className="rounded-xl border border-border bg-background p-6 shadow-card">{children}</div>
        <p className="mt-6 text-center text-xs text-muted">
          For hospital staff and registered patients. Access to health information is monitored and recorded.
        </p>
      </div>
    </main>
  );
}
