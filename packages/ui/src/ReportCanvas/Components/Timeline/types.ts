import React from 'react';
import type { TimelineEventSpec, TimelineSpec, UnitOfTime } from '@repo/report-schema';
import { TimelineDirection } from '@repo/report-schema';
import { TamaguiComponentProps } from '@/types';

/**
 * Renderer-side Timeline types.
 *
 * The wire half (TimelineSpec, TimelineEventSpec, UnitOfTime, TimelineDirection,
 * TimelineScale) lives in @repo/report-schema. What is added here is strictly
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
 * Maps the contract's semantic direction onto a flex direction.
 *
 * This mapping is why the wire values are semantic: an agent chooses "the
 * timeline runs forward", not "row-reverse". Swapping layout engines changes
 * this table and nothing else.
 */
export const DIRECTION_TO_FLEX: Record<
    TimelineDirection,
    'row' | 'row-reverse' | 'column' | 'column-reverse'
> = {
    [TimelineDirection.Forward]: 'row',
    [TimelineDirection.Backward]: 'row-reverse',
    [TimelineDirection.Down]: 'column',
    [TimelineDirection.Up]: 'column-reverse',
};

export const TimeFormatterMap: Record<UnitOfTime, Intl.DateTimeFormatOptions> = {
  second: { second: 'numeric' },
  minute: { minute: 'numeric', second: 'numeric' },
  hour:   { hour: 'numeric', minute: '2-digit' },
  day:    { day: 'numeric' },
  week:   { weekday: 'long' },
  month:  { month: 'short' }, // "Jan", "Feb", etc.
  year:   { year: 'numeric' }
};

// Usage Example:
// const options = TimeFormatterMap[UnitOfTime.Month];
// new Intl.DateTimeFormat('en-US', options).format(new Date()); -> "Oct"

export interface DateMethods {
  getter: keyof Date;
  setter: keyof Date;
}

export const DateMethodMap: Record<Exclude<UnitOfTime, 'week'>, DateMethods> = {
  second: { getter: 'getSeconds', setter: 'setSeconds' },
  minute: { getter: 'getMinutes', setter: 'setMinutes' },
  hour:   { getter: 'getHours',    setter: 'setHours' },
  day:    { getter: 'getDate',    setter: 'setDate' },    // Note: 'getDate' is day-of-month
  month:  { getter: 'getMonth',   setter: 'setMonth' },
  year:   { getter: 'getFullYear',setter: 'setFullYear' },
};
