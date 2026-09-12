import { describe, expect, it } from "vitest";
import {
  ComponentSpecSchema,
  ReportSpecSchema,
  SCHEMA_VERSION,
  TimelineOrder,
  TimelineOrientation,
  TimelineEventSpecSchema,
  TimelineScale,
  UnitOfTime,
} from "../src";

const validTimeline = {
  kind: "timeline" as const,
  id: "timeline-1",
  title: "Timeline One",
  events: [{ id: "e1", timestamp: "2023-01-01", title: "Event 1" }],
};

describe("the wire contract actually constrains agent output", () => {
  it("accepts a valid report", () => {
    const result = ReportSpecSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      data: {},
      components: [validTimeline],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown component kind", () => {
    expect(ComponentSpecSchema.safeParse({ ...validTimeline, kind: "hologram" }).success).toBe(
      false,
    );
  });

  it("rejects an enum value outside the contract", () => {
    // The exact failure mode an agent produces when it invents a value.
    expect(
      ComponentSpecSchema.safeParse({ ...validTimeline, orientation: "diagonal" }).success,
    ).toBe(false);
    expect(ComponentSpecSchema.safeParse({ ...validTimeline, scale: "logarithmic" }).success).toBe(
      false,
    );
  });

  it("strips unknown fields rather than rejecting them", () => {
    // Deliberately lenient on read: a newer backend adding a field must not
    // break an older client. An invented value in a KNOWN field still fails
    // (above) — that is where the contract does its work.
    const result = ComponentSpecSchema.safeParse({ ...validTimeline, direction: "forward" });
    expect(result.success).toBe(true);
    expect(result.success && "direction" in result.data).toBe(false);
  });

  it("rejects a Date instance as a timestamp", () => {
    // Date does not survive JSON serialization; only ISO strings cross the wire.
    const result = TimelineEventSpecSchema.safeParse({
      id: "e1",
      timestamp: new Date(),
      title: "Event 1",
    });
    expect(result.success).toBe(false);
  });

  it("accepts both date-only and full datetime timestamps", () => {
    // Precision of knowledge is itself meaningful; "January 2023" must not be
    // promoted to a fabricated midnight.
    for (const timestamp of ["2023-01-01", "2023-01-01T09:30:00Z", "2023-01-01T09:30:00+01:00"]) {
      expect(
        TimelineEventSpecSchema.safeParse({ id: "e1", timestamp, title: "t" }).success,
      ).toBe(true);
    }
    expect(
      TimelineEventSpecSchema.safeParse({ id: "e1", timestamp: "last Tuesday", title: "t" })
        .success,
    ).toBe(false);
  });

  it("requires stable ids on events", () => {
    expect(TimelineEventSpecSchema.safeParse({ timestamp: "2023-01-01", title: "t" }).success).toBe(
      false,
    );
    expect(
      TimelineEventSpecSchema.safeParse({ id: "", timestamp: "2023-01-01", title: "t" }).success,
    ).toBe(false);
  });

  it("defaults scale, orientation and order so agents need not specify them", () => {
    const parsed = ComponentSpecSchema.parse(validTimeline);
    expect(parsed.scale).toBe(TimelineScale.Ordinal);
    expect(parsed.orientation).toBe(TimelineOrientation.Horizontal);
    expect(parsed.order).toBe(TimelineOrder.Ascending);
  });

  it("has no ambiguous axis value for an agent to guess at", () => {
    // The old single `direction` enum had a `backward` member readable as either
    // "right-to-left" or "reverse-chronological". Orientation and order each
    // mean exactly one thing, so neither reading is expressible as a guess.
    expect(ComponentSpecSchema.safeParse({ ...validTimeline, orientation: "backward" }).success)
      .toBe(false);
    expect(ComponentSpecSchema.safeParse({ ...validTimeline, order: "vertical" }).success)
      .toBe(false);
    expect(
      ComponentSpecSchema.safeParse({
        ...validTimeline,
        orientation: "vertical",
        order: "descending",
      }).success,
    ).toBe(true);
  });

  it("keeps CSS out of the wire contract", () => {
    // 'row' / 'row-reverse' were the old values; the contract is semantic now.
    expect(ComponentSpecSchema.safeParse({ ...validTimeline, orientation: "row" }).success).toBe(
      false,
    );
    expect(TimelineOrientation.Horizontal).toBe("horizontal");
  });

  it("carries per-fact provenance on an event", () => {
    const result = TimelineEventSpecSchema.safeParse({
      id: "e1",
      timestamp: "2023-01-01",
      title: "Event 1",
      source: {
        documentId: "doc-1",
        nodeId: "node-7",
        page: 12,
        bbox: [{ l: 72, t: 640, r: 300, b: 620 }],
        coordOrigin: "bottomleft",
        quotedText: "the meeting occurred on January 1",
      },
    });
    expect(result.success).toBe(true);
  });

  it("exposes UnitOfTime members for renderer lookup tables", () => {
    expect(UnitOfTime.Year).toBe("year");
  });
});
