/**
 * 主题三态 hook (I8 visual-design 子阶段 A)
 *
 * 职责边界：只做 localStorage 读写、matchMedia 订阅与根元素 class 切换；
 * 明暗判定与三态循环一律回落 core 的纯函数（resolveTheme / cycleThemePreference），
 * renderer 不自持一份明暗判定逻辑（见 visual-design spec「主题解析为纯函数」）。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  THEME_STORAGE_KEY,
  cycleThemePreference,
  isThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '../../core/shell/theme.js';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

function readStoredPreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

export interface UseThemeResult {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly setPreference: (next: ThemePreference) => void;
  readonly cyclePreference: () => void;
}

export function useTheme(): UseThemeResult {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark);

  // 订阅系统明暗变化（仅「跟随系统」时影响解析结果，但始终跟踪以便随时切换偏好）。
  useEffect(() => {
    const mql = window.matchMedia(DARK_MEDIA_QUERY);
    const onChange = (e: MediaQueryListEvent): void => setPrefersDark(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(preference, prefersDark);

  // 据解析结论切换根元素 .dark class，使全部设计 token 生效。
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference): void => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // 持久化失败（如隐私模式）不影响本次会话生效。
    }
  }, []);

  const cyclePreference = useCallback((): void => {
    setPreference(cycleThemePreference(preference));
  }, [preference, setPreference]);

  return { preference, resolved, setPreference, cyclePreference };
}
