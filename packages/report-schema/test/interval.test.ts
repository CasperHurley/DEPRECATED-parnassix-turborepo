import { describe, expect, it } from "vitest";
import {
  TimePrecision,
  UnitOfTime,
  addUnits,
  floorToUnit,
  formatTimestamp,
  TimeSpanSchema,
  TimelineEventSpecSchema,
  eventIntervals,
  labelPrecision,
  offsetMinutesOf,
  spanInterval,
  timestampInterval,
} from "../src";

const DAY = 86_400_000;

/**
 * Every expectation here is written as a `Date.UTC(...)` literal rather than a
 * parsed string. That is deliberate: `Date.UTC` is zone-invariant, so these
 * assertions fail in exactly the same way whatever `TZ` the test host runs in.
 * A test written against `new Date("2019-03-01")` would pass in London and fail
 * in Los Angeles, which is the very bug this module exists to avoid.
 */

describe("an event occupies the span its source actually knew", () => {
  it("gives a year-precision source the whole year", () => {
    // The document said "2019". It did not say January.
    const iv = timestampInterval("2019-03-01", TimePrecision.Year)!;
    expect(iv.start).toBe(Date.UTC(2019, 0, 1));
    expect(iv.end).toBe(Date.UTC(2020, 0, 1));
  });

  it("gives a month-precision source the whole month, of the right length", () => {
    expect(timestampInterval("2019-03-01", TimePrecision.Month)!.end).toBe(Date.UTC(2019, 3, 1));
    // 31 days in March, 30 in April — taken from the calendar, not a table.
    const march = timestampInterval("2019-03-15", TimePrecision.Month)!;
    const april = timestampInterval("2019-04-15", TimePrecision.Month)!;
    expect(march.end - march.start).toBe(31 * DAY);
    expect(april.end - april.start).toBe(30 * DAY);
  });

  it("counts February correctly in a leap year", () => {
    const leap = timestampInterval("2020-02-10", TimePrecision.Month)!;
    const common = timestampInterval("2019-02-10", TimePrecision.Month)!;
    expect(leap.end - leap.start).toBe(29 * DAY);
    expect(common.end - common.start).toBe(28 * DAY);
  });

  it("rolls over the year, the month, and the day", () => {
    expect(timestampInterval("2019-12-15", TimePrecision.Month)!.end).toBe(Date.UTC(2020, 0, 1));
    expect(timestampInterval("2019-12-31", TimePrecision.Day)!.end).toBe(Date.UTC(2020, 0, 1));
    expect(timestampInterval("2019-03-01T23:30:00Z", TimePrecision.Hour)!.end).toBe(
      Date.UTC(2019, 2, 2, 0),
    );
  });

  it("gives a date-only value exactly one day", () => {
    const iv = timestampInterval("2019-03-01")!;
    expect(iv.start).toBe(Date.UTC(2019, 2, 1));
    expect(iv.end - iv.start).toBe(DAY);
  });

  it("gives minute and second precision exactly one minute and one second", () => {
    const min = timestampInterval("2019-03-01T09:30:00Z", TimePrecision.Minute)!;
    const sec = timestampInterval("2019-03-01T09:30:00Z", TimePrecision.Second)!;
    expect(min.end - min.start).toBe(60_000);
    expect(sec.end - sec.start).toBe(1_000);
  });

  it("truncates a fractional second rather than rounding it up", () => {
    // Rounding up would place the event after an event that genuinely followed it.
    const iv = timestampInterval("2019-03-01T09:30:00.750Z", TimePrecision.Second)!;
    expect(iv.start).toBe(Date.UTC(2019, 2, 1, 9, 30, 0));
  });
});

