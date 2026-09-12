import {
  TimePrecision,
  TimelineOrder,
  TimelineOrientation,
  UnitOfTime,
  addUnits,
  eventIntervals,
  floorToUnit,
  offsetMinutesOf,
  type TimeInterval,
  type TimelineEventSpec,
} from "@repo/report-schema";

/**
 * Layout arithmetic for `scale: 'time'`.
 *
 * Deliberately free of React, Tamagui and the DOM. Two reasons: it can be
 * tested without a browser environment, and — more importantly — the only thing
 * that distinguishes a time-scaled timeline from an ordinal one is the position
 * function, so that function is worth being able to reason about on its own.
 *
 * Everything here is a FRACTION of the axis, never a pixel. No component owns
 * its own dimensions (see `render-context.tsx`), and an evidentiary report has
 * to render identically to a phone, a slide, letter paper and a PDF export.
 * Fractions are the only representation that survives all four unchanged.
 *
 * The division of labour with `@repo/report-schema`: the contract owns calendar
 * MECHANISM (what a precision denotes, how months and leap years roll over);
 * this module owns axis POLICY (which unit to tick at, what to write on a
 * label). Claims about evidence live there; presentation choices live here.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface TimeDomain {
  /** Epoch ms, snapped outward to a tick boundary. */
  start: number;
  /** Exclusive, snapped outward. Always greater than `start`. */
  end: number;
  span: number;
  /** Derived from the data range. Never agent-facing. */
  unit: UnitOfTime;
  /** Ticks fall every `step` units. */
  step: number;
  /** The fixed offset the axis is READ in. Never the viewer's. */
  offsetMinutes: number;
  /** True when every event sits at one instant and the domain had to be padded. */
  degenerate: boolean;
}

export interface AxisTick {
  at: number;
  /** 0..1 along the axis, earliest first. Orientation and order apply at render. */
  fraction: number;
  label: string;
}

/** One period an event covers, placed on the axis. */
export interface PositionedSpan {
  startFraction: number;
  endFraction: number;
  /** The period's width. This is its precision, made visible. */
  extentFraction: number;
  centerFraction: number;
  precision: TimePrecision;
}

export interface PositionedEvent {
  event: TimelineEventSpec;
  /** Position in the ORIGINAL events array. The renderer never re-sorts. */
  index: number;
  /** Every period this event covers, primary first, in spec order. */
  spans: PositionedSpan[];
  /**
   * The hull across every span — first start to last end.
   *
   * Lane packing and the leader both work from this rather than from the
   * primary span, so an event with periods in March and November occupies that
   * whole stretch for collision purposes and is never drawn twice.
   */
  startFraction: number;
  endFraction: number;
  centerFraction: number;
  extentFraction: number;
  /** 0 sits on the axis; n is n rows out, reached by a leader line. */
  lane: number;
  /** The PRIMARY period's precision — what the card's date label is clamped to. */
  precision: TimePrecision;
}

/** An event placed on the axis, before lanes are known. */
export type PlacedEvent = Omit<PositionedEvent, "lane">;

/** A group before lanes are known. */
export type PlacedGroup = Omit<EventGroup, "members" | "deepestLane"> & {
  members: PlacedEvent[];
};

/**
 * Events that share one trunk down from the axis.
 *
 * Drawing a separate line from the axis to every card in a dense cluster
 * produces a bundle of near-identical verticals that reads as noise rather than
 * as structure. Grouping gives the cluster a single branch point: one arm per
 * period rising to its own band, a rail gathering them, and one trunk carrying
 * them all to their cards. Nothing about an event's own position moves — the
 * arms still land exactly where the evidence does.
 */
export interface EventGroup {
  /** Stable across renders: the first member's event id. */
  id: string;
  members: PositionedEvent[];
  /** Hull across every member's every period. */
  startFraction: number;
  endFraction: number;
  centerFraction: number;
  extentFraction: number;
  /**
   * Where an arm rises from the rail to a band. One per period, or two when a
   * period is wide enough to show its own start and end.
   */
  arms: number[];
  /** How far the trunk has to reach. */
  deepestLane: number;
}

