import React, { useState } from "react";
import { TimelineComponentProps, TimelineEventProps, UnitOfTime, TimelineDirection } from '@/ReportCanvas/Components/Timeline/types'
import { Section, XStack, YStack, Text } from "tamagui";

export function Timeline() {

    const timelineEventsMock: TimelineEventProps[] = [
        {
            timestamp: "2023-01-01",
            title: "Event 1",
            subtitle: "Subtitle 1",
            description: "Description 1",
            lineVariant: "solid",
            oppositeContent: "Opposite Content 1",
        },
        {
            timestamp: "2023-02-01",
            title: "Event 2",
            subtitle: "Subtitle 2",
            description: "Description 2",
            lineVariant: "dashed",
            oppositeContent: "Opposite Content 2",
        },
        {
            timestamp: "2023-03-01",
            title: "Event 3",
            subtitle: "Subtitle 3",
            description: "Description 3",
            lineVariant: "dotted",
            oppositeContent: "Opposite Content 3",
        },
    ];
    const [componentProps, setComponentProps] = useState<TimelineComponentProps>({
        id: "timeline1",
        title: "Timeline One",
        subtitle: "",
        description: "",
        unitOfTime: UnitOfTime.Year,
        direction: TimelineDirection.FORWARD,
        events: timelineEventsMock,
    })
    const [timelineData, setTimelineData] = useState({})

    return (
        <Section>
            <XStack flexDirection={componentProps.direction} jc="space-between">
                {componentProps.events.map((event, index) => (
                    <TimelineEvent key={index} {...event} />
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