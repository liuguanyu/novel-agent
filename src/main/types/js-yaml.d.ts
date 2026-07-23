/**
 * js-yaml 最小本地类型声明（无 @types/js-yaml；仅覆盖本项目用到的 load）。
 * 提示词加载器只做只读反序列化，故只声明 load。
 */
declare module 'js-yaml' {
  export interface LoadOptions {
    /** 文件名（用于错误信息） */
    filename?: string;
  }
  /** 解析单文档 YAML，返回 unknown（由调用方经 Zod 校验）。 */
  export function load(input: string, options?: LoadOptions): unknown;
}
