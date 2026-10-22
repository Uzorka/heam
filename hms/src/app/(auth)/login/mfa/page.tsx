import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionState } from "@/server/auth/session";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const s = await getSessionState();
  if (s.state === "anonymous") redirect("/login");
  if (s.state === "authenticated") redirect("/dashboard");
  const { next } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Two-step verification</h1>
      <p className="mb-5 text-[13px] text-muted">Enter the 6-digit code from your authenticator app.</p>
      <MfaForm next={next} />
    </>
  );
}