export interface UndatedEvent {
  event: TimelineEventSpec;
  index: number;
}

export interface TimelineLayout {
  /** `null` when there is nothing datable to draw an axis from. */
  domain: TimeDomain | null;
  ticks: AxisTick[];
  /** In ORIGINAL array order. */
  positioned: PositionedEvent[];
  /** The same events, gathered into shared branch points. */
  groups: EventGroup[];
  /** Events whose timestamp could not be read. Listed, never placed. */
  undated: UndatedEvent[];
  laneCount: number;
  /** Non-null only when the offset is material to reading the ticks. */
  zoneLabel: string | null;
}

export interface TimelineLayoutOptions {
  locale?: string;
  /** Lane-collision threshold as a fraction of the axis. See `MIN_SEPARATION`. */
  minSeparation?: number;
  targetTicks?: number;
  maxLanes?: number;
}

/* -------------------------------------------------------------------------- */
/* Axis reading zone                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The one zone the whole axis is read in. Never the viewer's.
 *
 * `formatTimestamp` reads each event in its own source zone, but a tick is not
 * a fact from a document — it is a ruler mark the renderer invented, and a
 * ruler needs a single zone. When every source agrees on an offset the axis
 * adopts it, so cards and ticks read alike. When sources disagree there is no
 * honest way to elect one jurisdiction's clock as the clock, so it falls back
 * to UTC and the caption says so.
 */
export function axisOffsetMinutes(timestamps: readonly string[]): number {
  let found: number | null = null;
  for (const ts of timestamps) {
    const offset = offsetMinutesOf(ts);
    if (found === null) found = offset;
    else if (found !== offset) return 0;
  }
  return found ?? 0;
}

/** `+01:00`, `-05:30`, `UTC`. */
export function formatOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "UTC";
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Units below which a one-hour offset visibly moves every tick. At day and
 * coarser it almost never moves a boundary, so the caption would be noise.
 */
const ZONE_MATERIAL_UNITS: readonly UnitOfTime[] = [
  UnitOfTime.Hour,
  UnitOfTime.Minute,
  UnitOfTime.Second,
  UnitOfTime.Millisecond,
];

/* -------------------------------------------------------------------------- */
/* Tick granularity                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Target tick count, with no pixel measurement available.
 *
 * Deliberately low. It is labels that collide, not ticks, and the narrowest
 * target viewport is a phone. Six labels are legible everywhere; twelve are not
 * legible anywhere narrow.
 */
const TARGET_TICKS = 6;
const MAX_TICKS = 12;

/**
 * `nominal` is a mean duration used ONLY to choose a rung. Every boundary that
 * ends up on screen comes from `floorToUnit` / `addUnits`, so a 31-day month
 * and a 28-day month both tick on the 1st regardless of what this table says.
 */
