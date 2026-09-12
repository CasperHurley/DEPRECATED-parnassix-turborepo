import { describe, expect, it } from "vitest";
import {
  TimePrecision,
  TimelineOrder,
  TimelineOrientation,
  UnitOfTime,
  type TimelineEventSpec,
} from "@repo/report-schema";
import {
  AXIS_PLACEMENT,
  MIN_SEPARATION,
  packGroupLanes,
  axisOffsetMinutes,
  computeTimelineLayout,
  deriveTickUnit,
  formatOffset,
  pct,
} from "../src/ReportCanvas/Components/Timeline/axis";

const event = (
  id: string,
  timestamp: string,
  precision?: TimePrecision,
): TimelineEventSpec => ({ id, timestamp, title: id, precision });

const byId = (layout: ReturnType<typeof computeTimelineLayout>) =>
  Object.fromEntries(
    layout.positioned.map((p) => [
      p.event.id,
      { center: p.centerFraction, lane: p.lane, extent: p.extentFraction },
    ]),
  );

describe("the gaps are the evidence", () => {
  it("spaces events in proportion to the real time between them", () => {
    // This is the whole reason `scale: 'time'` exists. "Nothing for eight
    // months, then five things in seventy-two hours" is an argument, and even
    // spacing destroys it. Any spacing heuristic added later breaks this test,
    // which is the point of it.
    const layout = computeTimelineLayout([
      event("a", "2019-01-01T00:00:00Z", TimePrecision.Second),
      event("b", "2019-01-02T00:00:00Z", TimePrecision.Second),
      event("c", "2019-09-02T00:00:00Z", TimePrecision.Second),
    ]);
    const p = byId(layout);

    const gap1 = p.a!.center - p.a!.center; // zero-width reference
    void gap1;
    const fractionRatio = (p.c!.center - p.b!.center) / (p.b!.center - p.a!.center);
    const msRatio =
      (Date.parse("2019-09-02T00:00:00Z") - Date.parse("2019-01-02T00:00:00Z")) /
      (Date.parse("2019-01-02T00:00:00Z") - Date.parse("2019-01-01T00:00:00Z"));

    expect(fractionRatio).toBeCloseTo(msRatio, 9);
  });

  it("keeps every fraction inside the axis", () => {
    const layout = computeTimelineLayout([
      event("a", "2018-11-01", TimePrecision.Month),
      event("b", "2019-07-18T08:30:00Z"),
    ]);
    for (const p of layout.positioned) {
      expect(p.startFraction).toBeGreaterThanOrEqual(0);
      expect(p.endFraction).toBeLessThanOrEqual(1);
      expect(p.endFraction).toBeGreaterThan(p.startFraction);
    }
  });
});

describe("the renderer does not re-sort events", () => {
  it("produces identical output whatever order the spec lists events in", () => {
    // `order` sets the direction of the axis; it is not a sort instruction, and
    // array position must never influence where an event lands. Lane assignment
    // must also be reproducible, because an exported PDF has to match the screen.
    const events = [
      event("a", "2019-01-01T00:00:00Z"),
      event("b", "2019-07-15T09:12:00Z"),
      event("c", "2019-07-15T09:30:00Z"),
      event("d", "2020-03-01", TimePrecision.Month),
    ];
    const forward = byId(computeTimelineLayout(events));
    const shuffled = byId(computeTimelineLayout([events[2]!, events[0]!, events[3]!, events[1]!]));
    const reversed = byId(computeTimelineLayout([...events].reverse()));

    expect(shuffled).toEqual(forward);
    expect(reversed).toEqual(forward);
  });

  it("returns events in the order the spec gave them", () => {
    const events = [
      event("late", "2020-01-01T00:00:00Z"),
      event("early", "2019-01-01T00:00:00Z"),
    ];
    const layout = computeTimelineLayout(events);
    expect(layout.positioned.map((p) => p.event.id)).toEqual(["late", "early"]);
    // ...but positioned chronologically regardless.
    expect(layout.positioned[0]!.centerFraction).toBeGreaterThan(
      layout.positioned[1]!.centerFraction,
    );
  });
});

