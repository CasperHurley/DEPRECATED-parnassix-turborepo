import React from 'react';
import { ComponentProps } from '@/types';

export interface TimelineComponentProps extends ComponentProps {
    id: string;
    title: string;
    subtitle?: string;
    description?: string;
    unitOfTime: UnitOfTime;
    direction: TimelineDirection;
    lineVariant?: LineVariant;
    events: TimelineEventProps[];
}

type Timestamp = Date | string;
type LineVariant = 'solid' | 'dashed' | 'dotted' | 'none';

export interface TimelineEventProps {
    timestamp: Timestamp;
    title: string;
    subtitle?: string;
    description?: string;
    lineVariant?: LineVariant;
    oppositeContent?: React.ReactNode; // Renders on the opposite side of the central axis 
    children?: React.ReactNode; // Override default layout
    // onClick?: (id: string | number) => void;
}

export enum UnitOfTime {
    Second = 'second',
    Minute = 'minute',
    Hour = 'hour',
    Day = 'day',
    Week = 'week',
    Month = 'month',
    Year = 'year'
}

export const TimeFormatterMap: Record<UnitOfTime, Intl.DateTimeFormatOptions> = {
  [UnitOfTime.Second]: { second: 'numeric' },
  [UnitOfTime.Minute]: { minute: 'numeric', second: 'numeric' },
  [UnitOfTime.Hour]:   { hour: 'numeric', minute: '2-digit' },
  [UnitOfTime.Day]:    { day: 'numeric' },
  [UnitOfTime.Week]:   { weekday: 'long' }, 
  [UnitOfTime.Month]:  { month: 'short' }, // "Jan", "Feb", etc.
  [UnitOfTime.Year]:   { year: 'numeric' }
};

// Usage Example: 
// const options = TimeFormatterMap[UnitOfTime.Month];
// new Intl.DateTimeFormat('en-US', options).format(new Date()); -> "Oct"

export interface DateMethods {
  getter: keyof Date;
  setter: keyof Date;
}

export const DateMethodMap: Record<Exclude<UnitOfTime, UnitOfTime.Week>, DateMethods> = {
  [UnitOfTime.Second]: { getter: 'getSeconds', setter: 'setSeconds' },
  [UnitOfTime.Minute]: { getter: 'getMinutes', setter: 'setMinutes' },
  [UnitOfTime.Hour]:   { getter: 'getHours',    setter: 'setHours' },
  [UnitOfTime.Day]:    { getter: 'getDate',    setter: 'setDate' },    // Note: 'getDate' is day-of-month
  [UnitOfTime.Month]:  { getter: 'getMonth',   setter: 'setMonth' },
  [UnitOfTime.Year]:   { getter: 'getFullYear',setter: 'setFullYear' },
};

export enum TimelineDirection {
    FORWARD = "row",
    BACKWARD = "row-reverse",
    DOWN = "column",
    UP = "column-reverse"
}