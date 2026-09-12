import {
    SCHEMA_VERSION,
    TimePrecision,
    TimelineOrder,
    TimelineOrientation,
    TimelineScale,
    type ReportSpecInput,
    type TimelineSpecInput,
} from "@repo/report-schema";

/**
 * The time scale's fixture: CLAUDE.md's sentence made literal.
 *
 * "Nothing for eight months, then five things in seventy-two hours" is the
 * argument the `time` scale exists to make, so the data has to contain it — the
 * ordinal fixture above would render this identically to any other three
 * events, which is exactly the failure worth seeing on screen.
 *
 * Every hard case is represented deliberately:
 *  - vague sources (`month`, `year`, `hour` precision) whose bands are visibly
 *    wider than the timestamped events, so precision reads off the screen;
 *  - two events minutes apart carrying DIFFERENT offsets, which forces the axis
 *    into its mixed-zone fallback and the cluster into lanes;
 *  - one event listed OUT of chronological order, so any regression that sorts
 *    or positions by array index is immediately visible;
 *  - one event carrying a SourceRef, exercising per-fact provenance.
 *
 * It deliberately contains no undated event: this is typed `ReportSpec`, so an
 * unreadable timestamp fails `safeParse` at the canvas and produces an error
 * card before the timeline ever sees it. The undated path is unit-tested in
 * `test/axis.test.ts` instead — please do not "fix" this by adding one here.
 */
export const mockTimeScaleTimeline: TimelineSpecInput = {
    kind: "timeline",
    id: "timeline-time",
    title: "Timeline Two",
    subtitle: "Proportional to time — the gaps are the evidence",
    description: "",
    scale: TimelineScale.Time,
    orientation: TimelineOrientation.Horizontal,
    order: TimelineOrder.Ascending,
    lineVariant: "solid",
    events: [
        {
            id: "retainer",
            timestamp: "2018-11-01",
            precision: TimePrecision.Month,
            title: "Retainer signed",
            subtitle: "Source says only \u201cNovember 2018\u201d",
            lineVariant: "dashed",
        },
        {
            id: "filing",
            timestamp: "2019-03-14",
            title: "Filing lodged",
            subtitle: "Then nothing for eight months",
        },
        {
            id: "call-1",
            timestamp: "2019-07-15T09:12:00Z",
            title: "First call",
        },
        {
            id: "call-2",
            timestamp: "2019-07-15T11:40:00+01:00",
            title: "Second call",
            subtitle: "Logged in a different jurisdiction",
        },
        {
            id: "wire",
            timestamp: "2019-07-16T02:05:00Z",
            precision: TimePrecision.Hour,
            title: "Wire transfer",
            subtitle: "Statement says only \u201caround 2am\u201d",
            lineVariant: "dotted",
        },
        {
            id: "memo",
            timestamp: "2019-07-17T14:00:00Z",
            title: "Internal memo",
            source: {
                documentId: "doc-memo-0031",
                nodeId: "node-8f21",
                page: 4,
                bbox: [{ l: 72, t: 512, r: 468, b: 486 }],
                coordOrigin: "bottomleft",
                pageSize: { width: 612, height: 792 },
                quotedText: "as discussed on the 16th",
            },
        },
        {
            id: "signature",
            timestamp: "2019-07-18T08:30:00Z",
            title: "Counter-signature",
        },
        {
            // One fact, three periods. Without `spans` this would have to be
            // emitted as three separate events, which would claim three facts.
            id: "instalments",
            timestamp: "2019-02-01",
            precision: TimePrecision.Month,
            title: "Instalments paid",
            subtitle: "February, May and September",
            spans: [
                { timestamp: "2019-05-01", precision: TimePrecision.Month },
                { timestamp: "2019-09-01", precision: TimePrecision.Month },
            ],
        },
        {
            // A recorded duration, which is a different claim from an imprecise
            // instant: this ran for two months, it is not "some time in March".
            id: "injunction",
            timestamp: "2019-03-03",
            until: "2019-05-19",
            title: "Injunction in force",
            subtitle: "3 March to 19 May",
            lineVariant: "dashed",
        },
        {
            // Deliberately out of chronological order. It must still render
            // between the retainer and the filing.
            id: "fy-open",
            timestamp: "2019-01-01",
            precision: TimePrecision.Year,
            title: "Financial year opens",
            subtitle: "Known only to the year",
        },
    ],
};

