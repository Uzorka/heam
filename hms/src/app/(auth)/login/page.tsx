import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionState } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  password_set: "Your password has been set. Sign in with your new password.",
  mfa_locked: "Too many incorrect codes. Sign in again.",
  expired: "Your session ended. Please sign in again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const sp = await searchParams;
  const s = await getSessionState();
  if (s.state === "authenticated") redirect("/dashboard");
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
      <p className="mb-5 text-[13px] text-muted">Use your hospital staff account.</p>
      <LoginForm next={sp.next} notice={sp.reason ? NOTICES[sp.reason] : undefined} />
    </>
  );
}
