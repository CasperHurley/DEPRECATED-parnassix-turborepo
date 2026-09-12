import * as React from "react";
import { Text, YStack } from "tamagui";

/**
 * Stands in for a component that could not be rendered.
 *
 * The rule this exists to enforce: an invalid component renders an error card,
 * it never blanks the report. A user reading a report mid-walkthrough should
 * lose one panel, not the whole document. See CLAUDE.md.
 */
export function ComponentErrorCard({
    componentId,
    reason,
}: {
    componentId?: string;
    reason?: string;
}) {
    return (
        <YStack
            bg="$red2"
            borderColor="$red7"
            borderWidth={1}
            borderRadius="$4"
            p="$3"
            gap="$1"
        >
            <Text color="$red11" fontWeight="600">
                This component could not be displayed
            </Text>
            {componentId ? (
                <Text color="$red10" fontSize="$2">
                    id: {componentId}
                </Text>
            ) : null}
            {reason ? (
                <Text color="$red10" fontSize="$2">
                    {reason}
                </Text>
            ) : null}
        </YStack>
    );
}