/**
 * The ordinal scale's fixture: procedural milestones.
 *
 * Deliberately the kind of data the `time` scale would render badly. The stages
 * of a matter are not an argument about intervals — nobody is claiming anything
 * from the fact that disclosure took four months and judgment took three. What
 * matters is which stage follows which, and an even axis says exactly that and
 * nothing more.
 *
 * It still carries a month-precision entry and a recorded duration, so the
 * card's date line is exercised on both scales rather than only on `time`.
 */
export const mockOrdinalTimeline: TimelineSpecInput = {
    kind: "timeline",
    id: "timeline-ordinal",
    title: "Matter milestones",
    subtitle: "Evenly spaced — the order is the point, not the intervals",
    scale: TimelineScale.Ordinal,
    orientation: TimelineOrientation.Horizontal,
    order: TimelineOrder.Ascending,
    lineVariant: "solid",
    events: [
        {
            id: "instructed",
            timestamp: "2018-11-01",
            precision: TimePrecision.Month,
            title: "Instructed",
            subtitle: "Retainer signed",
        },
        {
            id: "pleadings",
            timestamp: "2019-03-14",
            title: "Pleadings closed",
        },
        {
            id: "disclosure",
            timestamp: "2019-07-18",
            title: "Disclosure complete",
            subtitle: "Both parties certified",
        },
        {
            id: "trial",
            timestamp: "2020-02-03",
            until: "2020-02-07",
            title: "Trial",
            subtitle: "Five sitting days",
            lineVariant: "dashed",
        },
        {
            id: "judgment",
            timestamp: "2020-05-19",
            title: "Judgment handed down",
        },
    ],
};

/**
 * A sub-second window from a machine source.
 *
 * The case `millisecond` precision was added for. Every event here falls inside
 * one second, so at second resolution they would share a position entirely and
 * the ordering — which is the whole argument with logs — would be unreadable.
 * The axis ticks in milliseconds and the gaps between the writes are the point.
 */
export const mockLogTimeline: TimelineSpecInput = {
    kind: "timeline",
    id: "timeline-log",
    title: "Transfer sequence",
    subtitle: "Server log, one second wide — the ordering is the argument",
    scale: TimelineScale.Time,
    orientation: TimelineOrientation.Horizontal,
    order: TimelineOrder.Ascending,
    lineVariant: "solid",
    events: [
        {
            id: "request",
            timestamp: "2019-07-16T02:05:11.042Z",
            title: "Request received",
            subtitle: "api-gateway",
        },
        {
            id: "auth",
            timestamp: "2019-07-16T02:05:11.198Z",
            title: "Authorisation granted",
            subtitle: "auth-service",
        },
        {
            id: "debit",
            timestamp: "2019-07-16T02:05:11.203Z",
            title: "Account debited",
            subtitle: "Five milliseconds after authorisation",
            lineVariant: "dashed",
        },
        {
            id: "instruction",
            timestamp: "2019-07-16T02:05:11.560Z",
            title: "Instruction written",
            subtitle: "Recorded AFTER the debit it authorises",
        },
        {
            id: "ack",
            timestamp: "2019-07-16T02:05:11.884Z",
            title: "Acknowledgement sent",
        },
    ],
};

/**
 * The report the three apps render.
 *
 * Driven by props rather than by anything the component fabricates for itself —
 * a component that invents its own data exercises none of the contract this
 * package exists to enforce. Replace with an API response once the backend
 * serves one.
 */
export const mockReport: ReportSpecInput = {
    schemaVersion: SCHEMA_VERSION,
    data: {},
    components: [mockOrdinalTimeline, mockTimeScaleTimeline, mockLogTimeline],
};
