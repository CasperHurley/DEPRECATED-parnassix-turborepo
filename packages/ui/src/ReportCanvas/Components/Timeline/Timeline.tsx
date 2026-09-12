import * as React from "react";
import { Section } from "tamagui";
import { TimelineScale } from "@repo/report-schema";
import { TimeScaleTimeline } from "./TimeScaleTimeline";
import { OrdinalTimeline } from "./OrdinalTimeline";
import type { TimelineProps } from "./types";

/**
 * One component, two position functions.
 *
 * `ordinal` spaces events evenly and lays out with flex; `time` spaces them in
 * proportion to their timestamps and has to position absolutely, because flex
 * cannot express proportion. Everything else — the spec, the card, the header,
 * the render props, the error handling — is shared, which is why this is a
 * `scale` prop rather than two components an agent would have to choose between.
 */
export function Timeline(props: TimelineProps) {
  if (props.children) return <Section>{props.children}</Section>;
  return props.scale === TimelineScale.Time ? (
    <TimeScaleTimeline {...props} />
  ) : (
    <OrdinalTimeline {...props} />
  );
}

export { OrdinalTimeline, TimelineEvent } from "./OrdinalTimeline";
