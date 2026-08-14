/**
 * 故事资产面板 — 展示情节线/人物/关系/成长弧/伏笔 (Roadmap M2)
 *
 * 从故事资产快照中展示 LLM 提炼的结构化资产，支持确认（draft → confirmed）。
 * 分为五个标签页：情节线、人物、关系、成长弧、伏笔。
 */

import { useState } from 'react';
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  GitBranch,
  Users,
  Heart,
  TrendingUp,
  Lightbulb,
  Pencil,
} from 'lucide-react';
import { Button } from './ui/button.js';
import { ScrollArea } from './ui/scroll-area.js';
import type {
  StoryAssetSnapshotDto,
  PlotThreadDto,
  CharacterProfileDto,
  CharacterRelationDto,
  CharacterArcDto,
  ForeshadowingDto,
  CredibleClaimDto,
} from '../../shared/ipc/index.js';

/* ── Props ──────────────────────────────────────────────────────── */

interface StoryAssetPanelProps {
  snapshot: StoryAssetSnapshotDto | undefined;
  loading: boolean;
  extracting: boolean;
  error: string | undefined;
  onExtractAssets: () => void;
  onConfirmAsset: (assetKind: 'plotThread' | 'character' | 'relation' | 'arc' | 'foreshadowing', assetId: string) => void;
  onRefresh: () => void;
  onPublishAssets: () => void;
  onEditAsset: (assetKind: 'plotThread' | 'character' | 'relation' | 'arc', assetId: string, value: string, authorNote?: string) => void;
}

/* ── 辅助 ──────────────────────────────────────────────────────── */

const CREDIBILITY_LABEL: Readonly<Record<string, string>> = {
  explicit: '原文明确',
  inferred: '合理推断',
  'pending-confirmation': '待确认',
  'pending-design': '待补充',
};

const STATUS_LABEL: Readonly<Record<string, string>> = {
  draft: '草案',
  confirmed: '已确认',
  formal: '正式',
};

const STATUS_COLOR: Readonly<Record<string, string>> = {
  draft: 'bg-amber-500/10 text-amber-600',
  confirmed: 'bg-emerald-500/10 text-emerald-600',
  formal: 'bg-blue-500/10 text-blue-600',
};

const RELATION_LABEL: Readonly<Record<string, string>> = {
  ally: '盟友', enemy: '敌对', mentor: '师徒', lover: '恋人',
  family: '家人', colleague: '同事', rival: '竞争', other: '其他',
};

const FORESHADOWING_STATE_LABEL: Readonly<Record<string, string>> = {
  planted: '已埋设', advanced: '已推进', 'paid-off': '已回收', abandoned: '已放弃',
};

function ClaimDisplay({ claim, label }: { readonly claim: CredibleClaimDto; readonly label: string }): JSX.Element {
  if (claim.value.length === 0) return <span className="text-xs text-muted-foreground">{label}：—</span>;
  return (
    <div className="text-xs">
      <span className="font-medium text-foreground/80">{label}</span>
      <span className="ml-1">{claim.value}</span>
      <span className={`ml-1 rounded px-1 py-0.5 text-[10px] ${claim.credibility === 'explicit' ? 'bg-emerald-500/10 text-emerald-600' : claim.credibility === 'inferred' ? 'bg-blue-500/10 text-blue-600' : 'bg-amber-500/10 text-amber-600'}`}>
        {CREDIBILITY_LABEL[claim.credibility] ?? claim.credibility}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { readonly status: string }): JSX.Element {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_COLOR[status] ?? 'bg-gray-500/10 text-gray-600'}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/* ── 情节线 ──────────────────────────────────────────────────── */

function PlotThreadCard({ thread, onConfirm, onEdit }: { readonly thread: PlotThreadDto; readonly onConfirm: () => void; readonly onEdit: () => void }): JSX.Element {
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          <span className="font-medium">{thread.name}</span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{thread.kind === 'main' ? '主线' : '支线'}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={thread.status} />
          {thread.status !== 'formal' && <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onEdit}><Pencil className="mr-1 h-3 w-3" />修正</Button>}
          {thread.status === 'draft' && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onConfirm}>
              <CheckCircle2 className="mr-1 h-3 w-3" />确认
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-1">
        <ClaimDisplay claim={thread.goal} label="目标" />
        {thread.stages.length > 0 && (
          <div className="text-xs text-muted-foreground">
            阶段：{thread.stages.map((s) => s.kind).join(' → ')}
          </div>
        )}
        {thread.characterIds.length > 0 && (
          <div className="text-xs text-muted-foreground">涉及人物：{thread.characterIds.join('、')}</div>
        )}
        {thread.plotNodeIds.length > 0 && (
          <div className="text-xs text-muted-foreground">情节节点：{thread.plotNodeIds.length} 个</div>
        )}
      </div>
    </div>
  );
}

/* ── 人物 ──────────────────────────────────────────────────── */

