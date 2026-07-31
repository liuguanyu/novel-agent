import type { CreativeAssetKind } from './assets.js';

/**
 * task 5.3：把作者的后续意见/`@专家` 召唤在工作流上下文中分为三类路由（纯分类，无副作用）。
 *
 *  - in-stage：被召唤专家恰是当前阶段的承担者（在阶段模板 allowedExperts 内），视为当前阶段内运行；
 *  - asset-clarification：被召唤专家不是当前阶段承担者，但它是产出某类创作资产的专家
 *    （立意/世界观/人物/大纲/分场），此时优先解读为对该目标资产的跨阶段澄清——消歧出 targetAssetKind、
 *    保持主 currentStageId 不变，走资产维护而非改道当前阶段；
 *  - standalone：既非当前阶段承担者、又不产出创作资产（如 writer/审校诊断类），返回 standalone/
 *    暂停或切换选择，不把它当作当前阶段的写入工作。
 *
 * 该函数只依据「被召唤 agent」与「当前阶段允许专家集合」判定，不触碰仓储/图/LLM，可被 Core 单测直接覆盖。
 */

/** 产出创作资产的专家 → 其主要目标资产 kind。非此表内的专家（writer/审校/研究类）不产创作资产。 */
const ASSET_EXPERT_KIND: Readonly<Record<string, CreativeAssetKind>> = {
  'concept-generator': 'concept',
  worldbuilding: 'worldbuilding',
  'character-generator': 'character',
  architect: 'book-outline',
  'scene-outliner': 'scene-outline',
};

export type SummonRoute =
  | { readonly route: 'in-stage' }
  | { readonly route: 'asset-clarification'; readonly targetAssetKind: CreativeAssetKind }
  | { readonly route: 'standalone' };

export function classifySummonRoute(input: {
  readonly agent: string | undefined;
  readonly currentStageAllowedExperts: ReadonlyArray<string>;
}): SummonRoute {
  const { agent, currentStageAllowedExperts } = input;
  if (agent !== undefined && currentStageAllowedExperts.includes(agent)) {
    return { route: 'in-stage' };
  }
  const targetAssetKind = agent === undefined ? undefined : ASSET_EXPERT_KIND[agent];
  if (targetAssetKind !== undefined) {
    return { route: 'asset-clarification', targetAssetKind };
  }
  return { route: 'standalone' };
}
