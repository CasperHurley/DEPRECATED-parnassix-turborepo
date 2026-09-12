import { z } from "zod";
import { SourceRefSchema } from "./source";

/**
 * Timestamps cross the wire as ISO 8601 strings. `Date` is deliberately not
 * accepted: it does not survive JSON serialization, and the agents producing
 * these specs emit JSON.
 *
 * Both date-only and full datetime forms are allowed, because precision of
 * knowledge is itself meaningful evidence — a document that says "January 2023"
 * should not be promoted to a fabricated `2023-01-01T00:00:00Z`.
 */
export const TimestampSchema = z.union([z.iso.datetime({ offset: true }), z.iso.date()]);
export type Timestamp = z.infer<typeof TimestampSchema>;

/** How a connecting line is drawn. Shared across components that draw lines. */
export const LineVariant = {
  Solid: "solid",
  Dashed: "dashed",
  Dotted: "dotted",
  None: "none",
} as const;
export type LineVariant = (typeof LineVariant)[keyof typeof LineVariant];
export const LineVariantSchema = z.enum(LineVariant);

/**
 * Calendar granularity.
 *
 * Note this is a const object rather than a TypeScript `enum`: enums do not
 * round-trip to JSON Schema and interact badly with `isolatedModules`. Call
 * sites like `UnitOfTime.Year` read exactly as they did before.
 */
export const UnitOfTime = {
  Millisecond: "millisecond",
  Second: "second",
  Minute: "minute",
  Hour: "hour",
  Day: "day",
  Week: "week",
  Month: "month",
  Year: "year",
} as const;
export type UnitOfTime = (typeof UnitOfTime)[keyof typeof UnitOfTime];
export const UnitOfTimeSchema = z.enum(UnitOfTime);

/**
 * How much of a timestamp is actually *known*.
 *
 * Evidentiary sources are routinely vague: a document says "March 2019", not an
 * instant. Canonicalizing that to `2019-03-01` and rendering it as a specific
 * day fabricates precision the source never had — which, in a tool meant to
 * support legal work, is its own kind of false statement.
 *
 * So `timestamp` carries the canonical instant and `precision` says how much of
 * it to believe. A renderer must never display or position an event more
 * precisely than this allows.
 *
 * Deliberately not `UnitOfTime`: `week` does not nest in this hierarchy, because
 * it is not a truncation boundary of a calendar date. No source is ever known
 * "to the week" in the way it can be known to the month. `week` remains a
 * perfectly good AXIS TICK granularity though, which is why `floorToUnit` takes
 * a `UnitOfTime` while a precision cannot be one.
 *
 * The scale bottoms out at `millisecond` because machine-generated evidence is
 * evidence: server logs, audit trails and transaction records routinely
 * establish a time to the millisecond, and with those sources the ORDER is
 * frequently the whole argument — which write landed first, whether the
 * transfer preceded the instruction. Stopping at `second` did not make the
 * contract more careful, it just discarded that ordering silently.
 */
export const TimePrecision = {
  Year: "year",
  Month: "month",
  Day: "day",
  Hour: "hour",
  Minute: "minute",
  Second: "second",
  Millisecond: "millisecond",
} as const;
export type TimePrecision = (typeof TimePrecision)[keyof typeof TimePrecision];
export const TimePrecisionSchema = z.enum(TimePrecision);

/** Precisions that require a time-of-day component to be meaningful. */
const SUB_DAY_PRECISIONS: readonly TimePrecision[] = [
  TimePrecision.Hour,
  TimePrecision.Minute,
  TimePrecision.Second,
];

/** True when `timestamp` carries a time-of-day component. */
export function hasTimeOfDay(timestamp: string): boolean {
  return timestamp.includes("T");
}

/**
 * True when `timestamp` actually writes out a fraction of a second.
 *
 * `09:12:00` and `09:12:00.000` are the same instant but not the same claim:
 * only the second says the source resolved the millisecond. Millisecond
 * precision needs this rather than `hasTimeOfDay`, for the same reason minute
 * precision needs a time of day at all.
 */
