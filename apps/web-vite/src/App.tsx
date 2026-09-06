import './App.css'
import { TamaguiProvider, Theme, Button, YStack, config } from '@repo/ui';

function App() {
  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <Theme name="dark">
        <YStack f={1} ai="center" jc="center" bg="$background">
          <Button theme="blue">Hello Cross-Platform Tamagui</Button>
        </YStack>
      </Theme>
    </TamaguiProvider>
  )
}

export default App
