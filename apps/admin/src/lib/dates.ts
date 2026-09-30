export const todayIn = (tz = 'Asia/Hebron') => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
export const shiftDate = (d: string, days: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};
