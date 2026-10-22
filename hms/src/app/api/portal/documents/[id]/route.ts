import { NextResponse } from "next/server";
import { getSessionState } from "@/server/auth/session";
import { authorizePortalDownload } from "@/server/domains/portal/service";
import { storage } from "@/server/domains/documents/storage";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { reportError } from "@/server/logger";

export const dynamic = "force-dynamic";

/** Portal download: released documents of the signed-in patient or a verified dependant only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSessionState();
  if (s.state !== "authenticated") return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  try {
    const doc = await authorizePortalDownload(s.ctx, id);
    const bytes = await storage().get(doc.storageKey);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${doc.filename}"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError)
      return new NextResponse("Not found", { status: 404 });
    reportError(e, { route: "portal.document.download", requestId: s.ctx.meta.requestId });
    return new NextResponse("Error", { status: 500 });
  }
}
