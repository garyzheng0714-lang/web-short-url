/** 粘贴的长链接：带协议的原样，像域名的补 https://（同单条生成） */
export function normalizeTarget(raw: string) {
  const text = raw.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[\w-]+(\.[\w-]+)+/.test(text) && !/\s/.test(text)) return `https://${text}`;
  return text;
}

const looksLikeUrl = (token: string) => /^https?:\/\/\S+/i.test(token) || /^([\w-]+\.)+[a-z]{2,}([/?#]\S*)?$/i.test(token);

export type BatchItem = { line: number; name?: string; target: string };
export type BatchProblem = { line: number; text: string };
export type BatchParse = { items: BatchItem[]; problems: BatchProblem[]; duplicates: number; over: number };

export const BATCH_LIMIT = 1000;

/**
 * 一批长链接：一行一条；一行里有多条链接（空格隔开）就各算一条；
 * 一行只有一条链接、旁边还有别的字（从飞书表格复制的「名称 ⇥ 链接」两列、或「名称 链接」）时，别的字当名称。
 * 名称与链接都相同的算重复、只留一条；同一个链接配不同名称照常各生成一条。超过上限的截掉，记在 over。
 */
export function parseBatch(text: string, limit = BATCH_LIMIT): BatchParse {
  const items: BatchItem[] = [];
  const problems: BatchProblem[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const tokens = line.split(/\s+/);
    const urls = tokens.filter(looksLikeUrl);
    if (!urls.length) return void problems.push({ line: i + 1, text: line });
    const rest = tokens.filter((t) => !looksLikeUrl(t)).join(" ").replace(/[：:,，\-–—|]+$/, "").trim();
    const name = urls.length === 1 && rest ? rest.slice(0, 128) : undefined;
    for (const url of urls) {
      const target = normalizeTarget(url);
      const key = `${name || ""}\n${target}`;
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      items.push({ line: i + 1, name, target });
    }
  });
  return { items: items.slice(0, limit), problems, duplicates, over: Math.max(0, items.length - limit) };
}

/** 粘贴的是不是一批：至少两条链接 */
export function isBatchPaste(text: string) {
  return /\s/.test(text.trim()) && parseBatch(text).items.length >= 2;
}

/** CSV（带 BOM，Excel 直接打开不乱码）：名称、目标链接、短链 */
export function toCsv(rows: { name?: string; target: string; short: string }[]) {
  const cell = (v = "") => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + [["名称", "目标链接", "短链"], ...rows.map((r) => [r.name || "", r.target, r.short])].map((r) => r.map(cell).join(",")).join("\n");
}
