"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { prisma } from "@/server/db";

export const markAllReadAction = defineAction("notifications.read_all", z.object({}), async (ctx) => {
  const r = await prisma.notification.updateMany({ where: { userId: ctx.userId, channel: "IN_APP", readAt: null }, data: { readAt: new Date() } });
  return r.count;
});
