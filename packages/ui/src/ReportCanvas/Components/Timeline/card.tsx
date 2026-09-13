import * as React from "react";
import { Text } from "tamagui";
import {
  formatTimestamp,
  labelPrecision,
  type TimelineEventSpec,
  type UnitOfTime,
} from "@repo/report-schema";

/**
 * The event card, shared by both scales.
 *
 * Extracted rather than written twice on purpose: `ordinal` and `time` differ
 * only in where a card is PUT, never in what one says. Two copies of this would
 * drift, and the same report would then read differently depending on a `scale`
 * value that is supposed to control position alone.
 */

/**
 * The card box.
 *
 * Its extent is a FIXED number, not whatever the content happens to need. The
 * time scale positions lanes arithmetically with nothing measured, so it has to
 * know how much room a card takes before it draws one — a card that grew a line
 * taller than its lane would silently overprint the lane below. The height is
 * the capped worst case: a two-line date, a two-line title, a two-line subtitle.
 * Content beyond that clips, which is already true of the `numberOfLines` caps.
 */
export const CARD_WIDTH = 168;
export const CARD_HEIGHT = 126;

/** Between the periods of one fact. Not a range — these are separate spans. */
const PERIOD_SEPARATOR = " · ";
/** Within one period that has a recorded end. */
const RANGE_SEPARATOR = " – ";

/**
 * Every period a fact covers, written out.
 *
 * The axis shows these as bands, but the card has to state them too: the
 * `ordinal` scale has no proportional axis to show them on, and an exported PDF
 * has to carry the fact without the reader inferring it from a picture.
 *
 * `labelPrecision` clamps `labelUnit` against each period's own precision, so
 * every part of this string is bounded by what its source actually established.
 * A spec asking for minutes on a month-precision period cannot make this print
 * a midnight no document stated.
 */
export function formatEventPeriods(
  event: Pick<TimelineEventSpec, "timestamp" | "precision" | "until" | "untilPrecision"> & {
    spans?: TimelineEventSpec["spans"];
  },
  labelUnit?: UnitOfTime,
  locale?: string,
): string {
  return [event, ...(event.spans ?? [])]
    .map((span) => formatPeriod(span, labelUnit, locale))
    .join(PERIOD_SEPARATOR);
}

/** One period of a fact, written out. */
export function formatPeriod(
  span: {
    timestamp: string;
    precision?: TimelineEventSpec["precision"];
    until?: string;
    untilPrecision?: TimelineEventSpec["precision"];
  },
  labelUnit?: UnitOfTime,
  locale?: string,
): string {
  const from = formatTimestamp(
    span.timestamp,
    labelPrecision(span.timestamp, span.precision, labelUnit),
    locale,
  );
  if (!span.until) return from;
  const to = formatTimestamp(
    span.until,
    labelPrecision(span.until, span.untilPrecision, labelUnit),
    locale,
  );
  return `${from}${RANGE_SEPARATOR}${to}`;
}

export interface EventCardBodyProps {
  event: TimelineEventSpec;
  index: number;
  labelUnit?: UnitOfTime;
  /**
   * Drop the line caps.
   *
   * The card box clips because its extent has to be known before it is drawn.
   * Somewhere that constraint does not apply — a panel that sizes to its own
   * content — the same body can say the whole of what it knows, and a title cut
   * short on the axis is readable in full.
   */
  expanded?: boolean;
  renderEvent?: (event: TimelineEventSpec, index: number) => React.ReactNode;
  renderOppositeContent?: (event: TimelineEventSpec, index: number) => React.ReactNode;
}

/** What a card says. Where it goes is each scale's own business. */
export function EventCardBody({
  event,
  index,
  labelUnit,
  expanded,
  renderEvent,
  renderOppositeContent,
}: EventCardBodyProps) {
  if (renderEvent) return <>{renderEvent(event, index)}</>;
  const lines = expanded ? undefined : 2;
  return (
    <>
      <Text fontSize="$1" o={0.6} numberOfLines={lines}>
        {formatEventPeriods(event, labelUnit)}
      </Text>
      <Text fontWeight="600" fontSize="$2" numberOfLines={lines}>
        {event.title}
      </Text>
      {event.subtitle ? (
        <Text fontSize="$1" o={0.8} numberOfLines={lines}>
          {event.subtitle}
        </Text>
      ) : null}
      {renderOppositeContent?.(event, index)}
    </>
  );
}

/** The card's chrome, so both scales frame their content identically. */
export const cardChrome = {
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  overflow: "hidden",
  gap: "$1",
  p: "$2",
  bg: "$background",
  borderWidth: 1,
  borderColor: "$borderColor",
  borderRadius: "$3",
} as const;

/** Header shared by both scales: the component's own title and blurb. */
export function TimelineHeader({
  title,
  subtitle,
  description,
}: {
  title: string;
  subtitle?: string;
  description?: string;
}) {
  return (
    <>
      <Text fontWeight="700" fontSize="$5">
        {title}
      </Text>
      {subtitle ? (
        <Text fontSize="$2" o={0.7}>
          {subtitle}
        </Text>
      ) : null}
      {description ? (
        <Text fontSize="$2" o={0.7}>
          {description}
        </Text>
      ) : null}
    </>
  );
}

/** Shown when a timeline carries no events at all. */
export function EmptyTimeline() {
  return (
    // An empty timeline is valid data, not a render failure — an error card
    // here would blame the renderer for a gap in the evidence.
    <Text fontSize="$2" o={0.6} py="$3">
      No events.
    </Text>
  );
}

/** Tamagui takes a border style directly; `none` means draw nothing at all. */
export const BORDER_STYLE = {
  solid: "solid",
  dashed: "dashed",
  dotted: "dotted",
  none: null,
} as const satisfies Record<string, "solid" | "dashed" | "dotted" | null>;

/** Marker size, shared so an event's mark is the same size on both scales. */
export const MARKER_THICKNESS = 8;
