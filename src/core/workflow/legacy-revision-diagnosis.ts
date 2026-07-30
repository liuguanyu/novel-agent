import type { ConsistencyIssue, FactView } from '../story-bible/index.js';
import type { AuthorIntent } from './types.js';

export type DiagnosisItemStatus = 'located' | 'evidence-found' | 'pending';

export interface DiagnosisMatch {
  readonly label: string;
  readonly anchorRefs: ReadonlyArray<string>;
  readonly details?: ReadonlyArray<string>;
}

export interface LegacyRevisionDiagnosisItem {
  readonly intent: AuthorIntent;
  readonly status: DiagnosisItemStatus;
  readonly matches: ReadonlyArray<DiagnosisMatch>;
  readonly linkedIssueIds: ReadonlyArray<string>;
}

export interface LegacyRevisionDiagnosis {
  readonly kind: 'legacy-revision-diagnosis';
  readonly factVersion: string;
  readonly generatedAt: number;
  readonly preservation: ReadonlyArray<LegacyRevisionDiagnosisItem>;
  readonly characterExtraction: ReadonlyArray<LegacyRevisionDiagnosisItem>;
  readonly removals: ReadonlyArray<LegacyRevisionDiagnosisItem>;
}

interface IdentifiedIssue {
  readonly issue: ConsistencyIssue;
  readonly issueId?: string;
}

function anchorRefs(sources: ReadonlyArray<{ readonly location: { readonly id: string; readonly kind: string } }>): ReadonlyArray<string> {
  return [...new Set(sources.map((source) => `${source.location.kind}:${source.location.id}`))];
}

function relatedText(intent: string, candidate: string): boolean {
  const left = intent.trim().toLocaleLowerCase();
  const right = candidate.trim().toLocaleLowerCase();
  return left.length > 0 && right.length > 0 && (left.includes(right) || right.includes(left));
}

function preservationItem(intent: AuthorIntent, view: FactView): LegacyRevisionDiagnosisItem {
  const entityMatches: DiagnosisMatch[] = view.entities.flatMap((entity) => {
    const names = [entity.canonicalName, ...entity.aliasSet.aliases];
    if (!names.some((name) => relatedText(intent.text, name))) return [];
    return [{
      label: entity.canonicalName,
      anchorRefs: anchorRefs(entity.provenance.sources),
      details: entity.attributes.map((attribute) => `${attribute.key}：${attribute.value}`),
    }];
  });
  const hookMatches: DiagnosisMatch[] = view.plotHooks.flatMap((hook) => relatedText(intent.text, hook.description)
    ? [{ label: hook.description, anchorRefs: [`${hook.plantedAt.kind}:${hook.plantedAt.id}`], details: [`伏笔状态：${hook.state}`] }]
    : []);
  const matches = [...entityMatches, ...hookMatches];
  return { intent, status: matches.length > 0 ? 'located' : 'pending', matches, linkedIssueIds: [] };
}

function extractionItem(intent: AuthorIntent, view: FactView): LegacyRevisionDiagnosisItem {
  const namedPeople = view.entities.filter((entity) => entity.type === 'person' && (
    relatedText(intent.text, entity.canonicalName) || entity.aliasSet.aliases.some((alias) => relatedText(intent.text, alias))
  ));
  const people = namedPeople.length > 0 ? namedPeople : view.entities.filter((entity) => entity.type === 'person');
  const matches = people.flatMap((entity): DiagnosisMatch[] => {
    if (entity.attributes.length === 0) return [];
    const sources = entity.attributes.flatMap((attribute) => attribute.provenance.sources);
    return [{
      label: entity.canonicalName,
      anchorRefs: anchorRefs(sources.length > 0 ? sources : entity.provenance.sources),
      details: entity.attributes.map((attribute) => `${attribute.key}：${attribute.value}（${attribute.status}）`),
    }];
  });
  return { intent, status: matches.length > 0 ? 'evidence-found' : 'pending', matches, linkedIssueIds: [] };
}

function removalIssueMatches(text: string, issue: ConsistencyIssue): boolean {
  if (relatedText(text, issue.description) || relatedText(text, issue.type)) return true;
  const normalized = text.toLocaleLowerCase();
  if ((normalized.includes('矛盾') || normalized.includes('冲突')) && ['state-contradiction', 'timeline-break', 'spatial-inconsistency', 'naming-conflict'].includes(issue.type)) return true;
  if ((normalized.includes('ooc') || normalized.includes('人物') || normalized.includes('性格')) && issue.type === 'behavior-ooc') return true;
  if ((normalized.includes('伏笔') || normalized.includes('线索')) && issue.type === 'plot-hook-dangling') return true;
  if (normalized.includes('时间线') && issue.type === 'timeline-break') return true;
  return false;
}

function removalItem(intent: AuthorIntent, issues: ReadonlyArray<IdentifiedIssue>): LegacyRevisionDiagnosisItem {
  const matched = issues.filter(({ issue }) => removalIssueMatches(intent.text, issue));
  return {
    intent,
    status: matched.length > 0 ? 'evidence-found' : 'pending',
    matches: matched.map(({ issue }) => ({
      label: issue.description,
      anchorRefs: issue.anchors.map((anchor) => `${anchor.kind}:${anchor.id}`),
      ...(issue.suggestedFix === undefined ? {} : { details: [issue.suggestedFix] }),
    })),
    linkedIssueIds: matched.flatMap(({ issueId }) => issueId === undefined ? [] : [issueId]),
  };
}

export function buildLegacyRevisionDiagnosis(
  intents: ReadonlyArray<AuthorIntent>,
  view: FactView,
  issues: ReadonlyArray<IdentifiedIssue>,
  generatedAt = Date.now(),
): LegacyRevisionDiagnosis {
  return {
    kind: 'legacy-revision-diagnosis',
    factVersion: view.version as string,
    generatedAt,
    preservation: intents.filter((intent) => intent.kind === 'preserve').map((intent) => preservationItem(intent, view)),
    characterExtraction: intents.filter((intent) => intent.kind === 'extract').map((intent) => extractionItem(intent, view)),
    removals: intents.filter((intent) => intent.kind === 'remove').map((intent) => removalItem(intent, issues)),
  };
}