describe("positioning reads the zone the timestamp was written in", () => {
  it("does not place an offset timestamp on the viewer's day", () => {
    // 00:30 on 1 March in +05:00 is 19:30 on 28 February UTC. The day this event
    // occupies is the SOURCE's 1 March, which starts at 19:00Z on 28 February.
    const iv = timestampInterval("2019-03-01T00:30:00+05:00", TimePrecision.Day)!;
    expect(iv.start).toBe(Date.UTC(2019, 1, 28, 19));
    expect(iv.end).toBe(Date.UTC(2019, 2, 1, 19));
  });

  it("handles a negative offset symmetrically", () => {
    const iv = timestampInterval("2019-03-01T23:30:00-08:00", TimePrecision.Day)!;
    expect(iv.start).toBe(Date.UTC(2019, 2, 1, 8));
    expect(iv.end).toBe(Date.UTC(2019, 2, 2, 8));
  });

  it("gives the same instant in two source zones two different days", () => {
    // The positional twin of format.test.ts's "two honest readings". These are
    // the same moment, but the documents disagree about which day it was, and
    // that disagreement is evidence rather than something to normalise away.
    const east = timestampInterval("2019-03-01T00:30:00+05:00", TimePrecision.Day)!;
    const utc = timestampInterval("2019-02-28T19:30:00Z", TimePrecision.Day)!;
    expect(east.start).not.toBe(utc.start);
    expect(utc.start).toBe(Date.UTC(2019, 1, 28));
  });

  it("treats a date-only value as UTC, matching formatTimestamp", () => {
    expect(offsetMinutesOf("2019-03-01")).toBe(0);
    expect(offsetMinutesOf("2019-03-01T00:00:00Z")).toBe(0);
    expect(offsetMinutesOf("2019-03-01T00:00:00+05:30")).toBe(330);
    expect(offsetMinutesOf("2019-03-01T00:00:00-08:00")).toBe(-480);
  });
});

describe("an interval is never more precise than its source", () => {
  it("clamps a precision the timestamp cannot support", () => {
    // A date-only string claimed to the minute would fabricate a midnight.
    const iv = timestampInterval("2019-03-01", TimePrecision.Minute)!;
    expect(iv.precision).toBe(TimePrecision.Day);
    expect(iv.end - iv.start).toBe(DAY);
  });

  it("reports the precision it actually used", () => {
    expect(timestampInterval("2019-03-01")!.precision).toBe(TimePrecision.Day);
    expect(timestampInterval("2019-03-01T09:30:00Z")!.precision).toBe(TimePrecision.Second);
    expect(timestampInterval("2019-03-01", TimePrecision.Year)!.precision).toBe(
      TimePrecision.Year,
    );
  });
});

describe("an unreadable timestamp is refused, not guessed at", () => {
  it.each(["not-a-date", "", "last Tuesday", "2019-13-01", "2019-02-30"])(
    "returns null for %o",
    (bad) => {
      // null rather than NaN: Math.min(NaN, x) is NaN, so one bad value would
      // poison the domain and blank the entire axis.
      expect(timestampInterval(bad)).toBeNull();
    },
  );

  it("agrees with formatTimestamp on anything that is not a date at all", () => {
    // An event must never be positioned on an axis it cannot be labelled on.
    for (const ts of ["not-a-date", "", "last Tuesday"]) {
      expect(formatTimestamp(ts, undefined, "en-US")).toBe(ts);
      expect(timestampInterval(ts)).toBeNull();
    }
  });

  it("refuses a day that does not exist, where Date.parse would slide it", () => {
    // V8 reads "2019-02-30" as 2 March, and formatTimestamp inherits that.
    // TimestampSchema rejects the value outright, so it cannot arrive over the
    // wire; positioning matches the schema rather than the engine, because
    // sliding the event into the next month would place it on a date no source
    // claimed. formatTimestamp is knowingly the more lenient of the two — it is
    // only ever reached for a value the schema already let through.
    expect(timestampInterval("2019-02-30")).toBeNull();
    expect(timestampInterval("2019-02-29")).toBeNull(); // 2019 is not a leap year
    expect(timestampInterval("2020-02-29")).not.toBeNull();
    expect(timestampInterval("2019-04-31")).toBeNull();
  });
});

