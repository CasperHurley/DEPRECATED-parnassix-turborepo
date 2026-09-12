import {
  TamaguiProvider,
  Theme,
  YStack,
  ReportCanvas,
  config,
} from "@repo/ui";

function App() {
  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <Theme name="dark">
        <YStack 
          f={1} 
          ai="center" 
          // jc="center" 
          gap="$4" 
          bg="$background">
          <ReportCanvas />
        </YStack>
      </Theme>
    </TamaguiProvider>
  );
}

export default App;