describe("precision occupies space rather than collapsing to a point", () => {
  it("gives a month-precision event its month's exact share of the domain", () => {
    const layout = computeTimelineLayout([
      event("month", "2019-03-10", TimePrecision.Month),
      event("end", "2019-12-31T23:00:00Z"),
    ]);
    const p = layout.positioned[0]!;
    const { start, span } = layout.domain!;
    const expected = (Date.UTC(2019, 3, 1) - Date.UTC(2019, 2, 1)) / span;
    expect(p.extentFraction).toBeCloseTo(expected, 12);
    expect(p.extentFraction).toBeGreaterThan(0);
    expect(p.startFraction).toBeCloseTo((Date.UTC(2019, 2, 1) - start) / span, 12);
  });

  it("gives a year-precision event roughly twelve times a month's extent", () => {
    const layout = computeTimelineLayout([
      event("year", "2019-06-01", TimePrecision.Year),
      event("month", "2019-03-10", TimePrecision.Month),
    ]);
    const p = byId(layout);
    expect(p.year!.extent / p.month!.extent).toBeCloseTo(365 / 31, 1);
  });

  it("reports the precision it actually positioned at", () => {
    const layout = computeTimelineLayout([
      event("vague", "2018-11-01", TimePrecision.Month),
      event("exact", "2019-07-18T08:30:00Z"),
    ]);
    expect(layout.positioned[0]!.precision).toBe(TimePrecision.Month);
    expect(layout.positioned[1]!.precision).toBe(TimePrecision.Second);
  });
});

describe("colliding events stack into lanes", () => {
  it("separates events too close to sit side by side", () => {
    // Thirty minutes apart inside a five-year span is a single pixel's worth of
    // axis; the cards would overprint entirely.
    const layout = computeTimelineLayout([
      event("start", "2016-01-01T00:00:00Z"),
      event("a", "2019-07-15T09:00:00Z"),
      event("b", "2019-07-15T09:30:00Z"),
      event("end", "2021-01-01T00:00:00Z"),
    ]);
    const p = byId(layout);
    expect(p.a!.lane).not.toBe(p.b!.lane);
  });

  it("leaves well-separated events all on the axis", () => {
    const layout = computeTimelineLayout([
      event("a", "2016-01-01T00:00:00Z"),
      event("b", "2017-06-01T00:00:00Z"),
      event("c", "2019-01-01T00:00:00Z"),
      event("d", "2020-06-01T00:00:00Z"),
    ]);
    expect(layout.positioned.every((p) => p.lane === 0)).toBe(true);
    expect(layout.laneCount).toBe(1);
  });

  it("never exceeds the lane bound, however dense the cluster", () => {
    // A component whose height grows without limit is worse than one that
    // overlaps: at least overlap is visibly wrong.
    const events = Array.from({ length: 40 }, (_, i) =>
      event(`e${i}`, `2019-07-15T09:${String(i % 60).padStart(2, "0")}:00Z`),
    );
    const layout = computeTimelineLayout([...events, event("far", "2025-01-01T00:00:00Z")], {
      maxLanes: 6,
    });
    expect(layout.laneCount).toBeLessThanOrEqual(6);
    expect(Math.max(...layout.positioned.map((p) => p.lane))).toBeLessThan(6);
  });

  it("keys lanes by original index, which undated events leave gaps in", () => {
    // Regression guard: undated events never reach the lane pass, so lane
    // numbering and array position are not the same sequence.
    const { laneByIndex, laneCount } = packGroupLanes(
      [
        { centerFraction: 0.2, members: [{ index: 7, centerFraction: 0.2 }] },
        { centerFraction: 0.21, members: [{ index: 3, centerFraction: 0.21 }] },
      ],
      MIN_SEPARATION.horizontal,
    );
    expect(laneByIndex.get(7)).toBe(0);
    expect(laneByIndex.get(3)).toBe(1);
    expect(laneCount).toBe(2);
  });

  it("packs a whole group into consecutive lanes, in chronological order", () => {
    // Cards hang off one branch point, so they must not be interleaved with
    // another group's cards in the same lanes.
    const { laneByIndex } = packGroupLanes(
      [
        {
          centerFraction: 0.5,
          members: [
            { index: 2, centerFraction: 0.52 },
            { index: 0, centerFraction: 0.48 },
          ],
        },
        { centerFraction: 0.51, members: [{ index: 5, centerFraction: 0.51 }] },
      ],
      MIN_SEPARATION.horizontal,
    );
    expect(laneByIndex.get(0)).toBe(0);
    expect(laneByIndex.get(2)).toBe(1);
    expect(laneByIndex.get(5)).toBe(2);
  });
});

