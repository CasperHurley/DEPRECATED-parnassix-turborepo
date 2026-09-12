import {
    SCHEMA_VERSION,
    TimelineOrder,
    TimelineOrientation,
    TimelineScale,
    type ReportSpec,
} from "@repo/report-schema";

/**
 * Placeholder report, previously inlined in Timeline's own useState.
 *
 * It lives here so the component is driven by props the way a real report will
 * be — a component that fabricates its own data exercises none of the contract
 * this package exists to enforce. Replace with an API response once the
 * backend serves one.
 */
export const mockReport: ReportSpec = {
    schemaVersion: SCHEMA_VERSION,
    data: {},
    components: [
        {
            kind: "timeline",
            id: "timeline1",
            title: "Timeline One",
            subtitle: "",
            description: "",
            scale: TimelineScale.Ordinal,
            orientation: TimelineOrientation.Horizontal,
            order: TimelineOrder.Ascending,
            labelUnit: "year",
            events: [
                {
                    id: "timeline1-event1",
                    timestamp: "2023-01-01",
                    title: "Event 1",
                    subtitle: "Subtitle 1",
                    description: "Description 1",
                    lineVariant: "solid",
                },
                {
                    id: "timeline1-event2",
                    timestamp: "2023-02-01",
                    title: "Event 2",
                    subtitle: "Subtitle 2",
                    description: "Description 2",
                    lineVariant: "dashed",
                },
                {
                    id: "timeline1-event3",
                    timestamp: "2023-03-01",
                    title: "Event 3",
                    subtitle: "Subtitle 3",
                    description: "Description 3",
                    lineVariant: "dotted",
                },
            ],
        },
    ],
};
