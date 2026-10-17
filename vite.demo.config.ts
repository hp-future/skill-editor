import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 演示站点构建配置（`vite.config.ts` 只负责组件库的 lib build）。
 *
 * 产物输出到 `dist-demo/`，可直接部署到任意静态托管。`base` 对齐
 * GitHub Pages 的项目页地址：
 *
 *   https://<owner>.github.io/<repo>/
 *
 * 换仓库名、换托管平台或挂自定义域名时，用 CLI 覆盖：
 *
 *   pnpm build:demo --base=/
 *
 * 本地 `pnpm dev` 仍然从根路径 `/` 提供演示页。
 */
export default defineConfig(({ mode }) => ({
  base: mode === 'development' ? '/' : '/skill-editor/',
  plugins: [react()],
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
  },
}));
