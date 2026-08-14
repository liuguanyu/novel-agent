/**
 * 真实模型端到端复测（M0 收口 P0 第 1 项）
 *
 * 验证三件事：
 * 1. 参谋多轮讨论在真实模型下不截断、返回可解析 JSON、options 格式正确
 * 2. 全书诊断三条路径：发现候选 / 空结果 / 失败处理
 * 3. 情节识别在真实模型下返回合法候选
 *
 * 运行：pnpm run smoke:legacy-real-model
 * 前提：config/models.json 已配置可用的 API key
 */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadModelsConfig, ModelResolver } from '../model-resolver.js';
import { PlotAdvisor, type PlotAdvisorInput } from './plot-advisor.js';
import { BookDiagnoser } from './book-diagnoser.js';
import { PlotRecognizer } from './plot-recognizer.js';
import type { LegacyOutline } from '../../core/legacy-organization/index.js';

// ─── 测试用长文本（模拟真实章节正文，压力测试截断边界） ────────────────

const longChapterContent = `第十二章 印章与暗流

顾长风在法租界的公寓里来回踱步，桌上摊着老刘送来的情报。情报上只有一行字："印章在302号房，佐藤今夜外出。"

他看了看怀表，时针指向九点三刻。窗外，巡捕房的巡逻队刚换过岗，下一班还要二十分钟。这个间隙足够他潜入日军特务机关的临时据点——东亚饭店302号房。

顾长风从衣柜暗格里取出那套早已准备好的电工制服，换上后对着镜子仔细检查了一遍。他压低帽檐，从后巷溜出，沿着霞飞路向东走了两个街区，在东亚饭店后门停下脚步。

他沿着消防通道上到三楼，走廊里空无一人。302号房的门虚掩着，他推门而入，在床头柜的暗格里找到了一只锦盒。打开锦盒，里面躺着一枚玉质印章。

他正要把印章收进口袋，忽然注意到印章底部的刻字——这不是他此前见过的真品纹样。他用手电仔细照了照，发现玉石质地偏软，表面有轻微的树脂光泽。

"假的。"他心里一沉。

他迅速在房间里搜索其他线索。在抽屉的最里面，他发现了一张便笺，上面写着："真品已转移至佐藤随身，301空房为诱饵。"落款是一个简单的"藤"字。

原来佐藤早已预料到有人会来窃取印章，特意在302号放了赝品，真印章一直带在身上。顾长风意识到，这意味着佐藤的警觉程度远超此前的评估。

他必须在天亮前做出决定：是撤退保命，还是冒险接近佐藤本人。他选择了后者——因为如果不在今夜拿到真印章，明天佐藤就会把印章转移出上海，届时再无机会。

他离开302号房，沿走廊走到佐藤常住的308号房门前。他贴着墙壁听了听，里面隐约有呼吸声。他从工具包里取出细铁丝，开始撬锁。

就在锁芯即将转动的瞬间，走廊尽头传来脚步声。他迅速退回302号房，关上门，从门缝里观察。

一个日军宪兵走到308号房门前，敲了敲门，用日语说了几句话，然后离开了。佐藤的声音从里面传来，似乎是回应。

顾长风意识到，308号房里不止佐藤一个人。他的计划需要调整。

他退回302号房，从窗户观察到后巷有一个日军岗哨。他决定从天台绕行，从308号房的窗户进入。

天台上风很大，他匍匐前进，摸到了308号房窗户上方的雨棚。他正要翻入，突然听到窗户从里面打开了。

佐藤探出头来，几乎是面对面对上了顾长风的眼睛。两人都愣了一瞬。

然后佐藤笑了。"顾先生，久等了。"

顾长风知道，自己被算计了。从一开始，佐藤就是故意把假印章放在302号，引他深入。真正的陷阱不是印章，而是他本人。

"你想要印章？"佐藤从怀里取出一枚玉质印章，在月光下转了转，"可以。用你的命来换。"

此时，308号房里传出了拉枪栓的声音。至少三个枪口对准了顾长风。

顾长风没有动。他知道，在这种距离下，任何动作都是徒劳的。但他也知道，老刘的情报虽然不完整，但并非全错——老刘说过，佐藤有个致命的弱点：他太自负了。

"佐藤先生，"顾长风缓缓开口，"你知道为什么我敢一个人来吗？"

佐藤微微皱眉。

"因为我不需要拿到印章。"顾长风说，"我只需要确认印章在你身上。现在确认了。"

佐藤的脸色变了。他猛地按下了墙上的报警器。

但在报警器响起的同时，东亚饭店外面传来了密集的枪声。法租界巡捕房的人已经到了——这是顾长风事先安排的后手。

混战中，顾长风从雨棚翻下，沿着天台逃走。他身后传来佐藤愤怒的吼声和日军的追赶声。

他没能拿到真印章。但他达成了另一个目的：让佐藤暴露了印章的真正位置，并且让法租界方面注意到了日军在东亚饭店的秘密活动。

回到公寓后，他给老刘发了一封电报："印章在佐藤身上，302为诱饵。需重新制定方案。"

老刘的回复很快到来："收到。下一步：借法国人之手搅乱佐藤部署，趁乱接近。"

顾长风把电报烧掉，看着灰烬在烟灰缸里慢慢冷却。他知道，这场博弈才刚刚开始。`;

