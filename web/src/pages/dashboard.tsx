import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Segmented } from "@/components/ui/segmented";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { LineChart } from "@/components/ui/line-chart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkDrawer } from "@/components/link-drawer";
import { GroupDrawer } from "@/components/group-drawer";
import { RANGE_ITEMS, rangeLabel, type RangeKey } from "@/components/range-control";
import { toLineData } from "@/components/stats-panel";
import { useBootstrap } from "@/app/bootstrap";
import { api, type GroupItem, type LinkItem, type Overview } from "@/lib/api";
import { changeRatio, formatCount, shortUrlDisplay } from "@/lib/format";

const TOP = 8;

/** 排行的一行：名称在左、数字在右，下面一条按占比铺的细条（Featurebase、Hotjar 的排行画法），整行可点 */
function RankRow({ label, value, max, onClick }: { label: ReactNode; value: number; max: number; onClick: () => void }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <li>
      <button type="button" onClick={onClick} className="grid w-full gap-1.5 rounded-row px-2 py-2 text-left outline-none transition-colors duration-(--ds-dur-fast) hover:bg-hover focus-visible:focus-ring">
        <span className="flex min-w-0 items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate text-sm text-fg">{label}</span>
          <span className="shrink-0 text-sm font-medium tabular-nums">{formatCount(value)}</span>
        </span>
        <span aria-hidden className="h-1 overflow-hidden rounded-full bg-well">
          <span className="block h-full rounded-full bg-chart-bar" style={{ width: `${pct}%` }} />
        </span>
      </button>
    </li>
  );
}

function RankSkeleton() {
  return (
    <ul className="grid gap-1">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="grid gap-1.5 px-2 py-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-1 w-full" />
        </li>
      ))}
    </ul>
  );
}

/** 仪表盘：四张指标卡、每日访问卡、两张排行卡（访问最多的短链、分组）。成员只算自己创建的短链（服务端强制） */
export function DashboardPage() {
  const { data: boot } = useBootstrap();
  const admin = boot.user.is_admin;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const scope = admin && params.get("scope") === "mine" ? "mine" : admin ? "all" : "mine";
  const range = (RANGE_ITEMS.some((r) => r.value === params.get("range")) ? params.get("range") : "30d") as RangeKey;
  const openLinkId = Number(params.get("link")) || null;
  const openGroupId = admin ? params.get("g") : null;
  const period = rangeLabel(range);

  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<GroupItem[] | null>(null);

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(key);
        else next.set(key, v);
      }
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  const load = useCallback(() => {
    let cancelled = false;
    setData(null);
    setError("");
    api
      .overview({ range, scope })
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "加载失败"));
    return () => {
      cancelled = true;
    };
  }, [scope, range]);
  useEffect(load, [load]);
  useEffect(() => {
    api.groups().then((r) => setGroups(r.items)).catch(() => setGroups([]));
  }, []);

  const loading = !data && !error;
  const k = data?.kpi;
  const topLinks = (data?.top_links || []).slice(0, TOP);
  const topGroups = (groups || []).filter((g) => (scope === "all" || g.is_mine || !admin) && g.visits > 0).slice(0, TOP);
  const openLink = (l: LinkItem) => update({ link: String(l.id) });
  // 管理员点分组看分组详情；成员看不到分组的整体数据，点了去列表按这个分组筛自己的短链
  const openGroup = (g: GroupItem) => (admin ? update({ g: g.id }) : navigate(`/data?group=${encodeURIComponent(g.id)}`));

  return (
    <div className="cards @container/dash grid gap-6 pt-10">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">仪表盘</h1>
        {admin ? (
          <Segmented
            aria-label="范围"
            group="dash-scope"
            value={scope}
            onValueChange={(v) => update({ scope: v === "mine" ? "mine" : null })}
            items={[
              { value: "all", label: "全部" },
              { value: "mine", label: "我的" },
            ]}
          />
        ) : null}
        <Segmented aria-label="时间范围" group="dash-range" value={range} onValueChange={(v) => update({ range: v === "30d" ? null : v })} items={RANGE_ITEMS} />
      </header>

      <div role="group" aria-label="概览" className="grid grid-cols-2 gap-4 @3xl/dash:grid-cols-4">
        <Card>
          <CardContent>
            <MetricCard label={`${period}访问`} value={k?.period_visits ?? 0} change={changeRatio(k?.period_visits ?? 0, data?.previous?.visit_count)} changeLabel="较上期" loading={loading} />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <MetricCard label={`${period}访客`} value={k?.period_visitors ?? 0} change={changeRatio(k?.period_visitors ?? 0, data?.previous?.visitor_count)} changeLabel="较上期" loading={loading} />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <MetricCard label="今日访问" value={k?.today_visits ?? 0} context={`访客 ${formatCount(k?.today_visitors ?? 0)}`} loading={loading} />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <MetricCard label="短链" value={k?.total_links ?? 0} context={`${formatCount(k?.visited_links ?? 0)} 条被访问过`} loading={loading} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">每日访问</CardTitle>
          <CardDescription>{data?.series_note || `${period}，不含机器访问`}</CardDescription>
        </CardHeader>
        <CardContent>
          <LineChart
            label={`每日访问，${period}`}
            data={toLineData(data?.series || [])}
            series={[
              { key: "visits", label: "访问次数" },
              { key: "visitors", label: "访客数", dashed: true },
            ]}
            height={240}
            loading={loading}
            error={error || undefined}
            onRetry={load}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 @3xl/dash:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">访问最多的短链</CardTitle>
            <CardDescription>累计访问</CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link to="/data?sort=visits">全部</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {loading ? (
              <RankSkeleton />
            ) : topLinks.length ? (
              <ul aria-label="访问最多的短链" className="grid gap-1">
                {topLinks.map((l) => (
                  <RankRow
                    key={l.id}
                    label={
                      <>
                        <span className="text-fg-muted">{l.domain}/</span>
                        {l.key || shortUrlDisplay(l.link_url)}
                      </>
                    }
                    value={l.stats.visit_count}
                    max={topLinks[0].stats.visit_count}
                    onClick={() => openLink(l)}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-2 py-6 text-sm text-fg-muted">还没有被访问过的短链</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">分组</CardTitle>
            <CardDescription>累计访问</CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link to="/data?view=groups">全部</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {groups === null ? (
              <RankSkeleton />
            ) : topGroups.length ? (
              <ul aria-label="分组" className="grid gap-1">
                {topGroups.map((g) => (
                  <RankRow key={g.id} label={g.name} value={g.visits} max={topGroups[0].visits} onClick={() => openGroup(g)} />
                ))}
              </ul>
            ) : (
              <p className="px-2 py-6 text-sm text-fg-muted">还没有被访问过的分组</p>
            )}
          </CardContent>
        </Card>
      </div>

      <LinkDrawer id={openLinkId} initial={openLinkId ? topLinks.find((l) => l.id === openLinkId) || null : null} onClose={() => update({ link: null })} />
      <GroupDrawer id={openGroupId} onClose={() => update({ g: null })} onShowLinks={(id) => navigate(`/data?group=${encodeURIComponent(id)}`)} />
    </div>
  );
}