describe("intervals bracket the instant they came from", () => {
  const samples = [
    "2019-03-01",
    "2019-12-31",
    "2020-02-29",
    "2019-07-15T09:12:00Z",
    "2019-07-15T11:40:00+01:00",
    "2019-01-01T00:00:00-08:00",
    "2019-06-30T23:59:59+05:30",
  ];
  const precisions = [undefined, ...Object.values(TimePrecision)];

  it("always contains its own timestamp and has positive width", () => {
    for (const ts of samples) {
      for (const p of precisions) {
        const iv = timestampInterval(ts, p);
        if (!iv) continue;
        const at = Date.parse(ts);
        expect(iv.end).toBeGreaterThan(iv.start);
        expect(iv.start).toBeLessThanOrEqual(at);
        expect(iv.end).toBeGreaterThan(at);
      }
    }
  });
});

describe("calendar boundaries are found in the zone the axis is read in", () => {
  it("floors to real calendar boundaries", () => {
    const at = Date.UTC(2019, 6, 15, 14, 37, 22);
    expect(floorToUnit(at, UnitOfTime.Year)).toBe(Date.UTC(2019, 0, 1));
    expect(floorToUnit(at, UnitOfTime.Month)).toBe(Date.UTC(2019, 6, 1));
    expect(floorToUnit(at, UnitOfTime.Day)).toBe(Date.UTC(2019, 6, 15));
    expect(floorToUnit(at, UnitOfTime.Hour)).toBe(Date.UTC(2019, 6, 15, 14));
    expect(floorToUnit(at, UnitOfTime.Minute)).toBe(Date.UTC(2019, 6, 15, 14, 37));
    expect(floorToUnit(at, UnitOfTime.Second)).toBe(Date.UTC(2019, 6, 15, 14, 37, 22));
  });

  it("floors a week to the preceding Monday", () => {
    // 2019-07-15 is itself a Monday; 2019-07-18 is the Thursday after it.
    expect(floorToUnit(Date.UTC(2019, 6, 18), UnitOfTime.Week)).toBe(Date.UTC(2019, 6, 15));
    expect(floorToUnit(Date.UTC(2019, 6, 15), UnitOfTime.Week)).toBe(Date.UTC(2019, 6, 15));
    // Sunday belongs to the week that began the previous Monday, not the next one.
    expect(floorToUnit(Date.UTC(2019, 6, 21), UnitOfTime.Week)).toBe(Date.UTC(2019, 6, 15));
  });

  it("honours a step", () => {
    expect(floorToUnit(Date.UTC(2019, 6, 15), UnitOfTime.Year, 10)).toBe(Date.UTC(2010, 0, 1));
    expect(floorToUnit(Date.UTC(2019, 6, 15), UnitOfTime.Month, 3)).toBe(Date.UTC(2019, 6, 1));
    expect(floorToUnit(Date.UTC(2019, 6, 15, 14, 37), UnitOfTime.Minute, 15)).toBe(
      Date.UTC(2019, 6, 15, 14, 30),
    );
  });

  it("floors in the offset it is given, not the viewer's", () => {
    // 2019-07-15T02:00Z is already 07:00 on the 15th at +05:00, but it is still
    // 22:00 on the 14th at -04:00. "Midnight" is a different instant in each.
    const at = Date.UTC(2019, 6, 15, 2, 0);
    expect(floorToUnit(at, UnitOfTime.Day, 1, 300)).toBe(Date.UTC(2019, 6, 14, 19));
    expect(floorToUnit(at, UnitOfTime.Day, 1, -240)).toBe(Date.UTC(2019, 6, 14, 4));
    expect(floorToUnit(at, UnitOfTime.Day, 1, 0)).toBe(Date.UTC(2019, 6, 15));
  });

  it("advances by whole calendar units, not fixed millisecond counts", () => {
    expect(addUnits(Date.UTC(2019, 0, 31), UnitOfTime.Month, 1)).toBe(Date.UTC(2019, 2, 3));
    expect(addUnits(Date.UTC(2019, 11, 1), UnitOfTime.Month, 1)).toBe(Date.UTC(2020, 0, 1));
    expect(addUnits(Date.UTC(2020, 1, 1), UnitOfTime.Month, 1)).toBe(Date.UTC(2020, 2, 1));
    expect(addUnits(Date.UTC(2019, 6, 15), UnitOfTime.Week, 1)).toBe(Date.UTC(2019, 6, 22));
    expect(addUnits(Date.UTC(2019, 6, 15), UnitOfTime.Day, -1)).toBe(Date.UTC(2019, 6, 14));
  });

  it("round-trips: flooring then stepping forward lands on the next boundary", () => {
    const at = Date.UTC(2019, 6, 15, 14, 37, 22);
    for (const unit of Object.values(UnitOfTime)) {
      const floored = floorToUnit(at, unit);
      const next = addUnits(floored, unit, 1);
      expect(floored).toBeLessThanOrEqual(at);
      expect(next).toBeGreaterThan(at);
      expect(floorToUnit(floored, unit)).toBe(floored);
    }
  });
});

