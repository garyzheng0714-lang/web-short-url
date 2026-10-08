import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { X } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchField } from "@/components/ui/search-field";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { LineChart } from "@/components/ui/line-chart";
import { Sparkline } from "@/components/ui/sparkline";
import { Tag } from "@/components/ui/tag";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { QrDialog } from "@/components/qr-dialog";
import { LinkDrawer } from "@/components/link-drawer";
import { GroupDrawer } from "@/components/group-drawer";
import { EditLinkDrawer, LinkRowMenu } from "@/components/link-actions";
import { RANGE_ITEMS, rangeLabel, type RangeKey } from "@/components/range-control";
import { toLineData } from "@/components/stats-panel";
import { useBootstrap } from "@/app/bootstrap";
import { api, type GroupItem, type LinkItem, type ListLinksResult, type Overview } from "@/lib/api";
import { STATUS_LABEL, changeRatio, fmtDateShort, formatCount, shortUrlDisplay } from "@/lib/format";

const PAGE_SIZE = 18;
const STATUS_TAG: Record<string, "neutral" | "warning" | "danger"> = { suspended: "warning", banned: "danger", missing: "neutral" };

function pageWindow(current: number, pages: number) {
  return [...new Set([1, pages, current, current - 1, current + 1])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
}

/** 概览：四张指标卡 + 每日访问卡。范围随「全部 / 我的」（只有管理员有）、时间、分组筛选变化 */
function OverviewCards({ scope, range, group }: { scope: "all" | "mine"; range: RangeKey; group: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    let cancelled = false;
    setData(null);
    setError("");
    api
      .overview({ range, scope, group: group || undefined })
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "加载失败"));
    return () => {
      cancelled = true;
    };
  }, [scope, range, group]);
  useEffect(load, [load]);
  const loading = !data && !error;
  const k = data?.kpi;
  const period = rangeLabel(range);
  return (
    <>
      <div role="group" aria-label="概览" className="grid grid-cols-2 gap-4 @3xl/data:grid-cols-4">
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
    </>
  );
}

