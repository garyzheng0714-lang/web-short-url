import { useCallback, useEffect, useId, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatsPanel } from "@/components/stats-panel";
import { BotSwitch, RangeSegmented, rangeLabel, type RangeKey } from "@/components/range-control";
import { useBootstrap } from "@/app/bootstrap";
import { api, type GroupStats } from "@/lib/api";
import { formatNumber } from "@/lib/format";

export function GroupDetailPage() {
  const id = decodeURIComponent(useParams().id || "");
  const uid = useId();
  const { data: boot } = useBootstrap();
  const meta = boot.groups.find((g) => g.id === id);
  const [range, setRange] = useState<RangeKey>("30d");
  const [includeBots, setIncludeBots] = useState(false);
  const [stats, setStats] = useState<GroupStats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

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

  if (!meta && state === "error") {
    return (
      <div className="p-6">
        <EmptyState
          title="没有这个分组"
          action={
            <Button asChild>
              <Link to="/groups">回到分组</Link>
            </Button>
          }
        />
      </div>
    );
  }
  const period = rangeLabel(range);
  const loading = state === "loading" && !stats;

  return (
    <div className="grid gap-8 pb-8">
      <div className="grid gap-3 px-6 pt-2">
        <div className="-ml-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/groups">
              <ArrowLeft aria-hidden />
              分组
            </Link>
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="min-w-0 flex-1 truncate text-xl font-medium">{stats?.group.name || meta?.name || id}</h2>
          <span className="text-xs text-fg-muted">{meta?.owner_name ? `归属 ${meta.owner_name}` : "无归属"}</span>
          <Button asChild variant="secondary">
            <Link to={`/?group=${encodeURIComponent(id)}`}>查看组内短链</Link>
          </Button>
        </div>
      </div>
      <div className="grid gap-6 px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <RangeSegmented group={`${uid}-range`} value={range} onChange={setRange} />
          <BotSwitch includeBots={includeBots} onChange={setIncludeBots} />
        </div>
        <div role="group" aria-label="指标" className="grid grid-cols-2 gap-x-6 gap-y-6 @2xl:grid-cols-4">
          <MetricCard label={`${period}访问`} value={stats?.period.visit_count ?? 0} loading={loading} context={period} />
          <MetricCard label={`${period}访客`} value={stats?.period.visitor_count ?? 0} loading={loading} context={`IP ${formatNumber(stats?.period.ip_count ?? 0)}`} />
          <MetricCard label="累计访问" value={stats?.totals.visit_count ?? 0} loading={loading} context={`访客 ${formatNumber(stats?.totals.visitor_count ?? 0)}`} />
          <MetricCard label="被访问短链" value={stats?.totals.visited_link_count ?? 0} loading={loading} context={`共 ${formatNumber(stats?.totals.created_link_count ?? meta?.link_count ?? 0)} 条`} />
        </div>
        <StatsPanel daily={stats?.daily || []} chart={stats?.chart || null} period={period} loading={loading} error={state === "error" ? error : undefined} onRetry={() => void load()} />
      </div>
    </div>
  );
}
