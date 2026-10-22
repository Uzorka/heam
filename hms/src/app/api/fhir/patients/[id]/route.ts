import { NextResponse } from "next/server";
import { getSessionState } from "@/server/auth/session";
import { exportPatientFhir } from "@/server/domains/fhir/export";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { reportError } from "@/server/logger";

export const dynamic = "force-dynamic";

/** FHIR R4 Bundle for one patient. Session-authenticated, permission-checked and audited. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSessionState();
  if (s.state !== "authenticated") return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  try {
    const b = await exportPatientFhir(s.ctx, id);
    return new NextResponse(JSON.stringify(b, null, 2), {
      headers: {
        "Content-Type": "application/fhir+json; charset=utf-8",
        "Content-Disposition": `attachment; filename="patient-${id}.fhir.json"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    if (e instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    reportError(e, { route: "fhir.export", requestId: s.ctx.meta.requestId });
    return new NextResponse("Error", { status: 500 });
  }
}