export function hasFractionalSeconds(timestamp: string): boolean {
  return /\d{2}:\d{2}:\d{2}\.\d+/.test(timestamp);
}

/**
 * Whether a timestamp string can actually support the claimed precision.
 *
 * A date-only string cannot be known to the minute — claiming otherwise is
 * incoherent rather than merely imprecise, so it is rejected outright.
 */
export function timestampSupportsPrecision(
  timestamp: string,
  precision: TimePrecision,
): boolean {
  if (precision === TimePrecision.Millisecond) return hasFractionalSeconds(timestamp);
  if (!SUB_DAY_PRECISIONS.includes(precision)) return true;
  return hasTimeOfDay(timestamp);
}

/**
 * The precision to use when a spec does not state one.
 *
 * Derived rather than defaulted in the schema, for the same reason tick
 * granularity is derived: it keeps a field off the agent-facing surface. An
 * agent only needs to set `precision` when the source is VAGUER than the
 * timestamp string looks.
 */
export function resolveTimePrecision(
  timestamp: string,
  precision?: TimePrecision,
): TimePrecision {
  if (precision) return precision;
  if (hasFractionalSeconds(timestamp)) return TimePrecision.Millisecond;
  return hasTimeOfDay(timestamp) ? TimePrecision.Second : TimePrecision.Day;
}

/**
 * A half-open span of real time, in epoch milliseconds. `end` is exclusive.
 *
 * This is what a timestamp plus a precision actually denotes. A source saying
 * "March 2019" does not identify an instant, it identifies a month, and a
 * renderer positioning it must place it across that month rather than at a
 * point — the positional counterpart of the rule `PRECISION_FORMAT` enforces
 * for display.
 */
export interface TimeInterval {
  start: number;
  /** Exclusive. */
  end: number;
  /** The precision actually used. May be coarser than the one requested. */
  precision: TimePrecision;
}

/**
 * ISO 8601 in the two forms this contract accepts: `YYYY-MM-DD`, or a datetime
 * with an optional offset.
 *
 * Parsed field-by-field rather than through `new Date(...)` because the fields
 * we need are the SOURCE's wall clock, and every `Date` accessor that returns
 * wall-clock fields (`getHours`, `getDate`, …) returns the VIEWER's. Reading a
 * `+01:00` timestamp with `getDate()` in `UTC-08:00` can return the previous
 * day, which silently moves an event across a day boundary — the exact failure
 * `formatTimestamp` exists to prevent, arriving through the positioning layer.
 */
const ISO_FIELDS =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * A written fraction of a second, as whole milliseconds.
 *
 * Padded before truncating so `.1` is 100ms rather than 1ms, and anything finer
 * than a millisecond is dropped — the contract resolves no further, and keeping
 * digits it cannot position or display would be the same silent over-claim the
 * precision scale exists to prevent.
 */
function millisecondsOf(fraction: string | undefined): number {
  if (!fraction) return 0;
  return Number(`${fraction}000`.slice(0, 3));
}

/**
 * Minutes to add to a source wall clock to reach UTC. Absent or `Z` means UTC.
 *
 * The offset written in the string IS the source's zone, so there is no named
 * zone to resolve and therefore no DST ambiguity to worry about.
 */
export function offsetMinutesOf(timestamp: string): number {
  const m = ISO_FIELDS.exec(timestamp);
  return m ? offsetMinutes(m[8]) : 0;
}

function offsetMinutes(token: string | undefined): number {
  if (!token || token === "Z") return 0;
  const digits = token.slice(1).replace(":", "");
  return (
    (token[0] === "-" ? -1 : 1) *
    (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)))
  );
}

