import * as React from "react";
import { ScrollView, Section, Text, XStack, YStack } from "tamagui";
import { LineVariant, TimePrecision, TimelineOrientation, resolveTimePrecision } from "@repo/report-schema";
import {
  BORDER_STYLE,
  CARD_HEIGHT,
  CARD_WIDTH,
  EmptyTimeline,
  EventCardBody,
  MARKER_THICKNESS,
  TimelineHeader,
  cardChrome,
} from "./card";
import { LAYOUT_TO_FLEX, type TimelineProps } from "./types";

/**
 * Evenly spaced: position is the index, and nothing else.
 *
 * Right for milestones, where the question is what happened in what order
 * rather than how long the gaps were, and right for a narrow viewport where
 * proportional spacing collapses into overlap.
 *
 * Because position is the index, this scale needs none of the machinery the
 * time scale does: no domain, no ticks, no lanes, no trunks. Two events cannot
 * collide when each is given an equal share of the axis, so flex does the whole
 * job and every card sits in its own column. The card itself is shared with the
 * time scale — the scales differ in where a card is PUT, never in what it says.
 *
 * There is also no undated case here. An unreadable timestamp cannot break an
 * ordinal position, so the event still renders in sequence and
 * `formatEventPeriods` falls back to the raw string rather than dropping it.
 */
export function OrdinalTimeline({
  title,
  subtitle,
  description,
  events,
  orientation,
  order,
  labelUnit,
  lineVariant,
  renderEvent,
  renderOppositeContent,
}: TimelineProps) {
  const horizontal = orientation === TimelineOrientation.Horizontal;
  const axisStyle = BORDER_STYLE[lineVariant ?? LineVariant.Solid];

  return (
    <Section alignSelf="stretch" width="100%">
      <YStack gap="$2" py="$3" alignSelf="stretch">
        <TimelineHeader title={title} subtitle={subtitle} description={description} />

        {events.length === 0 ? (
          <EmptyTimeline />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // `minWidth: 100%` lets the steps spread across a wide screen;
            // below their combined minimum the axis scrolls instead.
            contentContainerStyle={{ minWidth: "100%" }}
          >
          <XStack
            f={1}
            // `order` reverses the axis rather than re-sorting: the spec's first
            // event still sits at the START of the axis, which for `descending`
            // is the far end.
            flexDirection={LAYOUT_TO_FLEX[orientation][order]}
            ai={horizontal ? "flex-start" : "stretch"}
            {...(horizontal ? { minWidth: events.length * STEP_SLOT } : null)}
          >
            {events.map((event, index) => (
              <OrdinalStep
                key={event.id}
                event={event}
                index={index}
                horizontal={horizontal}
                axisStyle={axisStyle}
                first={index === 0}
                last={index === events.length - 1}
                labelUnit={labelUnit}
                lineVariant={lineVariant}
                renderEvent={renderEvent}
                renderOppositeContent={renderOppositeContent}
              />
            ))}
          </XStack>
          </ScrollView>
        )}
      </YStack>
    </Section>
  );
}

/** Length of the stub joining a marker to its card. */
const LEADER = 18;

/**
 * The room one step needs before its card starts crushing its neighbour.
 *
 * An ordinal axis gives every event an equal share, so the total the component
 * needs is simply this times the event count. Below that it scrolls rather than
 * shrinking the columns — a card squeezed to a third of its width is not a
 * smaller card, it is an unreadable one.
 */
const STEP_SLOT = CARD_WIDTH + 16;

/**
 * How emphatically a marker is drawn, by how much its source actually knew.
 *
 * The time scale says this with the WIDTH of a band, which an ordinal axis has
 * no room for — every event gets an equal share whatever its precision. Saying
 * it with weight instead keeps the same fact visible on both scales.
 */
const PRECISION_EMPHASIS: Record<TimePrecision, number> = {
  [TimePrecision.Second]: 1,
  [TimePrecision.Minute]: 1,
  [TimePrecision.Hour]: 0.8,
  [TimePrecision.Day]: 0.65,
  [TimePrecision.Month]: 0.45,
  [TimePrecision.Year]: 0.3,
};

