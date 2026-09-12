import { z } from "zod";
import { SourceRefSchema } from "./source";
import {
  LineVariantSchema,
  TimeSpanSchema,
  checkTimeSpan,
  spanInterval,
  timeSpanFields,
  UnitOfTimeSchema,
  type TimeInterval,
  type TimePrecision,
  type TimeSpan,
} from "./primitives";
import { ComponentSpecBaseSchema } from "./component";

/**
 * The axis the timeline is laid out along.
 *
 * Semantic, NOT a flex value: the wire contract must not encode CSS. An agent
 * chooses an axis, not a layout-engine primitive, and the renderer is free to
 * change how it realises one. packages/ui maps orientation + order onto a flex
 * direction via LAYOUT_TO_FLEX.
 */
export const TimelineOrientation = {
  Horizontal: "horizontal",
  Vertical: "vertical",
} as const;
export type TimelineOrientation =
  (typeof TimelineOrientation)[keyof typeof TimelineOrientation];
export const TimelineOrientationSchema = z.enum(TimelineOrientation);

/**
 * Which way time advances along that axis.
 *
 * `ascending` puts the earliest event at the start of the axis (left for
 * horizontal, top for vertical); `descending` puts the latest there.
 *
 * Split out from orientation deliberately. The previous single `direction` enum
 * had a `backward` member that could be read either as "right-to-left" or as
 * "reverse-chronological" — two different things, and an agent choosing between
 * them had no way to know which was meant. Orientation and order are each
 * unambiguous on their own, at the same four combinations.
 *
 * Note this controls the direction of the axis, not the sort: the renderer
 * lays events out in the order supplied rather than re-sorting them.
 */
export const TimelineOrder = {
  Ascending: "ascending",
  Descending: "descending",
} as const;
export type TimelineOrder = (typeof TimelineOrder)[keyof typeof TimelineOrder];
export const TimelineOrderSchema = z.enum(TimelineOrder);

/**
 * How event position is computed along the axis.
 *
 * - `ordinal`: evenly spaced, position = index. Good for milestones, and for
 *   narrow viewports where proportional spacing collapses into overlap.
 * - `time`: position proportional to timestamp. The gaps carry meaning —
 *   "nothing for eight months, then five things in seventy-two hours" is an
 *   argument that ordinal spacing destroys.
 */
export const TimelineScale = {
  Ordinal: "ordinal",
  Time: "time",
} as const;
export type TimelineScale = (typeof TimelineScale)[keyof typeof TimelineScale];
export const TimelineScaleSchema = z.enum(TimelineScale);

export const TimelineEventSpecSchema = z.object({
  /**
   * Stable within its timeline. Load-bearing: it is the React reconciliation
   * key, the anchor a citation resolves to, and the address for "regenerate
   * that one". Array index is not good enough for any of those.
   */
  id: z.string().min(1),
  /**
   * The event's primary period: `timestamp` with optional `precision`, and an
   * optional `until` when the source recorded a real end rather than a vague
   * instant. Same four fields as a `TimeSpan`, checked by the same rules.
   */
  ...timeSpanFields,
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  lineVariant: LineVariantSchema.optional(),
  /** Where this specific event came from. Citations are per-fact. */
  source: SourceRefSchema.optional(),
  /**
   * Further periods of the SAME fact, beyond the one `timestamp` denotes.
   *
   * Additive on purpose. `timestamp` stays required and primary, so an older
   * renderer strips this field and still places the event at its primary time —
   * degraded, never wrong. Making the event a bare array of periods instead
   * would have broken every existing spec AND removed the invariant that an
   * event has one canonical position, which `order` and "regenerate that one"
   * both lean on.
   */
  spans: z.array(TimeSpanSchema).default([]),
}).superRefine(checkTimeSpan);
export type TimelineEventSpec = z.infer<typeof TimelineEventSpecSchema>;
/** What an agent writes: defaulted fields are still optional here. */
export type TimelineEventSpecInput = z.input<typeof TimelineEventSpecSchema>;

export const TimelineSpecSchema = ComponentSpecBaseSchema.extend({
  kind: z.literal("timeline"),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  scale: TimelineScaleSchema.default(TimelineScale.Ordinal),
  orientation: TimelineOrientationSchema.default(TimelineOrientation.Horizontal),
  order: TimelineOrderSchema.default(TimelineOrder.Ascending),
  /**
   * Granularity used to format each event's label.
   *
   * This is the only time-granularity knob an agent gets. Axis tick granularity
   * is deliberately NOT exposed — the renderer derives it from the data range,
   * because a twenty-year span should tick by year without an agent having to
   * say so, and every field exposed to an agent is a field an agent can get
   * wrong.
   */
  labelUnit: UnitOfTimeSchema.optional(),
  /** Default line style for events that do not override it. */
  lineVariant: LineVariantSchema.optional(),
  events: z.array(TimelineEventSpecSchema),
});
export type TimelineSpec = z.infer<typeof TimelineSpecSchema>;
export type TimelineSpecInput = z.input<typeof TimelineSpecSchema>;

/**
 * Every period an event covers, primary first, in the order the spec gave them.
 *
 * Unreadable periods are dropped rather than represented, for the same reason
 * `timestampInterval` returns null: a period that cannot be read cannot be
 * positioned, and positioning it anyway would assert a time no source stated.
 * An event whose PRIMARY timestamp is unreadable yields an empty array and is
 * listed as undated by the renderer.
 */
export function eventIntervals(event: {
  timestamp: string;
  precision?: TimePrecision;
  spans?: readonly TimeSpan[];
}): TimeInterval[] {
  const primary = spanInterval(event);
  if (!primary) return [];
  const rest = (event.spans ?? [])
    .map((span) => spanInterval(span))
    .filter((iv): iv is TimeInterval => iv !== null);
  return [primary, ...rest];
}
