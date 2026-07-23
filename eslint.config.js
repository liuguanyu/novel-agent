import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['out/**', 'out-smoke/**', 'dist/**', 'node_modules/**', '*.config.js', 'src/renderer/components/ui/**', 'src/renderer/lib/utils.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 工程规范红线 (Task 4.1)：禁用显式 any
      '@typescript-eslint/no-explicit-any': 'error',
      // 未知外部数据用 unknown（Task 4.2）配套：鼓励收窄
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