describe("a timeline with nothing to place still renders", () => {
  it("returns no axis for an empty event list", () => {
    // An empty timeline is valid data, not a render failure — the caller shows
    // an empty state, never an error card.
    const layout = computeTimelineLayout([]);
    expect(layout.domain).toBeNull();
    expect(layout.ticks).toEqual([]);
    expect(layout.positioned).toEqual([]);
    expect(layout.laneCount).toBe(0);
  });

  it("centres a lone event on a padded axis", () => {
    const layout = computeTimelineLayout([event("only", "2019-07-15T09:00:00Z")]);
    expect(layout.domain!.span).toBeGreaterThan(0);
    expect(layout.domain!.degenerate).toBe(true);
    expect(layout.positioned[0]!.centerFraction).toBeCloseTo(0.5, 1);
  });

  it("survives every event sitting at the same instant", () => {
    const layout = computeTimelineLayout([
      event("a", "2019-07-15T09:00:00Z"),
      event("b", "2019-07-15T09:00:00Z"),
    ]);
    expect(layout.domain!.span).toBeGreaterThan(0);
    expect(layout.positioned.every((p) => Number.isFinite(p.centerFraction))).toBe(true);
  });
});

describe("an event that cannot be dated is never given a date", () => {
  it("lists an unreadable timestamp instead of placing it at zero", () => {
    // Position 0 would assert the event happened at the start of the report.
    const layout = computeTimelineLayout([
      event("good", "2019-07-15T09:00:00Z"),
      event("bad", "not-a-date"),
      event("alsogood", "2019-08-15T09:00:00Z"),
    ]);
    expect(layout.undated.map((u) => u.event.id)).toEqual(["bad"]);
    expect(layout.positioned.map((p) => p.event.id)).toEqual(["good", "alsogood"]);
    expect(layout.positioned.some((p) => p.event.id === "bad")).toBe(false);
  });

  it("keeps the undated event's original index for the caller", () => {
    const layout = computeTimelineLayout([
      event("bad", "not-a-date"),
      event("good", "2019-07-15T09:00:00Z"),
    ]);
    expect(layout.undated[0]!.index).toBe(0);
    expect(layout.positioned[0]!.index).toBe(1);
  });

  it("draws no axis at all when nothing is datable", () => {
    const layout = computeTimelineLayout([event("bad", "not-a-date")]);
    expect(layout.domain).toBeNull();
    expect(layout.undated).toHaveLength(1);
  });
});

