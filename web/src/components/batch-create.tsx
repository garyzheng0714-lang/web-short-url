import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBootstrap } from "@/app/bootstrap";
import { api, ApiError, type LinkItem, type Usage } from "@/lib/api";
import { BATCH_LIMIT, parseBatch, toCsv, type BatchItem } from "@/lib/batch";
import { formatCount, shortUrlDisplay } from "@/lib/format";

/** 每份提交的条数：小码批量接口一次最多 100 条 */
const CHUNK = 100;
/** 出错的行最多列几条，其余写「还有 N 条」 */
const SHOWN = 5;

type Outcome = { item: BatchItem; link?: LinkItem; error?: string };

function Problems({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="grid gap-1 text-xs text-danger">
      {lines.slice(0, SHOWN).map((l) => (
        <li key={l}>{l}</li>
      ))}
      {lines.length > SHOWN ? <li>还有 {formatCount(lines.length - SHOWN)} 条</li> : null}
    </ul>
  );
}

/**
 * 批量生成（Julienne 的「一次导入多个链接」、Gemini 的「换行分隔多个网址」、incident.io 的粘贴即预览）：
 * 在单条输入框里一次粘贴多条时原地展开成多行框，单条的用法不变。一行一条，最多 1000 条；「名称 ⇥ 链接」两列时名称自动带上。
 * 粘贴后马上逐行检查：不是链接的行列出来、重复的合并、额度不够时按钮不可点。按钮写条数。
 * 生成时每 100 条提交一份、依次进行，按钮上写进度；结果原地替换多行框，顺序同粘贴顺序，可复制全部、下载 CSV，没生成的可以放回去改了再试。
 */
