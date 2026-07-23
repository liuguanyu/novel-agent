/**
 * Renderer 全局类型声明：把 preload 经 contextBridge 暴露的受限桥挂到 window。
 * 类型复用 shared/ipc 的 NovelAgentBridge 契约（叶子层，不引入 electron 类型）。
 */

import type { NovelAgentBridge } from '../shared/ipc/index.js';

declare global {
  interface Window {
    readonly novelAgent: NovelAgentBridge;
  }
}

export {};
