"use server";
import { z } from "zod";
import { defineAction } from "@/server/action";
import {
  amendImagingReport,
  saveImagingReport,
  scheduleImaging,
  signImagingReport,
  startImaging,
} from "@/server/domains/imaging/service";
import { amendImagingSchema, imagingReportSchema } from "@/lib/schemas/lab";
import { localDate, localTime, uuid } from "@/lib/schemas/common";
import { localDateTimeToUtc } from "@/lib/time";

export const scheduleImagingAction = defineAction(
  "imaging.schedule",
  z.object({ orderId: uuid, date: localDate, time: localTime }),
  async (ctx, i) =>
    scheduleImaging(ctx, { orderId: i.orderId, scheduledAt: localDateTimeToUtc(i.date, i.time) }),
);
export const startImagingAction = defineAction("imaging.start", z.object({ orderId: uuid }), async (ctx, i) =>
  startImaging(ctx, i.orderId),
);
export const saveImagingReportAction = defineAction(
  "imaging.report.save",
  imagingReportSchema,
  async (ctx, i) => (await saveImagingReport(ctx, i)).id,
);
export const signImagingReportAction = defineAction(
  "imaging.report.sign",
  z.object({ reportId: uuid, password: z.string().min(1, "Enter your password to sign") }),
  async (ctx, i) => signImagingReport(ctx, i),
);
export const amendImagingReportAction = defineAction(
  "imaging.report.amend",
  amendImagingSchema,
  async (ctx, i) => (await amendImagingReport(ctx, i)).id,
);
