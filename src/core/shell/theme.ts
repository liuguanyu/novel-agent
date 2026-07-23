/**
 * 主题偏好纯函数 (I8 visual-design 子阶段 A：主题三态引擎)
 *
 * spec: visual-design「主题三态持久与解析」——主题解析（偏好 + 系统明暗 → 实际明暗）与三态循环
 * MUST 由 core 纯函数承担，MUST NOT 依赖 React/DOM。renderer 的 useTheme 只负责读写 localStorage、
 * 订阅 matchMedia 与切换根元素 class，明暗判定一律回落到此处。
 *
 * 本文件为类型契约 + 纯数据 + 纯 helper（无 React、无 DOM、无 I/O）。
 */

/** 主题偏好：作者可选三态。 */
export type ThemePreference = 'light' | 'dark' | 'system';

/** 实际解析后的明暗（应用到根元素 .dark class 的最终结论）。 */
export type ResolvedTheme = 'light' | 'dark';

/** localStorage 持久化键。 */
export const THEME_STORAGE_KEY = 'novel-agent.theme';

/** 三态偏好的中文标签（顶栏切换/无障碍标注）。 */
export const THEME_PREFERENCE_LABELS: Readonly<Record<ThemePreference, string>> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

/** 三态循环顺序（顶栏切换按此推进）。 */
export const THEME_PREFERENCE_CYCLE: ReadonlyArray<ThemePreference> = ['light', 'dark', 'system'];

/**
 * 解析实际明暗：偏好为显式明暗时直接采用；「跟随系统」时据系统是否偏好深色判定。纯函数。
 */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/** 推进到下一个三态偏好（light→dark→system→light）。纯函数。 */
export function cycleThemePreference(preference: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCE_CYCLE.indexOf(preference);
  const next = THEME_PREFERENCE_CYCLE[(index + 1) % THEME_PREFERENCE_CYCLE.length];
  // next 恒有值（模运算落在合法下标内）；noUncheckedIndexedAccess 下显式兜底。
  return next ?? 'system';
}

/** 类型守卫：宽松 unknown（如 localStorage 读出的字符串）是否为合法偏好。纯函数。 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}