function CharacterCard({ character, onConfirm, onEdit }: { readonly character: CharacterProfileDto; readonly onConfirm: () => void; readonly onEdit: () => void }): JSX.Element {
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="font-medium">{character.name}</span>
          {character.aliases.length > 0 && (
            <span className="text-xs text-muted-foreground">（{character.aliases.join('、')}）</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={character.status} />
          {character.status !== 'formal' && <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onEdit}><Pencil className="mr-1 h-3 w-3" />修正身份</Button>}
          {character.status === 'draft' && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onConfirm}>
              <CheckCircle2 className="mr-1 h-3 w-3" />确认
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-1">
        <ClaimDisplay claim={character.identity} label="身份" />
        <ClaimDisplay claim={character.personality} label="性格" />
        <ClaimDisplay claim={character.desire} label="欲望" />
        <ClaimDisplay claim={character.goal} label="目标" />
        <ClaimDisplay claim={character.fear} label="恐惧" />
        <ClaimDisplay claim={character.weakness} label="弱点" />
        <ClaimDisplay claim={character.currentStatus} label="现状" />
      </div>
    </div>
  );
}

/* ── 关系 ──────────────────────────────────────────────────── */

function RelationCard({ relation, characterMap, onConfirm, onEdit }: {
  readonly relation: CharacterRelationDto;
  readonly characterMap: ReadonlyMap<string, string>;
  readonly onConfirm: () => void;
  readonly onEdit: () => void;
}): JSX.Element {
  const fromName = characterMap.get(relation.fromCharacterId) ?? relation.fromCharacterId;
  const toName = characterMap.get(relation.toCharacterId) ?? relation.toCharacterId;
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Heart className="h-4 w-4 text-primary" />
          <span className="font-medium">{fromName} → {toName}</span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{RELATION_LABEL[relation.kind] ?? relation.kind}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={relation.status} />
          {relation.status !== 'formal' && <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onEdit}><Pencil className="mr-1 h-3 w-3" />修正</Button>}
          {relation.status === 'draft' && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onConfirm}>
              <CheckCircle2 className="mr-1 h-3 w-3" />确认
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2">
        <ClaimDisplay claim={relation.description} label="描述" />
      </div>
    </div>
  );
}

/* ── 成长弧 ──────────────────────────────────────────────────── */

