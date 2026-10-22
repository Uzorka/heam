import Link from "next/link";
import { Forbidden } from "@/components/ui/misc";

export default function AccessDeniedPage() {
  return (
    <main id="main" className="px-4">
      <Forbidden />
      <p className="text-center">
        <Link prefetch={false} href="/dashboard" className="text-accent hover:underline">
          Back to dashboard
        </Link>
      </p>
    </main>
  );
}
