/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': process.env.API_TARGET ?? 'http://localhost:8000',
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