/** Field order, coarsest first. The index doubles as a precision rank. */
const FIELD_ORDER: readonly TimePrecision[] = [
  TimePrecision.Year,
  TimePrecision.Month,
  TimePrecision.Day,
  TimePrecision.Hour,
  TimePrecision.Minute,
  TimePrecision.Second,
  TimePrecision.Millisecond,
];

/** The value each field takes when it sits below the known precision. */
const FIELD_FLOOR: readonly number[] = [0, 0, 1, 0, 0, 0, 0];

/**
 * Builds an epoch ms from UTC wall-clock fields, tolerating out-of-range values
 * so `+1` on any field rolls over correctly: month 12 becomes next January,
 * day 29 of a non-leap February becomes 1 March, hour 24 becomes next midnight.
 * Month lengths and leap years therefore come from the engine's calendar rather
 * than from a table maintained here.
 *
 * `setUTCFullYear` rather than `Date.UTC` because `Date.UTC` maps years 0-99
 * into 1900-1999 and the setter does not.
 */
function utcFromFields(f: readonly number[]): number {
  const d = new Date(0);
  d.setUTCFullYear(f[0]!, f[1]!, f[2]!);
  d.setUTCHours(f[3]!, f[4]!, f[5]!, f[6] ?? 0);
  return d.getTime();
}

/** Wall-clock fields of an instant, read in a fixed offset. */
function fieldsAt(at: number, offset: number): number[] {
  const d = new Date(at + offset * 60_000);
  return [
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  ];
}

/**
 * The span of real time a timestamp denotes at its resolved precision.
 *
 * Returns `null` — never `NaN` — for an unreadable timestamp. This matters:
 * `Math.min(NaN, x)` is `NaN`, so a single bad value would poison a computed
 * domain and blank an entire axis. `null` forces the caller to branch, and the
 * only honest branch is to list the event as undated. Positioning it at zero
 * would assert it happened at the start of the report, which the source never
 * said.
 */
export function timestampInterval(
  timestamp: string,
  precision?: TimePrecision,
): TimeInterval | null {
  if (Number.isNaN(Date.parse(timestamp))) return null;
  const m = ISO_FIELDS.exec(timestamp);
  if (!m) return null;

  let resolved = resolveTimePrecision(timestamp, precision);
  // The schema rejects a precision the string cannot support, but this function
  // is also reachable directly from a render prop. Positioning a date-only
  // value to the minute would fabricate a midnight the source never stated.
  if (!timestampSupportsPrecision(timestamp, resolved)) resolved = TimePrecision.Day;

  const wall = [
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0),
    millisecondsOf(m[7]),
  ];
  // `Date.parse` is lenient about out-of-range calendar fields — V8 reads
  // "2019-02-30" as 2 March — but `TimestampSchema` rejects such a value, so a
  // spec carrying one never renders at all. Match the schema rather than the
  // engine: a document stating a day that does not exist is a data error, and
  // silently sliding the event into the next month would position it on a date
  // no source ever claimed.
  const roundTrip = fieldsAt(utcFromFields(wall), 0);
  if (roundTrip.some((v, i) => v !== wall[i])) return null;

  const keep = FIELD_ORDER.indexOf(resolved);

  const startFields = wall.map((v, i) => (i <= keep ? v : FIELD_FLOOR[i]!));
  const endFields = startFields.slice();
  endFields[keep] = endFields[keep]! + 1; // utcFromFields normalises the rollover

  // A wall clock of 09:00 at +05:00 is the instant 04:00Z, i.e. wall - offset.
  const shift = offsetMinutes(m[8]) * 60_000;
  return {
    start: utcFromFields(startFields) - shift,
    end: utcFromFields(endFields) - shift,
    precision: resolved,
  };
}

/**
 * The largest boundary of `unit * step` at or before `at`, read in `offset`.
 *
 * Axis ticks need calendar boundaries, and a boundary is only meaningful in a
 * stated zone — "midnight" is a different instant in every offset. Callers pass
 * the zone the axis is read in; they never get the viewer's.
 *
 * Unlike `TimePrecision`, `unit` here may be `week`: a week is a perfectly good
 * tick granularity even though it is not a truncation boundary of a calendar
 * date and so cannot be a precision.
 */