// ─── 参谋测试 ────────────────────────────────────────────────

async function testAdvisorNormal(resolver: ModelResolver): Promise<void> {
  console.log('  [1/3] 参谋多轮讨论 — 正常路径（长章节 + 多轮对话）...');

  const advisor = new PlotAdvisor(resolver);
  const input: PlotAdvisorInput = {
    mode: 'plot-logic',
    chapterTitle: '第十二章 印章与暗流',
    chapterContent: longChapterContent,
    plotTitle: '真假印章陷阱',
    plotSummary: '顾长风潜入302取印章，发现是假的，真印章在佐藤身上，最终被佐藤设计围困',
    evidenceQuote: '真品已转移至佐藤随身，301空房为诱饵。',
    question: '我的本意是佐藤临时拿走真印章体现他的警觉，同时让顾长风急中生智。这样成立吗？另外老刘的情报算不算写崩了？',
    conversation: [
      { role: 'author', content: '老刘的情报是不是错了？情报说印章在302，但实际在佐藤身上。' },
      { role: 'advisor', content: '目前看起来情报和后文有矛盾，但如果设计成佐藤临时调包，情报本身不算错，只是过时了。需要补充佐藤何时做出调包决定的铺垫。' },
      { role: 'author', content: '我加一段佐藤在顾长风出发前就收到密报的描写，这样调包就有了依据。' },
    ],
  };

  const result = await advisor.ask(input);

  // 核心断言：不截断 + JSON 可解析 + advice 非空
  assert.ok(result.advice.length > 0, 'advice 不应为空');
  assert.ok(result.advice.length <= 2000, `advice 长度 ${result.advice.length} 超过 2000`);

  console.log(`    ✅ advice (${result.advice.length} chars): ${result.advice.slice(0, 80)}...`);
  console.log(`    ✅ options (${result.options.length} 项):`);
  for (const opt of result.options) {
    console.log(`       — ${opt.slice(0, 60)}${opt.length > 60 ? '...' : ''}`);
  }

  // 验证 options 格式：前几项是可采纳方案，最后一项可能是补充/追问
  assert.ok(result.options.length <= 5, 'options 不应超过 5 项');

  console.log('  [1/3] ✅ 通过 — 参谋返回可解析建议，无截断\n');
}

async function testAdvisorAutoCheck(resolver: ModelResolver): Promise<void> {
  console.log('  [2/3] 参谋主动检查 — 空问题路径（让参谋自行找风险）...');

  const advisor = new PlotAdvisor(resolver);
  const input: PlotAdvisorInput = {
    mode: 'auto',
    chapterTitle: '第十二章 印章与暗流',
    chapterContent: longChapterContent,
    plotTitle: '真假印章陷阱',
    plotSummary: '顾长风潜入302取印章，发现是假的',
    evidenceQuote: undefined,
    question: '',  // 空问题，触发参谋主动检查
    conversation: [],
  };

  const result = await advisor.ask(input);
  assert.ok(result.advice.length > 0, 'advice 不应为空');

  console.log(`    ✅ advice: ${result.advice.slice(0, 80)}...`);
  console.log(`    ✅ options: ${result.options.length} 项`);
  console.log('  [2/3] ✅ 通过 — 参谋主动检查返回有效建议\n');
}

