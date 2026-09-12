import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { tamaguiPlugin } from '@tamagui/vite-plugin';

// https://vite.dev/config/
export default defineConfig({
  // Pinned so the app is always at a known URL. Without strictPort, whichever
  // app's dev server binds first takes 5173 and the other silently slides to
  // the next free port.
  server: {
    port: 5173,
    strictPort: true,
  },
  plugins: [
    react(),
    tamaguiPlugin({
      config: '../../packages/ui/src/tamagui.config.ts',
      components: ['tamagui'],
    }),
  ],
})