export function floorToUnit(
  at: number,
  unit: UnitOfTime,
  step = 1,
  offset = 0,
): number {
  const shift = offset * 60_000;
  const [y, mo, d, h, mi, s, ms] = fieldsAt(at, offset) as [
    number, number, number, number, number, number, number,
  ];
  const build = (...f: number[]) =>
    utcFromFields([f[0]!, f[1]!, f[2]!, f[3] ?? 0, f[4] ?? 0, f[5] ?? 0, f[6] ?? 0]) - shift;
  const down = (v: number) => Math.floor(v / step) * step;

  switch (unit) {
    case UnitOfTime.Year:
      return build(down(y), 0, 1);
    case UnitOfTime.Month:
      return build(y, down(mo), 1);
    case UnitOfTime.Week: {
      // ISO weeks start Monday. getUTCDay() is Sunday-based, so rotate it.
      const weekday = (new Date(at + shift).getUTCDay() + 6) % 7;
      return build(y, mo, d - weekday);
    }
    case UnitOfTime.Day:
      return build(y, mo, d);
    case UnitOfTime.Hour:
      return build(y, mo, d, down(h));
    case UnitOfTime.Minute:
      return build(y, mo, d, h, down(mi));
    case UnitOfTime.Second:
      return build(y, mo, d, h, mi, down(s));
    case UnitOfTime.Millisecond:
      return build(y, mo, d, h, mi, s, down(ms));
  }
}

/**
 * `at` advanced by `step` whole `unit`s, read in `offset`. `step` may be
 * negative. Rollover comes from the engine's calendar, so adding a month to
 * 31 January lands in March exactly as `Date` would — callers walking ticks
 * from a floored boundary never see that case.
 */
export function addUnits(
  at: number,
  unit: UnitOfTime,
  step = 1,
  offset = 0,
): number {
  const shift = offset * 60_000;
  const f = fieldsAt(at, offset);
  switch (unit) {
    case UnitOfTime.Year:
      f[0]! += step;
      break;
    case UnitOfTime.Month:
      f[1]! += step;
      break;
    case UnitOfTime.Week:
      f[2]! += step * 7;
      break;
    case UnitOfTime.Day:
      f[2]! += step;
      break;
    case UnitOfTime.Hour:
      f[3]! += step;
      break;
    case UnitOfTime.Minute:
      f[4]! += step;
      break;
    case UnitOfTime.Second:
      f[5]! += step;
      break;
    case UnitOfTime.Millisecond:
      f[6]! += step;
      break;
  }
  return utcFromFields(f) - shift;
}

/**
 * One period of real time a fact covers.
 *
 * The shape exists because a single `timestamp` + `precision` denotes exactly
 * one interval, and evidence is not always shaped that way: "payments were made
 * in March, July and November" is one fact with three periods.
 *
 * `until` is kept SEPARATE from `precision` on purpose. "The injunction ran from
 * 3 March to 19 May" and "some time in March" are different claims, and folding
 * a duration into the precision field would let a renderer draw a
 * month-precision instant as a two-month duration — a fabricated duration,
 * which is the same class of error `precision` exists to prevent. `precision`
 * says how much of the start is known; `until` states an end that was actually
 * recorded.
 */
/** The fields that describe one period. Shared by TimeSpan and by an event's primary period. */
export const timeSpanFields = {
  timestamp: TimestampSchema,
  precision: TimePrecisionSchema.optional(),
  /** An explicit end. Absent means the period is exactly `precision` wide. */
  until: TimestampSchema.optional(),
  untilPrecision: TimePrecisionSchema.optional(),
};

export interface TimeSpanLike {
  timestamp: string;
  precision?: TimePrecision;
  until?: string;
  untilPrecision?: TimePrecision;
}

