import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 导出构建：让 index.html 在离线 file:// 下可用。
// 1) 入口脚本是 IIFE（非 ESM），但 Vite 默认仍输出 `type="module" crossorigin`。
//    这两个属性会让浏览器在 file:// 下按 CORS 策略拒绝加载脚本，必须去掉。
//    但 `type="module"` 同时带来「DOM 解析完才执行」的语义；去掉后脚本会在
//    <head> 中同步执行、早于 <body> 的 #root 出现 → React #299。改用 `defer`
//    复刻「DOM 就绪后再执行」的时机。data.js 是纯赋值、无 DOM 依赖，也加 defer
//    以保证它仍在 viewer.js 之前执行（defer 脚本按文档顺序执行）。
// 2) 在入口脚本前注入 <script defer src="./data.js">，数据由 buildExport.js
//    运行时生成（设置 window.__FLIPBOOK__），不参与 Vite 构建。
function exportHtmlPlugin(): Plugin {
  return {
    name: 'flipbook-export-html',
    transformIndexHtml(html) {
      // 入口脚本：去掉 type="module"/crossorigin，改 defer
      let out = html.replace(
        /<script\b[^>]*\ssrc="(\.\/viewer\.js)"[^>]*><\/script>/,
        (_m, src) => `<script defer src="${src}"></script>`,
      );
      // 在 viewer.js 之前注入 data.js（同样 defer，按文档顺序先执行）
      out = out.replace(
        /<script\sdefer\ssrc="\.\/viewer\.js"><\/script>/,
        '<script defer src="./data.js"></script>\n    <script defer src="./viewer.js"></script>',
      );
      return out;
    },
  };
}

export default defineConfig(({ mode }) => {
  const isExport = mode === 'export';
  return {
    plugins: [react(), ...(isExport ? [exportHtmlPlugin()] : [])],
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