const TICK_LADDER: readonly { unit: UnitOfTime; step: number; nominal: number }[] = [
  // Sub-second rungs exist because machine logs do. Without them a cluster of
  // log lines inside one second snaps out to a one-second domain and loses the
  // ordering it was carried here to show.
  { unit: UnitOfTime.Millisecond, step: 1, nominal: 1 },
  { unit: UnitOfTime.Millisecond, step: 10, nominal: 10 },
  { unit: UnitOfTime.Millisecond, step: 25, nominal: 25 },
  { unit: UnitOfTime.Millisecond, step: 50, nominal: 50 },
  { unit: UnitOfTime.Millisecond, step: 100, nominal: 100 },
  { unit: UnitOfTime.Millisecond, step: 250, nominal: 250 },
  { unit: UnitOfTime.Millisecond, step: 500, nominal: 500 },
  { unit: UnitOfTime.Second, step: 1, nominal: 1_000 },
  { unit: UnitOfTime.Second, step: 5, nominal: 5_000 },
  { unit: UnitOfTime.Second, step: 15, nominal: 15_000 },
  { unit: UnitOfTime.Second, step: 30, nominal: 30_000 },
  { unit: UnitOfTime.Minute, step: 1, nominal: 60_000 },
  { unit: UnitOfTime.Minute, step: 5, nominal: 300_000 },
  { unit: UnitOfTime.Minute, step: 15, nominal: 900_000 },
  { unit: UnitOfTime.Minute, step: 30, nominal: 1_800_000 },
  { unit: UnitOfTime.Hour, step: 1, nominal: 3_600_000 },
  { unit: UnitOfTime.Hour, step: 3, nominal: 10_800_000 },
  { unit: UnitOfTime.Hour, step: 6, nominal: 21_600_000 },
  { unit: UnitOfTime.Hour, step: 12, nominal: 43_200_000 },
  { unit: UnitOfTime.Day, step: 1, nominal: 86_400_000 },
  { unit: UnitOfTime.Week, step: 1, nominal: 604_800_000 },
  { unit: UnitOfTime.Month, step: 1, nominal: 2_629_746_000 }, // mean Gregorian month
  { unit: UnitOfTime.Month, step: 3, nominal: 7_889_238_000 },
  { unit: UnitOfTime.Year, step: 1, nominal: 31_556_952_000 }, // mean Gregorian year
  { unit: UnitOfTime.Year, step: 5, nominal: 157_784_760_000 },
  { unit: UnitOfTime.Year, step: 10, nominal: 315_569_520_000 },
  { unit: UnitOfTime.Year, step: 25, nominal: 788_923_800_000 },
  { unit: UnitOfTime.Year, step: 100, nominal: 3_155_695_200_000 },
];

const MEAN_YEAR = 31_556_952_000;

/**
 * Picks the rung whose tick count lands CLOSEST to the target, not merely the
 * first one coarse enough.
 *
 * The difference is not academic. A two-year domain gets eight quarterly ticks
 * this way; taking the first rung that fits under the target would jump
 * straight to years and label the axis with two marks, which tells a reader
 * nothing about where in those two years anything sits.
 *
 * Ties go to the finer rung — iterating fine-to-coarse with a strict
 * comparison — because more marks on a ruler is the safer failure.
 */
export function deriveTickUnit(
  span: number,
  targetTicks: number = TARGET_TICKS,
): { unit: UnitOfTime; step: number } {
  // Below one millisecond there is nothing left to resolve: the contract stops
  // there, so an axis cannot usefully tick finer than its finest fact.
  if (span <= 0) return { unit: UnitOfTime.Millisecond, step: 1 };

  let best: { unit: UnitOfTime; step: number } | null = null;
  let bestDistance = Infinity;

  for (const rung of TICK_LADDER) {
    const count = span / rung.nominal;
    if (count > MAX_TICKS) continue; // too crowded to label at any width
    const distance = Math.abs(count - targetTicks);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { unit: rung.unit, step: rung.step };
    }
  }
  if (best) return best;

  // Past the end of the ladder: keep scaling by decades so a millennium-scale
  // domain emits a handful of ticks rather than four hundred of them.
  let step = 100;
  while (span / (MEAN_YEAR * step) > MAX_TICKS) step *= 10;
  return { unit: UnitOfTime.Year, step };
}

/* -------------------------------------------------------------------------- */
/* Tick labels                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Per-event label formats, selected by a spec's `labelUnit`.
 *
 * Kept exactly as it was when it lived in `types.ts`: it is a public export and
 * it is correct for the job `labelUnit` does. It is NOT usable for axis ticks —
 * `week` gives "Monday", which says nothing across a span of months, and `day`
 * gives a bare "1", which is ambiguous across a month boundary. Ticks use
 * `AXIS_TICK_FORMAT` instead.
 */
export const TimeFormatterMap: Record<UnitOfTime, Intl.DateTimeFormatOptions> = {
  millisecond: { second: "numeric", fractionalSecondDigits: 3 },
  second: { second: "numeric" },
  minute: { minute: "numeric", second: "numeric" },
  hour: { hour: "numeric", minute: "2-digit" },
  day: { day: "numeric" },
  week: { weekday: "long" },
  month: { month: "short" },
  year: { year: "numeric" },
};

