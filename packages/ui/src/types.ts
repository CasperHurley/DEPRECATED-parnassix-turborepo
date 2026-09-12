import { GestureResponderEvent, NativeMouseEvent } from 'react-native';
import { FocusEvent, MouseEvent } from 'react';
import type { ReportSpec } from '@repo/report-schema';

/**
 * Renderer-side types.
 *
 * The wire contract — everything an agent emits and everything that crosses a
 * wire — lives in @repo/report-schema. What stays here is the React/Tamagui
 * half: event handlers, ReactNode slots, and anything typed against
 * react-native. None of that is serializable, which is exactly why the two
 * layers are separate. See CLAUDE.md ("Two type layers, kept separate").
 *
 * The pattern for any component is:
 *
 *   type FooProps = FooSpec & TamaguiComponentProps & { children?: ReactNode }
 */

export interface TamaguiComponentProps {
    // DOCS: https://tamagui.dev/docs/intro/props
    onPress?: (e: GestureResponderEvent) => void;
    onPressIn?: (e: GestureResponderEvent) => void;
    onPressOut?: (e: GestureResponderEvent) => void;
    onLongPress?: (e: GestureResponderEvent) => void;
    onHoverIn?: (e: MouseEvent | NativeMouseEvent) => void;
    onHoverOut?: (e: MouseEvent | NativeMouseEvent) => void;
    onFocus?: (e: FocusEvent) => void;
    onBlur?: (e: FocusEvent) => void;
    delayPressIn?: number;
    delayPressOut?: number;
    delayLongPress?: number;
    minPressDuration?: number;
    cancelable?: boolean;
    disabled?: boolean;
    focusable?: boolean;
    hitSlop?: number | Insets;
}

export type Insets = {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
};

export type ReportCanvasProps = {
    /**
     * The report to render. Typed as the wire spec because that is exactly what
     * arrives from the API — the canvas revalidates it rather than trusting the
     * type, since a compile-time type proves nothing about a network payload.
     */
    report: ReportSpec;
} & TamaguiComponentProps;
