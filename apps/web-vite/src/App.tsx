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
        <YStack 
          // f={1} 
          ai="center" 
          // jc="center" 
          // gap="$4" 
          // bg="$background"
          inset={0} 
          position={'absolute'}
        >
          <ReportCanvas report={mockReport} />
        </YStack>
      </Theme>
    </TamaguiProvider>
  );
}

export default App;
