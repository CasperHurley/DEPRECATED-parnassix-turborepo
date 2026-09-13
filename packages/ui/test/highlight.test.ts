import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_WEIGHT,
  highlightTier,
  type HighlightTier,
} from "../src/ReportCanvas/Components/Timeline/types";
import { LINE_TIER } from "../src/ReportCanvas/Components/Timeline/TimeScaleTimeline";

/**
 * A cluster exists to say several things happened at the same moment. With only
 * "the lit event" and "everything else", hovering one of five calls in an
 * afternoon faded the other four exactly as hard as an event eight months away,
 * which is the one relationship the grouping is there to state.
 */
describe("a highlight says how close each event is to the one being read", () => {
  const cluster = new Set(["call-1", "call-2", "call-3"]);

  it("names nothing when nothing is lit", () => {
    expect(highlightTier("call-1", null, null)).toBe("rest");
    expect(highlightTier("far", null, cluster)).toBe("rest");
  });

  it("lights the event under the pointer", () => {
    expect(highlightTier("call-2", "call-2", cluster)).toBe("lit");
  });

  it("keeps the rest of the cluster nearer than the rest of the axis", () => {
    expect(highlightTier("call-3", "call-2", cluster)).toBe("related");
    expect(highlightTier("filing", "call-2", cluster)).toBe("aside");
  });

  it("treats a lone event's own group as no group at all", () => {
    // A single-member group has no siblings to place in the middle tier.
    expect(highlightTier("other", "solo", new Set(["solo"]))).toBe("aside");
  });
});

/**
 * The honesty rule, pinned.
 *
 * A marker's opacity is EVIDENCE — how much its source actually knew — so a
 * highlight may only ever fade one. Every tier being a fraction is what keeps
 * that true whichever tier a band lands in, and "make the highlight pop" is
 * exactly the later change that would quietly break it.
 */
describe("a highlight may dim a marker but never brighten one", () => {
  const tiers: HighlightTier[] = ["rest", "lit", "related", "aside"];

  it("never weighs a part above its own strength", () => {
    for (const tier of tiers) expect(HIGHLIGHT_WEIGHT[tier]).toBeLessThanOrEqual(1);
  });

  it("orders the tiers, so nearer never reads as further away", () => {
    expect(HIGHLIGHT_WEIGHT.lit).toBeGreaterThan(HIGHLIGHT_WEIGHT.related);
    expect(HIGHLIGHT_WEIGHT.related).toBeGreaterThan(HIGHLIGHT_WEIGHT.aside);
    expect(HIGHLIGHT_WEIGHT.aside).toBeGreaterThan(0);
  });

  it("leaves everything at full strength when nothing is lit", () => {
    // At rest the component must draw exactly what it drew before highlighting
    // existed — verified pixel-for-pixel, and this is the arithmetic half of it.
    expect(HIGHLIGHT_WEIGHT.rest).toBe(1);
  });
});

/**
 * At rest the component must draw exactly what it drew before highlighting
 * existed — the claim is checked pixel-for-pixel by hand, and this is the half
 * of it a test can hold. `related` shares the resting appearance deliberately:
 * a connector's resting strength already IS the middle one, so a cluster
 * holding the lit event keeps the structure it draws at rest and only the route
 * through it brightens.
 */
describe("a connector at rest is a connector untouched", () => {
  it("draws the resting line exactly as it always did", () => {
    expect(LINE_TIER.rest).toEqual({ o: 0.5, borderColor: "$borderColor" });
  });

  it("gives the lit event's own group that same resting line", () => {
    expect(LINE_TIER.related).toEqual(LINE_TIER.rest);
  });

  it("brightens only the lit route, and only in the marker's colour", () => {
    expect(LINE_TIER.lit).toEqual({ o: 1, borderColor: "$blue9" });
  });

  it("puts everything else behind both", () => {
    expect(LINE_TIER.aside.o).toBeLessThan(LINE_TIER.related.o);
    expect(LINE_TIER.aside.borderColor).toBe("$borderColor");
  });
});