describe("tick granularity is derived, never asked for", () => {
  it("emits a sane number of ticks at every scale from seconds to centuries", () => {
    // A hole in the ladder shows up as a domain with two ticks or forty.
    const spans = [
      1_000, 5_000, 30_000, 60_000, 300_000, 900_000, 3_600_000, 10_800_000, 43_200_000,
      86_400_000, 3 * 86_400_000, 604_800_000, 2_629_746_000, 3 * 2_629_746_000,
      31_556_952_000, 5 * 31_556_952_000, 10 * 31_556_952_000, 50 * 31_556_952_000,
      100 * 31_556_952_000, 500 * 31_556_952_000,
    ];
    const base = Date.UTC(2019, 6, 15, 12, 0, 0);
    for (const span of spans) {
      const layout = computeTimelineLayout([
        event("a", new Date(base).toISOString(), TimePrecision.Second),
        event("b", new Date(base + span).toISOString(), TimePrecision.Second),
      ]);
      expect(layout.ticks.length, `span ${span}ms`).toBeGreaterThanOrEqual(2);
      expect(layout.ticks.length, `span ${span}ms`).toBeLessThanOrEqual(14);
    }
  });

  it("picks a coarser unit as the span grows", () => {
    expect(deriveTickUnit(5_000).unit).toBe(UnitOfTime.Second);
    expect(deriveTickUnit(3_600_000).unit).toBe(UnitOfTime.Minute);
    expect(deriveTickUnit(5 * 86_400_000).unit).toBe(UnitOfTime.Day);
    expect(deriveTickUnit(2 * 31_556_952_000).unit).toBe(UnitOfTime.Month);
    expect(deriveTickUnit(40 * 31_556_952_000).unit).toBe(UnitOfTime.Year);
  });

  it("puts ticks on real calendar boundaries, not on even millisecond counts", () => {
    const layout = computeTimelineLayout([
      event("a", "2019-01-15", TimePrecision.Day),
      event("b", "2020-11-15", TimePrecision.Day),
    ]);
    expect(layout.domain!.unit).toBe(UnitOfTime.Month);
    for (const tick of layout.ticks) {
      const d = new Date(tick.at);
      expect(d.getUTCDate()).toBe(1);
      expect(d.getUTCHours()).toBe(0);
    }
  });

  it("ticks a multi-year domain on 1 January", () => {
    const layout = computeTimelineLayout([
      event("a", "2001-06-01", TimePrecision.Year),
      event("b", "2019-06-01", TimePrecision.Year),
    ]);
    expect(layout.domain!.unit).toBe(UnitOfTime.Year);
    for (const tick of layout.ticks) {
      const d = new Date(tick.at);
      expect(d.getUTCMonth()).toBe(0);
      expect(d.getUTCDate()).toBe(1);
    }
  });

  it("labels a month-ticked axis with the year where the year changes", () => {
    // Without this a two-year axis cannot say which year a "Mar" belongs to.
    const layout = computeTimelineLayout(
      [event("a", "2019-01-15", TimePrecision.Day), event("b", "2020-11-15", TimePrecision.Day)],
      { locale: "en-US" },
    );
    expect(layout.ticks[0]!.label).toMatch(/2019/);
    expect(layout.ticks.filter((t) => /2020/.test(t.label))).toHaveLength(1);
  });
});

describe("the axis ruler states which clock it is using", () => {
  it("adopts the offset when every source agrees on one", () => {
    expect(axisOffsetMinutes(["2019-07-15T09:00:00+01:00", "2019-07-15T11:00:00+01:00"])).toBe(60);
  });

  it("falls back to UTC when sources disagree", () => {
    // No honest way to elect one jurisdiction's clock as the clock.
    expect(axisOffsetMinutes(["2019-07-15T09:00:00+01:00", "2019-07-15T11:00:00-05:00"])).toBe(0);
  });

  it("treats date-only sources as UTC", () => {
    expect(axisOffsetMinutes(["2019-07-15", "2019-08-15"])).toBe(0);
    expect(axisOffsetMinutes([])).toBe(0);
  });

  it("captions the zone only when the ticks are fine enough for it to matter", () => {
    const fine = computeTimelineLayout([
      event("a", "2019-07-15T09:00:00+01:00"),
      event("b", "2019-07-15T17:00:00+01:00"),
    ]);
    expect(fine.domain!.offsetMinutes).toBe(60);
    expect(fine.zoneLabel).toBe("+01:00");

    const coarse = computeTimelineLayout([
      event("a", "2016-01-01", TimePrecision.Day),
      event("b", "2020-01-01", TimePrecision.Day),
    ]);
    expect(coarse.zoneLabel).toBeNull();
  });

  it("renders an offset the way a document would write it", () => {
    expect(formatOffset(0)).toBe("UTC");
    expect(formatOffset(60)).toBe("+01:00");
    expect(formatOffset(330)).toBe("+05:30");
    expect(formatOffset(-480)).toBe("-08:00");
  });

  it("places ticks on boundaries of the zone it adopted", () => {
    // Midnight at +05:00 is 19:00Z the day before. A tick claiming to be
    // midnight must fall there, not on UTC midnight.
    const layout = computeTimelineLayout([
      event("a", "2019-07-15T02:00:00+05:00"),
      event("b", "2019-07-18T02:00:00+05:00"),
    ]);
    expect(layout.domain!.offsetMinutes).toBe(300);
    for (const tick of layout.ticks) {
      expect((tick.at + 300 * 60_000) % 3_600_000).toBe(0);
    }
  });
});

