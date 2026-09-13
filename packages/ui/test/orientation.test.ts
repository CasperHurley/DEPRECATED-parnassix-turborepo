import { describe, expect, it } from "vitest";
import { TimelineOrientation } from "@repo/report-schema";
import {
  HORIZONTAL_MIN_WIDTH,
  resolveTimelineDetail,
  resolveTimelineOrientation,
} from "../src/ReportCanvas/Components/Timeline/types";

const { Horizontal, Vertical } = TimelineOrientation;

/**
 * An agent emits a size-agnostic template: it cannot know whether the report is
 * being read on a poster or a phone, and the contract deliberately does not tell
 * it. Fitting the axis to the box is therefore the renderer's job, and this is
 * the whole of that decision — pure, so a printed page and a screen at the same
 * width cannot disagree about which way the axis runs.
 */
describe("the axis is narrowed to the box, never widened past the spec", () => {
  it("keeps a horizontal axis when the box can show several cards across", () => {
    expect(resolveTimelineOrientation(Horizontal, 1440)).toBe(Horizontal);
  });

  it("turns a horizontal axis vertical in a phone-width box", () => {
    // A horizontal axis here shows about one card at a time, so every
    // comparison between two events costs a sideways scroll. Vertical spends
    // the page's own scroll on time instead.
    expect(resolveTimelineOrientation(Horizontal, 390)).toBe(Vertical);
  });

  it("leaves a specified vertical axis alone at any width", () => {
    // A vertical axis fits every box, so there is nothing for the renderer to
    // fix — overriding one would be second-guessing the agent for no reason.
    for (const width of [0, 390, 1440, 4096]) {
      expect(resolveTimelineOrientation(Vertical, width)).toBe(Vertical);
    }
  });

  it("keeps the spec while the box is still unmeasured", () => {
    // Guessing for one frame and flipping on the next is worse than starting
    // where the spec asked.
    expect(resolveTimelineOrientation(Horizontal, 0)).toBe(Horizontal);
  });

  it("switches at the card-derived threshold, not at a device breakpoint", () => {
    expect(resolveTimelineOrientation(Horizontal, HORIZONTAL_MIN_WIDTH)).toBe(Horizontal);
    expect(resolveTimelineOrientation(Horizontal, HORIZONTAL_MIN_WIDTH - 1)).toBe(Vertical);
  });

  it("gives a printed page the same axis every time", () => {
    // 8.5in at 72dpi, less an inch of margins. Export must not depend on the
    // window that happened to be open when it ran.
    const letter = 612 - 144;
    expect(resolveTimelineOrientation(Horizontal, letter)).toBe(
      resolveTimelineOrientation(Horizontal, letter),
    );
  });
});

/**
 * A vertical timeline in a phone-width box shows the rail alone and opens an
 * event's detail when a node is pressed. That is a real risk to the thing this
 * repo exists for: CLAUDE.md rejects any interaction that is the ONLY route to
 * a fact, because it does not survive export — the rule that killed hover-only
 * citation and expandable clustering. The panel is therefore a SCREEN
 * affordance, and these pin that it can never become the export path.
 */
describe("detail reaches paper without anyone having to press anything", () => {
  const RAIL = 200;

  it("opens a panel on a narrow screen, where cards could only be scrolled to", () => {
    expect(resolveTimelineDetail(Vertical, 354, false, RAIL)).toBe("panel");
  });

  it("never opens a panel on a static medium, however narrow the page", () => {
    // Letter paper inside its margins is narrower than a phone, and cannot be
    // pressed. Every card is drawn instead.
    for (const width of [200, 354, 468, 612]) {
      expect(resolveTimelineDetail(Vertical, width, true, RAIL)).toBe("cards");
    }
  });

  it("keeps the cards when the box has room for one beside the rail", () => {
    expect(resolveTimelineDetail(Vertical, RAIL + 168 + 14, false, RAIL)).toBe("cards");
    expect(resolveTimelineDetail(Vertical, RAIL + 168 + 13, false, RAIL)).toBe("panel");
  });

  it("never takes detail away from a horizontal timeline", () => {
    for (const width of [0, 200, 390, 1440]) {
      expect(resolveTimelineDetail(Horizontal, width, false, RAIL)).toBe("cards");
    }
  });

  it("shows the fuller layout while the box is still unmeasured", () => {
    // Scrolling through cards is a worse UI than the panel but never a less
    // complete one, so it is the safe thing to render before the box is known.
    expect(resolveTimelineDetail(Vertical, 0, false, RAIL)).toBe("cards");
  });
});
