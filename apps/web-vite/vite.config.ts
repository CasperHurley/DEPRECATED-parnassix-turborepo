import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { tamaguiPlugin } from '@tamagui/vite-plugin';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tamaguiPlugin({
      config: '../../packages/ui/src/tamagui.config.ts',
      components: ['tamagui'],
    }),
  ],
})
