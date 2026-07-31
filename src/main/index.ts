/**
 * Main 进程入口（最小骨架）。
 *
 * 职责边界（见 docs/conventions.md）：应用生命周期、窗口管理、协调、异步 I/O。
 * 本文件仅做窗口创建与生命周期管理；不含任何小说业务逻辑（业务在后续 change）。
 */

import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerIpcHandlers, loadModelsConfig, ModelResolver } from './ipc-handlers.js';
import { OrchestrationRuntime } from './orchestration/runtime.js';
import { UtilityProcessAuditRunner } from './audit/utility-process-audit-runner.js';
import { UtilityProcessDiffRunner } from './refactor/utility-process-diff-runner.js';
import { UtilityProcessEmbedRunner } from './corpus/utility-process-embed-runner.js';
import { InMemoryCorpusStore } from './corpus/corpus-store.js';
import { getOrchestrationLogPath, appendOrchestrationLog } from './local-log.js';
import {
  openDatabase,
  SqliteDatabase,
  SqliteCheckpointer,
  SqliteFactStore,
  WorkflowRepository, CreativeAssetRepository, WorkflowIssueRepository,
  SqliteStageRunEvidenceRecorder, SqliteContinuationRecordService, TaskRunRepository,
} from './db/index.js';
import { WorkflowApplicationService } from './workflow-application-service.js';

const baseDir = dirname(fileURLToPath(import.meta.url));

/** 当前可用的模型解析器；配置未就绪时为 undefined（对话请求回结构化错误，不崩溃）。 */
let modelResolver: ModelResolver | undefined;

/**
 * 持久化服务容器。SQLite 不可用时保持 undefined（不崩溃）——
 * 本波 checkpoint/事实库尚未接编排（I3/I4），故仅初始化并预留，供后续波次注入。
 */
let persistence:
  | { db: SqliteDatabase; checkpointer: SqliteCheckpointer; factStore: SqliteFactStore }
  | undefined;

/** 长驻编排运行时：持有单一有状态图 + checkpointer 接线（I3）。 */
let orchestration: OrchestrationRuntime | undefined;

/** 全书总检派发器（I5）：经 utilityProcess worker 执行，worker 不可用时内部回退内联。 */
const auditRunner = new UtilityProcessAuditRunner();

/** 局部重构 diff 派发器（I6）：经 utilityProcess worker 执行，worker 不可用时内部回退内联。 */
const diffRunner = new UtilityProcessDiffRunner();

/** 素材 embedding 派发器（I7）：经 utilityProcess worker 执行，worker 不可用时内部回退内联。 */
const embedRunner = new UtilityProcessEmbedRunner();

/** 素材向量存储（I7）：本 change 以进程内存储兑现接口（选型未锁定，待后续 change 替换）。 */
const corpusStore = new InMemoryCorpusStore();

/** 打开 SQLite 并组装持久化服务；失败走 console.warn，与 modelResolver 容错同构。 */
async function initPersistence(): Promise<void> {
  const dbPath = join(app.getPath('userData'), 'novel-agent.db');
  const result = await openDatabase(dbPath);
  if (result.ok) {
    persistence = {
      db: result.db,
      checkpointer: new SqliteCheckpointer(result.db),
      factStore: new SqliteFactStore(result.db),
    };
  } else {
    // SQLite 不可用（如运行时 Node 缺 node:sqlite）不崩溃：本波无编排依赖它，窗口照常。
    console.warn(`[persistence] ${result.reason}: ${result.message}`);
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(baseDir, '../preload/index.mjs'),
      // 安全姿势：contextIsolation 隔离 + 无 nodeIntegration，经 preload 受限桥通信。
      // sandbox 必须为 false：Electron 的 ESM preload（.mjs）不支持沙箱（沙箱 preload 只能 CJS），
      // electron-vite 默认产物为 ESM，此为 electron-vite 标准模板姿势。
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl !== undefined) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(baseDir, '../renderer/index.html'));
  }
}

app.whenReady().then(
  async () => {
    // 持久化与模型配置相互独立，并行初始化，两者失败均不阻断窗口创建。
    const [, result] = await Promise.all([initPersistence(), loadModelsConfig()]);
    const issueRepository = persistence === undefined ? undefined : new WorkflowIssueRepository(persistence.db);
    const workflowRepository = persistence === undefined ? undefined : new WorkflowRepository(persistence.db);
    const creativeAssetRepository = persistence === undefined ? undefined : new CreativeAssetRepository(persistence.db);
    orchestration = new OrchestrationRuntime({
      getModelResolver: () => modelResolver,
      getCheckpointer: () => persistence?.checkpointer,
      getFactStore: () => persistence?.factStore,
      getAuditRunner: () => auditRunner,
      getDiffRunner: () => diffRunner,
      getEmbedRunner: () => embedRunner,
      getCorpusStore: () => corpusStore,
      ...(issueRepository === undefined ? {} : { workflowIssues: issueRepository }),
      ...(persistence === undefined ? {} : { taskRuns: new TaskRunRepository(persistence.db) }),
      ...(creativeAssetRepository === undefined ? {} : { creativeAssets: creativeAssetRepository }),
      ...(workflowRepository === undefined || persistence === undefined ? {} : {
        workflows: workflowRepository,
        stageRunEvidence: new SqliteStageRunEvidenceRecorder(persistence.db),
        continuationRecords: new SqliteContinuationRecordService(persistence.db),
      }),
    });
    const workflowService = persistence === undefined || issueRepository === undefined
      ? undefined
      : new WorkflowApplicationService(
        workflowRepository!,
        creativeAssetRepository!,
        issueRepository,
      );
    registerIpcHandlers(orchestration, workflowService);
    if (result.ok) {
      modelResolver = new ModelResolver(result.config);
    } else {
      // 配置缺失不崩溃：窗口照常创建，对话请求时经 IPC 回结构化错误
      console.warn(`[model-config] ${result.message}`);
    }
    const logPath = await getOrchestrationLogPath();
    appendOrchestrationLog(`[app] started; logPath=${logPath}`);
    console.info(`[orchestration-log] ${logPath}`);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  },
  () => {
    // whenReady 理论上不会 reject；此分支满足无未处理 rejection 的约定
  },
);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  // 优雅关闭：先中断所有活跃运行，再关 SQLite（刷 WAL、释放句柄缓存）。
  if (orchestration !== undefined) {
    orchestration.disposeAll();
    orchestration = undefined;
  }
  if (persistence !== undefined) {
    void persistence.db.close();
    persistence = undefined;
  }
});
