import * as React from "react";
import { ScrollView, Text, XStack, YStack } from "tamagui";
import type { SourceRef, TimelineEventSpec, UnitOfTime } from "@repo/report-schema";
import { EventCardBody, formatPeriod } from "./card";
import type { EventGroup } from "./axis";

/**
 * The detail drawer a rail node opens.
 *
 * A drawer rather than a card that pops up beside the node, because of what it
 * has to hold. An event's detail is the small part: the substance is its
 * PROVENANCE — which document, which page, the quoted line, and eventually the
 * page image with the region highlighted. That is a reading surface, and a
 * reading surface needs the width of the component and a fixed edge to open
 * against.
 *
 * It opens against the axis and runs to the far edge, so the ruler and its tick
 * labels stay visible the whole time the drawer is open. Reading a citation
 * without being able to see when the thing happened would throw away the reason
 * the axis was frozen in the first place.
 *
 * Screen only. See `resolveTimelineDetail` — on paper every card is drawn and
 * nothing here is reachable by pressing, because paper cannot be pressed.
 */

/** One period of a fact, and whatever backs it. */
export interface PeriodSource {
  period: string;
  source?: SourceRef;
}

/**
 * Every period of a fact paired with its own source, INCLUDING the periods
 * nothing backs.
 *
 * Returning only the sources that exist would let a fact claiming three periods
 * show two citations and read as fully sourced. Which period is unbacked is the
 * thing a reader has to be able to see, so the pairing has to survive to the UI
 * rather than being filtered out on the way.
 */
export function periodSourcesOf(
  event: TimelineEventSpec,
  labelUnit?: UnitOfTime,
  locale?: string,
): PeriodSource[] {
  return [event, ...(event.spans ?? [])].map((span) => ({
    period: formatPeriod(span, labelUnit, locale),
    source: span.source,
  }));
}

export function DetailPanel({
  group,
  selectedId,
  labelUnit,
  onClose,
  renderEvent,
  renderOppositeContent,
}: {
  group: EventGroup;
  selectedId: string | null;
  labelUnit?: UnitOfTime;
  onClose: () => void;
  renderEvent?: (event: TimelineEventSpec, index: number) => React.ReactNode;
  renderOppositeContent?: (event: TimelineEventSpec, index: number) => React.ReactNode;
}) {
  return (
    <YStack
      f={1}
      bg="$background"
      borderLeftWidth={1}
      borderColor="$borderColor"
      overflow="hidden"
      // Square against the axis, rounded away from it: it reads as a surface
      // slid out from behind the ruler rather than a card floating over it.
      borderTopRightRadius="$4"
      borderBottomRightRadius="$4"
    >
      <XStack
        ai="center"
        jc="space-between"
        gap="$2"
        px="$3"
        py="$2"
        borderBottomWidth={1}
        borderColor="$borderColor"
      >
        <Text fontSize="$1" o={0.6} numberOfLines={1} f={1}>
          {group.members.length === 1
            ? "1 event"
            : `${group.members.length} events at this point`}
        </Text>
        <XStack
          onPress={onClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          cursor="pointer"
          pressStyle={{ o: 0.6 }}
          accessibilityRole="button"
          accessibilityLabel="Close detail"
        >
          <Text fontSize="$3" o={0.7}>
            ✕
          </Text>
        </XStack>
      </XStack>

      <ScrollView showsVerticalScrollIndicator={false}>
        <YStack gap="$3" p="$3">
          {group.members.map((pe) => (
            <YStack
              key={`detail-${pe.event.id}`}
              gap="$2"
              p="$2"
              borderRadius="$3"
              borderWidth={1}
              borderColor={pe.event.id === selectedId ? "$blue8" : "$borderColor"}
            >
              <YStack gap="$1">
                <EventCardBody
                  event={pe.event}
                  index={pe.index}
                  labelUnit={labelUnit}
                  expanded
                  renderEvent={renderEvent}
                  renderOppositeContent={renderOppositeContent}
                />
              </YStack>
              <Sources event={pe.event} labelUnit={labelUnit} />
            </YStack>
          ))}
        </YStack>
      </ScrollView>
    </YStack>
  );
}

/**
 * Where each period of a fact came from — or, loudly, that nobody recorded.
 *
 * The absence is stated rather than omitted. This tool exists so that a lawyer
 * cannot cite a case that does not exist, and a fact with no resolvable source
 * that renders as an ordinary fact is exactly how that happens. So the gap is
 * printed where the citation would have been.
 *
 * Per PERIOD, not per fact: "payments were made in March, July and November"
 * backed by two ledger pages is two thirds of a claim, and listing its two
 * citations without saying which period they cover reads as the whole of it.
 */
function Sources({ event, labelUnit }: { event: TimelineEventSpec; labelUnit?: UnitOfTime }) {
  const periods = periodSourcesOf(event, labelUnit);
  /** With one period, the card body above already states it. */
  const namePeriods = periods.length > 1;

  return (
    <YStack gap="$2">
      {periods.map(({ period, source }, index) => (
        <YStack
          key={`${period}-${index}`}
          gap={3}
          pl="$2"
          borderLeftWidth={2}
          borderColor={source ? "$blue8" : "$borderColor"}
        >
          {namePeriods ? (
            <Text fontSize="$1" o={0.6} numberOfLines={1}>
              {period}
            </Text>
          ) : null}

          {source ? (
            <>
              <Text fontSize="$1" o={0.75} numberOfLines={1}>
                {source.documentId} · p.{source.page}
              </Text>
              {source.quotedText ? (
                <Text fontSize="$1" o={0.9}>
                  “{source.quotedText}”
                </Text>
              ) : null}
              {/*
               * The region is carried but not yet drawn. Rendering it needs the
               * page image and, for a BOTTOMLEFT box, `pageSize.height` to flip
               * it into the renderer's TOPLEFT space — which is why the contract
               * carries both. Saying the highlight EXISTS is still worth
               * something: it is the difference between a citation that can be
               * checked and a string.
               */}
              {source.bbox.length > 0 ? (
                <Text fontSize="$1" o={0.5}>
                  {source.bbox.length === 1
                    ? "1 highlighted region"
                    : `${source.bbox.length} highlighted regions`}
                  {source.pageSize ? "" : " — page size missing"}
                </Text>
              ) : null}
            </>
          ) : (
            <Text fontSize="$1" o={0.55} fontStyle="italic">
              No source recorded
            </Text>
          )}
        </YStack>
      ))}
    </YStack>
  );
}
