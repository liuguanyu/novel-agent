/**
 * 主题三态切换 (I8 visual-design 子阶段 A)
 *
 * 顶栏控件：单键循环 浅色→深色→跟随系统，按当前偏好显示对应图标（Sun/Moon/Monitor）。
 * 明暗判定与循环由 useTheme（→ core 纯函数）承担，本组件只呈现与触发。
 */

import { Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '../hooks/useTheme.js';
import { THEME_PREFERENCE_LABELS } from '../../core/shell/theme.js';

export function ThemeToggle(): JSX.Element {
  const { preference, cyclePreference } = useTheme();
  const label = THEME_PREFERENCE_LABELS[preference];
  const Icon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor;
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={cyclePreference}
      aria-label={`主题：${label}（点击切换）`}
      title={`主题：${label}`}
    >
      <Icon className="size-4" />
    </Button>
  );
}
