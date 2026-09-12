import { describe, expect, it } from "vitest";
import { TimePrecision, UnitOfTime } from "@repo/report-schema";
import { formatEventPeriods } from "../src/ReportCanvas/Components/Timeline/card";

/**
 * The card's date line is the only place an event's periods are stated in
 * WORDS. On the time scale the axis draws them as bands too; on the ordinal
 * scale, and in an exported PDF read without the picture, this string is the
 * whole account. So it has to be bounded by what the source established.
 */
describe("a card states every period, and never more than is known", () => {
  it("writes a single period plainly", () => {
    expect(formatEventPeriods({ timestamp: "2019-03-14" }, undefined, "en-US")).toBe(
      "Mar 14, 2019",
    );
  });

  it("writes a recorded duration as a range", () => {
    expect(
      formatEventPeriods({ timestamp: "2020-02-03", until: "2020-02-07" }, undefined, "en-US"),
    ).toBe("Feb 3, 2020 – Feb 7, 2020");
  });

  it("lists separate periods rather than collapsing them to a range", () => {
    // Three payments are not one payment lasting seven months.
    const out = formatEventPeriods(
      {
        timestamp: "2019-02-01",
        precision: TimePrecision.Month,
        spans: [
          { timestamp: "2019-05-01", precision: TimePrecision.Month },
          { timestamp: "2019-09-01", precision: TimePrecision.Month },
        ],
      },
      undefined,
      "en-US",
    );
    expect(out).toBe("Feb 2019 · May 2019 · Sep 2019");
    expect(out).not.toContain("–");
  });

  it("never states a period more precisely than its source", () => {
    expect(
      formatEventPeriods(
        { timestamp: "2018-11-01", precision: TimePrecision.Month },
        undefined,
        "en-US",
      ),
    ).toBe("Nov 2018");
  });

  it("lets labelUnit coarsen but never sharpen, per period", () => {
    // The clamp is per period, so a coarse span beside a precise one keeps its
    // own bound rather than borrowing its neighbour's.
    const out = formatEventPeriods(
      {
        timestamp: "2019-03-01",
        precision: TimePrecision.Month,
        spans: [{ timestamp: "2019-07-15T09:12:00Z" }],
      },
      UnitOfTime.Minute,
      "en-US",
    );
    expect(out).toMatch(/^Mar 2019 · /);
    expect(out).toMatch(/9:12/);
  });

  it("coarsens both ends of a range when asked", () => {
    expect(
      formatEventPeriods(
        { timestamp: "2020-02-03", until: "2020-02-07" },
        UnitOfTime.Year,
        "en-US",
      ),
    ).toBe("2020 – 2020");
  });

  it("falls back to the raw string rather than rendering Invalid Date", () => {
    // Ordinal position is the index, so an unreadable timestamp still renders
    // in sequence — it must not blank the card that carries it.
    expect(formatEventPeriods({ timestamp: "not-a-date" }, undefined, "en-US")).toBe("not-a-date");
  });
});
