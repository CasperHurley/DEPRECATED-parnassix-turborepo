import { z } from "zod";

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
 * Deliberately not `UnitOfTime`: `week` does not nest in this hierarchy (it is
 * not a truncation boundary of a calendar date), and `DateMethodMap` already
 * had to exclude it.
 */
export const TimePrecision = {
  Year: "year",
  Month: "month",
  Day: "day",
  Hour: "hour",
  Minute: "minute",
  Second: "second",
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
 * Whether a timestamp string can actually support the claimed precision.
 *
 * A date-only string cannot be known to the minute — claiming otherwise is
 * incoherent rather than merely imprecise, so it is rejected outright.
 */
export function timestampSupportsPrecision(
  timestamp: string,
  precision: TimePrecision,
): boolean {
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
  return hasTimeOfDay(timestamp) ? TimePrecision.Second : TimePrecision.Day;
}
