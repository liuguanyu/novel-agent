/**
 * Main 侧本地文件日志。
 *
 * 桌面客户端常见做法：把关键运行时诊断写入 userData/logs，便于复现用户本机问题。
 * 注意：日志只写截断后的调试摘要，调用方应避免写入完整正文、密钥等敏感内容。
 */

import { mkdir, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electron from 'electron';

let logFilePath: string | undefined;
let writeQueue: Promise<void> = Promise.resolve();

function timestamp(): string {
  return new Date().toISOString();
}

function userDataPath(): string {
  // Electron Main 运行时有 app；Node smoke 直接运行时 electron 包不提供 app 导出，降级到临时目录。
  const app = electron.app;
  return app !== undefined ? app.getPath('userData') : join(tmpdir(), 'novel-agent-smoke');
}

async function ensureLogFile(): Promise<string> {
  if (logFilePath !== undefined) return logFilePath;
  const dir = join(userDataPath(), 'logs');
  await mkdir(dir, { recursive: true });
  logFilePath = join(dir, 'orchestration.log');
  return logFilePath;
}

/** 取当前日志文件路径（会创建 logs 目录）。 */
export async function getOrchestrationLogPath(): Promise<string> {
  return ensureLogFile();
}

/** 追加一行编排日志。失败时仅 console.warn，不影响主流程。 */
export function appendOrchestrationLog(message: string): void {
  writeQueue = writeQueue
    .then(async () => {
      const file = await ensureLogFile();
      await appendFile(file, `[${timestamp()}] ${message}\n`, 'utf8');
    })
    .catch((err: unknown) => {
      console.warn(`[orchestration-log] ${err instanceof Error ? err.message : String(err)}`);
    });
}
