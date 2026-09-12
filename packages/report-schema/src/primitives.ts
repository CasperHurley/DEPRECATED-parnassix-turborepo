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
