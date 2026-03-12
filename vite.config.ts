import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: '.',
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    hmr: false,
  },
  resolve: {
    alias: {
      '@assets': path.resolve(__dirname, 'attached_assets'),
    },
  },
});