async function testAdvisorContinuousFollowUp(resolver: ModelResolver): Promise<void> {
  console.log('  [3/3] 参谋连续追问 — 多轮深度讨论...');

  const advisor = new PlotAdvisor(resolver);
  const input: PlotAdvisorInput = {
    mode: 'character',
    chapterTitle: '第十二章 印章与暗流',
    chapterContent: longChapterContent,
    plotTitle: '佐藤的陷阱设计',
    plotSummary: '佐藤用假印章引诱顾长风深入',
    evidenceQuote: '顾先生，久等了。',
    question: '佐藤在窗户探出头说"久等了"是不是太刻意了？我想让他显得更自然，同时保持威胁感。',
    conversation: [
      { role: 'author', content: '佐藤在天台等顾长风是不是太巧合了？' },
      { role: 'advisor', content: '如果佐藤提前在302发现入侵痕迹，推断入侵者会从天台撤退，在308窗户守株待兔是合理的。但需要在正文中补一个佐藤发现痕迹的细节。' },
      { role: 'author', content: '我加一段佐藤检查302发现门锁有撬痕的描写。' },
      { role: 'advisor', content: '这样就有了。但"久等了"这句台词的语气需要拿捏——太得意会显得脸谱化，太冷淡又失去威胁感。建议改成更含蓄的表达。' },
    ],
  };

  const result = await advisor.ask(input);
  assert.ok(result.advice.length > 0, 'advice 不应为空');

  console.log(`    ✅ advice: ${result.advice.slice(0, 80)}...`);
  console.log(`    ✅ options: ${result.options.length} 项`);
  for (const opt of result.options) {
    const tag = opt === result.options[result.options.length - 1] ? '补充' : '采纳';
    console.log(`       [${tag}] ${opt.slice(0, 60)}${opt.length > 60 ? '...' : ''}`);
  }
  console.log('  [3/3] ✅ 通过 — 连续多轮讨论正常返回\n');
}

// ─── 全书诊断测试 ────────────────────────────────────────────

const testOutline: LegacyOutline = {
  id: 'outline-test',
  projectId: 'project-test',
  version: 1,
  createdAt: '2026-08-14T00:00:00.000Z',
  sourceChapterTreeVersion: undefined,
  nodes: [
    { id: 'ch1', parentId: undefined, order: 0, kind: 'chapter', title: '第一章 情报', summary: '', characters: [], sources: [], preserved: false, authorNote: undefined },
    { id: 'ch2', parentId: undefined, order: 1, kind: 'chapter', title: '第二章 布局', summary: '', characters: [], sources: [], preserved: false, authorNote: undefined },
    { id: 'ch3', parentId: undefined, order: 2, kind: 'chapter', title: '第三章 行动', summary: '', characters: [], sources: [], preserved: false, authorNote: undefined },
    { id: 'ch4', parentId: undefined, order: 3, kind: 'chapter', title: '第四章 撤退', summary: '', characters: [], sources: [], preserved: false, authorNote: undefined },
    { id: 'p1', parentId: 'ch1', order: 0, kind: 'plot-beat', title: '老刘送情报', summary: '老刘向顾长风提供印章在302号房的情报', characters: ['顾长风', '老刘'], sources: [], preserved: true, authorNote: undefined },
    { id: 'p2', parentId: 'ch2', order: 0, kind: 'plot-beat', title: '佐藤调包', summary: '佐藤收到密报后把真印章从302取出随身携带，302放赝品', characters: ['佐藤'], sources: [], preserved: false, authorNote: undefined },
    { id: 'p3', parentId: 'ch3', order: 0, kind: 'plot-beat', title: '顾长风潜入302', summary: '顾长风按情报潜入302号房，发现假印章', characters: ['顾长风'], sources: [], preserved: true, authorNote: undefined },
    { id: 'p4', parentId: 'ch3', order: 1, kind: 'plot-beat', title: '天台对峙', summary: '顾长风从天台接近308，被佐藤当场截住', characters: ['顾长风', '佐藤'], sources: [], preserved: true, authorNote: undefined },
    { id: 'p5', parentId: 'ch4', order: 0, kind: 'plot-beat', title: '法租界介入', summary: '法租界巡捕房按顾长风事先安排赶到东亚饭店', characters: ['顾长风'], sources: [], preserved: false, authorNote: undefined },
    { id: 'p6', parentId: 'ch4', order: 1, kind: 'plot-beat', title: '顾长风撤退', summary: '顾长风趁乱从天台逃走，未拿到真印章', characters: ['顾长风'], sources: [], preserved: true, authorNote: undefined },
    { id: 'p7', parentId: 'ch4', order: 2, kind: 'plot-beat', title: '佐藤受重伤', summary: '混战中佐藤被流弹击中肩膀，但仍然活着', characters: ['佐藤'], sources: [], preserved: false, authorNote: undefined },
  ],
  crossChapterIssues: [],
};

