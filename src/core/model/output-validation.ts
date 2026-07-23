/**
 * 结构化输出的 schema 校验边界约定 (Task 3.5)
 *
 * 来自模型的非结构化输出，进入系统前 MUST 经 schema 校验并转强类型；
 * 禁止未校验的 any 穿透（见 spec: model-adapter「结构化输出边界校验」、
 * engineering-standards「未知数据用 unknown」）。
 *
 * 约定：
 * - 校验点位置：**在模型适配层与业务逻辑之间**。即 adapter 产出的原始文本先解析为 unknown，
 *   再由调用方用对应 Zod schema 校验，仅当通过后强类型结果方可进入后续流程。
 * - 失败处理策略：不抛裸异常穿透 IPC；返回结构化失败（category: 'validation'），
 *   由上层决定重试/降级/回报作者（对应 IpcError.category = 'validation'）。
 *
 * 本文件提供校验的**通用类型与辅助约定**，不含任何具体业务 schema
 *（具体 schema 如 bug 列表、事实条目由各自 change 定义）。
 */

import { z } from 'zod';

/** 校验成功 */
export interface ValidationOk<T> {
  ok: true;
  data: T;
}

/** 校验失败（结构化，不抛异常） */
export interface ValidationErr {
  ok: false;
  /** 人类可读的失败摘要 */
  message: string;
  /** 字段级问题路径与原因 */
  issues: ReadonlyArray<{ path: string; message: string }>;
}

/** 校验结果判别联合 */
export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

/**
 * 通用校验辅助：以给定 schema 校验 unknown 输入，返回结构化结果（不抛异常）。
 * 这是「校验点」的标准入口；各业务模块传入自己的 schema。
 *
 * 注：此为纯函数、无 I/O、无副作用，符合 core 层约束。
 */
export function validateWithSchema<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return {
    ok: false,
    message: 'Structured output failed schema validation',
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
