/**
 * Helpers puros para métricas de retenção de gancho (Skip Rate 3s) e Reposts
 * na Meta Graph API v27.0 (Fase 45 - META42-01).
 */

export function buildCandidateMetricSets(isReel: boolean): string[] {
  if (isReel) {
    return [
      "views,reach,saved,shares,likes,comments,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate,reposts",
      "views,reach,saved,shares,likes,comments,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reposts",
      "views,reach,saved,shares,likes,comments,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate",
      "views,reach,saved,shares,likes,comments,ig_reels_avg_watch_time,ig_reels_video_view_total_time",
      "views,reach,saved,shares,likes,comments",
      "reach,saved,likes,comments",
    ];
  }
  return [
    "views,reach,saved,shares,total_interactions,reposts",
    "views,reach,saved,shares,total_interactions",
    "views,reach,saved,shares",
    "reach,saved",
  ];
}

export function normalizeSkipRatePct(
  raw: number | null | undefined,
  isReel: boolean
): number | null {
  if (!isReel || typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return null;
  }
  return Number(Math.min(100, Math.max(0, raw)).toFixed(2));
}

export function computeHookRetention3sPct(skipRatePct: number | null): number | null {
  if (skipRatePct === null || !Number.isFinite(skipRatePct)) {
    return null;
  }
  return Number((100 - skipRatePct).toFixed(2));
}

export function normalizeRepostsCount(raw: number | null | undefined): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return null;
  }
  return Math.max(0, Math.round(raw));
}

export function extractRetentionMetricsFromMap(
  metricMap: Record<string, number | null>,
  isReel: boolean
): {
  skip_rate_3s_pct: number | null;
  hook_retention_3s_pct: number | null;
  reposts: number | null;
} {
  const rawSkip = metricMap.reels_skip_rate ?? metricMap.skip_rate ?? null;
  const skipRatePct = normalizeSkipRatePct(rawSkip, isReel);
  const hookRetentionPct = computeHookRetention3sPct(skipRatePct);
  const reposts = normalizeRepostsCount(metricMap.reposts ?? null);

  return {
    skip_rate_3s_pct: skipRatePct,
    hook_retention_3s_pct: hookRetentionPct,
    reposts,
  };
}
