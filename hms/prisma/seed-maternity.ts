/**
 * Phase 5 demo content. FICTIONAL. A dated antenatal pregnancy for demo patient Aisha Bello and
 * DEMO-priced bed-day services for the DEMO wards (prices are fictional - replace before go-live).
 */
import type { PrismaClient } from "@prisma/client";
import { nextYearlyRef } from "../src/server/sequence";
import { calendarDateToUtcMidnight, todayLocal } from "../src/lib/time";
import { eddFromLmp, gestationDays } from "../src/lib/obstetrics";

const day = (offset: number) => {
  const d = new Date(`${todayLocal()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

export async function seedMaternity(prisma: PrismaClient, users: Record<string, string>) {
  let changed = false;
  const yearStart = calendarDateToUtcMidnight(`${todayLocal().slice(0, 4)}-01-01`);
  for (const [code, ward, naira] of [
    ["BED-GEN", "DEMO-GEN", 15000],
    ["BED-MAT", "DEMO-MAT", 20000],
  ] as const) {
    if (await prisma.serviceItem.findUnique({ where: { code } })) continue;
    const w = await prisma.ward.findFirst({ where: { code: ward } });
    if (!w) continue;
    const item = await prisma.serviceItem.create({
      data: { code, name: `${w.name} bed-day`, category: "ADMISSION", wardId: w.id },
    });
    await prisma.servicePrice.create({
      data: {
        serviceItemId: item.id,
        amountKobo: BigInt(naira * 100),
        effectiveFrom: yearStart,
        reason: "DEMO price for local testing - fictional, replace before go-live",
        status: "APPROVED",
        createdById: users.finance!,
        decidedById: users.owner!,
        decidedAt: new Date(),
      },
    });
    changed = true;
  }

  const aisha = await prisma.patient.findFirst({
    where: { isDemo: true, givenName: "Aisha", familyName: "Bello" },
  });
  if (aisha && !(await prisma.pregnancyEpisode.findFirst({ where: { patientId: aisha.id } }))) {
    const lmp = day(-196); // 28 weeks
    const edd = eddFromLmp(lmp);
    await prisma.$transaction(async (tx) => {
      const ep = await tx.pregnancyEpisode.create({
        data: {
          ref: await nextYearlyRef(tx, "PRG", Number(todayLocal().slice(0, 4))),
          patientId: aisha.id,
          branchId: aisha.registeredBranchId,
          gravida: 2,
          para: 1,
          bookingDate: calendarDateToUtcMidnight(day(-120)),
          bloodGroup: "O Rh+ (demo)",
          edd: calendarDateToUtcMidnight(edd),
          openedById: users.midwife!,
        },
      });
      await tx.pregnancyDatingEvent.create({
        data: {
          episodeId: ep.id,
          method: "LMP",
          lmp: calendarDateToUtcMidnight(lmp),
          edd: calendarDateToUtcMidnight(edd),
          adopted: true,
          note: "DEMO dating",
          recordedById: users.doctor!,
        },
      });
      for (const [offset, weight, sys, dia, fundal] of [
        [-120, 64.5, 112, 70, null],
        [-60, 67.0, 118, 74, 20],
        [-14, 69.2, 122, 78, 26],
      ] as const) {
        await tx.antenatalVisit.create({
          data: {
            episodeId: ep.id,
            visitDate: calendarDateToUtcMidnight(day(offset)),
            gestationDays: gestationDays(edd, day(offset)),
            weightKg: weight,
            systolicMmHg: sys,
            diastolicMmHg: dia,
            fundalHeightCm: fundal,
            fetalHeartRate: offset > -100 ? 142 : null,
            presentation: offset > -30 ? "Cephalic" : null,
            urineProtein: "Negative",
            notes: "DEMO antenatal visit",
            recordedById: users.midwife!,
          },
        });
      }
    });
    changed = true;
  }
  return changed;
}
