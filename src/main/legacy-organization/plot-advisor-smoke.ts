import assert from 'node:assert/strict';
import type { ModelCallInput, ModelResult } from '../../core/model/index.js';
import { PlotAdvisor, renderPlotAdvisorPrompt, type PlotAdvisorInput } from './plot-advisor.js';

function smokeConversationContext(): void {
  const prompt = renderPlotAdvisorPrompt({
    mode: 'plot-logic',
    chapterTitle: '第十二章 印章',
    chapterContent: '老刘说印章在302。顾长风后来发现302里的印章是假的，真印章在佐藤身上。',
    plotTitle: '真假印章',
    plotSummary: '顾长风根据情报潜入302，却发现假印章。',
    evidenceQuote: '真印章在佐藤身上。',
    question: '我的本意是佐藤临时拿走真印章，体现他的警觉，同时让顾长风急中生智。这样成立吗？',
    conversation: [
      { role: 'author', content: '老刘的情报是不是错了？' },
      { role: 'advisor', content: '目前看起来情报和后文有矛盾，需要补充解释。' },
    ],
  });

  assert.match(prompt, /此前讨论/);
  assert.match(prompt, /作者：老刘的情报是不是错了/);
  assert.match(prompt, /参谋：目前看起来情报和后文有矛盾/);
  assert.match(prompt, /佐藤临时拿走真印章/);
  assert.match(prompt, /优先判断这种意图是否成立/);
  assert.match(prompt, /最后一项写成需要作者补充确认的问题/);
}

function smokeConversationBound(): void {
  const conversation = Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 === 0 ? 'author' as const : 'advisor' as const,
    content: `第${index + 1}条讨论`,
  }));
  const prompt = renderPlotAdvisorPrompt({
    mode: 'auto',
    chapterTitle: '测试章节',
    chapterContent: '正文',
    plotTitle: '测试情节',
    plotSummary: '摘要',
    evidenceQuote: undefined,
    question: '继续讨论',
    conversation,
  });

  assert.doesNotMatch(prompt, /第1条讨论/);
  assert.doesNotMatch(prompt, /第2条讨论/);
  assert.match(prompt, /第3条讨论/);
  assert.match(prompt, /第14条讨论/);
}

const modelInput: PlotAdvisorInput = {
  mode: 'auto',
  chapterTitle: '测试章节',
  chapterContent: '正文',
  plotTitle: '测试情节',
  plotSummary: '摘要',
  evidenceQuote: undefined,
  question: '',
  conversation: [],
};

async function smokeModelCall(): Promise<void> {
  let capturedInput: ModelCallInput | undefined;
  const advisor = new PlotAdvisor({
    createAdapter: () => ({
      complete: async (input): Promise<ModelResult> => {
        capturedInput = input;
        return {
          text: '{"advice":"暂未发现明确风险","options":[]}',
          finishReason: 'stop',
        };
      },
    }),
  });

  assert.deepEqual(await advisor.ask(modelInput), { advice: '暂未发现明确风险', options: [] });
  assert.equal(capturedInput?.options?.maxTokens, 8_192);
}

async function smokeTruncatedResponse(): Promise<void> {
  const advisor = new PlotAdvisor({
    createAdapter: () => ({
      complete: async () => ({ text: '{"advice":"未完成', finishReason: 'length' }),
    }),
  });
  await assert.rejects(() => advisor.ask(modelInput), /参谋建议被截断，请重试/);
}

smokeConversationContext();
smokeConversationBound();
await smokeModelCall();
await smokeTruncatedResponse();
console.log('plot-advisor smoke passed');
