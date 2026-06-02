import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 导出构建：在 index.html 的入口脚本前注入 <script src="./data.js">，
// 让离线产物从 window.__FLIPBOOK__ 读取数据。data.js 由 buildExport.js
// 在运行时生成，不参与 Vite 构建，故这里只注入标签、不让 Vite 解析它。
function injectDataScriptPlugin(): Plugin {
  return {
    name: 'flipbook-inject-data-script',
    transformIndexHtml(html) {
      return html.replace(
        /<script type="module"/,
        '<script src="./data.js"></script>\n    <script type="module"',
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const isExport = mode === 'export';
  return {
    plugins: [react(), ...(isExport ? [injectDataScriptPlugin()] : [])],
    define: {
      __FLIPBOOK_EXPORT__: JSON.stringify(isExport),
    },
    base: isExport ? './' : '/',
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
    build: isExport
      ? {
          outDir: 'dist-export',
          sourcemap: false,
          // 离线 file:// 兼容：单文件 IIFE + 相对路径，无 type="module"
          rollupOptions: {
            output: {
              format: 'iife',
              inlineDynamicImports: true,
              entryFileNames: 'viewer.js',
              assetFileNames: (info) =>
                info.name && info.name.endsWith('.css') ? 'viewer.css' : '[name][extname]',
            },
          },
        }
      : {
          outDir: 'dist',
          sourcemap: true,
        },
  };
});
