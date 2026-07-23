/**
 * 中文数字序号解析 (story-workspace task 2.1 支撑 / project-import task 3.2 支撑)
 *
 * 导入既有小说时，章标题形如「第十六章：…」，卷目录形如「第三卷」。
 * 章/卷需按序号（而非文件名字典序）排列——「第二章」必须排在「第十一章」之前。
 * 本文件为纯函数（无 I/O），提供中文数字 → 整数的解析，供导入解析与排序使用。
 *
 * 支持范围：1–9999 的常见中文写法（含「十/百/千」，如 十六 / 二十四 / 一百零三）。
 * 无法解析时返回 null，交由上层降级为人工确认（保真优先，不静默猜测）。
 */

const DIGIT: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const UNIT: Readonly<Record<string, number>> = {
  十: 10,
  百: 100,
  千: 1000,
};

/**
 * 解析中文数字为整数；不合法返回 null。
 * 例：'十六' → 16，'二十四' → 24，'一百零三' → 103，'十' → 10。
 */
export function parseChineseNumeral(text: string): number | null {
  const s = text.trim();
  if (s.length === 0) return null;

  // 纯阿拉伯数字直接解析（导入源也可能混用）。
  if (/^\d+$/.test(s)) {
    return Number.parseInt(s, 10);
  }

  let total = 0;
  let current = 0;
  let sawAny = false;

  for (const ch of s) {
    if (ch in DIGIT) {
      current = DIGIT[ch] ?? 0;
      sawAny = true;
    } else if (ch in UNIT) {
      const unit = UNIT[ch] ?? 1;
      // 「十六」中十前无数字，视为 1×10。
      const factor = current === 0 ? 1 : current;
      total += factor * unit;
      current = 0;
      sawAny = true;
    } else {
      return null; // 出现无法识别的字符 → 不猜测
    }
  }

  total += current;
  return sawAny ? total : null;
}

/**
 * 从形如「第十六章：标题」「第三卷」「第二十四章-标题」的字符串中抽取序号整数。
 * 匹配「第<中文/阿拉伯数字>{卷|章|节|回}」前缀；失败返回 null。
 */
export function extractOrdinal(label: string): number | null {
  const m = /第\s*([零〇一二两三四五六七八九十百千\d]+)\s*[卷章节回]/.exec(label);
  if (m === null) return null;
  const group = m[1];
  if (group === undefined) return null;
  return parseChineseNumeral(group);
}
