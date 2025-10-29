import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/QRplantillaWeb/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        // Force new filenames to break cache completely - v5
        entryFileNames: 'assets/[name]-[hash]-v5.js',
        chunkFileNames: 'assets/[name]-[hash]-v5.js',
        assetFileNames: 'assets/[name]-[hash]-v5.[ext]'
      }
    }
  },
  server: {
    port: 5173,
    host: true,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  }
})