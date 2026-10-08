import { useCallback, useEffect, useId, useState } from "react";
import { List } from "lucide-react";
import { toast } from "sonner";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatsPanel } from "@/components/stats-panel";
import { BotSwitch, RangeSegmented, rangeLabel, type RangeKey } from "@/components/range-control";
import { useBootstrap } from "@/app/bootstrap";
import { api, ApiError, type GroupStats } from "@/lib/api";
import { formatNumber } from "@/lib/format";

const NONE = "__none";

function GroupDetail({ id, onShowLinks }: { id: string; onShowLinks: () => void }) {
  const uid = useId();
  const { data: boot, refresh } = useBootstrap();
  const meta = boot.groups.find((g) => g.id === id);
  const [range, setRange] = useState<RangeKey>("30d");
  const [includeBots, setIncludeBots] = useState(!boot.settings.exclude_bot);
  const [stats, setStats] = useState<GroupStats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [users, setUsers] = useState<{ open_id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      setStats(await api.groupStats(id, { range, bot: includeBots ? "include" : "exclude" }));
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setState("error");
    }
  }, [id, range, includeBots]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (boot.user.is_admin) api.users().then((r) => setUsers(r.items)).catch(() => undefined);
  }, [boot.user.is_admin]);

  const assign = async (v: string) => {
    try {
      const r = await api.updateGroup(id, { owner_open_id: v === NONE ? null : v });
      toast.success(r.group.owner ? `已归到 ${r.group.owner.name} 名下` : "已取消归属");
      void refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败");
    }
  };

  const period = rangeLabel(range);
  const loading = state === "loading" && !stats;
  const total = stats?.totals.created_link_count ?? meta?.link_count ?? 0;
  return (
    <div className="@container/detail grid gap-8">
      {/* 排法同短链抽屉：动作在前，属性是标签 · 值的小表，「访问数据」一节自带时间范围与含机器访问 */}
      <div className="grid gap-6">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onShowLinks}>
            <List aria-hidden />
            查看组内短链
          </Button>
        </div>
        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-sm">
          <dt className="text-fg-muted">归属人</dt>
          <dd className="min-w-0">
            {boot.user.is_admin ? (
              <Select value={meta?.owner_open_id || NONE} onValueChange={(v) => void assign(v)}>
                <SelectTrigger variant="inline" aria-label="归属人" className="edge-start">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>无归属</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.open_id} value={u.open_id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className={meta?.owner_name ? "" : "text-fg-muted"}>{meta?.owner_name || "无"}</span>
            )}
          </dd>
          <dt className="text-fg-muted">短链</dt>
          <dd className="tabular-nums">
            {formatNumber(total)} 条{stats ? <span className="text-fg-muted"> · {formatNumber(stats.totals.visited_link_count)} 条被访问过</span> : null}
          </dd>
        </dl>
      </div>

      <section aria-labelledby={`${uid}-data`} className="grid gap-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h3 id={`${uid}-data`} className="mr-auto text-sm font-medium">
            访问数据
          </h3>
          <BotSwitch includeBots={includeBots} onChange={setIncludeBots} />
          <RangeSegmented group={`${uid}-range`} value={range} onChange={setRange} />
        </div>
        <div role="group" aria-label="指标" className="grid grid-cols-3 gap-6">
          <MetricCard label="访问" value={stats?.period.visit_count ?? 0} loading={loading} context={`IP ${formatNumber(stats?.period.ip_count ?? 0)}`} />
          <MetricCard label="访客" value={stats?.period.visitor_count ?? 0} loading={loading} />
          <MetricCard label="累计访问" value={stats?.totals.visit_count ?? 0} loading={loading} context={`访客 ${formatNumber(stats?.totals.visitor_count ?? 0)}`} />
        </div>
        <StatsPanel daily={stats?.daily || []} chart={stats?.chart || null} period={period} loading={loading} error={state === "error" ? error : undefined} onRetry={() => void load()} />
      </section>
    </div>
  );
}

export function GroupDrawer({ id, onClose, onShowLinks }: { id: string | null; onClose: () => void; onShowLinks: (id: string) => void }) {
  const { data: boot } = useBootstrap();
  const meta = id ? boot.groups.find((g) => g.id === id) : null;
  return (
    <Drawer open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent side="right" className="max-w-3xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector<HTMLElement>("button[aria-label=关闭]")?.focus();
        }}
        title={meta?.name || "分组"} description={meta ? `${formatNumber(meta.link_count)} 条短链` : undefined}>
        {id ? <GroupDetail id={id} onShowLinks={() => onShowLinks(id)} /> : null}
      </DrawerContent>
    </Drawer>
  );
}
