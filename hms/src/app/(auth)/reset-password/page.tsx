import type { Metadata } from "next";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Set password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Set a new password</h1>
      <p className="mb-5 text-[13px] text-muted">
        At least 12 characters, mixing three of: lowercase, uppercase, numbers and symbols. A passphrase works well.
      </p>
      {t ? <ResetForm token={t} /> : <p className="text-sm text-danger">This link is incomplete. Request a new reset link.</p>}
    </>
  );
}