/** What a tick says on its own. */
export const AXIS_TICK_FORMAT: Record<UnitOfTime, Intl.DateTimeFormatOptions> = {
  year: { year: "numeric" },
  millisecond: { second: "2-digit", fractionalSecondDigits: 3, hour12: false },
  month: { month: "short" },
  week: { month: "short", day: "numeric" },
  day: { month: "short", day: "numeric" },
  hour: { hour: "numeric", hour12: false },
  minute: { hour: "numeric", minute: "2-digit", hour12: false },
  second: { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false },
};

/**
 * The coarser context a tick needs when that context changes under it, so a
 * month-ticked axis spanning two years can say which year a mark belongs to.
 */
const TICK_CONTEXT: Partial<Record<UnitOfTime, Intl.DateTimeFormatOptions>> = {
  millisecond: { hour: "numeric", minute: "2-digit", hour12: false },
  month: { year: "numeric" },
  week: { year: "numeric" },
  day: { year: "numeric" },
  hour: { month: "short", day: "numeric" },
  minute: { month: "short", day: "numeric" },
  second: { month: "short", day: "numeric" },
};

/**
 * Formats an instant at a FIXED offset.
 *
 * The offset is applied by shifting the instant and formatting in UTC, never by
 * handing `Intl` a `"+05:00"` timeZone — that is engine-dependent, and React
 * Native ships a reduced Intl. The two are arithmetically identical for a fixed
 * offset, and only one of them works everywhere this renders.
 */
function formatAtOffset(
  at: number,
  offsetMinutes: number,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  const shifted = new Date(at + offsetMinutes * 60_000);
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(shifted);
  } catch {
    return shifted.toISOString();
  }
}

/* -------------------------------------------------------------------------- */
/* Domain                                                                     */
/* -------------------------------------------------------------------------- */

export function computeTimeDomain(
  intervals: readonly TimeInterval[],
  offsetMinutes: number,
  targetTicks: number = TARGET_TICKS,
): TimeDomain | null {
  if (intervals.length === 0) return null;

  let rawStart = Infinity;
  let rawEnd = -Infinity;
  for (const iv of intervals) {
    if (iv.start < rawStart) rawStart = iv.start;
    // Interval END, not the instant: a year-precision event at the right edge
    // of the domain occupies its whole year, and the axis has to contain it.
    if (iv.end > rawEnd) rawEnd = iv.end;
  }

  // Degenerate means the span comes from ONE event's own extent rather than
  // from any gap between events — a lone event, or several at the same instant
  // with the same precision. Such an axis has no proportion to express, so the
  // event would otherwise stretch edge to edge and read as a duration.
  const distinct = new Set(intervals.map((iv) => `${iv.start}:${iv.end}`));
  const degenerate = distinct.size < 2;
  const { unit, step } = deriveTickUnit(rawEnd - rawStart, targetTicks);

  let start = floorToUnit(rawStart, unit, step, offsetMinutes);
  let end = floorToUnit(rawEnd, unit, step, offsetMinutes);
  if (end < rawEnd) end = addUnits(end, unit, step, offsetMinutes);

  if (degenerate) {
    // A single instant has no span to be proportional to. Pad a tick either
    // side so the lone event sits mid-axis rather than welded to an edge.
    start = addUnits(start, unit, -step, offsetMinutes);
    end = addUnits(end, unit, step, offsetMinutes);
  }
  // Belt and braces: nothing downstream may divide by zero.
  if (end <= start) end = addUnits(start, unit, step, offsetMinutes);

  return { start, end, span: end - start, unit, step, offsetMinutes, degenerate };
}

export function generateTicks(domain: TimeDomain, locale?: string): AxisTick[] {
  const { unit, step, offsetMinutes, start, end, span } = domain;
  const ticks: AxisTick[] = [];
  const contextOptions = TICK_CONTEXT[unit];
  let previousContext: string | null = null;

  for (
    let at = start, guard = 0;
    at <= end && guard <= MAX_TICKS * 4;
    at = addUnits(at, unit, step, offsetMinutes), guard++
  ) {
    let label = formatAtOffset(at, offsetMinutes, AXIS_TICK_FORMAT[unit], locale);

    if (contextOptions) {
      const context = formatAtOffset(at, offsetMinutes, contextOptions, locale);
      // The first tick always carries its context; later ticks only when it
      // changes, so "Mar" becomes "Mar 2020" exactly where the year rolls over.
      if (context !== previousContext) label = `${label} ${context}`;
      previousContext = context;
    }

    ticks.push({ at, fraction: (at - start) / span, label });
  }
  return ticks;
}

