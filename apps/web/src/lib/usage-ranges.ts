// Client-safe: the range picker imports this without pulling the DB layer into the bundle.
export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export const parseRange = (v: string | undefined): RangeDays => {
  const n = Number(v?.replace(/d$/, ''));
  return (RANGES as readonly number[]).includes(n) ? (n as RangeDays) : 30;
};
