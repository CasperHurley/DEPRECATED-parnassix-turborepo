import { Button, YStack } from "@repo/ui";

export default function Native() {
  return (
    <YStack f={1} ai="center" jc="center" bg="$background">
      <Button theme="blue">Hello Cross-Platform Tamagui</Button>
    </YStack>
  );
}