export function BatchCreate({ initialText, usage, onUsage, onClose, onQuotaExceeded }: {
  initialText: string;
  usage: Usage;
  onUsage: (u: Usage) => void;
  onClose: () => void;
  onQuotaExceeded: () => void;
}) {
  const { data } = useBootstrap();
  const domain = data.domains.some((d) => d.domain === data.settings.default_domain) ? data.settings.default_domain : data.domains[0]?.domain || data.default_domain_fallback;
  const defaultGroup = data.groups.find((g) => g.id === data.settings.default_group_id) || data.groups[0];
  const [text, setText] = useState(initialText);
  const [groupId, setGroupId] = useState(defaultGroup?.id || "");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const parsed = useMemo(() => parseBatch(text), [text]);
  const count = parsed.items.length;
  const overQuota = count > usage.remaining;

  const run = async () => {
    if (!count || overQuota || !groupId) return;
    const items = parsed.items;
    const out: Outcome[] = [];
    let stopped = "";
    setProgress({ done: 0, total: count });
    for (let i = 0; i < count; i += CHUNK) {
      const part = items.slice(i, i + CHUNK);
      if (stopped) {
        out.push(...part.map((item) => ({ item, error: stopped })));
        continue;
      }
      try {
        const r = await api.batchCreateLinks({
          items: part.map((p) => ({ target_url: p.target, name: p.name })),
          group_id: groupId,
          domain,
          key_length: data.defaults.key_length,
          advanced_bot_detection: data.defaults.advanced_bot_detection,
          webhook: data.defaults.webhook,
        });
        for (const x of r.items) out.push({ item: part[x.index], link: x.link, error: x.error });
        onUsage(r.usage);
      } catch (err) {
        const reason = err instanceof ApiError ? err.message : "网络出错，没有生成";
        // 额度用完：后面的份不再提交
        if (err instanceof ApiError && err.code === "quota_exceeded") {
          stopped = reason;
          onQuotaExceeded();
        }
        out.push(...part.map((item) => ({ item, error: reason })));
      }
      setProgress({ done: Math.min(count, i + CHUNK), total: count });
    }
    setProgress(null);
    setOutcomes(out);
    const made = out.filter((o) => o.link).length;
    if (made) toast.success(`已生成 ${formatCount(made)} 条短链`);
  };

  if (outcomes) {
    const made = outcomes.filter((o) => o.link);
    const failed = outcomes.filter((o) => !o.link);
    const download = () => {
      const blob = new Blob([toCsv(made.map((o) => ({ name: o.item.name, target: o.item.target, short: o.link!.link_url })))], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `短链-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    return (
      <section aria-label="批量生成结果" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="mr-auto text-sm font-medium">
            已生成 {formatCount(made.length)} 条{failed.length ? `，${formatCount(failed.length)} 条没生成` : ""}
          </p>
          {made.length ? (
            <>
              {/* CopyButton 默认是 sm 档，两个按钮同一档 */}
              <CopyButton variant="secondary" value={made.map((o) => o.link!.link_url).join("\n")} label="复制全部" />
              <Button variant="secondary" size="sm" onClick={download}>
                下载 CSV
              </Button>
            </>
          ) : null}
        </div>
        {made.length ? (
          <div className="max-h-96 overflow-y-auto">
            <Table aria-label="生成的短链">
              <TableHeader>
                <TableRow>
                  <TableHead>名称 / 目标链接</TableHead>
                  <TableHead className="w-44">短链</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">复制</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {made.map((o) => (
                  <TableRow key={o.link!.id}>
                    <TableCell className="max-w-0 truncate" title={o.item.target}>
                      {o.item.name ? <span className="text-fg">{o.item.name} · </span> : null}
                      {shortUrlDisplay(o.item.target)}
                    </TableCell>
                    <TableCell className="text-fg">{shortUrlDisplay(o.link!.link_url)}</TableCell>
                    <TableCell>
                      {/* 单元格按基线排，图标钮会高一截：放进 flex 落在行中线 */}
                      <span className="flex justify-end">
                        <CopyButton value={o.link!.link_url} label="复制短链" iconOnly size="icon-sm" />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
        <Problems lines={failed.map((o) => `第 ${o.item.line} 行：${o.error}`)} />
        <div className="flex justify-end gap-2">
          {failed.length ? (
            <Button
              variant="ghost"
              onClick={() => {
                setText(failed.map((o) => [o.item.name, o.item.target].filter(Boolean).join("\t")).join("\n"));
                setOutcomes(null);
              }}
            >
              把没生成的放回去
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            再生成一批
          </Button>
        </div>
      </section>
    );
  }

  const summary = [
    `${formatCount(count)} 条`,
    parsed.problems.length ? `${formatCount(parsed.problems.length)} 行不是链接` : "",
    parsed.duplicates ? `${formatCount(parsed.duplicates)} 条重复已合并` : "",
    parsed.over ? `超过 ${formatCount(BATCH_LIMIT)} 条，后面 ${formatCount(parsed.over)} 条这次不生成` : "",
    `本月还能生成 ${formatCount(usage.remaining)} 条`,
  ].filter(Boolean);

  return (
    <section aria-label="批量生成" className="grid gap-3">
      <Textarea
        aria-label="长链接，一行一条"
        autoFocus
        disabled={Boolean(progress)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="一行一条长链接；从表格复制「名称、链接」两列也可以"
      />
      <div className="flex flex-wrap items-center gap-2">
        <p data-part="batch-summary" className="mr-auto text-xs text-fg-muted tabular-nums">
          {summary.join(" · ")}
        </p>
        <Select value={groupId} onValueChange={setGroupId} disabled={Boolean(progress)}>
          <SelectTrigger aria-label="分组" className="w-44">
            <SelectValue placeholder="选择分组" />
          </SelectTrigger>
          <SelectContent>
            {data.groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Problems lines={parsed.problems.map((p) => `第 ${p.line} 行不是链接：${p.text.slice(0, 40)}`)} />
      {overQuota ? (
        <p role="alert" className="text-xs text-danger">
          这批 {formatCount(count)} 条超出了本月剩余额度（{formatCount(usage.remaining)} 条），{data.user.is_admin ? "可以在「设置」里调高额度" : `请联系 ${usage.contact} 调整额度`}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={Boolean(progress)}>
          收起
        </Button>
        {/* 处理中用 aria-busy 而不是 loading：loading 过 400ms 会把字换成转圈，这里的字写着进度，要一直看得见 */}
        <Button
          variant="primary"
          disabled={!progress && (!count || overQuota || !groupId)}
          aria-busy={progress ? true : undefined}
          aria-disabled={progress ? true : undefined}
          onClick={() => !progress && void run()}
        >
          {progress ? `正在生成 ${formatCount(progress.done)} / ${formatCount(progress.total)}` : `生成 ${formatCount(count)} 条`}
        </Button>
      </div>
    </section>
  );
}