/* -------------------------------------------------------------------------- */
/* Lane packing                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Fallback lane-collision threshold, as a fraction of the axis.
 *
 * Only used when a caller does not supply one. The renderer always does: it
 * names the axis's minimum length in pixels and passes `cardSlot / axisLength`,
 * which is what turns "cards never overprint" into a guarantee. These constants
 * remain for callers computing a layout without rendering it.
 */
export const MIN_SEPARATION = { horizontal: 0.12, vertical: 0.05 } as const;
const MAX_LANES = 8;

/**
 * Below this share of the axis a period renders as a dot rather than a band, so
 * marking its two ends separately says nothing the single mark does not.
 */
export const MIN_VISIBLE_EXTENT = 0.01;

/**
 * Assigns each group the lowest run of lanes it fits in, so groups that collide
 * stack outward from the axis instead of overprinting each other.
 *
 * Packing works on GROUPS, not on individual events, because a card is drawn at
 * its group's branch point rather than at its own position. Packing the events
 * would measure collisions somewhere the cards are not, and two cards from
 * different groups would then land on top of each other in the same lane.
 *
 * Within a group, members take consecutive lanes in chronological order, so a
 * cluster reads top-to-bottom the way it happened.
 *
 * Greedy-lowest is deterministic, which is what makes an exported PDF match what
 * was on screen.
 */
export function packGroupLanes(
  groups: readonly { members: { index: number; centerFraction: number }[]; centerFraction: number }[],
  minSeparation: number,
  maxLanes: number = MAX_LANES,
): { laneByIndex: Map<number, number>; laneCount: number } {
  const ordered = [...groups].sort((a, b) => a.centerFraction - b.centerFraction);
  const laneEnd: number[] = [];
  const laneByIndex = new Map<number, number>();
  let highest = 0;

  for (const group of ordered) {
    // The card's own footprint, centred on the branch point it hangs from.
    const from = group.centerFraction - minSeparation / 2;
    const to = group.centerFraction + minSeparation / 2;

    // Members take the lowest free lanes, one at a time, rather than a
    // contiguous block. They come out consecutive whenever the lanes are free,
    // which is the common case — but requiring a block meant a large cluster
    // that could not find one anywhere fell back to lane 0 and overprinted
    // whatever was already there. A gap in a cluster is a far smaller cost.
    const chronological = [...group.members].sort(
      (a, b) => a.centerFraction - b.centerFraction || a.index - b.index,
    );

    for (const member of chronological) {
      let lane = laneEnd.findIndex((occupiedUntil) => from >= occupiedUntil);
      if (lane === -1) {
        if (laneEnd.length >= maxLanes) {
          // Bounded on purpose: unbounded lanes make the component arbitrarily
          // tall, and a component whose height is driven by the worst cluster in
          // the data is unusable. When every lane is taken, take the one that
          // frees up soonest — its occupant is the furthest away, so the overlap
          // this forces is the least bad available.
          lane = laneEnd.reduce((best, end, i) => (end < laneEnd[best]! ? i : best), 0);
        } else {
          lane = laneEnd.length;
          laneEnd.push(0);
        }
      }
      laneEnd[lane] = to;
      laneByIndex.set(member.index, lane);
      if (lane + 1 > highest) highest = lane + 1;
    }
  }

  return { laneByIndex, laneCount: Math.max(highest, 1) };
}

/* -------------------------------------------------------------------------- */
/* Orientation and order                                                      */
/* -------------------------------------------------------------------------- */

export interface AxisPlacement {
  /** The edge a fraction anchors to. */
  start: "left" | "right" | "top" | "bottom";
  /** The dimension an interval's extent occupies. */
  size: "width" | "height";
  /** Negative-margin prop that centres a fixed-size child on a point. */
  centerMargin: "marginLeft" | "marginRight" | "marginTop" | "marginBottom";
  /** The perpendicular axis that lanes stack along. */
  cross: "top" | "left";
}

