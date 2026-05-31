import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // 监听所有接口，供局域网设备 / Caddy 反代访问
    allowedHosts: ['flipbook.lan'], // 放行经 Caddy 转发进来的局域网域名
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
