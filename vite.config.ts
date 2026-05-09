import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  define: {
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY),
    'process.env.GOOGLE_CLIENT_ID': JSON.stringify(process.env.GOOGLE_CLIENT_ID),
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/moodleProxy': 'http://localhost:3000',
      '/.netlify': 'http://localhost:3000'
    }
  },
  build: {
    outDir: 'dist',
  },
});