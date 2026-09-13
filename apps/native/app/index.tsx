import { ScrollView, YStack, ReportCanvas, mockReport } from "@repo/ui";

export default function Native() {
  return (
    // A report is a document: on native nothing scrolls unless something says
    // so, and a vertical timeline is taller than the screen immediately.
    <ScrollView f={1} bg="$background" contentContainerStyle={{ minHeight: "100%" }}>
      <YStack f={1}>
        <ReportCanvas report={mockReport} />
      </YStack>
    </ScrollView>
  );
}