function ArcCard({ arc, characterMap, onConfirm, onEdit }: {
  readonly arc: CharacterArcDto;
  readonly characterMap: ReadonlyMap<string, string>;
  readonly onConfirm: () => void;
  readonly onEdit: () => void;
}): JSX.Element {
  const characterName = characterMap.get(arc.characterId) ?? arc.characterId;
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="font-medium">{characterName}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={arc.status} />
          {arc.status !== 'formal' && <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onEdit}><Pencil className="mr-1 h-3 w-3" />修正</Button>}
          {arc.status === 'draft' && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onConfirm}>
              <CheckCircle2 className="mr-1 h-3 w-3" />确认
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-1">
        <div className="text-xs">{arc.description}</div>
        {arc.turningPoints.length > 0 && (
          <div className="text-xs text-muted-foreground">
            转折点：{arc.turningPoints.length} 个
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 伏笔 ──────────────────────────────────────────────────── */

function ForeshadowingCard({ foreshadowing }: { readonly foreshadowing: ForeshadowingDto }): JSX.Element {
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" />
          <span className="font-medium">{foreshadowing.description}</span>
        </div>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${
          foreshadowing.state === 'paid-off' ? 'bg-emerald-500/10 text-emerald-600' :
          foreshadowing.state === 'planted' ? 'bg-blue-500/10 text-blue-600' :
          foreshadowing.state === 'advanced' ? 'bg-purple-500/10 text-purple-600' :
          'bg-gray-500/10 text-gray-600'
        }`}>
          {FORESHADOWING_STATE_LABEL[foreshadowing.state] ?? foreshadowing.state}
        </span>
      </div>
    </div>
  );
}

/* ── 主组件 ──────────────────────────────────────────────────── */

type TabId = 'plotThreads' | 'characters' | 'relations' | 'arcs' | 'foreshadowings';

const TABS: ReadonlyArray<{ readonly id: TabId; readonly label: string; readonly icon: typeof GitBranch }> = [
  { id: 'plotThreads', label: '情节线', icon: GitBranch },
  { id: 'characters', label: '人物', icon: Users },
  { id: 'relations', label: '关系', icon: Heart },
  { id: 'arcs', label: '成长弧', icon: TrendingUp },
  { id: 'foreshadowings', label: '伏笔', icon: Lightbulb },
];

export function StoryAssetPanel({
  snapshot,
  loading,
  extracting,
  error,
  onExtractAssets,
  onConfirmAsset,
  onRefresh,
  onPublishAssets,
  onEditAsset,
}: StoryAssetPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('plotThreads');

  const characterMap = new Map<string, string>(
    (snapshot?.characters ?? []).map((c) => [c.id, c.name]),
  );

  const requestEdit = (kind: 'plotThread' | 'character' | 'relation' | 'arc', id: string, currentValue: string): void => {
    const value = window.prompt('修正内容', currentValue);
    if (value === null || value.trim().length === 0 || value.trim() === currentValue.trim()) return;
    const authorNote = window.prompt('修正依据或备注（可选）') ?? undefined;
    onEditAsset(kind, id, value.trim(), authorNote);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold">故事资产</h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading || extracting}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {snapshot !== undefined && snapshot.plotThreads.every((item) => item.status !== 'draft') && snapshot.characters.every((item) => item.status !== 'draft') && snapshot.relations.every((item) => item.status !== 'draft') && snapshot.arcs.every((item) => item.status !== 'draft') && snapshot.foreshadowings.every((item) => item.status !== 'draft') && (
            <Button variant="outline" size="sm" onClick={onPublishAssets} disabled={extracting}>发布正式版</Button>
          )}
          <Button variant="default" size="sm" onClick={onExtractAssets} disabled={extracting}>
            {extracting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
            {extracting ? '提炼中…' : '提炼故事资产'}
          </Button>
        </div>
      </div>

      {/* 错误提示 */}
      {error !== undefined && (
        <div className="flex items-center gap-2 border-b border-border bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* 提炼中提示 */}
      {extracting && (
        <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-4 py-2 text-xs text-primary">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在用 LLM 提炼故事资产，请稍候…
        </div>
      )}

      {/* 空状态 */}
      {snapshot === undefined && !loading && !extracting && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Sparkles className="h-8 w-8" />
          <p className="text-sm">尚无故事资产快照</p>
          <p className="text-xs">点击「提炼故事资产」从旧稿大纲中提炼情节线和人物</p>
        </div>
      )}

      {/* 快照内容 */}
      {snapshot !== undefined && (
        <>
          {/* 标签栏 */}
          <div className="flex border-b border-border px-2">
            {TABS.map((tab) => {
              const count = tab.id === 'plotThreads' ? snapshot.plotThreads.length
                : tab.id === 'characters' ? snapshot.characters.length
                : tab.id === 'relations' ? snapshot.relations.length
                : tab.id === 'arcs' ? snapshot.arcs.length
                : snapshot.foreshadowings.length;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors ${
                    activeTab === tab.id ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                  <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{count}</span>
                </button>
              );
            })}
          </div>

          {/* 内容区 */}
          <ScrollArea className="flex-1">
            <div className="space-y-2 p-3">
              {activeTab === 'plotThreads' && (
                snapshot.plotThreads.length === 0
                  ? <p className="text-xs text-muted-foreground">无情节线</p>
                  : snapshot.plotThreads.map((thread) => (
                    <PlotThreadCard
                      key={thread.id}
                      thread={thread}
                      onConfirm={() => onConfirmAsset('plotThread', thread.id)}
                      onEdit={() => requestEdit('plotThread', thread.id, thread.goal.value)}
                    />
                  ))
              )}
              {activeTab === 'characters' && (
                snapshot.characters.length === 0
                  ? <p className="text-xs text-muted-foreground">无人物档案</p>
                  : snapshot.characters.map((character) => (
                    <CharacterCard
                      key={character.id}
                      character={character}
                      onConfirm={() => onConfirmAsset('character', character.id)}
                      onEdit={() => requestEdit('character', character.id, character.identity.value)}
                    />
                  ))
              )}
              {activeTab === 'relations' && (
                snapshot.relations.length === 0
                  ? <p className="text-xs text-muted-foreground">无人物关系</p>
                  : snapshot.relations.map((relation) => (
                    <RelationCard
                      key={relation.id}
                      relation={relation}
                      characterMap={characterMap}
                      onConfirm={() => onConfirmAsset('relation', relation.id)}
                      onEdit={() => requestEdit('relation', relation.id, relation.description.value)}
                    />
                  ))
              )}
              {activeTab === 'arcs' && (
                snapshot.arcs.length === 0
                  ? <p className="text-xs text-muted-foreground">无成长弧</p>
                  : snapshot.arcs.map((arc) => (
                    <ArcCard
                      key={arc.id}
                      arc={arc}
                      characterMap={characterMap}
                      onConfirm={() => onConfirmAsset('arc', arc.id)}
                      onEdit={() => requestEdit('arc', arc.id, arc.description)}
                    />
                  ))
              )}
              {activeTab === 'foreshadowings' && (
                snapshot.foreshadowings.length === 0
                  ? <p className="text-xs text-muted-foreground">无伏笔</p>
                  : snapshot.foreshadowings.map((foreshadowing) => (
                    <ForeshadowingCard
                      key={foreshadowing.id}
                      foreshadowing={foreshadowing}
                    />
                  ))
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}
