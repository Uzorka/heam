import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <Wordmark className="mb-8" />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 max-w-md text-[14px] text-muted">
        The page or record does not exist, or it is not available to your account. Records outside your access
        are shown as not found.
      </p>
      <Link prefetch={false} href="/dashboard" className="mt-6 text-accent hover:underline">
        Go to dashboard
      </Link>
    </main>
  );
}