describe("order is an anchor swap, not a second arithmetic flip", () => {
  it("keeps fractions canonical and moves the anchor instead", () => {
    // For an interval with width, the mirror of `left: start` is
    // `right: 1 - end`. Anchoring from the far edge makes that fall out of the
    // same code rather than needing a flip that is easy to get backwards.
    const events = [event("a", "2019-01-01T00:00:00Z"), event("b", "2019-06-01T00:00:00Z")];
    expect(byId(computeTimelineLayout(events))).toEqual(byId(computeTimelineLayout(events)));

    expect(AXIS_PLACEMENT[TimelineOrientation.Horizontal][TimelineOrder.Ascending].start).toBe(
      "left",
    );
    expect(AXIS_PLACEMENT[TimelineOrientation.Horizontal][TimelineOrder.Descending].start).toBe(
      "right",
    );
    expect(AXIS_PLACEMENT[TimelineOrientation.Vertical][TimelineOrder.Ascending].start).toBe("top");
    expect(AXIS_PLACEMENT[TimelineOrientation.Vertical][TimelineOrder.Descending].start).toBe(
      "bottom",
    );
  });

  it("pairs each anchor with the matching centring margin and extent axis", () => {
    for (const orientation of Object.values(TimelineOrientation)) {
      for (const order of Object.values(TimelineOrder)) {
        const p = AXIS_PLACEMENT[orientation][order];
        expect(p.centerMargin.toLowerCase()).toBe(`margin${p.start}`);
        expect(p.size).toBe(orientation === TimelineOrientation.Horizontal ? "width" : "height");
        expect(p.cross).toBe(orientation === TimelineOrientation.Horizontal ? "top" : "left");
      }
    }
  });

  it("clamps percentages into the axis", () => {
    expect(pct(0)).toBe("0.0000%");
    expect(pct(1)).toBe("100.0000%");
    expect(pct(-0.5)).toBe("0.0000%");
    expect(pct(1.5)).toBe("100.0000%");
  });
});

describe("a fact covering several periods is placed once, across all of them", () => {
  const instalments = {
    id: "instalments",
    title: "Instalments",
    timestamp: "2019-02-01",
    precision: TimePrecision.Month,
    spans: [
      { timestamp: "2019-05-01", precision: TimePrecision.Month },
      { timestamp: "2019-09-01", precision: TimePrecision.Month },
    ],
  } as TimelineEventSpec;

  it("places every period, primary first", () => {
    const layout = computeTimelineLayout([instalments]);
    const spans = layout.positioned[0]!.spans;
    expect(spans).toHaveLength(3);
    expect(spans[0]!.startFraction).toBeLessThan(spans[1]!.startFraction);
    expect(spans[1]!.startFraction).toBeLessThan(spans[2]!.startFraction);
  });

  it("uses the hull for the event's own footprint, not the primary period", () => {
    // One card, one lane, spanning February to September — an event with gaps
    // between its periods must never be drawn twice.
    const layout = computeTimelineLayout([instalments]);
    const pe = layout.positioned[0]!;
    expect(layout.positioned).toHaveLength(1);
    expect(pe.startFraction).toBeCloseTo(pe.spans[0]!.startFraction, 12);
    expect(pe.endFraction).toBeCloseTo(pe.spans[2]!.endFraction, 12);
  });

  it("stretches the domain to contain the last period", () => {
    const layout = computeTimelineLayout([instalments]);
    expect(layout.domain!.end).toBeGreaterThanOrEqual(Date.UTC(2019, 9, 1));
  });

  it("honours an explicit `until` as a duration, not as vagueness", () => {
    const layout = computeTimelineLayout([
      { id: "a", title: "a", timestamp: "2019-03-03", until: "2019-05-19" },
      { id: "b", title: "b", timestamp: "2019-12-31" },
    ] as TimelineEventSpec[]);
    const injunction = layout.positioned[0]!;
    const { span } = layout.domain!;
    const expected = (Date.UTC(2019, 4, 20) - Date.UTC(2019, 2, 3)) / span;
    expect(injunction.extentFraction).toBeCloseTo(expected, 12);
  });
});

