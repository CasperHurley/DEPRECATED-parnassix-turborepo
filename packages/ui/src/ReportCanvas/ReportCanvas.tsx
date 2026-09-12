import * as React from "react";
import { Section, H1 } from "tamagui";
import {
  ComponentSpecSchema,
  z,
  type ComponentKind,
  type ComponentSpec,
} from "@repo/report-schema";
import { Timeline } from "@/ReportCanvas/Components/Timeline/Timeline";
import { ComponentErrorBoundary } from "@/ReportCanvas/ComponentErrorBoundary";
import { ComponentErrorCard } from "@/ReportCanvas/ComponentErrorCard";
import { ReportCanvasProps } from "@/types";

export function ReportCanvas({ report }: ReportCanvasProps) {
  return (
    <Section>
      <H1>Report Canvas</H1>
      {report.components.map((component, index) => (
        <ComponentErrorBoundary
          key={component?.id ?? index}
          componentId={component?.id ?? `#${index}`}
        >
          <ReportComponent spec={component} />
        </ComponentErrorBoundary>
      ))}
    </Section>
  );
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
function ReportComponent({ spec }: { spec: ComponentSpec }) {
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
