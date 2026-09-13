import * as React from "react";
import { ScrollView, Section, Text, XStack, YStack } from "tamagui";
import { useIsStaticMedium, useRenderContext } from "../../../render-context";
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
  armsOf,
  litRailSpan,
  splitLitRun,
  computeTimelineLayout,
  pct,
  stackRailNodes,
  type AxisPlacement,
  type EventGroup,
  type PositionedEvent,
} from "./axis";
import { DetailPanel } from "./DetailPanel";
import {
  HIGHLIGHT_WEIGHT,
  highlightTier,
  resolveTimelineDetail,
  type HighlightTier,
  type TimelineProps,
} from "./types";

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
 * The frozen rail, drawn only when the axis runs vertically.
 *
 * A vertical timeline stacks its lanes along X, which is the direction a phone
 * has least of, so panning through a dense cluster used to carry the axis and
 * its tick labels off the left edge — leaving a column of cards with no visible
 * time reference at all. The axis therefore comes OUT of the scrolling area and
 * sits in a fixed column beside it.
 *
 * The column carries a node per group as well as the ticks, so the rail alone is
 * a complete account of what happened and in what order. That is what keeps this
 * clear of the rule that killed expandable clustering and hover-only citation:
 * scrolling reveals DETAIL about a fact already listed, never the only copy of
 * the fact. Nothing collapses and nothing is hidden, so there is no screen-only
 * state for the export path to disagree with.
 */
const NODE_LABEL_WIDTH = 112;
/** Between the axis and the node labels. */
const NODE_GAP = 8;
/**
 * One node row. Fixed, like the card box, because block positions are
 * arithmetic with nothing measured — a row that grew a line would push its
 * block into the one below without the layout ever knowing.
 *
 * A node carries no date of its own. The tick labels immediately to its left
 * already state the time, and the node sits against them; a group spanning
 * three days has no single date to print here, and the one it would pick would
 * be wrong for four of its five members.
 */
const NODE_LINE = 18;
/** Clear air between two node blocks that would otherwise touch. */
const NODE_BLOCK_GAP = 8;

const RAIL_WIDTH =
  AXIS_OFFSET.vertical + MARKER_THICKNESS / 2 + NODE_GAP + NODE_LABEL_WIDTH;

/** Where the node labels begin, measured from the rail's left edge. */
const NODE_LABEL_LEFT = AXIS_OFFSET.vertical + MARKER_THICKNESS / 2 + NODE_GAP;

/**
 * The detail drawer, which is how a rail-only timeline gives up its detail.
 *
 * It opens against the axis — just clear of the precision bands — and runs to
 * the far edge, so the ruler and its tick labels stay visible while it is open.
 * Covering them would throw away the reason the axis was frozen.
 *
 * Placed without measuring anything: it opens beside the node that was pressed
 * rather than at the top of a component that is routinely taller than the
 * screen, and is clamped so it cannot hang off either end of the axis.
 */
const PANEL_LEFT = AXIS_OFFSET.vertical + MARKER_THICKNESS / 2 + 6;
/**
 * A NAMED height rather than the component's own, for the same reason the axis
 * names its length: a vertical timeline is taller than a phone, so a drawer
 * that filled it could not be seen at once. This fits a phone with room to
 * spare and is simply the whole component when that is shorter.
 */
const PANEL_MAX_HEIGHT = 520;
/** How far above the pressed node the drawer opens. */
const PANEL_RISE = 24;

/** Extra touch target around a node row, which costs no layout. */
const NODE_HIT_SLOP = { top: 5, bottom: 5, left: 8, right: 8 } as const;

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

/** How tall a group's block of node rows is. */
const nodeBlockHeight = (members: number) => members * NODE_LINE;

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

/**
 * Highlighting DIMS THE REST; it never brightens the target.
 *
 * Marker opacity already carries meaning — `PRECISION_EMPHASIS` above says how
 * much the source knew — so raising a lit band to full strength would overwrite
 * evidence with a hover state, making a window the source guessed at read as a
 * time it fixed. Every tier in `HIGHLIGHT_WEIGHT` is therefore a fraction, which
 * preserves each ratio between the bands, and at rest every weight is 1 so the
 * component draws exactly what it drew before highlighting existed.
 */

/** How firmly a connector is drawn when nothing is competing with it. */
const CONNECTOR_OPACITY = 0.5;

