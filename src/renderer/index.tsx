/**
 * Renderer 入口 (walking-skeleton task 5.2)
 *
 * 从占位替换为 React 挂载。职责边界（conventions §3）：仅渲染与交互，全部业务经 window.novelAgent 桥委派后端。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import {
  THEME_STORAGE_KEY,
  isThemePreference,
  resolveTheme,
} from '../core/shell/theme.js';
import './index.css';

// 挂载前先按持久化偏好应用 .dark，避免首帧闪烁（useTheme 挂载后再接管同步）。
try {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  const preference = isThemePreference(stored) ? stored : 'system';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', resolveTheme(preference, prefersDark) === 'dark');
} catch {
  // 读偏好失败则维持浅色默认，不阻断挂载。
}

const root = document.getElementById('root');
if (root !== null) {
  root.textContent = '';
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
