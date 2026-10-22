import { NextResponse } from "next/server";
import { getSessionState } from "@/server/auth/session";
import { exportBatchCsv } from "@/server/domains/hmo/claims";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { reportError } from "@/server/logger";

export const dynamic = "force-dynamic";

/** Claim batch export (CSV, Excel-friendly). Permission-checked and audited in the service. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSessionState();
  if (s.state !== "authenticated") return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  try {
    const { filename, csv } = await exportBatchCsv(s.ctx, id);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    reportError(e, { route: "hmo.batch.export", requestId: s.ctx.meta.requestId });
    return new NextResponse("Error", { status: 500 });
  }
}
