export type LeaderboardSort =
  | "in_sample"
  | "out_of_sample"
  | "full_sample"
  | "gap";

export type LeaderboardRow = {
  model_code?: string;
  rank?: number;
  in_sample_objective?: number;
  out_of_sample_objective?: number;
  full_sample_objective?: number;
  gap_objective?: number;
};

export function leaderboardSortValue(
  row: LeaderboardRow,
  sort: LeaderboardSort,
): number {
  const v =
    sort === "out_of_sample"
      ? row.out_of_sample_objective
      : sort === "full_sample"
        ? row.full_sample_objective
        : sort === "gap"
          ? row.gap_objective
          : row.in_sample_objective;
  return Number(v ?? -1e9);
}

/** Keep one row per model_code (best in-sample objective wins). */
export function dedupeLeaderboardRows(rows: LeaderboardRow[]): LeaderboardRow[] {
  const byCode = new Map<string, LeaderboardRow>();
  for (const row of rows) {
    const code = String(row.model_code ?? "");
    if (!code) continue;
    const existing = byCode.get(code);
    if (
      !existing ||
      leaderboardSortValue(row, "in_sample") >
        leaderboardSortValue(existing, "in_sample")
    ) {
      byCode.set(code, row);
    }
  }
  return Array.from(byCode.values());
}

export function sortLeaderboardRows(
  rows: LeaderboardRow[],
  sort: LeaderboardSort,
): LeaderboardRow[] {
  return [...rows].sort(
    (a, b) => leaderboardSortValue(b, sort) - leaderboardSortValue(a, sort),
  );
}

export function buildHoldoutLeaderboard(
  rawRows: LeaderboardRow[],
  sort: LeaderboardSort,
  fullByCode?: Map<string, number>,
): LeaderboardRow[] {
  const enriched = rawRows.map((row) => ({
    ...row,
    full_sample_objective:
      row.full_sample_objective ??
      fullByCode?.get(String(row.model_code ?? "")),
  }));
  return sortLeaderboardRows(dedupeLeaderboardRows(enriched), sort);
}
