import { createTamagui, type InferTamaguiConfig } from '@tamagui/core';
import { config as configPreset } from '@tamagui/config/v3';

// The explicit annotation keeps the emitted .d.ts portable: without it TS has to
// name @tamagui/config's nested @tamagui/themes copy, which isn't reachable from
// this package under pnpm's strict node_modules layout (TS2742).
export const config: InferTamaguiConfig<typeof configPreset> =
  createTamagui(configPreset);

export type Conf = typeof config;

declare module '@tamagui/core' {
  interface TamaguiCustomConfig extends Conf {}
}

export default config;
