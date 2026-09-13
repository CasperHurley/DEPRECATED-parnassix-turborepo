import * as React from "react";
import { Section, H1, YStack } from "tamagui";
import {
  ComponentSpecSchema,
  z,
  type ComponentKind,
  type ComponentSpecInput,
} from "@repo/report-schema";
import { RenderContextProvider, useRenderContext } from "../render-context";
import { Timeline } from "./Components/Timeline/Timeline";
import { ComponentErrorBoundary } from "./ComponentErrorBoundary";
import { ComponentErrorCard } from "./ComponentErrorCard";
import { ReportCanvasProps } from "../types";

export function ReportCanvas({ report }: ReportCanvasProps) {
  const { context, onLayout } = useCanvasBox();

  return (
    /*
     * The canvas fills the box it is given rather than shrinking to its
     * content. An ancestor with `alignItems: center` would otherwise collapse
     * it to the width of its widest child, and a component that lays out
     * proportionally — the time-scaled Timeline — would have almost no axis to
     * be proportional across.
     */
    <Section alignSelf="stretch" width="100%" px="$4">
      {/*
       * Measured INSIDE the padding, because the context has to describe the
       * box a component actually gets. Measuring the padded frame reports ~36px
       * that no component can lay out in, which is enough to put a layout on the
       * wrong side of a threshold derived from a card's width.
       */}
      <YStack alignSelf="stretch" onLayout={onLayout}>
        <RenderContextProvider value={context}>
          <H1>Report Canvas</H1>
          {report.components.map((component, index) => (
            <ComponentErrorBoundary
              key={component?.id ?? index}
              componentId={component?.id ?? `#${index}`}
            >
              <ReportComponent spec={component} />
            </ComponentErrorBoundary>
          ))}
        </RenderContextProvider>
      </YStack>
    </Section>
  );
}

/** What a layout callback reports, typed structurally so this file does not
 * import react-native — an optional peer dependency here. */
type LayoutEvent = { nativeEvent: { layout: { width: number; height: number } } };

/**
 * The canvas's own box, measured once and handed to every component below.
 *
 * Measured HERE rather than read from the viewport, because the box a report is
 * rendered into is not the window: a report in a sidebar is narrow on a 4K
 * monitor, and a media query would tell every component the wrong thing.
 *
 * An ancestor that STATES its box always wins. The print and slide paths set a
 * width that has nothing to do with what a browser measures — letter paper is
 * 8.5in across whatever the window is — so a measurement must never silently
 * replace one. That also keeps export deterministic: the same stated width
 * yields the same layout on any machine.
 */
function useCanvasBox() {
  const inherited = useRenderContext();
  const stated = inherited.width > 0;
  const [measured, setMeasured] = React.useState({ width: 0, height: 0 });

  const handleLayout = React.useCallback(({ nativeEvent }: LayoutEvent) => {
    const { width, height } = nativeEvent.layout;
    setMeasured((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  const context = React.useMemo(
    () => (stated ? inherited : { ...inherited, ...measured }),
    [stated, inherited, measured],
  );

  return { context, onLayout: stated ? undefined : handleLayout };
}

/**
 * Renders one component, validating it first.
 *
 * The spec is revalidated here even though it is already typed, because the
 * type proves nothing about a payload that arrived over a network from an
 * agent. This is the frontend's half of the three-place validation described in
 * CLAUDE.md; Python validates its agents' output and NestJS validates the
 * public boundary.
 */
function ReportComponent({ spec }: { spec: ComponentSpecInput }) {
  const parsed = ComponentSpecSchema.safeParse(spec);

  if (!parsed.success) {
    const { formErrors, fieldErrors } = z.flattenError(parsed.error);
    const reason =
      [...formErrors, ...Object.entries(fieldErrors).map(([k, v]) => `${k}: ${v?.join(", ")}`)]
        .slice(0, 3)
        .join("; ") || "did not match the report schema";
    return <ComponentErrorCard componentId={(spec as { id?: string })?.id} reason={reason} />;
  }

  switch (parsed.data.kind) {
    case "timeline":
      return <Timeline {...parsed.data} />;
    default:
      // Reachable only if the contract gains a kind this renderer predates —
      // an older client rendering a newer report. Still a card, never a blank.
      return (
        <ComponentErrorCard
          componentId={(spec as { id?: string })?.id}
          reason="Unsupported component type"
        />
      );
  }
}

/**
 * Compile-time exhaustiveness.
 *
 * Adding a component kind to @repo/report-schema without handling it above is a
 * compile error here. A `default: assertNever(...)` cannot do this job while the
 * union has a single member — TypeScript only narrows a genuine union to `never`
 * — so the check lives in a lookup table that works at any union size.
 */
const HANDLED_KINDS: Record<ComponentKind, true> = {
  timeline: true,
};
void HANDLED_KINDS;
