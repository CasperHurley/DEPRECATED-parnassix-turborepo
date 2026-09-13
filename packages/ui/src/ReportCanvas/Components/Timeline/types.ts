import React from 'react';
import type {
    TimelineEventSpec,
    TimelineOrder,
    TimelineOrientation,
    TimelineSpec,
} from '@repo/report-schema';
import { TimelineOrder as Order, TimelineOrientation as Orientation } from '@repo/report-schema';
import { TamaguiComponentProps } from '../../../types';
import { CARD_WIDTH } from './card';

/**
 * Renderer-side Timeline types.
 *
 * The wire half (TimelineSpec, TimelineEventSpec, UnitOfTime, TimelineOrientation,
 * TimelineOrder, TimelineScale) lives in @repo/report-schema. What is added here is strictly
 * what cannot cross a wire: handlers and ReactNode slots.
 */

export type TimelineProps = TimelineSpec &
    TamaguiComponentProps & {
        /**
         * Per-event content on the opposite side of the axis.
         *
         * A render prop rather than a field on the event, because events arrive
         * from the wire where a ReactNode cannot travel. The spec carries the
         * data; the renderer supplies the node. (The old per-event
         * `oppositeContent` field could never have survived serialization.)
         */
        renderOppositeContent?: (event: TimelineEventSpec, index: number) => React.ReactNode;
        /** Replace a single event's default layout. */
        renderEvent?: (event: TimelineEventSpec, index: number) => React.ReactNode;
        /** Override the default layout entirely. */
        children?: React.ReactNode;
    };

export type TimelineEventProps = TimelineEventSpec &
    TamaguiComponentProps & {
        /** Renders on the opposite side of the central axis. */
        oppositeContent?: React.ReactNode;
        /** Override default layout. */
        children?: React.ReactNode;
    };

/**
 * Maps the contract's semantic axis onto a flex direction.
 *
 * This table is why the wire values are semantic: an agent chooses a horizontal
 * axis running earliest-first, not `row`. Swapping layout engines changes these
 * four entries and nothing else.
 */
export const LAYOUT_TO_FLEX: Record<
    TimelineOrientation,
    Record<TimelineOrder, 'row' | 'row-reverse' | 'column' | 'column-reverse'>
> = {
    [Orientation.Horizontal]: {
        [Order.Ascending]: 'row',
        [Order.Descending]: 'row-reverse',
    },
    [Orientation.Vertical]: {
        [Order.Ascending]: 'column',
        [Order.Descending]: 'column-reverse',
    },
};

/**
 * The narrowest box a horizontal axis is worth drawing in.
 *
 * Derived from the card rather than chosen as a breakpoint. Below three cards
 * side by side a horizontal timeline shows barely one event at a time, and every
 * comparison between two of them costs a sideways scroll. A vertical axis spends
 * the page's OWN scroll on time instead, which is the direction a phone has to
 * give.
 */
export const HORIZONTAL_MIN_WIDTH = 3 * CARD_WIDTH;

/**
 * The axis the spec asks for, narrowed to what the box can actually show.
 *
 * One-directional on purpose: a specified `vertical` is never widened back to
 * horizontal. Fitting a horizontal axis into a narrow box is a decision only the
 * renderer can make, because only the renderer knows the box — but a vertical
 * axis already fits every box, so overriding one would be the renderer
 * second-guessing the agent for no reason.
 *
 * An unmeasured box (width 0) keeps the spec. Guessing an orientation for one
 * frame and flipping on the next is worse than starting where the spec asked.
 */
export function resolveTimelineOrientation(
    specified: TimelineOrientation,
    boxWidth: number,
): TimelineOrientation {
    if (specified === Orientation.Vertical || boxWidth === 0) return specified;
    return boxWidth < HORIZONTAL_MIN_WIDTH ? Orientation.Vertical : specified;
}

/**
 * How a vertical timeline gives up an event's detail.
 *
 * `cards` draws every event beside the axis, which is what the horizontal scale
 * always does. `panel` draws the rail alone and opens the detail when a node is
 * pressed — the right answer in a box too narrow to hold a card next to the
 * rail, where `cards` can only be reached by scrolling sideways through them.
 *
 * A STATIC medium never gets `panel`, however narrow it is. A panel that opens
 * on a press is exactly the interaction CLAUDE.md rules out as the ONLY route to
 * a fact — the rule that rejected hover-only citation and expandable clustering
 * — and paper cannot be pressed. On export every card is drawn.
 */
export function resolveTimelineDetail(
    orientation: TimelineOrientation,
    boxWidth: number,
    isStatic: boolean,
    railWidth: number,
): 'cards' | 'panel' {
    if (orientation === Orientation.Horizontal || isStatic) return 'cards';
    // An unmeasured box keeps the fuller layout: showing everything and
    // scrolling is a worse UI than the panel, but it is never a LESS complete
    // one, so it is the safe thing to render before the box is known.
    if (boxWidth === 0) return 'cards';
    return boxWidth < railWidth + CARD_WIDTH + CONNECTOR_GAP_FOR_DETAIL ? 'panel' : 'cards';
}

/** Clear air a card needs beside the rail before it is worth drawing one. */
const CONNECTOR_GAP_FOR_DETAIL = 14;

/**
 * How much of a component the pointer is currently speaking for.
 *
 * Two tiers were not enough. With only "the lit event" and "everything else", a
 * sibling three milliseconds away faded exactly like an event eight months
 * away — and a cluster exists precisely to say those things happened at the
 * same moment, so flattening them throws away the thing the grouping states.
 *
 * `rest` and `lit` are separate even though they share a weight: `lit` also
 * takes the marker's colour on a card's border, and `rest` must not.
 */
export type HighlightTier = 'rest' | 'lit' | 'related' | 'aside';

/**
 * Multiplier on a part's OWN opacity. **Never above 1.**
 *
 * A marker's opacity is evidence — `PRECISION_EMPHASIS` says how much its
 * source knew — so a highlight may only ever fade one, never strengthen it.
 * Every tier being a fraction is what keeps that true no matter which tier a
 * band lands in: `related` is a SMALLER fade than `aside`, not an increase.
 * Pinned by a test, because "make the highlight pop" is exactly the change that
 * would quietly break it.
 */
export const HIGHLIGHT_WEIGHT: Record<HighlightTier, number> = {
    rest: 1,
    lit: 1,
    related: 0.6,
    aside: 0.3,
};

/** Which tier an event falls in, given what is lit and what shares its group. */
export function highlightTier(
    eventId: string,
    highlightedId: string | null,
    relatedIds: ReadonlySet<string> | null,
): HighlightTier {
    if (highlightedId === null) return 'rest';
    if (eventId === highlightedId) return 'lit';
    return relatedIds?.has(eventId) ? 'related' : 'aside';
}
