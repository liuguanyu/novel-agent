/** 旧稿情节识别器冒烟测试。 */

import type { CapabilityTier, ModelAdapter } from '../../core/model/index.js';
import {
  PlotRecognizer,
  parsePlotRecognitionOutput,
  renderPlotRecognitionPrompt,
  splitChapterContent,
  type PlotRecognizerModelResolver,
} from './plot-recognizer.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail.length > 0 ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function smokeParser(): void {
  const parsed = parsePlotRecognitionOutput(JSON.stringify({
    plots: [
      {
        title: '沈砚发现袖口铜钱'.repeat(5),
        summary: '沈砚验尸时发现异常铜钱，并判断案件可能牵涉三年前旧案。'.repeat(5),
        quote: '他从死者袖口摸出一枚带着暗红锈迹的铜钱。'.repeat(10),
        characters: ['沈砚', '沈砚', '仵作'],
      },
      {
        title: '沈砚追查铜钱来源',
        summary: '沈砚前往旧货铺追查铜钱来源，却发现掌柜已经失踪。',
        quote: '铺门半掩，柜台后的账册还摊着，人却不见了。',
        characters: ['沈砚', '掌柜'],
      },
    ],
  }));
  check('有效 JSON 解析为语义情节候选', parsed.length === 2);
  check(
    '候选短文本被限制且人物去重',
    (parsed[0]?.title.length ?? 0) <= 40 &&
      (parsed[0]?.summary.length ?? 0) <= 120 &&
      (parsed[0]?.quote.length ?? 0) <= 160 &&
      parsed[0]?.characters.length === 2,
  );

  let rejected = false;
  try {
    parsePlotRecognitionOutput('沈砚发现了铜钱，所以这是第一段情节。');
  } catch {
    rejected = true;
  }
  check('非法模型文本被明确拒绝而非降级为正文候选', rejected);
}

function smokeLongChapterSplit(): void {
  const long = `${'甲'.repeat(23_900)}。\n\n${'乙'.repeat(23_900)}。\n\n${'丙'.repeat(23_900)}。`;
  const segments = splitChapterContent(long);
  check('长章节被完整分片而非截断', segments.length >= 3 && segments.join('') === long);
  check('每个分片都在安全字符上限内', segments.every((segment) => segment.length <= 30_000));
}

class FakeResolver implements PlotRecognizerModelResolver {
  createAdapter(agentId: string, tier: CapabilityTier): Pick<ModelAdapter, 'complete'> {
    check('识别器使用 architect + cheap-fast 模型档位', agentId === 'architect' && tier === 'cheap-fast');
    return {
      complete: async () => ({
        text: JSON.stringify({
          plots: [
            { title: '发现铜钱', summary: '沈砚验尸时发现异常铜钱。', quote: '袖口里滚出一枚铜钱。', characters: ['沈砚'] },
            { title: '追查旧案', summary: '沈砚由铜钱联想到三年前旧案并决定追查。', quote: '这纹样，他三年前见过。', characters: ['沈砚'] },
          ],
        }),
        finishReason: 'stop',
      }),
    };
  }
}

class LongChapterResolver implements PlotRecognizerModelResolver {
  calls = 0;

  createAdapter(): Pick<ModelAdapter, 'complete'> {
    return {
      complete: async (input) => {
        this.calls += 1;
        const isMerge = input.messages.some((message) => message.content.includes('sourceCandidateIds'));
        if (isMerge) {
          return {
            text: JSON.stringify({
              plots: [
                { title: '跨段追踪', summary: '沈砚沿线索连续追踪目标。', characters: ['沈砚'], sourceCandidateIds: ['s1-p1', 's2-p2'] },
                { title: '发现密室', summary: '沈砚最终发现藏匿证据的密室。', characters: ['沈砚'], sourceCandidateIds: ['s3-p3'] },
              ],
            }),
            finishReason: 'stop' as const,
          };
        }
        return {
          text: JSON.stringify({ plots: [{ title: `分段事件${this.calls}`, summary: '沈砚继续追踪线索。', quote: '他沿着足迹追去。', characters: ['沈砚'] }] }),
          finishReason: 'stop' as const,
        };
      },
    };
  }
}

async function smokeRecognizer(): Promise<void> {
  const prompt = renderPlotRecognitionPrompt('第一章 铜钱', '沈砚验尸时发现一枚铜钱。');
  check(
    'prompt 要求按故事事件识别且禁止整章复述',
    prompt.includes('不要按段落均分') && prompt.includes('绝不能复制大段正文') && prompt.includes('2–8 个主要情节'),
  );
  const plots = await new PlotRecognizer(new FakeResolver()).recognize('第一章 铜钱', '沈砚验尸时发现一枚铜钱。');
  check('识别器返回少量结构化候选', plots.length === 2 && plots[0]?.title === '发现铜钱');

  const resolver = new LongChapterResolver();
  const longContent = `${'第一段正文。'.repeat(4_500)}\n\n${'第二段正文。'.repeat(4_500)}\n\n${'第三段正文。'.repeat(4_500)}`;
  const progress: string[] = [];
  const merged = await new PlotRecognizer(resolver).recognize('长章节', longContent, ({ segment, totalSegments }) => {
    progress.push(`${segment}/${totalSegments}`);
  });
  check('长章节逐段调用后再执行章节归并', resolver.calls === progress.length + 1 && progress.length > 1);
  check('归并结果保留章节级主要情节', merged.length === 2 && merged[0]?.title === '跨段追踪');
}

smokeParser();
smokeLongChapterSplit();
await smokeRecognizer();

if (failures > 0) {
  console.error(`\n${failures} 项旧稿情节识别冒烟检查失败`);
  process.exitCode = 1;
} else {
  console.log('\n旧稿情节识别冒烟检查全部通过');
}