/**
 * The colour a lit chain is drawn in — the MARKER's own colour.
 *
 * A leader's whole job is to say that this card belongs to that band, so
 * drawing it in the band's colour is the shortest way to say it.
 *
 * Connectors may be brightened where markers may not. A marker's opacity is
 * evidence — `PRECISION_EMPHASIS` — and raising it would overstate what a source
 * knew. A connector is a routing device that asserts nothing, so its own
 * strength is free to carry the emphasis the marker cannot.
 */
const LIT_LINE = "$blue9";

/**
 * How a line is drawn in each tier.
 *
 * `rest` and `related` are deliberately the same: a connector's resting 0.5 IS
 * the middle strength, so a cluster holding the lit event keeps the structure it
 * draws at rest and only the route through it brightens. Nothing needs to be
 * invented for the middle tier on this side.
 */
export const LINE_TIER: Record<HighlightTier, { o: number; borderColor: string }> = {
  rest: { o: CONNECTOR_OPACITY, borderColor: "$borderColor" },
  lit: { o: 1, borderColor: LIT_LINE },
  related: { o: CONNECTOR_OPACITY, borderColor: "$borderColor" },
  aside: { o: CONNECTOR_OPACITY * HIGHLIGHT_WEIGHT.aside, borderColor: "$borderColor" },
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

/**
 * 1px on the edges named — and explicitly **0 on the other three**.
 *
 * The zeroes are the whole point. CSS's initial `border-width` is `medium`,
 * which computes to 3px, and it stays invisible only while `border-style` is
 * `none`. Every line here sets a style, so naming one edge's width and leaving
 * the rest alone does not draw a line: it draws a 3px box with one 1px side.
 * Dashed made that obvious — a dash pattern scales with its border's width, so
 * three 3px edges came out as chunky blocks around a fine dotted one — but
 * `solid` had been drawing the same box all along, quietly, as a thick stub at
 * each end of every leader and both ends of the axis.
 */
const edgeBorders = (...edges: Edge[]): Record<string, number> =>
  Object.fromEntries(
    (Object.keys(BORDER_WIDTH_PROP) as Edge[]).map((edge) => [
      BORDER_WIDTH_PROP[edge],
      edges.includes(edge) ? 1 : 0,
    ]),
  );

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

  /**
   * A vertical axis is lifted out of the scrolling area into a frozen rail, so
   * the lane area then starts at the rail's right edge and measures from there.
   * A horizontal axis scrolls WITH its cards — panning moves you through time,
   * which is the thing the axis is a ruler for — so it stays in one stack.
   */
  const frozen = !horizontal;

  /** The inset a staggered card needs to hang past the end of the axis. */
  const timeInset = frozen ? CARD_HEIGHT / 2 + CONNECTOR_GAP : CARD_WIDTH / 2 + CONNECTOR_GAP;

  /**
   * Whether the rail gives up its detail to a panel instead of to cards beside
   * it.
   *
   * Two conditions, and the second is the one that matters. A box too narrow to
   * hold a card next to the rail can only show cards by scrolling sideways
   * through them, which is the arrangement this replaced. But a STATIC medium
   * never takes this path however narrow it is, because a panel that opens on a
   * press is exactly the interaction CLAUDE.md rules out as the only route to a
   * fact — the same rule that rejected hover-only citation and expandable
   * clustering. On paper every card is drawn, and the panel does not exist.
   */
  const isStatic = useIsStaticMedium();
  const { width: boxWidth } = useRenderContext();
  const railOnly =
    resolveTimelineDetail(orientation, boxWidth, isStatic, RAIL_WIDTH) === "panel";

  /** Which event's detail is open. Screen-only state; never set on paper. */
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  /**
   * Which event is lit: the card, the line that carries it back to the axis,
   * and the band that line lands on, drawn as one.
   *
   * Those three are one claim drawn in three places, and in a dense cluster it
   * is genuinely hard to tell which of six leaders belongs to the card you are
   * reading. Lighting the chain answers that without moving anything or
   * revealing anything: every part was already on screen and stays there once
   * the pointer leaves.
   *
   * Two sources, because a pointer and a finger are not the same gesture. A
   * hover is transient and follows the pointer; a press PINS, so the highlight
   * survives reading the card, and touch — which has no hover at all — can
   * reach the same affordance. A press on the pinned card puts it out again.
   *
   * Both are kept, rather than one id, because they have to compose: hovering a
   * second card while one is pinned lights the hovered one and hands the
   * highlight back when the pointer leaves.
   *
   * Separate from `selectedId`, which opens the drawer — a pointer wandering
   * across a cluster must not keep reopening it.
   */
  const [hoverId, setHoverId] = React.useState<string | null>(null);
  const [pinnedId, setPinnedId] = React.useState<string | null>(null);

  /*
   * Withheld on a static medium rather than merely left unused: paper cannot be
   * hovered or pressed, and an export that inherited whatever a screen happened
   * to be pointing at would print one event emphasised over the rest for no
   * reason a reader could see.
   *
   * Resolved by LOOKUP for the same reason `selection` below is: a report is a
   * session document whose components are replaced by id as the backend
   * regenerates them, and a pin naming an event that has since left the spec —
   * or become undated, which places it nowhere — would otherwise leave every
   * remaining event faded against a card that is not on screen.
   */
  const highlighted = React.useMemo(() => {
    if (isStatic) return null;
    const id = hoverId ?? pinnedId;
    return id !== null && positioned.some((pe) => pe.event.id === id) ? id : null;
  }, [isStatic, hoverId, pinnedId, positioned]);

  /*
   * The lit event's own group, which earns the middle tier.
   *
   * Resolved by lookup like the drawer's selection, and for the same reason: a
   * report is a session document whose components are replaced by id, so a held
   * reference would keep emphasising evidence no longer in the report.
   */
  const relatedIds = React.useMemo(() => {
    if (highlighted === null) return null;
    const group = groups.find((g) => g.members.some((m) => m.event.id === highlighted));
    return group === undefined ? null : new Set(group.members.map((m) => m.event.id));
  }, [highlighted, groups]);

  const tierOf = (eventId: string) => highlightTier(eventId, highlighted, relatedIds);

  /** A part's own opacity, faded by how much this tier is speaking for it. */
  const weigh = (own: number, eventId: string) => own * HIGHLIGHT_WEIGHT[tierOf(eventId)];

  const highlightProps = (eventId: string) =>
    isStatic
      ? null
      : {
          onHoverIn: () => setHoverId(eventId),
          // Only clears its OWN hover: moving between two adjacent cards fires
          // the new card's hover-in before the old card's hover-out, and an
          // unconditional clear would drop the highlight that just arrived.
          onHoverOut: () => setHoverId((current) => (current === eventId ? null : current)),
          onPress: () => {
            setPinnedId((current) => (current === eventId ? null : eventId));
            // A tap on a touchscreen emits a compatibility hover first, which
            // would otherwise keep the card lit after the press that put it
            // out. Dropping this card's hover on any press makes the pin the
            // only thing deciding, for a finger and a pointer alike.
            setHoverId((current) => (current === eventId ? null : current));
          },
          cursor: "pointer",
        };

  /** Where a connector meets the axis, in the stack that draws connectors. */
  const axisEdge = frozen ? 0 : axisOffset + MARKER_THICKNESS / 2;

  /** Where lane 0 sits, and therefore where every other lane sits. */
  const laneOrigin = frozen ? CONNECTOR_GAP : axisOffset + LANE_ORIGIN_GAP;
  const lanePositionOf = (lane: number) => laneOrigin + lane * laneStride;
  const lanesExtent = laneOrigin + Math.max(laneCount, 1) * laneStride;

  /** Where each group's node block goes on the rail, top-down in screen space. */
  const nodeBlocks = React.useMemo(() => {
    if (!frozen) return [];
    const screenYOf = (fraction: number) =>
      (placement.start === "top" ? fraction : 1 - fraction) * axisLength;
    return stackRailNodes(
      groups.map((group) => ({
        item: group,
        screenY: screenYOf(group.centerFraction),
        height: nodeBlockHeight(group.members.length),
      })),
      NODE_BLOCK_GAP,
    );
  }, [frozen, groups, placement.start, axisLength]);

  /*
   * Resolved by lookup rather than held as an object, so a selection cannot
   * outlive the event it names. A report is a session document: components are
   * replaced by id as the backend regenerates them, and a stale reference would
   * otherwise keep a panel open on evidence that is no longer in the report.
   */
  const selection = React.useMemo(() => {
    if (selectedId === null) return null;
    const block = nodeBlocks.find(({ item }) =>
      item.members.some((m) => m.event.id === selectedId),
    );
    return block ? { group: block.item, top: block.top } : null;
  }, [selectedId, nodeBlocks]);

  const railHeight = axisLength + timeInset * 2;
  const panelHeight = Math.min(PANEL_MAX_HEIGHT, railHeight);

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

  /*
   * The five absolute layers, built once and then placed into either one stack
   * or two. What each layer SAYS does not depend on whether the axis is frozen;
   * only which stack it lands in does.
   */
  const axisLine = axisStyle ? (
      <YStack
        position="absolute"
        borderColor="$borderColor"
        {...(horizontal
          ? { left: 0, right: 0, top: axisOffset, ...edgeBorders("top") }
          : { top: 0, bottom: 0, left: axisOffset, ...edgeBorders("left") })}
        borderStyle={axisStyle}
      />
    ) : null;

  const tickMarks = ticks.map((tick) => (
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
    ));

  /*
   * One element is both the dot and the interval band. Its length is the
   * event's precision as a share of the domain, floored so a second-precision
   * event stays visible inside a five-year span. A visibly wide band means a
   * vague source — precision you can see.
   */
  const markers = positioned.flatMap((pe) =>
    pe.spans.map((span, spanIndex) => (
      <YStack
        key={`marker-${pe.event.id}-${spanIndex}`}
        position="absolute"
        bg="$blue9"
        o={weigh(PRECISION_EMPHASIS[span.precision], pe.event.id)}
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
  );

  const connectors = groups.map((group) => (
      <GroupConnector
        key={`connector-${group.id}`}
        group={group}
        horizontal={horizontal}
        placement={placement}
        axisEdge={axisEdge}
        laneCenterOf={(lane) => lanePositionOf(lane) + cardLaneExtent / 2}
        sideOf={sideOf}
        defaultStyle={lineVariant}
        highlightId={highlighted}
      />
    ));

  const cards = groups.flatMap((group) =>
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
          tier={tierOf(pe.event.id)}
          interaction={highlightProps(pe.event.id)}
          renderEvent={renderEvent}
          renderOppositeContent={renderOppositeContent}
        />
      )),
    );

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
        ) : frozen ? (
          <XStack alignSelf="stretch" position="relative">
            {/*
              * The rail. Outside the ScrollView, so panning through a cluster
              * never carries the ruler or the running order off the screen —
              * and, when there is no room for cards at all, the whole of what
              * the component shows at rest.
              */}
            <YStack
              position="relative"
              height={axisLength}
              my={timeInset}
              {...(railOnly ? { f: 1 } : { width: RAIL_WIDTH })}
            >
              {axisLine}
              {tickMarks}
              {markers}
              {nodeBlocks.map(({ item: group, top }) => (
                <AxisNode
                  key={`node-${group.id}`}
                  group={group}
                  top={top}
                  fill={railOnly}
                  selectedId={selectedId}
                  highlightId={highlighted}
                  onSelect={railOnly ? setSelectedId : undefined}
                />
              ))}
            </YStack>

            {railOnly ? null : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ minWidth: "100%" }}
              >
                <YStack
                  position="relative"
                  f={1}
                  height={axisLength}
                  minWidth={lanesExtent}
                  my={timeInset}
                >
                  {connectors}
                  {cards}
                </YStack>
              </ScrollView>
            )}

            {selection ? (
              <>
                {/* Press the ruler beside the drawer to dismiss it. */}
                <YStack
                  position="absolute"
                  top={0}
                  left={0}
                  right={0}
                  bottom={0}
                  onPress={() => setSelectedId(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Close detail"
                />
                <XStack
                  position="absolute"
                  left={PANEL_LEFT}
                  right={0}
                  height={panelHeight}
                  top={clamp(
                    selection.top + timeInset - PANEL_RISE,
                    0,
                    railHeight - panelHeight,
                  )}
                >
                  <DetailPanel
                    group={selection.group}
                    selectedId={selectedId}
                    labelUnit={labelUnit}
                    onClose={() => setSelectedId(null)}
                    renderEvent={renderEvent}
                    renderOppositeContent={renderOppositeContent}
                  />
                </XStack>
              </>
            ) : null}
          </XStack>
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
              mx={timeInset}
              minWidth={axisLength}
              height={lanesExtent}
            >
              {axisLine}
              {tickMarks}
              {markers}
              {connectors}
              {cards}
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
  axisEdge,
  laneCenterOf,
  sideOf,
  defaultStyle,
  highlightId,
}: {
  group: EventGroup;
  horizontal: boolean;
  placement: AxisPlacement;
  axisEdge: number;
  laneCenterOf: (lane: number) => number;
  sideOf: (pe: PositionedEvent) => 1 | -1;
  defaultStyle: TimelineProps["lineVariant"];
  highlightId: string | null;
}) {
  const styleOf = (pe: PositionedEvent) =>
    BORDER_STYLE[pe.event.lineVariant ?? defaultStyle ?? LineVariant.Solid];

  /*
   * Which of these parts the lit event actually travels along.
   *
   * **The lit path is the route and no more.** The trunk and the rail are the
   * GROUP's — a routing device several cards share — but only the STRETCH a lit
   * card uses belongs to it: a trunk lit past the card it points at is pointing
   * at the wrong card, and a rail lit end to end for one member claims four
   * other facts' worth of axis. So both are split rather than lit whole, and
   * what is left over falls to the group's own tier instead of the far fade.
   *
   * The arms and the branch are each one event's outright: an arm lands where
   * one period of one fact was recorded, and lighting a sibling's alongside
   * would say the lit card was placed there too.
   *
   * `group.arms` cannot answer that, because it is deduped across the members —
   * two events at the same instant are one arm — so ownership comes from
   * `armsOf`, the same rule the group was built with.
   */
  const litMember = group.members.find((m) => m.event.id === highlightId) ?? null;
  const litArms = litMember === null ? null : new Set(armsOf(litMember));

  /** What this group draws when it is not the lit one, or nothing is. */
  const groupTier: HighlightTier =
    highlightId === null ? "rest" : litMember === null ? "aside" : "related";
  const tierProps = (lit: boolean) => LINE_TIER[lit ? "lit" : groupTier];

  /*
   * A lone event's rail and trunk are wholly its own, so there is nothing to
   * split: it lights end to end. Splitting one anyway would leave a faint tail
   * wherever `armsOf` marks a hairline period by its centre rather than its two
   * edges — an unlit stretch of a bracket belonging to nobody else.
   */
  const solo = group.members.length === 1;

  // The group's own line style is the first member's; per-event variants still
  // apply to that event's own branch below.
  const groupStyle = styleOf(group.members[0]!);
  if (!groupStyle) return null;

  /** Gather only when there is more than one mark, or a mark with width. */
  const gathers = group.arms.length > 1 || group.extentFraction >= MIN_VISIBLE_EXTENT;
  const topLane = Math.min(...group.members.map((m) => m.lane));
  const railAt = axisEdge + BRACKET_DEPTH + topLane * BRACKET_LANE_STEP;
  const trunkFrom = gathers ? railAt : axisEdge;

  const farLaneEdge = OPPOSITE[placement.cross];
  const across = (from: number, size: number) =>
    horizontal ? { top: from, height: size } : { left: from, width: size };

  const deepest = laneCenterOf(group.deepestLane);
  const trunkDepth = deepest - trunkFrom;

  return (
    <>
      {gathers ? (
        <>
          {splitLitRun(
            group.startFraction,
            group.extentFraction,
            litMember === null
              ? null
              : solo
                ? { start: group.startFraction, size: group.extentFraction }
                : litRailSpan(armsOf(litMember), group.centerFraction),
          ).map((piece, index) => (
            <YStack
              // Keyed by position in the run rather than by the lit member, so
              // a pointer crossing a cluster updates these rather than
              // remounting one per step.
              key={`rail-${index}`}
              position="absolute"
              borderStyle={groupStyle}
              {...tierProps(piece.lit)}
              {...across(railAt, 0)}
              {...edgeBorders(farLaneEdge)}
              {...{
                [placement.start]: pct(piece.start),
                [placement.size]: pct(piece.size),
              }}
            />
          ))}
          {group.arms.map((arm) => (
            <YStack
              key={`arm-${arm}`}
              position="absolute"
              borderStyle={groupStyle}
              {...tierProps(litArms?.has(arm) ?? false)}
              {...across(axisEdge, railAt - axisEdge)}
              {...edgeBorders(placement.start)}
              {...{ [placement.start]: pct(arm), [placement.size]: 0 }}
            />
          ))}
        </>
      ) : null}

      {trunkDepth > 0
        ? splitLitRun(
            trunkFrom,
            trunkDepth,
            // The lit stretch stops where the lit card's own branch turns off.
            litMember === null
              ? null
              : { start: trunkFrom, size: laneCenterOf(litMember.lane) - trunkFrom },
          ).map((piece, index) => (
            <YStack
              key={`trunk-${index}`}
              position="absolute"
              borderStyle={groupStyle}
              {...tierProps(piece.lit)}
              {...across(piece.start, piece.size)}
              {...edgeBorders(placement.start)}
              {...{ [placement.start]: pct(group.centerFraction), [placement.size]: 0 }}
            />
          ))
        : null}

      {group.members.map((pe) => {
        const style = styleOf(pe);
        if (!style) return null;
        const side = sideOf(pe);
        return (
          <YStack
            key={`branch-${pe.event.id}`}
            position="absolute"
            borderStyle={style}
            {...tierProps(pe.event.id === highlightId)}
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

/**
 * One group's entry on the frozen rail.
 *
 * The rail's job is to be the whole timeline on its own: every event is listed
 * here, in order, whether or not its card is currently scrolled into view. That
 * is what separates this from the expandable clustering CLAUDE.md rejected —
 * scrolling sideways reveals DETAIL about a fact already named, never the only
 * copy of the fact, so there is no screen-only state an export could lose.
 *
 * Listed per GROUP rather than per event because a group is already one branch
 * point on the axis: the five calls in one afternoon share a mark, and five
 * separate rail entries at the same position would have to lie about where four
 * of them are. Members run in chronological order, matching the order their
 * cards take across the lanes.
 *
 * The bullets sit in the label column, clear of the axis. The claim about WHEN
 * something happened is the band on the axis line to their left; these are list
 * markers, and a block nudged clear of its neighbour has not moved a fact.
 */
function AxisNode({
  group,
  top,
  fill,
  selectedId,
  highlightId,
  onSelect,
}: {
  group: EventGroup;
  top: number;
  /** Spread to the rail's right edge, when no cards sit beside it. */
  fill: boolean;
  selectedId: string | null;
  /**
   * Lit from a card beside the rail. Marked the same way a selection is: the
   * rail is this component's account of the axis, so an event picked out on the
   * axis and the same event picked out on the rail must not disagree about
   * which one it is.
   */
  highlightId: string | null;
  onSelect?: (eventId: string) => void;
}) {
  return (
    <YStack
      position="absolute"
      top={top}
      left={NODE_LABEL_LEFT}
      {...(fill ? { right: 0 } : { width: NODE_LABEL_WIDTH })}
    >
      {group.members.map((pe) => {
        const selected = pe.event.id === selectedId || pe.event.id === highlightId;
        return (
          <XStack
            key={`node-row-${pe.event.id}`}
            height={NODE_LINE}
            gap={5}
            ai="center"
            {...(onSelect
              ? {
                  onPress: () => onSelect(pe.event.id),
                  // Widens the touch target past the row without widening the
                  // row, which block placement is arithmetic on.
                  hitSlop: NODE_HIT_SLOP,
                  cursor: "pointer",
                  hoverStyle: { o: 1 },
                  pressStyle: { o: 0.6 },
                  accessibilityRole: "button",
                  accessibilityLabel: `${pe.event.title} — open detail`,
                }
              : null)}
          >
            <YStack
              width={4}
              height={4}
              borderRadius={2}
              bg="$blue9"
              o={selected ? 1 : 0.8}
            />
            <Text
              fontSize="$1"
              o={selected ? 1 : 0.85}
              fontWeight={selected ? "600" : undefined}
              numberOfLines={1}
              f={1}
            >
              {pe.event.title}
            </Text>
          </XStack>
        );
      })}
    </YStack>
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
  tier,
  interaction,
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
  /** How much the pointer is currently speaking for this card. */
  tier: HighlightTier;
  /** Absent on a static medium, where there is nothing to hover or press. */
  interaction: Record<string, unknown> | null;
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
      // Colour and opacity only. The border keeps its width, so a lit card
      // occupies exactly the box it occupied a moment ago — lane packing is
      // arithmetic done before any of this, and a card that grew on hover would
      // overprint the neighbour the packing had cleared it of.
      //
      // The same colour as its leader and its band, because the three of them
      // are one claim and the point of lighting them is to say so.
      {...(tier === "lit" ? { borderColor: LIT_LINE } : null)}
      {...(HIGHLIGHT_WEIGHT[tier] === 1 ? null : { o: HIGHLIGHT_WEIGHT[tier] })}
      {...interaction}
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
