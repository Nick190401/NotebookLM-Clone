import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Vendors change far less often than app code; splitting keeps them cached across deploys.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react'
          if (id.includes('zod')) return 'vendor-zod'
          return 'vendor'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/frontend/setup.ts',
    include: ['tests/frontend/**/*.test.ts', 'tests/frontend/**/*.test.tsx'],
    css: true,
    exclude: ['node_modules/**', 'dist/**'],
  },
})
