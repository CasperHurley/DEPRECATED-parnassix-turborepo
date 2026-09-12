import React from 'react';
import type {
    TimelineEventSpec,
    TimelineOrder,
    TimelineOrientation,
    TimelineSpec,
} from '@repo/report-schema';
import { TimelineOrder as Order, TimelineOrientation as Orientation } from '@repo/report-schema';
import { TamaguiComponentProps } from '../../../types';

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

/*
 * `TimeFormatterMap` moved to `axis.ts`, and `DateMethodMap` was removed.
 *
 * The formatter map is axis-labelling policy and belongs with the rest of it,
 * in a module that imports no React so it can be unit-tested. `DateMethodMap`
 * had no call sites and was a trap: its getters and setters (`getHours`,
 * `getDate`, …) read the VIEWER's zone, so building tick boundaries out of them
 * would have moved events across day boundaries — the failure `formatTimestamp`
 * exists to prevent. It also could not express `week`, which the tick ladder
 * needs. `floorToUnit` and `addUnits` in `@repo/report-schema` do that job with
 * an explicit offset instead.
 */