/**
 * The time scale's counterpart to `LAYOUT_TO_FLEX`: same 2x2, different engine.
 * Flex cannot express proportional spacing, so the time scale positions
 * absolutely and this table says which properties to position against.
 *
 * `descending` anchors from the far edge rather than negating the fraction.
 * That is not a style preference — for an interval with width, the mirror of
 * `left: startFraction` is `right: 1 - endFraction`, and anchoring from the
 * right makes that fall out of the same code rather than needing a second flip
 * that is easy to get wrong.
 */
export const AXIS_PLACEMENT: Record<
  TimelineOrientation,
  Record<TimelineOrder, AxisPlacement>
> = {
  [TimelineOrientation.Horizontal]: {
    [TimelineOrder.Ascending]: {
      start: "left",
      size: "width",
      centerMargin: "marginLeft",
      cross: "top",
    },
    [TimelineOrder.Descending]: {
      start: "right",
      size: "width",
      centerMargin: "marginRight",
      cross: "top",
    },
  },
  [TimelineOrientation.Vertical]: {
    [TimelineOrder.Ascending]: {
      start: "top",
      size: "height",
      centerMargin: "marginTop",
      cross: "left",
    },
    [TimelineOrder.Descending]: {
      start: "bottom",
      size: "height",
      centerMargin: "marginBottom",
      cross: "left",
    },
  },
};

/** Clamped so a rounding error can never position anything off the axis. */
export const pct = (fraction: number): string =>
  `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(4)}%`;

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Gathers events into shared branch points.
 *
 * Two events join the same trunk when they fall on the same calendar day in the
 * axis's own zone, or when they sit closer together than the lane-collision
 * threshold — which is the renderer's own statement that they are at the same
 * place. The second rule is self-scaling: zoom in far enough that a cluster
 * spreads out and it stops applying, so each event gets its own trunk again
 * exactly when there is room to tell them apart.
 *
 * An event with a period wide enough to see, or with several periods, is always
 * its own group. Those already have their own extent to state, and folding them
 * into a neighbour's trunk would imply the two are one fact.
 */
export function groupTimelineEvents(
  positioned: readonly PlacedEvent[],
  minSeparation: number,
  offsetMinutes: number,
  domain: TimeDomain,
): PlacedGroup[] {
  const atDay = (fraction: number) =>
    floorToUnit(domain.start + fraction * domain.span, UnitOfTime.Day, 1, offsetMinutes);

  const build = (members: PlacedEvent[]): PlacedGroup => {
    const startFraction = Math.min(...members.map((m) => m.startFraction));
    const endFraction = Math.max(...members.map((m) => m.endFraction));
    const arms: number[] = [];
    for (const member of members) {
      for (const span of member.spans) {
        // Two marks when the period is wide enough to have a visible start and
        // end; one when it is a point. Either way the marks land on the axis
        // where the evidence does, not where the trunk happens to be.
        if (span.extentFraction >= MIN_VISIBLE_EXTENT) arms.push(span.startFraction, span.endFraction);
        else arms.push(span.centerFraction);
      }
    }
    return {
      id: members[0]!.event.id,
      members,
      startFraction,
      endFraction,
      centerFraction: (startFraction + endFraction) / 2,
      extentFraction: endFraction - startFraction,
      arms: [...new Set(arms)].sort((a, b) => a - b),
    };
  };

  const solo: PlacedEvent[] = [];
  const clusterable: PlacedEvent[] = [];
  for (const pe of positioned) {
    if (pe.spans.length > 1 || pe.extentFraction >= MIN_VISIBLE_EXTENT) solo.push(pe);
    else clusterable.push(pe);
  }

  // Sorted copy only; `positioned` keeps the spec's order, as `order` requires.
  const ordered = [...clusterable].sort(
    (a, b) => a.centerFraction - b.centerFraction || a.index - b.index,
  );

  const groups: PlacedGroup[] = [];
  let run: PlacedEvent[] = [];
  for (const pe of ordered) {
    const previous = run[run.length - 1];
    const joins =
      previous !== undefined &&
      (atDay(previous.centerFraction) === atDay(pe.centerFraction) ||
        pe.centerFraction - previous.centerFraction < minSeparation);
    if (joins) run.push(pe);
    else {
      if (run.length > 0) groups.push(build(run));
      run = [pe];
    }
  }
  if (run.length > 0) groups.push(build(run));

  for (const pe of solo) groups.push(build([pe]));
  return groups.sort((a, b) => a.centerFraction - b.centerFraction);
}