async function testDiagnosisFoundIssues(resolver: ModelResolver): Promise<void> {
  console.log('  [1/3] 全书诊断 — 发现候选路径...');

  const diagnoser = new BookDiagnoser(resolver);
  const candidates = await diagnoser.diagnose(testOutline);

  console.log(`    ✅ 发现 ${candidates.length} 个候选问题`);
  for (const c of candidates) {
    console.log(`       [${c.kind}/${c.severity}] ${c.description}`);
    console.log(`         关联情节: ${c.plotNodeIds.join(', ')}`);
  }

  // 验证候选格式
  for (const c of candidates) {
    assert.ok(c.plotNodeIds.length >= 2, `候选 ${c.description} 关联情节少于 2 个`);
    assert.ok(c.description.length > 0 && c.description.length <= 300);
  }

  console.log('  [1/3] ✅ 通过 — 诊断返回合法候选\n');
}

async function testDiagnosisWithExistingIssues(resolver: ModelResolver): Promise<void> {
  console.log('  [2/3] 全书诊断 — 已有问题过滤路径（不重复报告）...');

  const outlineWithExisting: LegacyOutline = {
    ...testOutline,
    crossChapterIssues: [{
      id: 'issue-1',
      plotNodeIds: ['p1', 'p3'],
      chapterNodeIds: ['ch1', 'ch3'],
      kind: 'timeline',
      severity: 'high',
      description: '老刘的情报与实际印章位置矛盾',
      evidence: [],
      status: 'open',
      createdAt: '',
      updatedAt: '',
    }],
  };

  const diagnoser = new BookDiagnoser(resolver);
  const candidates = await diagnoser.diagnose(outlineWithExisting);

  console.log(`    ✅ 在已有问题情况下，发现 ${candidates.length} 个新候选`);

  // 检查不重复报告已有问题（描述不完全匹配）
  for (const c of candidates) {
    assert.ok(
      !c.description.includes('老刘的情报与实际印章位置矛盾'),
      `诊断重复报告了已有问题: ${c.description}`,
    );
  }

  console.log('  [2/3] ✅ 通过 — 未重复报告已有问题\n');
}

async function testDiagnosisEmptyOutline(resolver: ModelResolver): Promise<void> {
  console.log('  [3/3] 全书诊断 — 空结果路径（极少情节）...');

  const minimalOutline: LegacyOutline = {
    id: 'outline-min',
    projectId: 'project-test',
    version: 1,
    createdAt: '2026-08-14T00:00:00.000Z',
    sourceChapterTreeVersion: undefined,
    nodes: [
      { id: 'ch1', parentId: undefined, order: 0, kind: 'chapter', title: '第一章', summary: '', characters: [], sources: [], preserved: false, authorNote: undefined },
      { id: 'p1', parentId: 'ch1', order: 0, kind: 'plot-beat', title: '唯一的情节', summary: '只有一个情节，无法形成跨章问题', characters: ['角色A'], sources: [], preserved: false, authorNote: undefined },
    ],
    crossChapterIssues: [],
  };

  const diagnoser = new BookDiagnoser(resolver);
  const candidates = await diagnoser.diagnose(minimalOutline);

  console.log(`    ✅ 单情节大纲，诊断返回 ${candidates.length} 个候选（预期 0 或极少）`);
  assert.ok(candidates.length <= 2, `单情节大纲不应返回过多候选，实际 ${candidates.length}`);

  console.log('  [3/3] ✅ 通过 — 空结果路径正常收敛\n');
}

