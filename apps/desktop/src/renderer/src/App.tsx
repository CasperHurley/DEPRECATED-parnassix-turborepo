import {
  TamaguiProvider,
  Theme,
  YStack,
  ReportCanvas,
  config,
  mockReport,
} from "@repo/ui";

/*
 * Tall enough to clear the traffic lights, which hiddenInset pushes further
 * down than a plain hidden title bar does. Declared here rather than in CSS so
 * the strip and the space reserved for it cannot drift apart.
 */
const TITLEBAR_HEIGHT = 38;

/*
 * Only macOS gets a hidden title bar (src/main/index.ts); Windows and Linux
 * keep the real one, where reserving this band would just be a gap.
 */
const titleBarOverlaysContent = window.api.platform === "darwin";

function App() {
  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <Theme name="dark">
        {titleBarOverlaysContent ? (
          <div className="titlebar-drag" style={{ height: TITLEBAR_HEIGHT }} />
        ) : null}
        <YStack 
          f={1} 
          ai="center" 
          // jc="center" 
          gap="$4" 
          bg="$background"
          pt={titleBarOverlaysContent ? TITLEBAR_HEIGHT : 0}>
          <ReportCanvas report={mockReport} />
        </YStack>
      </Theme>
    </TamaguiProvider>
  );
}

export default App;
