import { TamaguiProvider, Theme, Button, Paragraph, YStack, config } from '@repo/ui'

function App() {
  const { electron, chrome, node } = window.api.versions

  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <Theme name="dark">
        <YStack f={1} ai="center" jc="center" gap="$4" bg="$background">
          <Button theme="blue">Hello Cross-Platform Tamagui</Button>
          <Paragraph size="$2" opacity={0.6}>
            Electron {electron} · Chromium {chrome} · Node {node}
          </Paragraph>
        </YStack>
      </Theme>
    </TamaguiProvider>
  )
}

export default App
