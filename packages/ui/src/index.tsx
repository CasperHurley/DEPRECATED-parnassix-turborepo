export * from "tamagui";

export { ReportCanvas } from "./ReportCanvas/ReportCanvas";
export { ComponentErrorCard } from "./ReportCanvas/ComponentErrorCard";
export { ComponentErrorBoundary } from "./ReportCanvas/ComponentErrorBoundary";
export { mockReport } from "./ReportCanvas/fixtures";
export { Timeline, TimelineEvent } from "./ReportCanvas/Components/Timeline/Timeline";
export {
  LAYOUT_TO_FLEX,
  DateMethodMap,
  TimeFormatterMap,
} from "./ReportCanvas/Components/Timeline/types";
export {
  RenderContextProvider,
  defaultRenderContext,
  useIsStaticMedium,
  useRenderContext,
} from "./render-context";
export { config } from "./tamagui.config";

/*
 * Types are re-exported EXPLICITLY, never via `export *`.
 *
 * `export * from "tamagui"` above already exports an `Insets`, and two star
 * exports of the same name are ambiguous — ESM and TypeScript drop the name
 * silently rather than erroring. Explicit named exports win over star exports
 * deterministically, so the collision is resolved rather than hidden.
 */
export type {
  Insets,
  ReportCanvasProps,
  TamaguiComponentProps,
} from "./types";
export type {
  DateMethods,
  TimelineEventProps,
  TimelineProps,
} from "./ReportCanvas/Components/Timeline/types";
export type { RenderContextValue, RenderMedium } from "./render-context";

/* The wire contract, re-exported so apps have a single import site. */
export type {
  BBox,
  ComponentKind,
  ComponentSpec,
  ReportData,
  ReportSpec,
  SourceRef,
  TimelineEventSpec,
  TimelineSpec,
} from "@repo/report-schema";
export {
  PRECISION_FORMAT,
  formatTimestamp,
  resolveTimePrecision,
  timestampSupportsPrecision,
  CoordOrigin,
  LineVariant,
  SCHEMA_VERSION,
  TimelineOrder,
  TimelineOrientation,
  TimePrecision,
  TimelineScale,
  UnitOfTime,
} from "@repo/report-schema";
