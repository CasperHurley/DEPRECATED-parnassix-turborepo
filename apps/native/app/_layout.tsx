import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { TamaguiProvider, Theme, useTheme, config } from "@repo/ui"

// Inside the provider so the navigator's chrome can read the same theme tokens
// the screens use — otherwise expo-router renders its default light header.
const RootStack = () => {
  const theme = useTheme()

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background.val },
        headerTintColor: theme.color.val,
        contentStyle: { backgroundColor: theme.background.val },
      }}
    />
  )
}

const AppLayout = () => {
  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <Theme name="dark">
        <StatusBar style="light" />
        <RootStack />
      </Theme>
    </TamaguiProvider>
  )
}

export default AppLayout
