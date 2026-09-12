import { YStack, XStack, ReportCanvas } from "@repo/ui";

export default function Native() {
  return (
    <YStack 
      f={1} 
      // ai="center" 
      // jc="center" 
      gap="$4" 
      bg="$background"
    >
      <XStack>
        <ReportCanvas />
      </XStack>
    </YStack>
  );
}
