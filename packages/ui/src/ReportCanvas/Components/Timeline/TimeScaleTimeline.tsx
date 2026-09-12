import * as React from "react";
import { ScrollView, Section, Text, YStack } from "tamagui";
import {
  LineVariant,
  TimePrecision,
  TimelineOrientation,
  type TimelineEventSpec,
} from "@repo/report-schema";
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
import {
  AXIS_PLACEMENT,
  MIN_VISIBLE_EXTENT,
  computeTimelineLayout,
  pct,
  type AxisPlacement,
  type EventGroup,
  type PositionedEvent,
} from "./axis";
import type { TimelineProps } from "./types";

/**
 * The time-scaled Timeline.
 *
 * Everything is positioned absolutely as a percentage of the axis, so the
 * component needs no measurement and renders identically on a phone, a slide,
 * letter paper and in an exported PDF. All layout arithmetic lives in `axis.ts`;
 * this file only turns fractions into props.
 *
 * There are no diagonal lines here, and therefore no SVG — every line is a
 * border or a background. `react-native-svg` is not a dependency, and adding one
 * for decoration would be a poor trade.
 */

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

const TICK_LENGTH = 6;

/**
 * The card box.
 *
 * Its extent along the lane axis is a FIXED number, not whatever the content
 * happens to need. Lanes are positioned arithmetically with nothing measured,
 * so the renderer has to know how much room a card takes before it draws one —
 * a card that grows a line taller than its lane silently overprints the lane
 * below. The height below is the capped worst case: a date line plus a two-line
 * title plus a two-line subtitle. Content beyond that clips, which is already
 * true of the `numberOfLines` caps on the text itself.
 */

/** Clear air between a card and the line that leads to it. */
const CONNECTOR_GAP = 14;

/** Clear air between adjacent lanes, and between the axis and the first lane. */
const LANE_GAP = 16;
const LANE_ORIGIN_GAP = 58;

/**
 * Distance between adjacent lanes.
 *
 * Differs by orientation because lanes stack along the axis a card is TALL in
 * when the timeline is horizontal, and WIDE in when it is vertical. One stride
 * cannot serve both.
 */
const LANE_STRIDE = {
  horizontal: CARD_HEIGHT + LANE_GAP,
  vertical: CARD_WIDTH + LANE_GAP,
} as const;

/** Distance from the component edge to the axis, leaving room for tick labels. */
const AXIS_OFFSET = { horizontal: 34, vertical: 76 } as const;

/** Space a tick's label may occupy. */
const TICK_LABEL_SIZE = {
  horizontal: 72,
  vertical: AXIS_OFFSET.vertical - TICK_LENGTH - 6,
} as const;

/**
 * How deep the span bracket's arms run before they meet its rail.
 *
 * Deep enough to read as a shape that GATHERS the span down to a single point,
 * which is the thing being said: this whole stretch of axis belongs to one
 * card. A shallow version of the same three borders just looks like a box
 * ruled under the band, restating what the band already shows.
 */
const BRACKET_DEPTH = 18;

/**
 * Extra depth per lane, so overlapping groups do not rule their rails on top of
 * each other. Timelines routinely carry several long periods covering the same
 * months; without this their rails collapse into a stack of parallel lines
 * under the axis that belongs to nothing in particular.
 */
const BRACKET_LANE_STEP = 4;

/**
 * How long the time axis is, at minimum.
 *
 * `MIN_CARDS_ACROSS` is the floor — below it a timeline is too cramped to read
 * at any density. `TARGET_LANES` lengthens it as events are added, so that
 * events spread evenly would stack no more than that deep before the axis grows
 * instead. Growing the axis is the better trade: a longer axis scrolls, whereas
 * deeper lanes eventually hit the lane cap and overprint.
 */
const MIN_CARDS_ACROSS = 7;
const TARGET_LANES = 3;

