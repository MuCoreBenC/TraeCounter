import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Fix WebSocket connection issues in Wails dev mode
    hmr: {
      protocol: 'ws',
      host: 'localhost'
    }
  }
})
