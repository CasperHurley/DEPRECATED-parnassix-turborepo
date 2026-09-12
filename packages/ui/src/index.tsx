export * from "tamagui";

export { ReportCanvas } from "./ReportCanvas/ReportCanvas";
export { ComponentErrorCard } from "./ReportCanvas/ComponentErrorCard";
export { ComponentErrorBoundary } from "./ReportCanvas/ComponentErrorBoundary";
export {
  mockOrdinalTimeline,
  mockReport,
  mockTimeScaleTimeline,
} from "./ReportCanvas/fixtures";
export {
  Timeline,
  OrdinalTimeline,
  TimelineEvent,
} from "./ReportCanvas/Components/Timeline/Timeline";
export {
  CARD_HEIGHT,
  CARD_WIDTH,
  EventCardBody,
  TimelineHeader,
  cardChrome,
  formatEventPeriods,
} from "./ReportCanvas/Components/Timeline/card";
export { LAYOUT_TO_FLEX } from "./ReportCanvas/Components/Timeline/types";
export {
  AXIS_PLACEMENT,
  AXIS_TICK_FORMAT,
  MIN_SEPARATION,
  MIN_VISIBLE_EXTENT,
  TimeFormatterMap,
  packGroupLanes,
  axisOffsetMinutes,
  computeTimeDomain,
  computeTimelineLayout,
  deriveTickUnit,
  formatOffset,
  generateTicks,
  groupTimelineEvents,
  pct,
} from "./ReportCanvas/Components/Timeline/axis";
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
  TimelineEventProps,
  TimelineProps,
} from "./ReportCanvas/Components/Timeline/types";
export type { EventCardBodyProps } from "./ReportCanvas/Components/Timeline/card";
export type {
  AxisPlacement,
  AxisTick,
  EventGroup,
  PlacedEvent,
  PlacedGroup,
  PositionedEvent,
  PositionedSpan,
  TimeDomain,
  TimelineLayout,
  TimelineLayoutOptions,
  UndatedEvent,
} from "./ReportCanvas/Components/Timeline/axis";
export type { RenderContextValue, RenderMedium } from "./render-context";

/* The wire contract, re-exported so apps have a single import site. */
export type {
  BBox,
  ComponentKind,
  ComponentSpec,
  ComponentSpecInput,
  ReportData,
  ReportSpec,
  ReportSpecInput,
  SourceRef,
  TimeInterval,
  TimeSpan,
  TimelineEventSpec,
  TimelineEventSpecInput,
  TimelineSpec,
  TimelineSpecInput,
} from "@repo/report-schema";
export {
  PRECISION_FORMAT,
  addUnits,
  floorToUnit,
  eventIntervals,
  formatTimestamp,
  labelPrecision,
  offsetMinutesOf,
  spanInterval,
  resolveTimePrecision,
  timestampInterval,
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
