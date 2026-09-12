import { GestureResponderEvent, NativeMouseEvent } from 'react-native';
import { FocusEvent, MouseEvent } from 'react';

export interface ReportCanvasProps {
    data: ReportCanvasData;
    components: ComponentProps[];
}

export interface ReportCanvasData {

}

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

export interface ComponentProps extends TamaguiComponentProps {
    id: string;
}