function OrdinalStep({
  event,
  index,
  horizontal,
  axisStyle,
  first,
  last,
  labelUnit,
  lineVariant,
  renderEvent,
  renderOppositeContent,
}: {
  event: TimelineProps["events"][number];
  index: number;
  horizontal: boolean;
  axisStyle: "solid" | "dashed" | "dotted" | null;
  first: boolean;
  last: boolean;
  labelUnit: TimelineProps["labelUnit"];
  lineVariant: TimelineProps["lineVariant"];
  renderEvent?: TimelineProps["renderEvent"];
  renderOppositeContent?: TimelineProps["renderOppositeContent"];
}) {
  const leaderStyle = BORDER_STYLE[event.lineVariant ?? lineVariant ?? LineVariant.Solid];
  const emphasis = PRECISION_EMPHASIS[resolveTimePrecision(event.timestamp, event.precision)];

  /**
   * Each step draws its own half-segments of the axis, which meet their
   * neighbours' to form one continuous line. Drawn per step rather than as one
   * absolute element so the line follows wherever flex puts the markers — the
   * ordinal scale's whole premise is that flex decides position.
   */
  const segment = (side: "before" | "after") => {
    const hidden = (side === "before" && first) || (side === "after" && last);
    return (
      <YStack
        f={1}
        borderColor="$borderColor"
        borderStyle={axisStyle ?? "solid"}
        o={hidden || !axisStyle ? 0 : 1}
        {...(horizontal ? { borderTopWidth: 1 } : { borderLeftWidth: 1 })}
      />
    );
  };

  return (
    <YStack
      f={1}
      ai="center"
      // A column that never falls below a card's width, so a long timeline
      // scrolls rather than crushing every card to nothing.
      {...(horizontal
        ? { minWidth: STEP_SLOT }
        : { minHeight: CARD_HEIGHT + 16, flexDirection: "row", ai: "center" })}
    >
      {/* Axis segment with the marker sitting on it. */}
      <XStack
        ai="center"
        jc="center"
        {...(horizontal
          ? { alignSelf: "stretch", height: MARKER_THICKNESS }
          : { flexDirection: "column", alignSelf: "stretch", width: MARKER_THICKNESS })}
      >
        {segment("before")}
        <YStack
          width={MARKER_THICKNESS}
          height={MARKER_THICKNESS}
          borderRadius={MARKER_THICKNESS / 2}
          bg="$blue9"
          o={emphasis}
        />
        {segment("after")}
      </XStack>

      {leaderStyle ? (
        <YStack
          borderColor="$borderColor"
          borderStyle={leaderStyle}
          o={0.5}
          {...(horizontal
            ? { height: LEADER, borderLeftWidth: 1 }
            : { width: LEADER, borderTopWidth: 1 })}
        />
      ) : (
        <YStack {...(horizontal ? { height: LEADER } : { width: LEADER })} />
      )}

      <YStack {...cardChrome}>
        <EventCardBody
          event={event}
          index={index}
          labelUnit={labelUnit}
          renderEvent={renderEvent}
          renderOppositeContent={renderOppositeContent}
        />
      </YStack>
    </YStack>
  );
}

/**
 * Kept for the `children` escape hatch and for consumers that were rendering a
 * single event directly. The default layout no longer uses it — a card's
 * content lives in `EventCardBody`, shared with the time scale.
 */
export const TimelineEvent: React.FC<{
  title: string;
  subtitle?: string;
  description?: string;
  oppositeContent?: React.ReactNode;
  children?: React.ReactNode;
}> = (props) => {
  if (props.children) return <YStack>{props.children}</YStack>;
  return (
    <YStack {...cardChrome}>
      <Text fontWeight="600" fontSize="$2" numberOfLines={2}>
        {props.title}
      </Text>
      {props.subtitle ? (
        <Text fontSize="$1" o={0.8} numberOfLines={2}>
          {props.subtitle}
        </Text>
      ) : null}
      {props.description ? (
        <Text fontSize="$1" o={0.7} numberOfLines={2}>
          {props.description}
        </Text>
      ) : null}
      {props.oppositeContent}
    </YStack>
  );
};