describe("labelUnit can only coarsen a label, never sharpen it", () => {
  it("ignores a labelUnit finer than the source precision", () => {
    // The source said "March 2019"; asking for minutes cannot conjure them.
    expect(labelPrecision("2019-03-01", TimePrecision.Month, UnitOfTime.Minute)).toBe(
      TimePrecision.Month,
    );
  });

  it("applies a labelUnit that is coarser", () => {
    expect(labelPrecision("2019-03-01T09:30:00Z", undefined, UnitOfTime.Year)).toBe(
      TimePrecision.Year,
    );
  });

  it("falls through when no labelUnit is given, or when it is week", () => {
    expect(labelPrecision("2019-03-01")).toBe(TimePrecision.Day);
    expect(labelPrecision("2019-03-01", undefined, UnitOfTime.Week)).toBe(TimePrecision.Day);
  });

  it("composes with formatTimestamp to render only what is known", () => {
    const ts = "2019-03-01";
    expect(formatTimestamp(ts, labelPrecision(ts, TimePrecision.Month, UnitOfTime.Minute), "en-US"))
      .toBe("Mar 2019");
  });
});

describe("a fact can cover several periods, and each is honoured", () => {
  it("treats a span with no `until` as exactly its precision wide", () => {
    const iv = spanInterval({ timestamp: "2019-03-01", precision: TimePrecision.Month })!;
    expect(iv.start).toBe(Date.UTC(2019, 2, 1));
    expect(iv.end).toBe(Date.UTC(2019, 3, 1));
  });

  it("runs an explicit `until` to the END of its own interval", () => {
    // "3 March to 19 May" covers all of 19 May. Stopping at its midnight would
    // shorten the period by a day and, on a timeline, by a visible amount.
    const iv = spanInterval({ timestamp: "2019-03-03", until: "2019-05-19" })!;
    expect(iv.start).toBe(Date.UTC(2019, 2, 3));
    expect(iv.end).toBe(Date.UTC(2019, 4, 20));
  });

  it("keeps `until` distinct from precision", () => {
    // A month-precision instant and a two-month duration are different claims.
    const vague = spanInterval({ timestamp: "2019-03-01", precision: TimePrecision.Month })!;
    const duration = spanInterval({ timestamp: "2019-03-01", until: "2019-04-30" })!;
    expect(duration.end - duration.start).toBeGreaterThan(vague.end - vague.start);
  });

  it("degrades to the start rather than losing the fact when `until` is unreadable", () => {
    const iv = spanInterval({ timestamp: "2019-03-03", until: "not-a-date" })!;
    expect(iv.start).toBe(Date.UTC(2019, 2, 3));
    expect(iv.end).toBe(Date.UTC(2019, 2, 4));
  });

  it("returns null when the start itself cannot be read", () => {
    expect(spanInterval({ timestamp: "not-a-date" })).toBeNull();
  });

  it("lists every period of an event, primary first", () => {
    const intervals = eventIntervals({
      timestamp: "2019-03-01",
      precision: TimePrecision.Month,
      spans: [
        { timestamp: "2019-07-01", precision: TimePrecision.Month },
        { timestamp: "2019-11-01", precision: TimePrecision.Month },
      ],
    });
    expect(intervals).toHaveLength(3);
    expect(intervals[0]!.start).toBe(Date.UTC(2019, 2, 1));
    expect(intervals[1]!.start).toBe(Date.UTC(2019, 6, 1));
    expect(intervals[2]!.start).toBe(Date.UTC(2019, 10, 1));
  });

  it("drops an unreadable extra period without losing the event", () => {
    const intervals = eventIntervals({
      timestamp: "2019-03-01",
      spans: [{ timestamp: "not-a-date" }],
    });
    expect(intervals).toHaveLength(1);
  });

  it("yields nothing when the primary timestamp is unreadable", () => {
    // The renderer then lists the event as undated rather than placing it.
    expect(eventIntervals({ timestamp: "not-a-date", spans: [{ timestamp: "2019-03-01" }] }))
      .toHaveLength(0);
  });

  it("reads each period in its own source zone", () => {
    const [primary, second] = eventIntervals({
      timestamp: "2019-03-01T00:30:00+05:00",
      precision: TimePrecision.Day,
      spans: [{ timestamp: "2019-03-01T00:30:00Z", precision: TimePrecision.Day }],
    });
    expect(primary!.start).toBe(Date.UTC(2019, 1, 28, 19));
    expect(second!.start).toBe(Date.UTC(2019, 2, 1));
  });
});