describe("events at one point share a single branch off the axis", () => {
  const at = (id: string, timestamp: string) =>
    ({ id, title: id, timestamp }) as TimelineEventSpec;

  it("gives same-day events one trunk instead of one line each", () => {
    const layout = computeTimelineLayout([
      at("start", "2016-01-01T00:00:00Z"),
      at("a", "2019-07-15T09:12:00Z"),
      at("b", "2019-07-15T11:40:00Z"),
      at("end", "2021-01-01T00:00:00Z"),
    ]);
    const cluster = layout.groups.find((g) => g.members.length > 1)!;
    expect(cluster.members.map((m) => m.event.id).sort()).toEqual(["a", "b"]);
  });

  it("still marks each event's own instant with its own arm", () => {
    // The trunk is a routing device; positional honesty lives in the arms.
    const layout = computeTimelineLayout([
      at("start", "2016-01-01T00:00:00Z"),
      at("a", "2019-07-15T09:12:00Z"),
      at("b", "2019-07-15T11:40:00Z"),
      at("end", "2021-01-01T00:00:00Z"),
    ]);
    const cluster = layout.groups.find((g) => g.members.length > 1)!;
    expect(cluster.arms).toHaveLength(2);
    expect(cluster.arms[0]).toBeCloseTo(cluster.members[0]!.centerFraction, 12);
    expect(cluster.arms[1]).toBeCloseTo(cluster.members[1]!.centerFraction, 12);
  });

  it("merges across days only while they are too close to tell apart", () => {
    // Self-scaling: the same threshold that forced them into separate lanes.
    const tight = computeTimelineLayout([
      at("start", "2016-01-01T00:00:00Z"),
      at("a", "2019-07-15T09:00:00Z"),
      at("b", "2019-07-18T09:00:00Z"),
      at("end", "2021-01-01T00:00:00Z"),
    ]);
    expect(tight.groups.some((g) => g.members.length === 2)).toBe(true);

    // Same two events, an axis zoomed to the week: now they are far apart.
    const zoomed = computeTimelineLayout([
      at("a", "2019-07-15T09:00:00Z"),
      at("b", "2019-07-18T09:00:00Z"),
    ]);
    expect(zoomed.groups.every((g) => g.members.length === 1)).toBe(true);
  });

  it("never folds an event with its own extent into a neighbour's trunk", () => {
    // A month-precision event has an extent to state; sharing a trunk with the
    // events beside it would imply they are one fact.
    const layout = computeTimelineLayout([
      at("point", "2019-07-15T09:00:00Z"),
      {
        id: "vague",
        title: "vague",
        timestamp: "2019-07-01",
        precision: TimePrecision.Month,
      } as TimelineEventSpec,
    ]);
    const vague = layout.groups.find((g) => g.id === "vague")!;
    expect(vague.members).toHaveLength(1);
  });

  it("gives a multi-period event its own trunk with an arm per period", () => {
    const layout = computeTimelineLayout([
      {
        id: "instalments",
        title: "Instalments",
        timestamp: "2019-02-01",
        precision: TimePrecision.Month,
        spans: [{ timestamp: "2019-09-01", precision: TimePrecision.Month }],
      } as TimelineEventSpec,
    ]);
    const group = layout.groups[0]!;
    expect(group.members).toHaveLength(1);
    // Two periods, each wide enough to show a start and an end.
    expect(group.arms).toHaveLength(4);
  });

  it("accounts for every event exactly once across groups", () => {
    const layout = computeTimelineLayout([
      at("a", "2019-07-15T09:00:00Z"),
      at("b", "2019-07-15T10:00:00Z"),
      at("c", "2020-01-01T00:00:00Z"),
    ]);
    const ids = layout.groups.flatMap((g) => g.members.map((m) => m.event.id)).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("reaches the deepest lane it has to serve", () => {
    const layout = computeTimelineLayout([
      at("a", "2019-07-15T09:00:00Z"),
      at("b", "2019-07-15T09:30:00Z"),
      at("c", "2019-07-15T10:00:00Z"),
    ]);
    const cluster = layout.groups.find((g) => g.members.length > 1)!;
    expect(cluster.deepestLane).toBe(Math.max(...cluster.members.map((m) => m.lane)));
  });
});

describe("cards in one lane are always at least a card apart", () => {
  /**
   * This is the invariant the renderer converts into "cards never overprint".
   * It names the axis's minimum length in pixels and passes one card's slot as
   * `minSeparation`, so as long as packing honours this, no two cards sharing a
   * lane can touch — at any viewport width, because a wider one only adds slack.
   */
  const anchorsByLane = (layout: ReturnType<typeof computeTimelineLayout>) => {
    const lanes = new Map<number, number[]>();
    for (const group of layout.groups) {
      for (const member of group.members) {
        const list = lanes.get(member.lane) ?? [];
        list.push(group.centerFraction);
        lanes.set(member.lane, list);
      }
    }
    return lanes;
  };

  it("keeps every same-lane pair at least minSeparation apart", () => {
    const minSeparation = 0.1;
    const events = [
      event("a", "2019-01-01T00:00:00Z"),
      event("b", "2019-01-02T00:00:00Z"),
      event("c", "2019-01-03T00:00:00Z"),
      event("d", "2019-06-01T00:00:00Z"),
      event("e", "2019-06-02T00:00:00Z"),
      event("f", "2019-12-01T00:00:00Z"),
      event("g", "2020-01-01T00:00:00Z"),
    ];
    const layout = computeTimelineLayout(events, { minSeparation });
    expect(layout.laneCount).toBeLessThan(8); // not wrapped at the cap

    for (const [, anchors] of anchorsByLane(layout)) {
      const sorted = [...new Set(anchors)].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(minSeparation - 1e-9);
      }
    }
  });

  it("holds at a phone-sized separation, where the old constant failed", () => {
    // A 390px axis made the old 0.12 constant 47px wide while a card is 168px,
    // so everything collided. Deriving it from the axis length fixes that by
    // construction, whatever the length is.
    const minSeparation = 0.4;
    const layout = computeTimelineLayout(
      [
        event("a", "2019-01-01T00:00:00Z"),
        event("b", "2019-02-01T00:00:00Z"),
        event("c", "2019-03-01T00:00:00Z"),
      ],
      { minSeparation },
    );
    for (const [, anchors] of anchorsByLane(layout)) {
      const sorted = [...new Set(anchors)].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(minSeparation - 1e-9);
      }
    }
  });
});

