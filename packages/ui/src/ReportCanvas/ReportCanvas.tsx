import * as React from "react";
import { Section, H1 } from "tamagui";
import { Timeline } from "@/ReportCanvas/Components/Timeline/Timeline";

export function ReportCanvas() {
  return (
    <Section>
      <H1>Report Canvas</H1>
      <Timeline />
    </Section>
  );
}