function LinkCard({ link, trend, onOpen, onChanged, onQr, onEdit }: { link: LinkItem; trend?: number[]; onOpen: (l: LinkItem) => void; onChanged: (l: LinkItem) => void; onQr: (url: string) => void; onEdit: (l: LinkItem) => void }) {
  const target = `${link.name && !/^短链/.test(link.name) ? `${link.name} · ` : ""}${shortUrlDisplay(link.target_url)}`;
  return (
    <Card onClick={() => onOpen(link)} label={`查看 ${shortUrlDisplay(link.link_url)} 的数据`}>
      <CardHeader>
        <CardTitle className="text-base">
          <span className="block truncate">
            <span className="font-normal text-fg-muted">{link.domain}/</span>
            {link.key || shortUrlDisplay(link.link_url)}
          </span>
        </CardTitle>
        <CardDescription className="truncate" title={link.target_url}>
          {target}
        </CardDescription>
        <CardAction>
          <LinkRowMenu link={link} onChanged={onChanged} onQr={onQr} onEdit={onEdit} onOpen={onOpen} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex items-end gap-4">
        <div className="grid">
          <span className="text-2xl font-semibold tabular-nums">{formatCount(link.stats.visit_count)}</span>
          <span className="text-xs text-fg-muted">累计访问</span>
        </div>
        {trend && trend.some((v) => v > 0) ? (
          <div className="ml-auto w-28">
            <Sparkline data={trend} label={`${shortUrlDisplay(link.link_url)} 近 7 天访问`} readout={false} interactive={false} height={32} area={false} />
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
        <span className="min-w-0 truncate">{link.group_name || "未分组"}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0 tabular-nums">{fmtDateShort(link.created_at)}</span>
        {link.status !== "active" ? (
          <Tag variant={STATUS_TAG[link.status]} className="ml-auto shrink-0">
            {STATUS_LABEL[link.status]}
          </Tag>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function GroupCard({ group, onOpen }: { group: GroupItem; onOpen: (g: GroupItem) => void }) {
  return (
    <Card onClick={() => onOpen(group)} label={`查看分组 ${group.name}`}>
      <CardHeader>
        <CardTitle className="text-base">
          <span className="block truncate">{group.name}</span>
        </CardTitle>
        <CardDescription className="truncate tabular-nums">
          {formatCount(group.link_count)} 条短链 · {formatCount(group.visited_links)} 条被访问过
        </CardDescription>
      </CardHeader>
      <CardContent className="grid">
        <span className="text-2xl font-semibold tabular-nums">{formatCount(group.visits)}</span>
        <span className="text-xs text-fg-muted">累计访问</span>
      </CardContent>
      {group.owner?.name ? <CardFooter className="text-xs text-fg-muted">归属 {group.owner.name}</CardFooter> : null}
    </Card>
  );
}

/** 短链访问数据：概览卡 + 每日访问卡，下面是短链卡片（或分组卡片）。成员只看得到自己创建的短链（服务端强制） */
export function DataPage() {
  const { data: boot } = useBootstrap();
  const admin = boot.user.is_admin;
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "groups" ? "groups" : "list";
  const scope = admin && params.get("scope") === "mine" ? "mine" : admin ? "all" : "mine";
  const range = (RANGE_ITEMS.some((r) => r.value === params.get("range")) ? params.get("range") : "30d") as RangeKey;
  const group = params.get("group") || "";
  const q = params.get("q") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const sort = params.get("sort") === "visits" ? "visits" : "created";
  const openLinkId = Number(params.get("link")) || null;
  const openGroupId = admin ? params.get("g") : null;

  const [text, setText] = useState(q);
  const [result, setResult] = useState<ListLinksResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [trends, setTrends] = useState<Record<string, number[]>>({});
  const [groups, setGroups] = useState<GroupItem[] | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<LinkItem | null>(null);

  const update = useCallback(
    (patch: Record<string, string | null>, keepPage = false) => {
      const next = new URLSearchParams(params);
      for (const [key, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(key);
        else next.set(key, v);
      }
      if (!keepPage) next.delete("page");
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      setResult(await api.listLinks({ scope, group, q, page, page_size: PAGE_SIZE, sort }));
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setState("error");
    }
  }, [scope, group, q, page, sort]);
  useEffect(() => {
    if (view === "list") void load();
  }, [load, view]);

  useEffect(() => {
    if (view !== "groups" || groups) return;
    api.groups().then((r) => setGroups(r.items)).catch(() => setGroups([]));
  }, [view, groups]);

  useEffect(() => {
    const ids = (result?.items || []).filter((l) => l.stats.visit_count > 0 && !(l.id in trends)).map((l) => l.id);
    if (!ids.length) return;
    let cancelled = false;
    api.trends(ids).then((r) => !cancelled && setTrends((t) => ({ ...t, ...r.trends }))).catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const replaceLink = useCallback((next: LinkItem) => setResult((r) => (r ? { ...r, items: r.items.map((l) => (l.id === next.id ? next : l)) } : r)), []);
  const openLink = (l: LinkItem) => update({ link: String(l.id) }, true);
  // 管理员点分组看分组详情；成员看不到分组的整体数据，点了就按这个分组筛自己的短链
  const openGroup = (g: GroupItem) => (admin ? update({ g: g.id }, true) : update({ view: null, group: g.id }));

  const groupName = group ? boot.groups.find((g) => g.id === group)?.name || group : "";
  const visibleGroups = useMemo(() => {
    const t = text.trim();
    return (groups || []).filter((g) => (scope === "all" || g.is_mine || !admin) && (!t || g.name.includes(t)));
  }, [groups, scope, text, admin]);
  const items = result?.items || [];
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(group || q);

  return (
    <div className="cards @container/data grid gap-6 pt-10">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">短链访问数据</h1>
        {admin ? (
          <Segmented
            aria-label="范围"
            group="data-scope"
            value={scope}
            onValueChange={(v) => update({ scope: v === "mine" ? "mine" : null })}
            items={[
              { value: "all", label: "全部" },
              { value: "mine", label: "我的" },
            ]}
          />
        ) : null}
        <Segmented aria-label="时间范围" group="data-range" value={range} onValueChange={(v) => update({ range: v === "30d" ? null : v }, true)} items={RANGE_ITEMS} />
      </header>

      <OverviewCards scope={scope} range={range} group={group} />

      <section aria-label={view === "list" ? "短链" : "分组"} className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            aria-label="视图"
            group="data-view"
            value={view}
            onValueChange={(v) => update({ view: v === "groups" ? "groups" : null, group: null })}
            items={[
              { value: "list", label: "短链" },
              { value: "groups", label: "分组" },
            ]}
          />
          {group ? (
            <Button variant="secondary" onClick={() => update({ group: null })} aria-label={`取消分组筛选：${groupName}`}>
              {groupName}
              <X aria-hidden />
            </Button>
          ) : null}
          {view === "list" ? (
            <Select value={sort} onValueChange={(v) => update({ sort: v === "visits" ? "visits" : null })}>
              <SelectTrigger aria-label="排序" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created">最新创建</SelectItem>
                <SelectItem value="visits">访问最多</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          <SearchField
            className="w-full @xl/data:ml-auto @xl/data:w-64"
            placeholder={view === "list" ? "搜索短链、目标或名称" : "搜索分组"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onQueryChange={(v) => view === "list" && update({ q: v || null })}
          />
        </div>

        {view === "list" ? (
          items.length ? (
            <div className="grid gap-4 @xl/data:grid-cols-2 @4xl/data:grid-cols-3">
              {items.map((l) => (
                <LinkCard key={l.id} link={l} trend={trends[l.id]} onOpen={openLink} onChanged={replaceLink} onQr={setQrUrl} onEdit={setEditing} />
              ))}
            </div>
          ) : state === "loading" ? (
            <div className="grid h-40 place-items-center">
              <Spinner delay={400} label="正在加载" />
            </div>
          ) : state === "error" ? (
            <EmptyState title="没能加载短链" description={error} action={<Button onClick={() => void load()}>重试</Button>} />
          ) : (
            <EmptyState
              title={filtered ? "没有匹配的短链" : "还没有短链"}
              description={filtered ? undefined : "去「生成短链」粘贴一条长链接"}
              action={
                filtered ? (
                  <Button
                    onClick={() => {
                      setText("");
                      update({ group: null, q: null });
                    }}
                  >
                    清除筛选
                  </Button>
                ) : null
              }
            />
          )
        ) : groups === null ? (
          <div className="grid h-40 place-items-center">
            <Spinner delay={400} label="正在加载" />
          </div>
        ) : visibleGroups.length ? (
          <div className="grid gap-4 @xl/data:grid-cols-2 @4xl/data:grid-cols-3">
            {visibleGroups.map((g) => (
              <GroupCard key={g.id} group={g} onOpen={openGroup} />
            ))}
          </div>
        ) : (
          <EmptyState title={text ? `没有找到「${text}」` : "还没有分组"} />
        )}

        {view === "list" && pages > 1 ? (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious aria-disabled={page === 1} onClick={(e) => (e.preventDefault(), page > 1 && update({ page: String(page - 1) }, true))} />
              </PaginationItem>
              {pageWindow(page, pages).map((p, i, arr) => (
                <PaginationItem key={p}>
                  {i > 0 && arr[i - 1] !== p - 1 ? <span className="px-1 text-fg-subtle">…</span> : null}
                  <PaginationLink isActive={p === page} onClick={(e) => (e.preventDefault(), update({ page: String(p) }, true))}>
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext aria-disabled={page === pages} onClick={(e) => (e.preventDefault(), page < pages && update({ page: String(page + 1) }, true))} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        ) : null}
      </section>

      <QrDialog url={qrUrl} onClose={() => setQrUrl(null)} />
      <EditLinkDrawer link={editing} onClose={() => setEditing(null)} onSaved={replaceLink} />
      <LinkDrawer id={openLinkId} initial={openLinkId ? items.find((l) => l.id === openLinkId) || null : null} onClose={() => update({ link: null }, true)} onChanged={replaceLink} />
      <GroupDrawer id={openGroupId} onClose={() => update({ g: null }, true)} onShowLinks={(id) => update({ g: null, view: null, group: id })} />
    </div>
  );
}
