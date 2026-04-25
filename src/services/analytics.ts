import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { referrals, referralClicks } from '../db/schema.js';

// ---------------------------------------------------------------------------
// Conversion rate — approved referrals / total clicks (0 if no clicks)
// ---------------------------------------------------------------------------
export async function getConversionRate(shopId: string) {
  const [clickResult] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(referralClicks)
    .where(eq(referralClicks.shopId, shopId));

  const [refResult] = await db
    .select({ approved: sql<number>`COUNT(*)::int` })
    .from(referrals)
    .where(and(eq(referrals.shopId, shopId), eq(referrals.status, 'approved')));

  const totalClicks = clickResult?.total ?? 0;
  const approvedReferrals = refResult?.approved ?? 0;
  const conversionRate =
    totalClicks > 0 ? Math.round((approvedReferrals / totalClicks) * 10000) / 100 : 0;

  return { totalClicks, approvedReferrals, conversionRate };
}

// ---------------------------------------------------------------------------
// Revenue from referrals — sum of approved order amounts (in paise)
// ---------------------------------------------------------------------------
export async function getReferralRevenue(shopId: string) {
  const [result] = await db
    .select({ totalPaise: sql<number>`COALESCE(SUM(${referrals.referredOrderAmount}), 0)::int` })
    .from(referrals)
    .where(and(eq(referrals.shopId, shopId), eq(referrals.status, 'approved')));

  return { totalPaise: result?.totalPaise ?? 0 };
}

// ---------------------------------------------------------------------------
// Top sources — referral clicks grouped by source, descending
// ---------------------------------------------------------------------------
export async function getTopSources(shopId: string) {
  const rows = await db
    .select({
      source: referralClicks.source,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(referralClicks)
    .where(eq(referralClicks.shopId, shopId))
    .groupBy(referralClicks.source)
    .orderBy(sql`COUNT(*) DESC`);

  return rows;
}

// ---------------------------------------------------------------------------
// Timeseries — daily clicks, conversions, and revenue over the last N days
// ---------------------------------------------------------------------------
export async function getTimeseries(shopId: string, days = 30) {
  const [clickRows, refRows] = await Promise.all([
    db
      .select({
        day: sql<string>`DATE(${referralClicks.createdAt})::text`,
        clicks: sql<number>`COUNT(*)::int`,
      })
      .from(referralClicks)
      .where(
        and(
          eq(referralClicks.shopId, shopId),
          sql`${referralClicks.createdAt} >= NOW() - (${days}::int * INTERVAL '1 day')`,
        ),
      )
      .groupBy(sql`DATE(${referralClicks.createdAt})`)
      .orderBy(sql`DATE(${referralClicks.createdAt})`),

    db
      .select({
        day: sql<string>`DATE(${referrals.createdAt})::text`,
        conversions: sql<number>`COUNT(*)::int`,
        revenuePaise: sql<number>`COALESCE(SUM(${referrals.referredOrderAmount}), 0)::int`,
      })
      .from(referrals)
      .where(
        and(
          eq(referrals.shopId, shopId),
          eq(referrals.status, 'approved'),
          sql`${referrals.createdAt} >= NOW() - (${days}::int * INTERVAL '1 day')`,
        ),
      )
      .groupBy(sql`DATE(${referrals.createdAt})`)
      .orderBy(sql`DATE(${referrals.createdAt})`),
  ]);

  // Merge by day
  const byDay = new Map<string, { clicks: number; conversions: number; revenuePaise: number }>();
  for (const r of clickRows) {
    byDay.set(r.day, { clicks: r.clicks, conversions: 0, revenuePaise: 0 });
  }
  for (const r of refRows) {
    const existing = byDay.get(r.day) ?? { clicks: 0, conversions: 0, revenuePaise: 0 };
    byDay.set(r.day, { ...existing, conversions: r.conversions, revenuePaise: r.revenuePaise });
  }

  return Array.from(byDay.entries())
    .map(([day, data]) => ({ day, ...data }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

// ---------------------------------------------------------------------------
// Overview — single call returning all headline numbers
// ---------------------------------------------------------------------------
export async function getAnalyticsOverview(shopId: string) {
  const [{ totalClicks, approvedReferrals, conversionRate }, { totalPaise }, sources] =
    await Promise.all([
      getConversionRate(shopId),
      getReferralRevenue(shopId),
      getTopSources(shopId),
    ]);

  const [totalRefResult] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(referrals)
    .where(eq(referrals.shopId, shopId));

  return {
    conversionRate,
    totalClicks,
    totalReferrals: totalRefResult?.total ?? 0,
    approvedReferrals,
    referralRevenuePaise: totalPaise,
    topSources: sources,
  };
}