describe("an axis can resolve a machine-log window", () => {
  const at = (id: string, timestamp: string) =>
    ({ id, title: id, timestamp }) as TimelineEventSpec;

  it("ticks in milliseconds when the whole span is under a second", () => {
    // At second resolution this domain snaps out to one tick and every event
    // lands on top of every other — the ordering logs exist to record is lost.
    const layout = computeTimelineLayout([
      at("a", "2019-07-16T02:05:11.042Z"),
      at("b", "2019-07-16T02:05:11.884Z"),
    ]);
    expect(layout.domain!.unit).toBe(UnitOfTime.Millisecond);
    expect(layout.ticks.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps sub-second gaps proportional", () => {
    const layout = computeTimelineLayout([
      at("a", "2019-07-16T02:05:11.000Z"),
      at("b", "2019-07-16T02:05:11.100Z"),
      at("c", "2019-07-16T02:05:11.500Z"),
    ]);
    const p = byId(layout);
    // b is 100ms after a; c is 400ms after b — four times the gap.
    const first = p.b!.center - p.a!.center;
    const second = p.c!.center - p.b!.center;
    expect(second / first).toBeCloseTo(4, 6);
  });

  it("separates two writes five milliseconds apart", () => {
    // The ordering question: which landed first. Both used to floor to the
    // same second and become indistinguishable.
    const layout = computeTimelineLayout([
      at("auth", "2019-07-16T02:05:11.198Z"),
      at("debit", "2019-07-16T02:05:11.203Z"),
    ]);
    const p = byId(layout);
    expect(p.debit!.center).toBeGreaterThan(p.auth!.center);
  });

  it("puts millisecond ticks on real millisecond boundaries", () => {
    const layout = computeTimelineLayout([
      at("a", "2019-07-16T02:05:11.042Z"),
      at("b", "2019-07-16T02:05:11.884Z"),
    ]);
    const step = layout.domain!.step;
    for (const tick of layout.ticks) expect(tick.at % step).toBe(0);
  });

  it("still ticks coarsely when the span is long", () => {
    // The new rungs must not capture spans that belong further up the ladder.
    const layout = computeTimelineLayout([
      at("a", "2016-01-01T00:00:00Z"),
      at("b", "2021-01-01T00:00:00Z"),
    ]);
    expect(layout.domain!.unit).toBe(UnitOfTime.Year);
  });
});