describe("a period that contradicts itself is rejected", () => {
  const parse = (span: unknown) => TimeSpanSchema.safeParse(span);

  it("refuses an `until` that precedes the start", () => {
    expect(parse({ timestamp: "2019-05-19", until: "2019-03-03" }).success).toBe(false);
  });

  it("accepts an `until` inside the start's own interval", () => {
    // "March 2019, until 15 March" is narrow but coherent.
    expect(
      parse({ timestamp: "2019-03-01", precision: "month", until: "2019-03-15" }).success,
    ).toBe(true);
  });

  it("refuses untilPrecision without until", () => {
    expect(parse({ timestamp: "2019-03-01", untilPrecision: "day" }).success).toBe(false);
  });

  it("refuses a precision finer than either string supports", () => {
    expect(parse({ timestamp: "2019-03-01", precision: "minute" }).success).toBe(false);
    expect(
      parse({ timestamp: "2019-03-01", until: "2019-03-05", untilPrecision: "minute" }).success,
    ).toBe(false);
  });

  it("accepts the ordinary cases", () => {
    expect(parse({ timestamp: "2019-03-01" }).success).toBe(true);
    expect(parse({ timestamp: "2019-03-01", until: "2019-05-19" }).success).toBe(true);
    expect(parse({ timestamp: "2019-03-01T09:00:00Z", precision: "hour" }).success).toBe(true);
  });
});

describe("an event's own period obeys the same rules as its extra ones", () => {
  const event = (extra: Record<string, unknown>) =>
    TimelineEventSpecSchema.safeParse({ id: "e", title: "t", ...extra });

  it("accepts a duration on the event itself", () => {
    const parsed = event({ timestamp: "2019-03-03", until: "2019-05-19" });
    expect(parsed.success).toBe(true);
    const iv = eventIntervals(parsed.data!)[0]!;
    expect(iv.end).toBe(Date.UTC(2019, 4, 20));
  });

  it("rejects on the event exactly what it rejects inside spans", () => {
    // One implementation, checked in both places — the point of timeSpanIssues.
    expect(event({ timestamp: "2019-05-19", until: "2019-03-03" }).success).toBe(false);
    expect(event({ timestamp: "2019-03-01", untilPrecision: "day" }).success).toBe(false);
    expect(event({ timestamp: "2019-03-01", precision: "minute" }).success).toBe(false);
    expect(
      event({ timestamp: "2019-03-01", spans: [{ timestamp: "2019-05-19", until: "2019-03-03" }] })
        .success,
    ).toBe(false);
  });

  it("defaults spans to an empty array so the output type is total", () => {
    const parsed = event({ timestamp: "2019-03-01" });
    expect(parsed.data!.spans).toEqual([]);
  });

  it("strips an unknown field rather than failing an older client's spec", () => {
    const parsed = event({ timestamp: "2019-03-01", somethingNewer: 42 });
    expect(parsed.success).toBe(true);
    expect(parsed.data as Record<string, unknown>).not.toHaveProperty("somethingNewer");
  });
});
