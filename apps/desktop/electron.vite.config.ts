import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { tamaguiPlugin } from '@tamagui/vite-plugin'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    // Pinned so it never competes with web-vite for 5173. See that app's
    // vite.config.ts.
    server: {
      port: 5174,
      strictPort: true,
    },
    plugins: [
      react(),
      tamaguiPlugin({
        // Absolute: the renderer's vite root is src/renderer, not the app root,
        // so a relative path here would not line up with the other apps'.
        config: resolve(__dirname, '../../packages/ui/src/tamagui.config.ts'),
        components: ['tamagui'],
      }),
    ],
  },
})