/**
 * Everything incoherent a period can say about itself.
 *
 * Written as a plain function rather than inline refinements so that an event's
 * PRIMARY period and the extra periods in `spans` are checked by exactly the
 * same rules — two copies of this would drift, and the half that drifted would
 * be the half no test covered.
 *
 * As with `precision` today, JSON Schema cannot express any of these, so the
 * emitted artifact does not carry them and `datamodel-code-generator` will not
 * reproduce them. The Python side needs its own validator or a spec passes
 * Pydantic and fails here.
 */
export function timeSpanIssues(span: TimeSpanLike): { message: string; path: string[] }[] {
  const issues: { message: string; path: string[] }[] = [];

  if (!timestampSupportsPrecision(span.timestamp, span.precision ?? TimePrecision.Day)) {
    issues.push({
      message: "precision is finer than the timestamp supports (no time-of-day component)",
      path: ["precision"],
    });
  }

  if (span.untilPrecision !== undefined && span.until === undefined) {
    issues.push({ message: "untilPrecision has no meaning without `until`", path: ["untilPrecision"] });
  }

  if (span.until !== undefined) {
    if (!timestampSupportsPrecision(span.until, span.untilPrecision ?? TimePrecision.Day)) {
      issues.push({
        message: "untilPrecision is finer than `until` supports (no time-of-day component)",
        path: ["untilPrecision"],
      });
    }
    const from = timestampInterval(span.timestamp, span.precision);
    const to = timestampInterval(span.until, span.untilPrecision);
    // Unreadable values are already rejected by TimestampSchema.
    if (from && to && to.end <= from.start) {
      issues.push({ message: "`until` is before the period starts", path: ["until"] });
    }
  }

  return issues;
}

/** Applies `timeSpanIssues` to any object schema carrying the period fields. */
export function checkTimeSpan(span: TimeSpanLike, ctx: z.RefinementCtx): void {
  for (const issue of timeSpanIssues(span)) {
    ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
  }
}

/**
 * One period of real time a fact covers.
 *
 * The shape exists because a single `timestamp` + `precision` denotes exactly
 * one interval, and evidence is not always shaped that way: "payments were made
 * in March, July and November" is one fact with three periods.
 *
 * `until` is kept SEPARATE from `precision` on purpose. "The injunction ran from
 * 3 March to 19 May" and "some time in March" are different claims, and folding
 * a duration into the precision field would let a renderer draw a
 * month-precision instant as a two-month duration — a fabricated duration,
 * which is the same class of error `precision` exists to prevent. `precision`
 * says how much of the start is known; `until` states an end that was actually
 * recorded.
 */
export const TimeSpanSchema = z
  .object({
    ...timeSpanFields,
    /** Periods of one fact can come from different documents. */
    source: SourceRefSchema.optional(),
  })
  .superRefine(checkTimeSpan);
export type TimeSpan = z.infer<typeof TimeSpanSchema>;

/**
 * The interval a `TimeSpan` covers.
 *
 * With no `until` this is exactly `timestampInterval` — the period is as wide as
 * its precision. With one, the period runs from the start of the first interval
 * to the end of the second, so "3 March to 19 May" at day precision covers all
 * of 19 May rather than stopping at its midnight.
 *
 * An unreadable `until` degrades to the start's own interval rather than
 * discarding the period: the start is still known, and hiding a fact because
 * half of it failed to parse loses more than it protects. The schema rejects
 * such a value before it can reach here over the wire.
 */
export function spanInterval(span: {
  timestamp: string;
  precision?: TimePrecision;
  until?: string;
  untilPrecision?: TimePrecision;
}): TimeInterval | null {
  const from = timestampInterval(span.timestamp, span.precision);
  if (!from) return null;
  if (span.until === undefined) return from;
  const to = timestampInterval(span.until, span.untilPrecision);
  if (!to) return from;
  return {
    start: Math.min(from.start, to.start),
    end: Math.max(from.end, to.end),
    precision: from.precision,
  };
}
