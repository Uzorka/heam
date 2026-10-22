import { NextResponse } from "next/server";
import { handleProviderCallback } from "@/server/domains/billing/payments";
import { reportError } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * Payment provider webhook. Disabled (503) until PAYMENT_PROVIDER and PAYMENT_WEBHOOK_SECRET are
 * configured. The signature is verified over the raw body; replays are acknowledged once.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 64 * 1024) return new NextResponse("Payload too large", { status: 413 });
  try {
    const r = await handleProviderCallback(raw, req.headers.get("x-paystack-signature"));
    return NextResponse.json({ outcome: r.outcome }, { status: r.status });
  } catch (e) {
    reportError(e, { route: "payments.callback" });
    return new NextResponse("Error", { status: 500 });
  }
}