/**
 * How close to either end of the axis a card is forced to stagger inward.
 *
 * A staggered card hangs entirely to one side of its leader, so an event near
 * the start of the axis staggered backwards would hang off the component. In
 * the middle the side alternates by lane instead, which is what makes a cluster
 * zigzag around its leaders rather than bury them.
 */
const EDGE_ZONE = 0.12;

/**
 * How emphatically a marker is drawn, by how much its source actually knew.
 *
 * A year-precision event occupies a year of axis, and drawn at full strength
 * that band reads as "this went on for a year" — an assertion about duration
 * the source never made. Fading it with the coarseness of the precision makes
 * the band read as what it is: the window the event is known to fall inside.
 * Keyed to `precision` rather than to the rendered width, because vagueness is
 * a property of the evidence, not of how wide the viewport happens to be.
 */
const PRECISION_EMPHASIS: Record<TimePrecision, number> = {
  [TimePrecision.Millisecond]: 1,
  [TimePrecision.Second]: 1,
  [TimePrecision.Minute]: 1,
  [TimePrecision.Hour]: 0.8,
  [TimePrecision.Day]: 0.65,
  [TimePrecision.Month]: 0.45,
  [TimePrecision.Year]: 0.3,
};

type Edge = "left" | "right" | "top" | "bottom";

const OPPOSITE: Record<Edge, Edge> = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
};

const BORDER_WIDTH_PROP: Record<Edge, string> = {
  left: "borderLeftWidth",
  right: "borderRightWidth",
  top: "borderTopWidth",
  bottom: "borderBottomWidth",
};

/** `{ borderLeftWidth: 1, ... }` for the edges named. */
const edgeBorders = (...edges: Edge[]): Record<string, number> =>
  Object.fromEntries(edges.map((edge) => [BORDER_WIDTH_PROP[edge], 1]));

/* -------------------------------------------------------------------------- */

