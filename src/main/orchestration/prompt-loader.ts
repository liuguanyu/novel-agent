/**
 * 外置 YAML 提示词运行时读盘器（I9 子阶段 B / spec prompt-loading「运行时 YAML 读盘」「资产定位与缓存」）
 *
 * 职责：按 agent 名从外置 YAML 读盘 → js-yaml 解析 → parsePromptTemplate 校验 → 进程内缓存。
 * 缺失/解析失败/校验失败 → 回退到调用方传入的内置默认（MissingTemplatePolicy='builtin-default'），
 * 并记录一次诊断（不静默、不抛未捕获）。
 *
 * 定位（多态可达，spec「多态定位」）：electron-vite 默认外置 dependencies，故三态（build/dev/smoke）
 * 均由 Node 运行时读盘；候选目录依次探测：
 *   1) 打包/编译产物与本模块同级的 `prompts/`（若资产被拷到产物旁）；
 *   2) 源码树 `src/main/orchestration/prompts/`（从产物目录相对回溯，冒烟/开发态可达）。
 * 全部未命中 → 回退内置默认。已成功加载的模板做模块级缓存，避免重复读盘。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { parsePromptTemplate, type PromptTemplate } from '../../core/orchestration/index.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * 候选提示词目录（按优先级）。第一项覆盖「资产随产物」，其余覆盖冒烟/开发态源码树。
 * resolve 消除相对段；不存在的目录在读盘时自然落空进入下一候选。
 */
const CANDIDATE_DIRS: readonly string[] = [
  join(moduleDir, 'prompts'),
  // out-smoke/main/orchestration/ → 回溯到项目根再进源码树
  resolve(moduleDir, '../../../src/main/orchestration/prompts'),
  // out/main/ (bundle) → 回溯到项目根再进源码树
  resolve(moduleDir, '../../src/main/orchestration/prompts'),
];

/** 已成功解析的模板缓存（key = agent 名）。 */
const cache = new Map<string, PromptTemplate>();

/** 读盘失败/回退的一次性诊断（避免重复刷屏：同一 agent 只记一次）。 */
const warned = new Set<string>();

function warnOnce(agent: string, message: string): void {
  if (warned.has(agent)) {
    return;
  }
  warned.add(agent);
  console.warn(`[prompt-loader] ${agent}: ${message}`);
}

/** 尝试从候选目录读取并解析某 agent 的 YAML；命中并校验通过则返回，否则 undefined。 */
function tryLoadFromDisk(agent: string): PromptTemplate | undefined {
  for (const dir of CANDIDATE_DIRS) {
    const filePath = join(dir, `${agent}.yml`);
    let text: string;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch {
      continue; // 该候选无此文件，试下一个
    }
    let raw: unknown;
    try {
      raw = loadYaml(text, { filename: filePath });
    } catch (err) {
      warnOnce(agent, `YAML 解析失败（${filePath}）：${(err as Error).message}；回退内置默认`);
      return undefined;
    }
    const result = parsePromptTemplate(raw);
    if (!result.ok) {
      warnOnce(agent, `模板校验失败（${filePath}）：${result.reason}；回退内置默认`);
      return undefined;
    }
    return result.template;
  }
  warnOnce(agent, '未找到外置 YAML，回退内置默认');
  return undefined;
}

/**
 * 按 agent 名加载提示词模板；失败时回退到 builtinDefault。
 * 成功加载（含回退）后缓存，后续同名请求命中缓存不再读盘（spec「加载结果缓存」）。
 * builtinDefault 保证任何情况下都返回可用模板——绝不静默产出残缺 prompt。
 */
export function loadPromptTemplate(agent: string, builtinDefault: PromptTemplate): PromptTemplate {
  const cached = cache.get(agent);
  if (cached !== undefined) {
    return cached;
  }
  const loaded = tryLoadFromDisk(agent) ?? builtinDefault;
  cache.set(agent, loaded);
  return loaded;
}

/** 测试/热重载用：清空缓存与告警去重。 */
export function clearPromptCache(): void {
  cache.clear();
  warned.clear();
}
