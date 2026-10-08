import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { LineChart } from "@/components/ui/line-chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { RangeSegmented, rangeLabel, type RangeKey } from "@/components/range-control";
import { toLineData } from "@/components/stats-panel";
import { useBootstrap } from "@/app/bootstrap";
import { api, type Overview } from "@/lib/api";
import { changeRatio, fmtAxisDay, fmtDate, formatNumber, relativeTime, shortUrlDisplay } from "@/lib/format";

const ALL = "__all";
type Metric = "visits" | "visitors";

export function OverviewPage() {
  const { data: boot } = useBootstrap();
  const uid = useId();
  const [range, setRange] = useState<RangeKey>("30d");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [group, setGroup] = useState(ALL);
  const [metric, setMetric] = useState<Metric>("visits");
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      setData(await api.overview({ range, scope, group: group === ALL ? undefined : group }));
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setState("error");
    }
  }, [range, scope, group]);
  useEffect(() => {
    void load();
  }, [load]);

  const lineData = useMemo(() => toLineData(data?.series || []), [data]);
  const period = rangeLabel(range);
  const span = data ? `${fmtAxisDay(data.range.start)} 至 ${fmtAxisDay(data.range.end)}` : "";
  const prevVisits = data?.previous?.visit_count;
  const prevVisitors = data?.previous?.visitor_count;
  const loading = state === "loading" && !data;

  return (
    <div className="grid gap-8 pb-8">
      <div className="flex min-h-(--ds-header-h) flex-wrap items-center gap-x-2 gap-y-2 px-6 py-2">
        <div className="me-2 flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <h2 className="shrink-0 text-base font-medium">概览</h2>
          <span className="text-xs font-normal whitespace-nowrap text-fg-muted tabular-nums">{span}</span>
        </div>
        <Select value={scope} onValueChange={(v) => setScope(v === "mine" ? "mine" : "all")}>
          <SelectTrigger variant="inline" aria-label="范围">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部短链</SelectItem>
            <SelectItem value="mine">我的短链</SelectItem>
          </SelectContent>
        </Select>
        <Select value={group} onValueChange={setGroup}>
          <SelectTrigger variant="inline" aria-label="分组">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部分组</SelectItem>
            {boot.groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <RangeSegmented group={`${uid}-range`} value={range} onChange={setRange} className="@max-[460px]:w-full @max-[460px]:[&>button]:flex-1" />
      </div>

      <div className="grid gap-8 px-6">
        <div role="group" aria-label="指标" className="-mx-3 grid grid-cols-2 gap-2 @2xl:grid-cols-4">
          <Button variant="ghost" aria-pressed={metric === "visits"} onClick={() => setMetric("visits")} className="h-auto min-w-0 justify-start rounded-card p-3 text-left whitespace-normal [&>span]:block [&>span]:w-full">
            <MetricCard className="[&>span:first-child]:font-medium [&>span:first-child]:text-fg" label={`${period}访问`} value={data?.kpi.period_visits ?? 0} change={changeRatio(data?.kpi.period_visits ?? 0, prevVisits)} loading={loading} />
          </Button>
          <Button variant="ghost" aria-pressed={metric === "visitors"} onClick={() => setMetric("visitors")} className="h-auto min-w-0 justify-start rounded-card p-3 text-left whitespace-normal [&>span]:block [&>span]:w-full">
            <MetricCard className="[&>span:first-child]:font-medium [&>span:first-child]:text-fg" label={`${period}访客`} value={data?.kpi.period_visitors ?? 0} change={changeRatio(data?.kpi.period_visitors ?? 0, prevVisitors)} loading={loading} />
          </Button>
          <div className="p-3">
            <MetricCard label="今日访问" value={data?.kpi.today_visits ?? 0} context={`访客 ${formatNumber(data?.kpi.today_visitors ?? 0)}`} loading={loading} />
          </div>
          <div className="p-3">
            <MetricCard label="短链" value={data?.kpi.total_links ?? 0} context={`${formatNumber(data?.kpi.visited_links ?? 0)} 条被访问过 · 累计 ${formatNumber(data?.kpi.visits_total ?? 0)} 次`} loading={loading} />
          </div>
        </div>

        <div className="grid min-w-0 gap-2">
          <h3 className="text-sm font-medium">{metric === "visits" ? "每日访问次数" : "每日访客数"}</h3>
          <LineChart
            label={`${metric === "visits" ? "每日访问次数" : "每日访客数"}，${period}`}
            data={lineData}
            series={[{ key: metric, label: metric === "visits" ? "访问次数" : "访客数" }]}
            loading={loading}
            error={state === "error" ? error : undefined}
            onRetry={() => void load()}
          />
          {data?.series_note ? <p className="text-xs text-fg-muted">{data.series_note}</p> : null}
        </div>

        <div className="grid gap-8 @2xl:grid-cols-2 @2xl:gap-12">
          <section aria-labelledby={`${uid}-top`} className="grid min-w-0 content-start gap-2">
            <h3 id={`${uid}-top`} className="flex h-(--ds-h-md) items-center text-sm font-medium">
              访问最多
            </h3>
            {data?.top_links.length ? (
              <Table flush>
                <TableHeader>
                  <TableRow>
                    <TableHead>短链</TableHead>
                    <TableHead className="w-28 @max-xl/main:hidden">分组</TableHead>
                    <TableHead className="w-24 text-right">累计访问</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody key={`${scope}-${group}`}>
                  {data.top_links.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="min-w-0">
                        <Link to={`/links/${l.id}`} className="block truncate font-mono text-fg hover:underline">
                          {shortUrlDisplay(l.link_url)}
                        </Link>
                        <span className="block truncate text-xs text-fg-muted">{l.name && !/^短链/.test(l.name) ? l.name : l.target_url}</span>
                      </TableCell>
                      <TableCell className="truncate @max-xl/main:hidden">{l.group_name || "—"}</TableCell>
                      <TableCell className="text-right text-fg tabular-nums">{formatNumber(l.stats.visit_count)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState title="还没有被访问的短链" />
            )}
          </section>
          <section aria-labelledby={`${uid}-recent`} className="grid min-w-0 content-start gap-2">
            <h3 id={`${uid}-recent`} className="flex h-(--ds-h-md) items-center text-sm font-medium">
              最近创建
            </h3>
            {data?.recent_links.length ? (
              <Table flush>
                <TableHeader>
                  <TableRow>
                    <TableHead>短链</TableHead>
                    <TableHead className="w-28">创建</TableHead>
                    <TableHead className="w-20 text-right">访问</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody key={`${scope}-${group}-r`}>
                  {data.recent_links.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="min-w-0">
                        <Link to={`/links/${l.id}`} className="block truncate font-mono text-fg hover:underline">
                          {shortUrlDisplay(l.link_url)}
                        </Link>
                        <span className="block truncate text-xs text-fg-muted">{l.creator?.name ? `${l.creator.name} · ` : ""}{l.group_name || "—"}</span>
                      </TableCell>
                      <TableCell className="tabular-nums">{fmtDate(l.created_at)}</TableCell>
                      <TableCell className="text-right text-fg tabular-nums">{formatNumber(l.stats.visit_count)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState title="这个范围里还没有短链" />
            )}
          </section>
        </div>

        {data?.recent_events.length ? (
          <section aria-labelledby={`${uid}-events`} className="grid min-w-0 content-start gap-2">
            <h3 id={`${uid}-events`} className="flex h-(--ds-h-md) items-center text-sm font-medium">
              实时访问
            </h3>
            <Table flush>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">时间</TableHead>
                  <TableHead>短链</TableHead>
                  <TableHead className="w-32">地点</TableHead>
                  <TableHead className="w-32">设备</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent_events.map((e, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-fg-muted">{relativeTime(e.visited_at)}</TableCell>
                    <TableCell className="truncate font-mono">{e.link_id ? <Link to={`/links/${e.link_id}`} className="hover:underline">{shortUrlDisplay(e.link_url)}</Link> : shortUrlDisplay(e.link_url)}</TableCell>
                    <TableCell className="truncate">{e.city || "—"}</TableCell>
                    <TableCell className="truncate">{[e.device, e.browser].filter(Boolean).join(" · ") || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ) : null}

        {data?.kpi.oldest_stats_at ? <p className="text-xs text-fg-muted">累计数据按热度分层刷新，最旧一条更新于 {relativeTime(data.kpi.oldest_stats_at)}</p> : null}
      </div>
    </div>
  );
}
