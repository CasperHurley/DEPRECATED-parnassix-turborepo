import { TimePrecision, resolveTimePrecision } from "./primitives";

/**
 * Presentation of timestamps whose precision is known only approximately.
 *
 * This lives with the contract rather than in a renderer because it is a
 * guarantee about what the contract *means*, not a layout choice: **never
 * render more detail than is known.** A document that said "March 2019" must
 * display as "Mar 2019", never "Mar 1, 2019" — the day is an artefact of
 * canonicalisation, and showing it states something the source does not. That
 * has to hold identically on web, on native, and in an exported PDF, so it
 * cannot live in any one of them.
 *
 * (By contrast `TimeFormatterMap` and `DateMethodMap` stay in packages/ui —
 * those are axis-labelling and layout arithmetic, not claims about evidence.)
 */
export const PRECISION_FORMAT: Record<TimePrecision, Intl.DateTimeFormatOptions> = {
  [TimePrecision.Year]: { year: "numeric" },
  [TimePrecision.Month]: { year: "numeric", month: "short" },
  [TimePrecision.Day]: { year: "numeric", month: "short", day: "numeric" },
  [TimePrecision.Hour]: { year: "numeric", month: "short", day: "numeric", hour: "numeric" },
  [TimePrecision.Minute]: {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
  [TimePrecision.Second]: {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  },
};

/**
 * The zone a timestamp should be *read* in: the one it was written in.
 *
 * Never the viewer's. A timestamp extracted from a document must display as
 * that document states it — two people in different timezones looking at the
 * same evidence have to see the same time, and a local-zone shift can move an
 * event across a day boundary or reorder it against a neighbour. Both are
 * material when the timeline is the argument.
 *
 * Date-only and offset-less strings are read as UTC, which is how `Date` parses
 * them, so the rendered value matches the string exactly.
 */
function sourceTimeZone(timestamp: string): string {
  const offset = /(?:Z|([+-]\d{2}:?\d{2}))$/.exec(timestamp);
  if (!offset) return "UTC";
  return offset[1] ?? "UTC";
}

/**
 * Formats a timestamp honestly for its precision, in the zone it was written in.
 *
 * Falls back to the raw string if the runtime's Intl cannot do the job — some
 * React Native builds ship a reduced Intl, and a wrong time is worse than an
 * unformatted one here.
 */
export function formatTimestamp(
  timestamp: string,
  precision?: TimePrecision,
  locale?: string,
): string {
  const resolved = resolveTimePrecision(timestamp, precision);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;

  const options: Intl.DateTimeFormatOptions = {
    ...PRECISION_FORMAT[resolved],
    timeZone: sourceTimeZone(timestamp),
  };

  try {
    return new Intl.DateTimeFormat(locale, options).format(parsed);
  } catch {
    return timestamp;
  }
}
