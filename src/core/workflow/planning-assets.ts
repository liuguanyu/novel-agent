import type { CreativeAssetKind } from './assets.js';

/**
 * task 6.1：把产出创作资产的规划专家 + 当前模板阶段映射为目标 CreativeAssetKind（纯函数，无副作用）。
 *
 * 与 summon-routing 的 ASSET_EXPERT_KIND 不同：此处用于「规划节点产物落哪类资产」，
 * 需结合当前阶段消歧 architect——同一专家在 book-outline 阶段产全书大纲、在 chapter-plan 阶段产章节规划。
 * researcher 不在此表：研究札记不是创作资产，走独立 research artifact 持久化。
 *
 * 返回 undefined 表示该 agent 不产创作资产（如 writer/审校/researcher），调用方 MUST NOT 据此写 CreativeAsset。
 */
export function planningAssetKindFor(
  agentId: string,
  templateStageId: string | undefined,
): CreativeAssetKind | undefined {
  switch (agentId) {
    case 'concept-generator':
      return 'concept';
    case 'worldbuilding':
      return 'worldbuilding';
    case 'character-generator':
      return 'character';
    case 'scene-outliner':
      return 'scene-outline';
    case 'architect':
      // 全书大纲阶段 → book-outline；章节规划阶段 → chapter-plan；阶段未知时保守回退 book-outline。
      return templateStageId === 'chapter-plan' ? 'chapter-plan' : 'book-outline';
    default:
      return undefined;
  }
}

/** chapter-plan / scene-outline 属章节 scope，其余属项目 scope（无章节锚点仍必须持久化）。 */
export function planningAssetScopeKind(kind: CreativeAssetKind): 'project' | 'chapter' {
  return kind === 'chapter-plan' || kind === 'scene-outline' ? 'chapter' : 'project';
}