export function TimeScaleTimeline({
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
  const placement = AXIS_PLACEMENT[orientation][order];

  /** One card's worth of the time axis, including the air a stagger needs. */
  const cardSlot = horizontal ? CARD_WIDTH + CONNECTOR_GAP : CARD_HEIGHT + LANE_GAP;

  /**
   * The axis's own length along the time direction — a MINIMUM, not a cap.
   *
   * Naming a length rather than inheriting the viewport's is what lets the
   * component guarantee anything: positions are fractions, so the total decides
   * only how much room the gaps get on screen, never their ratio to each other.
   * A wider viewport simply adds slack.
   */
  const axisLength = Math.max(MIN_CARDS_ACROSS, events.length / TARGET_LANES) * cardSlot;

  /**
   * Derived from that length, never a constant.
   *
   * Lane packing keeps two cards in the same lane at least this far apart, so
   * setting it to exactly one card's slot is what makes "cards never overprint"
   * a guarantee rather than a hope. A fixed fraction cannot: 12% is a card's
   * width on a 1400px axis and 47px on a phone's 390px one, where a card is
   * still 168px.
   */
  const minSeparation = cardSlot / axisLength;

  const layout = React.useMemo(
    () => computeTimelineLayout(events, { minSeparation }),
    [events, minSeparation],
  );

  const { domain, ticks, positioned, groups, undated, laneCount, zoneLabel } = layout;

  const axisStyle = BORDER_STYLE[lineVariant ?? LineVariant.Solid];
  const axisOffset = horizontal ? AXIS_OFFSET.horizontal : AXIS_OFFSET.vertical;
  const laneStride = horizontal ? LANE_STRIDE.horizontal : LANE_STRIDE.vertical;
  const tickLabelSize = horizontal ? TICK_LABEL_SIZE.horizontal : TICK_LABEL_SIZE.vertical;

  /** The card's extent along the TIME axis, which is what staggering moves it by. */
  const cardTimeExtent = horizontal ? CARD_WIDTH : CARD_HEIGHT;
  /** The card's extent along the LANE axis, used to centre a leader on it. */
  const cardLaneExtent = horizontal ? CARD_HEIGHT : CARD_WIDTH;

  /** Where lane 0 sits, and therefore where every other lane sits. */
  const laneOrigin = axisOffset + LANE_ORIGIN_GAP;
  const lanePositionOf = (lane: number) => laneOrigin + lane * laneStride;
  const lanesExtent = laneOrigin + Math.max(laneCount, 1) * laneStride;

  /**
   * Which side of its leader a card sits on.
   *
   * `+1` is toward later time, `-1` toward earlier — expressed against the
   * fraction rather than the screen, so `order: descending` mirrors for free.
   */
  const sideOf = (pe: PositionedEvent): 1 | -1 => {
    if (pe.centerFraction < EDGE_ZONE) return 1;
    if (pe.centerFraction > 1 - EDGE_ZONE) return -1;
    return pe.lane % 2 === 0 ? 1 : -1;
  };

  return (
    /*
     * `alignSelf: stretch` is load-bearing, not cosmetic. A proportional axis
     * is only legible if it actually spans the space available: an ancestor
     * with `alignItems: center` would otherwise shrink this to its content
     * width, and `minSeparation` — a fraction of the axis — would then be a
     * handful of pixels, collapsing every event into its own lane.
     */
    <Section alignSelf="stretch" width="100%">
      <YStack gap="$2" py="$3" alignSelf="stretch">
        <TimelineHeader title={title} subtitle={subtitle} description={description} />

        {domain === null ? (
          <EmptyTimeline />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // `minWidth: 100%` lets the axis stretch past its minimum on a wide
            // screen; below that it scrolls instead of crushing the cards.
            contentContainerStyle={{ minWidth: "100%" }}
          >
          <YStack
            position="relative"
            f={1}
            // Inset so a staggered card has room to hang to one side of its
            // leader without overflowing the component.
            {...(horizontal
              ? { mx: CARD_WIDTH / 2 + CONNECTOR_GAP, minWidth: axisLength, height: lanesExtent }
              : {
                  my: CARD_HEIGHT / 2 + CONNECTOR_GAP,
                  height: axisLength,
                  minWidth: lanesExtent,
                })}
          >
            {axisStyle ? (
              <YStack
                position="absolute"
                borderColor="$borderColor"
                {...(horizontal
                  ? { left: 0, right: 0, top: axisOffset, borderTopWidth: 1 }
                  : { top: 0, bottom: 0, left: axisOffset, borderLeftWidth: 1 })}
                borderStyle={axisStyle}
              />
            ) : null}

            {ticks.map((tick) => (
              <YStack
                key={tick.at}
                position="absolute"
                ai={horizontal ? "center" : "flex-end"}
                gap={2}
                {...(horizontal
                  ? { top: 0, width: tickLabelSize }
                  : { left: 0, width: tickLabelSize })}
                {...{
                  [placement.start]: pct(tick.fraction),
                  [placement.centerMargin]: horizontal ? -tickLabelSize / 2 : -7,
                }}
              >
                <Text fontSize="$1" o={0.6} numberOfLines={1}>
                  {tick.label}
                </Text>
                <YStack
                  bg="$borderColor"
                  {...(horizontal
                    ? { width: 1, height: TICK_LENGTH }
                    : { height: 1, width: TICK_LENGTH })}
                />
              </YStack>
            ))}

            {/*
             * One element is both the dot and the interval band. Its length is
             * the event's precision as a share of the domain, floored so a
             * second-precision event stays visible inside a five-year span. A
             * visibly wide band means a vague source — precision you can see.
             */}
            {positioned.flatMap((pe) =>
              pe.spans.map((span, spanIndex) => (
              <YStack
                key={`marker-${pe.event.id}-${spanIndex}`}
                position="absolute"
                bg="$blue9"
                o={PRECISION_EMPHASIS[span.precision]}
                borderRadius={MARKER_THICKNESS / 2}
                {...(horizontal
                  ? {
                      top: axisOffset - MARKER_THICKNESS / 2,
                      height: MARKER_THICKNESS,
                      minWidth: MARKER_THICKNESS,
                    }
                  : {
                      left: axisOffset - MARKER_THICKNESS / 2,
                      width: MARKER_THICKNESS,
                      minHeight: MARKER_THICKNESS,
                    })}
                {...{
                  [placement.start]: pct(span.startFraction),
                  [placement.size]: pct(span.extentFraction),
                }}
              />
              )),
            )}

            {groups.map((group) => (
              <GroupConnector
                key={`connector-${group.id}`}
                group={group}
                horizontal={horizontal}
                placement={placement}
                axisOffset={axisOffset}
                laneCenterOf={(lane) => lanePositionOf(lane) + cardLaneExtent / 2}
                sideOf={sideOf}
                defaultStyle={lineVariant}
              />
            ))}

            {groups.flatMap((group) =>
              group.members.map((pe) => (
                <EventCard
                  key={pe.event.id}
                  positioned={pe}
                  horizontal={horizontal}
                  placement={placement}
                  lanePosition={lanePositionOf(pe.lane)}
                  // Cards hang off the GROUP's trunk, not off their own
                  // position: that is what makes a cluster read as one branch
                  // with cards on it. Each event's own instant is still stated
                  // exactly — by its band on the axis and by its arm.
                  anchorFraction={group.centerFraction}
                  stagger={
                    sideOf(pe) > 0 ? CONNECTOR_GAP : -(cardTimeExtent + CONNECTOR_GAP)
                  }
                  labelUnit={labelUnit}
                  renderEvent={renderEvent}
                  renderOppositeContent={renderOppositeContent}
                />
              )),
            )}
            </YStack>
          </ScrollView>
        )}

        {zoneLabel ? (
          // Said out loud because an exported PDF has to carry its own context:
          // a reader on another desk cannot ask which clock this ruler used.
          <Text fontSize="$1" o={0.55}>
            All times {zoneLabel}
          </Text>
        ) : null}

        {undated.length > 0 ? (
          <YStack gap="$1" pt="$2">
            <Text fontSize="$1" o={0.6}>
              Not placed on the timeline — no readable date:
            </Text>
            {undated.map(({ event }) => (
              <Text key={event.id} fontSize="$2">
                {event.title}
              </Text>
            ))}
          </YStack>
        ) : null}
      </YStack>
    </Section>
  );
}

/**
 * Leads the eye from a group of cards back to the axis they came from.
 *
 * One branch point per group, not one line per card: a line from the axis to
 * every card in a dense cluster is a bundle of near-identical verticals that
 * reads as noise, so the cluster gets a single trunk and the cards hang off it.
 *
 * Three parts, each saying something different:
 *
 *  - **Arms.** One rises to the axis at every period the group covers — at both
 *    ends of a period wide enough to show them, otherwise at its single mark.
 *    This is where positional honesty lives: the arms land exactly where the
 *    evidence does, whatever the trunk does.
 *  - **A rail** gathering the arms. It spans the group's full extent, so an
 *    event known only to its month reads as owning that month, and a cluster
 *    reads as owning the stretch its events actually fall in.
 *  - **A trunk and its branches.** The trunk carries the group down to its
 *    cards; a short branch turns off it into each card's near edge. Cards
 *    stagger to alternating sides, so the branches land in clear space rather
 *    than the trunk disappearing behind the cards it points at.
 *
 * A lone point event needs none of that gathering and gets a plain leader.
 * Still borders and no diagonals, so still no SVG.
 */
function GroupConnector({
  group,
  horizontal,
  placement,
  axisOffset,
  laneCenterOf,
  sideOf,
  defaultStyle,
}: {
  group: EventGroup;
  horizontal: boolean;
  placement: AxisPlacement;
  axisOffset: number;
  laneCenterOf: (lane: number) => number;
  sideOf: (pe: PositionedEvent) => 1 | -1;
  defaultStyle: TimelineProps["lineVariant"];
}) {
  const styleOf = (pe: PositionedEvent) =>
    BORDER_STYLE[pe.event.lineVariant ?? defaultStyle ?? LineVariant.Solid];

  // The group's own line style is the first member's; per-event variants still
  // apply to that event's own branch below.
  const groupStyle = styleOf(group.members[0]!);
  if (!groupStyle) return null;

  const bandEdge = axisOffset + MARKER_THICKNESS / 2;
  /** Gather only when there is more than one mark, or a mark with width. */
  const gathers = group.arms.length > 1 || group.extentFraction >= MIN_VISIBLE_EXTENT;
  const topLane = Math.min(...group.members.map((m) => m.lane));
  const railAt = bandEdge + BRACKET_DEPTH + topLane * BRACKET_LANE_STEP;
  const trunkFrom = gathers ? railAt : bandEdge;

  const farLaneEdge = OPPOSITE[placement.cross];
  const across = (from: number, size: number) =>
    horizontal ? { top: from, height: size } : { left: from, width: size };

  const deepest = laneCenterOf(group.deepestLane);
  const trunkDepth = deepest - trunkFrom;

  return (
    <>
      {gathers ? (
        <>
          <YStack
            position="absolute"
            borderColor="$borderColor"
            borderStyle={groupStyle}
            o={0.5}
            {...across(railAt, 0)}
            {...edgeBorders(farLaneEdge)}
            {...{
              [placement.start]: pct(group.startFraction),
              [placement.size]: pct(group.extentFraction),
            }}
          />
          {group.arms.map((arm) => (
            <YStack
              key={`arm-${arm}`}
              position="absolute"
              borderColor="$borderColor"
              borderStyle={groupStyle}
              o={0.5}
              {...across(bandEdge, railAt - bandEdge)}
              {...edgeBorders(placement.start)}
              {...{ [placement.start]: pct(arm), [placement.size]: 0 }}
            />
          ))}
        </>
      ) : null}

      {trunkDepth > 0 ? (
        <YStack
          position="absolute"
          borderColor="$borderColor"
          borderStyle={groupStyle}
          o={0.5}
          {...across(trunkFrom, trunkDepth)}
          {...edgeBorders(placement.start)}
          {...{ [placement.start]: pct(group.centerFraction), [placement.size]: 0 }}
        />
      ) : null}

      {group.members.map((pe) => {
        const style = styleOf(pe);
        if (!style) return null;
        const side = sideOf(pe);
        return (
          <YStack
            key={`branch-${pe.event.id}`}
            position="absolute"
            borderColor="$borderColor"
            borderStyle={style}
            o={0.5}
            {...across(laneCenterOf(pe.lane), 0)}
            {...edgeBorders(farLaneEdge)}
            {...{
              [placement.start]: pct(group.centerFraction),
              [placement.size]: CONNECTOR_GAP,
              [placement.centerMargin]: side > 0 ? 0 : -CONNECTOR_GAP,
            }}
          />
        );
      })}
    </>
  );
}

function EventCard({
  positioned: pe,
  horizontal,
  placement,
  lanePosition,
  anchorFraction,
  stagger,
  labelUnit,
  renderEvent,
  renderOppositeContent,
}: {
  positioned: PositionedEvent;
  horizontal: boolean;
  lanePosition: number;
  anchorFraction: number;
  stagger: number;
  placement: AxisPlacement;
  labelUnit: TimelineProps["labelUnit"];
  renderEvent?: (event: TimelineEventSpec, index: number) => React.ReactNode;
  renderOppositeContent?: (event: TimelineEventSpec, index: number) => React.ReactNode;
}) {
  return (
    <YStack
      position="absolute"
      {...cardChrome}
      {...(horizontal ? { top: lanePosition } : { left: lanePosition })}
      {...{
        [placement.start]: pct(anchorFraction),
        [placement.centerMargin]: stagger,
      }}
    >
      <EventCardBody
        event={pe.event}
        index={pe.index}
        labelUnit={labelUnit}
        renderEvent={renderEvent}
        renderOppositeContent={renderOppositeContent}
      />
    </YStack>
  );
}
