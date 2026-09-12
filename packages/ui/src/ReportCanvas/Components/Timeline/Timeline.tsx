import React from "react";
import {
    DIRECTION_TO_FLEX,
    TimelineEventProps,
    TimelineProps,
} from '@/ReportCanvas/Components/Timeline/types'
import { Section, XStack, YStack, Text } from "tamagui";

export function Timeline({
    events,
    direction,
    renderEvent,
    renderOppositeContent,
    children,
}: TimelineProps) {
    if (children) return <Section>{children}</Section>;

    return (
        <Section>
            <XStack flexDirection={DIRECTION_TO_FLEX[direction]} jc="space-between">
                {events.map((event, index) => (
                    <React.Fragment key={event.id}>
                        {renderEvent?.(event, index) ?? (
                            <TimelineEvent
                                {...event}
                                oppositeContent={renderOppositeContent?.(event, index)}
                            />
                        )}
                    </React.Fragment>
                ))}
            </XStack>
        </Section>
    );
}

export const TimelineEvent: React.FC<TimelineEventProps> = (props) => {
    return (
        <YStack>
            <Text>{props.title}</Text>
            <Text>{props.subtitle}</Text>
            <Text>{props.description}</Text>
        </YStack>
    )
}
