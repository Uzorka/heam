import type { Metadata } from "next";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Reset your password</h1>
      <p className="mb-5 text-[13px] text-muted">Enter the email for your staff account.</p>
      <ForgotForm />
    </>
  );
}
