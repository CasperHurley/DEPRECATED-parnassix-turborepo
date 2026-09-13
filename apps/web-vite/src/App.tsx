import {
  TamaguiProvider,
  Theme,
  YStack,
  ReportCanvas,
  config,
  mockReport,
} from "@repo/ui";

function App() {
  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <Theme name="dark">
        {/*
          * In normal flow, not pinned with `position: absolute; inset: 0`.
          * Pinned, the canvas is locked to the viewport and anything taller is
          * clipped with no way to scroll to it — which a vertical timeline is
          * immediately.
          */}
        <YStack f={1} bg="$background">
          <ReportCanvas report={mockReport} />
        </YStack>
      </Theme>
    </TamaguiProvider>
  );
}

export default App;
