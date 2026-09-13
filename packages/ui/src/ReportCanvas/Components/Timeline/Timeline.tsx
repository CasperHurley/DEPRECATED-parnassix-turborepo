import * as React from "react";
import { Section } from "tamagui";
import { TimelineScale } from "@repo/report-schema";
import { useRenderContext } from "../../../render-context";
import { TimeScaleTimeline } from "./TimeScaleTimeline";
import { OrdinalTimeline } from "./OrdinalTimeline";
import { resolveTimelineOrientation, type TimelineProps } from "./types";

/**
 * One component, two position functions.
 *
 * `ordinal` spaces events evenly and lays out with flex; `time` spaces them in
 * proportion to their timestamps and has to position absolutely, because flex
 * cannot express proportion. Everything else — the spec, the card, the header,
 * the render props, the error handling — is shared, which is why this is a
 * `scale` prop rather than two components an agent would have to choose between.
 *
 * The axis, though, is resolved against the box before either scale sees it: a
 * horizontal timeline in a phone-width box is read one card at a time, and
 * turning it vertical spends the page's own scroll on time. That decision is the
 * renderer's rather than the agent's, which is what the render context is for —
 * an agent emitting a size-agnostic template cannot know it is being read on a
 * phone, and should not have to.
 */
export function Timeline(props: TimelineProps) {
  const { width } = useRenderContext();
  if (props.children) return <Section>{props.children}</Section>;

  const resolved = {
    ...props,
    orientation: resolveTimelineOrientation(props.orientation, width),
  };

  return props.scale === TimelineScale.Time ? (
    <TimeScaleTimeline {...resolved} />
  ) : (
    <OrdinalTimeline {...resolved} />
  );
}

export { OrdinalTimeline, TimelineEvent } from "./OrdinalTimeline";
