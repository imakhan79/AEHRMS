const dateFmt = new Intl.DateTimeFormat("en-PK", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-PK", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Karachi",
});

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  // Date-only values are parsed as local dates so they don't shift by timezone.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return dateFmt.format(d);
}

export function fmtDateTime(value: string | null | undefined): string {
  return value ? dateTimeFmt.format(new Date(value)) : "—";
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const timeFmt = new Intl.DateTimeFormat("en-PK", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" });

export function fmtTime(value: string | null | undefined): string {
  return value ? timeFmt.format(new Date(value)) : "—";
}

/** 545 → "9h 05m" */
export function fmtMinutes(mins: number | null | undefined): string {
  if (!mins) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function fmtDays(n: number | string): string {
  const v = Number(n);
  return `${Number.isInteger(v) ? v : v.toFixed(1)} day${v === 1 ? "" : "s"}`;
}

/** Turns empty form strings into null so optional DB columns stay NULL. */
export function emptyToNull<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, typeof v === "string" && v.trim() === "" ? null : v]),
  ) as T;
}

/** Postgres/PostgREST errors → message a user can act on. */
export function friendlyError(error: { message: string; code?: string } | null | undefined): string {
  if (!error) return "Something went wrong.";
  if (error.code === "23505") return "A record with this value already exists.";
  if (error.code === "23514") return "One of the values is not in the expected format.";
  if (error.code === "42501" && !error.message.includes(" ")) return "You don't have permission to do that.";
  if (error.message.includes("row-level security")) return "You don't have permission to do that.";
  return error.message;
}
