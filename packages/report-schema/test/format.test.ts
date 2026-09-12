import { describe, expect, it } from "vitest";
import { TimePrecision, formatTimestamp } from "../src";

describe("timestamps are never rendered more precisely than they are known", () => {
  it("shows a month-precision source as a month, not a day", () => {
    // The source said "March 2019". 2019-03-01 is canonicalisation, not fact.
    expect(formatTimestamp("2019-03-01", TimePrecision.Month, "en-US")).toBe("Mar 2019");
  });

  it("shows a year-precision source as a year", () => {
    expect(formatTimestamp("2019-03-01", TimePrecision.Year, "en-US")).toBe("2019");
  });

  it("shows full detail when the source has it", () => {
    const out = formatTimestamp("2019-03-01T09:30:00Z", TimePrecision.Minute, "en-US");
    expect(out).toContain("Mar 1, 2019");
    expect(out).toMatch(/9:30/);
  });

  it("renders a timestamp in the zone it was written in, not the viewer's", () => {
    // A document saying 09:30+01:00 must read 9:30 to everyone. Shifting it into
    // the reader's local zone can reorder it against a neighbouring event or move
    // it across a day boundary — material when the timeline IS the argument.
    expect(formatTimestamp("2019-03-01T09:30:00+01:00", TimePrecision.Minute, "en-US"))
      .toMatch(/9:30/);
    expect(formatTimestamp("2019-03-01T09:30:00Z", TimePrecision.Minute, "en-US"))
      .toMatch(/9:30/);
    // Same instant, two source zones, two honest readings.
    expect(formatTimestamp("2019-03-01T09:30:00+01:00", TimePrecision.Minute, "en-US")).not.toBe(
      formatTimestamp("2019-03-01T08:30:00Z", TimePrecision.Minute, "en-US"),
    );
  });

  it("does not shift a date-only value across a day boundary", () => {
    // `new Date("2019-03-01")` is UTC midnight; formatting that in a negative-offset
    // zone renders "Feb 28, 2019" and silently changes what the report says.
    expect(formatTimestamp("2019-03-01", TimePrecision.Day, "en-US")).toBe("Mar 1, 2019");
  });

  it("falls back to the raw string rather than rendering Invalid Date", () => {
    expect(formatTimestamp("not-a-date", TimePrecision.Day, "en-US")).toBe("not-a-date");
  });

  it("derives precision when none is stated", () => {
    expect(formatTimestamp("2019-03-01", undefined, "en-US")).toBe("Mar 1, 2019");
  });
});
