import { z } from "zod";
import { SourceRefSchema } from "./source";
import { LineVariantSchema, TimestampSchema, UnitOfTimeSchema } from "./primitives";
import { ComponentSpecBaseSchema } from "./component";

/**
 * Which way the timeline runs.
 *
 * These are semantic values, NOT flex values. The wire contract must not encode
 * CSS — an agent is choosing a direction, not a layout engine primitive, and the
 * renderer is free to change how it realises "forward". packages/ui maps these
 * to flex directions via DIRECTION_TO_FLEX.
 */
export const TimelineDirection = {
  Forward: "forward",
  Backward: "backward",
  Down: "down",
  Up: "up",
} as const;
export type TimelineDirection = (typeof TimelineDirection)[keyof typeof TimelineDirection];
export const TimelineDirectionSchema = z.enum(TimelineDirection);

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
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  lineVariant: LineVariantSchema.optional(),
  /** Where this specific event came from. Citations are per-fact. */
  source: SourceRefSchema.optional(),
});
export type TimelineEventSpec = z.infer<typeof TimelineEventSpecSchema>;

export const TimelineSpecSchema = ComponentSpecBaseSchema.extend({
  kind: z.literal("timeline"),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  scale: TimelineScaleSchema.default(TimelineScale.Ordinal),
  direction: TimelineDirectionSchema.default(TimelineDirection.Forward),
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
