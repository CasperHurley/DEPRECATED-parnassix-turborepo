import { z } from "zod";
import { SourceRefSchema } from "./source";

/**
 * Fields every component spec carries.
 *
 * Note what is NOT here: event handlers, ReactNode slots, styling. Those are
 * renderer concerns and live in packages/ui. This file describes only what an
 * agent can emit and what can cross a wire.
 */
export const ComponentSpecBaseSchema = z.object({
  /**
   * Stable across regeneration. The reconciliation key for the canvas, and the
   * address used by the chat layer to focus or replace a single component.
   */
  id: z.string().min(1),
  /** Component-level provenance, where the whole component has one source. */
  source: SourceRefSchema.optional(),
}).meta({ id: "ComponentSpecBase" });
export type ComponentSpecBase = z.infer<typeof ComponentSpecBaseSchema>;
