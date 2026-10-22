import type { Metadata } from "next";
import { requireAuthContext } from "@/server/auth/session";
import { Forbidden, PageHeader } from "@/components/ui/misc";
import { allowed } from "../../_lib/guard";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Register patient" };

export default async function NewPatientPage({
  searchParams,
}: {
  searchParams: Promise<{ emergency?: string }>;
}) {
  const ctx = await requireAuthContext();
  if (!(await allowed(ctx, "/patients/new", ["patient.create"]))) return <Forbidden />;
  const { emergency } = await searchParams;
  return (
    <>
      <PageHeader
        title="Register patient"
        description="Search first to avoid duplicate records. The system will also warn you if a similar record exists."
        back={{ href: "/patients", label: "Patients" }}
      />
      <div className="max-w-4xl">
        <RegisterForm emergency={emergency === "1"} />
      </div>
    </>
  );
}
