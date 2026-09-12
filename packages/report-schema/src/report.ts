import { z } from "zod";
import { TimelineSpecSchema } from "./timeline";

/**
 * The discriminated union of everything the canvas knows how to render.
 *
 * The `kind` discriminant is what makes a heterogeneous component array
 * renderable at all — without it the canvas cannot tell a timeline from a
 * table. Adding a component means adding its spec here and a case to the
 * canvas's switch; nothing else.
 */
export const ComponentSpecSchema = z.discriminatedUnion("kind", [TimelineSpecSchema]);
export type ComponentSpec = z.infer<typeof ComponentSpecSchema>;

/** Component `kind` values, for exhaustiveness checks in the renderer. */
export type ComponentKind = ComponentSpec["kind"];

/**
 * Report-level context shared by every component.
 *
 * Intentionally empty for now — whether this holds a subject, a time range, a
 * dataset handle, or nothing at all is still open (see CLAUDE.md). Passthrough
 * so that backend experimentation is not blocked by a frontend release.
 */
export const ReportDataSchema = z.looseObject({});
export type ReportData = z.infer<typeof ReportDataSchema>;

export const ReportSpecSchema = z.object({
  /**
   * Version of the component schema this report was produced against.
   *
   * Caching invalidates when the data changes OR when component templates
   * change; carrying the version in the payload makes the second half of that
   * rule mechanical rather than something a person has to remember.
   */
  schemaVersion: z.string().min(1),
  data: ReportDataSchema,
  components: z.array(ComponentSpecSchema),
});
export type ReportSpec = z.infer<typeof ReportSpecSchema>;

/** Bump when a change to any component spec is not backward compatible. */
export const SCHEMA_VERSION = "0.3.0";
