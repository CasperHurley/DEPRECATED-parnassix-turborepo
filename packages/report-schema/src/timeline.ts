import { z } from "zod";
import { SourceRefSchema } from "./source";
import {
  LineVariantSchema,
  TimePrecisionSchema,
  TimestampSchema,
  UnitOfTimeSchema,
  timestampSupportsPrecision,
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
  timestamp: TimestampSchema,
  /**
   * How much of `timestamp` the source actually establishes. Omitted means
   * "as precise as the string looks" — see resolveTimePrecision.
   */
  precision: TimePrecisionSchema.optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  lineVariant: LineVariantSchema.optional(),
  /** Where this specific event came from. Citations are per-fact. */
  source: SourceRefSchema.optional(),
}).refine((event) => timestampSupportsPrecision(event.timestamp, event.precision ?? "day"), {
  message: "precision is finer than the timestamp supports (no time-of-day component)",
  path: ["precision"],
});
export type TimelineEventSpec = z.infer<typeof TimelineEventSpecSchema>;

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