export function computeTimelineLayout(
  events: readonly TimelineEventSpec[],
  options: TimelineLayoutOptions = {},
): TimelineLayout {
  const {
    locale,
    minSeparation = MIN_SEPARATION.horizontal,
    targetTicks = TARGET_TICKS,
    maxLanes = MAX_LANES,
  } = options;

  const dated: { event: TimelineEventSpec; index: number; intervals: TimeInterval[] }[] = [];
  const undated: UndatedEvent[] = [];

  events.forEach((event, index) => {
    const intervals = eventIntervals(event);
    // An event whose primary timestamp is unreadable is listed, never placed.
    // Positioning it at zero would assert it happened at the start of the
    // report — a claim no source made, and exactly the fabrication this
    // renderer exists to refuse.
    if (intervals.length > 0) dated.push({ event, index, intervals });
    else undated.push({ event, index });
  });

  const offsetMinutes = axisOffsetMinutes(dated.map((d) => d.event.timestamp));
  const domain = computeTimeDomain(
    dated.flatMap((d) => d.intervals),
    offsetMinutes,
    targetTicks,
  );

  if (!domain) {
    // No axis to draw. An empty timeline is valid data, not a render failure.
    return {
      domain: null,
      ticks: [],
      positioned: [],
      groups: [],
      undated,
      laneCount: 0,
      zoneLabel: null,
    };
  }

  const fractionOf = (at: number) => (at - domain.start) / domain.span;

  const placed: PlacedEvent[] = dated.map(({ event, index, intervals }) => {
    const spans: PositionedSpan[] = intervals.map((interval) => {
      const startFraction = fractionOf(interval.start);
      const endFraction = fractionOf(interval.end);
      return {
        startFraction,
        endFraction,
        extentFraction: endFraction - startFraction,
        centerFraction: (startFraction + endFraction) / 2,
        precision: interval.precision,
      };
    });
    const startFraction = Math.min(...spans.map((s) => s.startFraction));
    const endFraction = Math.max(...spans.map((s) => s.endFraction));
    return {
      event,
      index,
      spans,
      startFraction,
      endFraction,
      centerFraction: (startFraction + endFraction) / 2,
      extentFraction: endFraction - startFraction,
      precision: spans[0]!.precision,
    };
  });

  // Group BEFORE packing: a card is drawn at its group's branch point, so that
  // is where its collisions have to be measured.
  const placedGroups = groupTimelineEvents(placed, minSeparation, offsetMinutes, domain);
  const { laneByIndex, laneCount } = packGroupLanes(placedGroups, minSeparation, maxLanes);

  const laneOf = (index: number) => laneByIndex.get(index) ?? 0;
  const positioned: PositionedEvent[] = placed.map((p) => ({ ...p, lane: laneOf(p.index) }));
  const byIndex = new Map(positioned.map((p) => [p.index, p]));
  const groups: EventGroup[] = placedGroups.map((group) => {
    const members = group.members
      .map((m) => byIndex.get(m.index)!)
      .sort((a, b) => a.centerFraction - b.centerFraction || a.index - b.index);
    return { ...group, members, deepestLane: Math.max(...members.map((m) => m.lane)) };
  });

  return {
    domain,
    ticks: generateTicks(domain, locale),
    positioned,
    groups,
    undated,
    laneCount,
    zoneLabel: ZONE_MATERIAL_UNITS.includes(domain.unit)
      ? formatOffset(domain.offsetMinutes)
      : null,
  };
}