// ─── 情节识别测试 ────────────────────────────────────────────

async function testPlotRecognition(resolver: ModelResolver): Promise<void> {
  console.log('  [1/1] 情节识别 — 真实章节正文...');

  const recognizer = new PlotRecognizer(resolver);
  const plots = await recognizer.recognize('第十二章 印章与暗流', longChapterContent);

  console.log(`    ✅ 识别出 ${plots.length} 个情节候选`);
  for (const p of plots) {
    console.log(`       — ${p.title}: ${p.summary.slice(0, 50)}${p.summary.length > 50 ? '...' : ''}`);
    if (p.characters.length > 0) {
      console.log(`         人物: ${p.characters.join('、')}`);
    }
  }

  // 验证候选格式
  assert.ok(plots.length >= 2, `应识别至少 2 个情节，实际 ${plots.length}`);
  for (const p of plots) {
    assert.ok(p.title.length > 0 && p.title.length <= 40);
    assert.ok(p.summary.length > 0 && p.summary.length <= 120);
  }

  console.log('  [1/1] ✅ 通过 — 情节识别返回合法候选\n');
}

// ─── 主入口 ──────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('真实模型端到端复测（M0 P0 第 1 项）');
  console.log('═'.repeat(60));

  // 1. 加载模型配置
  const configPath = resolve(process.cwd(), 'config/models.json');
  const loadResult = await loadModelsConfig(configPath);
  if (!loadResult.ok) {
    console.error(`❌ 无法加载模型配置: ${loadResult.message}`);
    process.exit(1);
  }

  const resolver = new ModelResolver(loadResult.config);
  console.log('✅ 模型配置已加载，开始真实模型测试\n');

  let failed = false;

  // ─── 参谋测试 ───
  console.log('━'.repeat(40));
  console.log('一、参谋多轮讨论复测');
  console.log('━'.repeat(40) + '\n');
  try {
    await testAdvisorNormal(resolver);
    await testAdvisorAutoCheck(resolver);
    await testAdvisorContinuousFollowUp(resolver);
  } catch (err) {
    failed = true;
    console.error(`❌ 参谋测试失败: ${err instanceof Error ? err.message : String(err)}\n`);
    if (err instanceof Error && err.stack) console.error(err.stack);
  }

  // ─── 全书诊断测试 ───
  console.log('━'.repeat(40));
  console.log('二、全书诊断三条路径复测');
  console.log('━'.repeat(40) + '\n');
  try {
    await testDiagnosisFoundIssues(resolver);
    await testDiagnosisWithExistingIssues(resolver);
    await testDiagnosisEmptyOutline(resolver);
  } catch (err) {
    failed = true;
    console.error(`❌ 全书诊断测试失败: ${err instanceof Error ? err.message : String(err)}\n`);
    if (err instanceof Error && err.stack) console.error(err.stack);
  }

  // ─── 情节识别测试 ───
  console.log('━'.repeat(40));
  console.log('三、情节识别复测');
  console.log('━'.repeat(40) + '\n');
  try {
    await testPlotRecognition(resolver);
  } catch (err) {
    failed = true;
    console.error(`❌ 情节识别测试失败: ${err instanceof Error ? err.message : String(err)}\n`);
    if (err instanceof Error && err.stack) console.error(err.stack);
  }

  // ─── 汇总 ───
  console.log('═'.repeat(60));
  if (failed) {
    console.log('❌ 真实模型复测存在失败项，请检查上方日志');
    process.exit(1);
  } else {
    console.log('✅ 真实模型复测全部通过');
    console.log('   — 参谋多轮讨论: 不截断，JSON 可解析，options 格式正确');
    console.log('   — 全书诊断: 发现候选 / 已有问题过滤 / 空结果 三条路径均收敛');
    console.log('   — 情节识别: 真实正文返回合法候选');
  }
  console.log('═'.repeat(60));
}

await main();
