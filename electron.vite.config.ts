import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import { cpSync, existsSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 将外置提示词 YAML 资产拷到 main 构建产物旁（out/main/prompts），
 * 使 prompt-loader 的首选候选目录（产物同级 prompts/）在 build/打包态可达。
 */
function copyPromptAssets() {
  return {
    name: 'copy-prompt-assets',
    closeBundle() {
      const src = resolve('src/main/orchestration/prompts');
      if (existsSync(src)) {
        cpSync(src, resolve('out/main/prompts'), { recursive: true });
      }
    },
  };
}

/**
 * electron-vite 三段式构建：main / preload / renderer。
 * 对应 src/main、src/preload、src/renderer；共享类型走 src/shared（仅类型，随各段编译）。
 */
export default defineConfig({
  main: {
    plugins: [copyPromptAssets()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // 全书总检 utilityProcess worker 入口（I5）：产到 out/main/audit-worker.js，
          // 与 main/index 同级，供 UtilityProcessAuditRunner 的 fork 定位。
          'audit-worker': resolve('src/workers/audit-worker.ts'),
          // 局部重构 diff utilityProcess worker 入口（I6）：产到 out/main/diff-worker.js，
          // 供 UtilityProcessDiffRunner 的 fork 定位。
          'diff-worker': resolve('src/workers/diff-worker.ts'),
          // 素材 embedding utilityProcess worker 入口（I7）：产到 out/main/embed-worker.js，
          // 供 UtilityProcessEmbedRunner 的 fork 定位。
          'embed-worker': resolve('src/workers/embed-worker.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: { '@': resolve('src/renderer') },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
  },
});
