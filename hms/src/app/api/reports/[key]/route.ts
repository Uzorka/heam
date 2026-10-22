import { NextResponse } from "next/server";
import { getSessionState } from "@/server/auth/session";
import { exportReport, isReportKey } from "@/server/domains/reports/service";
import { DomainError, ForbiddenError } from "@/server/errors";
import { reportError } from "@/server/logger";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Audited, watermarked CSV export of an aggregated report. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const s = await getSessionState();
  if (s.state !== "authenticated") return new NextResponse("Unauthorized", { status: 401 });
  const { key } = await params;
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!isReportKey(key) || !DATE.test(from) || !DATE.test(to))
    return new NextResponse("Not found", { status: 404 });
  try {
    const out = await exportReport(s.ctx, key, from, to);
    return new NextResponse(out.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Forbidden", { status: 403 });
    if (e instanceof DomainError) return new NextResponse(e.message, { status: 400 });
    reportError(e, { route: "report.export", requestId: s.ctx.meta.requestId });
    return new NextResponse("Error", { status: 500 });
  }
}
