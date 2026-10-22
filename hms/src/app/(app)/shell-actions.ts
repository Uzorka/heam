"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { switchBranch } from "@/server/domains/security/account";

export const switchBranchAction = defineAction("shell.switch_branch", z.object({ branchId: z.string().uuid() }), async (ctx, input) => {
  await switchBranch(ctx, input.branchId);
  revalidatePath("/", "layout");
  return null;
});

export async function setThemeAction(theme: "light" | "dark") {
  (await cookies()).set("hms_theme", theme === "dark" ? "dark" : "light", {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
