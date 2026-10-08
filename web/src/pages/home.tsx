import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard } from "@/components/ui/metric-card";
import { Sparkline } from "@/components/ui/sparkline";
import { Tag } from "@/components/ui/tag";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { CreateLink } from "@/components/create-link";
import { QuotaDialog } from "@/components/quota-dialog";
import { QrDialog } from "@/components/qr-dialog";
import { LinkDrawer } from "@/components/link-drawer";
import { GroupDrawer } from "@/components/group-drawer";
import { EditLinkDrawer, LinkRowMenu } from "@/components/link-actions";
import { useBootstrap } from "@/app/bootstrap";
import { api, type GroupItem, type LinkItem, type ListLinksResult, type Overview, type Usage } from "@/lib/api";
import { STATUS_LABEL, changeRatio, fmtDateShort, formatNumber, shortUrlDisplay } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const STATUS_TAG: Record<string, "neutral" | "warning" | "danger"> = { suspended: "warning", banned: "danger", missing: "neutral" };
type SortKey = "created" | "visits";
type Dir = "asc" | "desc";

function pageWindow(current: number, pages: number) {
  return [...new Set([1, pages, current, current - 1, current + 1])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
}

function SortHead({ label, k, sortKey, dir, onSort, className }: { label: string; k: SortKey; sortKey: SortKey; dir: Dir; onSort: (k: SortKey) => void; className?: string }) {
  const on = sortKey === k;
  const Icon = on && dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"} className={cn("text-right", className)}>
      <button type="button" onClick={() => onSort(k)} className={cn("hit-area group/sort relative inline-flex flex-row-reverse items-center gap-1 rounded-sm outline-none hover:text-fg focus-visible:focus-ring-out", on && "text-fg")}>
        {label}
        <Icon aria-hidden className={cn("size-3.5", !on && "invisible group-hover/sort:visible")} />
      </button>
    </TableHead>
  );
}

/** 概览：当前范围（全部 / 我的、某个分组）近 30 天的三个数 */
function Summary({ scope, group }: { scope: "all" | "mine"; group: string }) {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    api
      .overview({ range: "30d", scope, group: group || undefined })
      .then((r) => !cancelled && setData(r))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scope, group]);
  const loading = !data;
  return (
    <div role="group" aria-label="概览" className="grid grid-cols-3 gap-6">
      <MetricCard label="近 30 天访问" value={data?.kpi.period_visits ?? 0} change={changeRatio(data?.kpi.period_visits ?? 0, data?.previous?.visit_count)} trend={data?.series.map((d) => d.visit_count)} loading={loading} />
      <MetricCard label="今日访问" value={data?.kpi.today_visits ?? 0} context={`访客 ${formatNumber(data?.kpi.today_visitors ?? 0)}`} loading={loading} />
      <MetricCard label="短链" value={data?.kpi.total_links ?? 0} context={`${formatNumber(data?.kpi.visited_links ?? 0)} 条被访问过`} loading={loading} />
    </div>
  );
}

export function HomePage() {
  const { data: boot } = useBootstrap();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "groups" ? "groups" : "list";
  const scope = params.get("scope") === "mine" ? "mine" : "all";
  const group = params.get("group") || "";
  const q = params.get("q") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const sortKey: SortKey = params.get("sort") === "visits" ? "visits" : "created";
  const dir: Dir = params.get("dir") === "asc" ? "asc" : "desc";
  const openLinkId = Number(params.get("link")) || null;
  const openGroupId = params.get("g");

  const [usage, setUsage] = useState<Usage>(boot.usage);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [text, setText] = useState(q);
  const [result, setResult] = useState<ListLinksResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [trends, setTrends] = useState<Record<string, number[]>>({});
  const [groups, setGroups] = useState<GroupItem[] | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<LinkItem | null>(null);
  const [summaryKey, setSummaryKey] = useState(0);

  const update = useCallback(
    (patch: Record<string, string | null>, keepPage = false) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
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
      const sort = sortKey === "visits" ? "visits" : dir === "asc" ? "created_asc" : "created";
      setResult(await api.listLinks({ scope, group, q, page, page_size: PAGE_SIZE, sort }));
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setState("error");
    }
  }, [scope, group, q, page, sortKey, dir]);
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
  const onCreated = () => {
    setSummaryKey((k) => k + 1);
    setGroups(null);
    if (view !== "list" || page !== 1 || sortKey !== "created" || dir !== "desc" || group || q) {
      setText("");
      update({ view: null, page: null, sort: null, dir: null, group: null, q: null });
    } else void load();
  };
  const onSort = (k: SortKey) => update({ sort: k === "created" ? null : k, dir: k === sortKey && dir === "desc" ? "asc" : null });
  const openLink = (l: LinkItem) => update({ link: String(l.id) }, true);
  const rowClick = (fn: () => void) => (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest("button, a, [role=menu], [role=menuitem]")) return;
    fn();
  };

  const groupName = group ? boot.groups.find((g) => g.id === group)?.name || group : "";
  const visibleGroups = useMemo(() => {
    const t = text.trim();
    return (groups || []).filter((g) => (scope === "all" || g.is_mine) && (!t || g.name.includes(t)));
  }, [groups, scope, text]);
  const items = result?.items || [];
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(group || q);

  return (
    <div className="grid gap-12 pt-10">
      <section aria-labelledby="create-title" className="grid gap-4">
        <h1 id="create-title" className="text-2xl font-semibold">
          生成短链
        </h1>
        <CreateLink usage={usage} onUsage={setUsage} onCreated={onCreated} onShowQr={setQrUrl} onOpen={openLink} onQuotaExceeded={() => setQuotaOpen(true)} />
      </section>

      <section aria-label="我的短链数据" className="@container/data grid gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={scope} onValueChange={(v) => update({ scope: v === "mine" ? "mine" : null })}>
            <SelectTrigger aria-label="范围" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="mine">我的</SelectItem>
            </SelectContent>
          </Select>
          {group ? (
            <Button variant="secondary" onClick={() => update({ group: null })} aria-label={`取消分组筛选：${groupName}`}>
              {groupName}
              <X aria-hidden />
            </Button>
          ) : null}
          <SearchField
            className="w-full @xl/data:ml-auto @xl/data:w-64"
            placeholder={view === "list" ? "搜索短链、目标或名称" : "搜索分组"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onQueryChange={(v) => view === "list" && update({ q: v || null })}
          />
        </div>

        <Summary key={summaryKey} scope={scope} group={group} />

        {view === "list" ? (
          items.length ? (
            <Table flush className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead>短链</TableHead>
                  <TableHead className="w-40 @max-3xl/data:hidden">分组</TableHead>
                  <SortHead label="累计访问" k="visits" sortKey={sortKey} dir={dir} onSort={onSort} className="w-24" />
                  <TableHead className="w-24 @max-xl/data:hidden">近 7 天</TableHead>
                  <SortHead label="创建" k="created" sortKey={sortKey} dir={dir} onSort={onSort} className="w-24 @max-md/data:hidden" />
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody key={`${scope}-${group}-${q}-${page}-${sortKey}-${dir}`}>
                {items.map((l) => {
                  const t = trends[l.id];
                  return (
                    <TableRow key={l.id} onClick={rowClick(() => openLink(l))} className="cursor-pointer">
                      <TableCell className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <button type="button" className="truncate text-sm text-fg" onClick={() => openLink(l)}>
                            <span className="text-fg-muted">{l.domain}/</span>
                            <span className="font-medium">{l.key || shortUrlDisplay(l.link_url)}</span>
                          </button>
                          {l.status !== "active" ? (
                            <Tag variant={STATUS_TAG[l.status]} className="shrink-0 text-sm text-fg">
                              {STATUS_LABEL[l.status]}
                            </Tag>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-fg-muted" title={l.target_url}>
                          {l.name && !/^短链/.test(l.name) ? `${l.name} · ` : ""}
                          {shortUrlDisplay(l.target_url)}
                        </span>
                      </TableCell>
                      <TableCell className="truncate @max-3xl/data:hidden">{l.group_name || "—"}</TableCell>
                      <TableCell className="text-right text-fg tabular-nums">{formatNumber(l.stats.visit_count)}</TableCell>
                      <TableCell className="@max-xl/data:hidden">{t && t.some((v) => v > 0) ? <Sparkline data={t} label={`${shortUrlDisplay(l.link_url)} 近 7 天访问`} readout={false} interactive={false} height={24} area={false} /> : null}</TableCell>
                      <TableCell className="text-right tabular-nums @max-md/data:hidden">{fmtDateShort(l.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <LinkRowMenu link={l} onChanged={replaceLink} onQr={setQrUrl} onEdit={setEditing} onOpen={openLink} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : state === "loading" ? (
            <div className="grid h-40 place-items-center">
              <Spinner delay={400} label="正在加载" />
            </div>
          ) : state === "error" ? (
            <EmptyState title="没能加载短链" description={error} action={<Button onClick={() => void load()}>重试</Button>} />
          ) : (
            <EmptyState
              title={filtered ? "没有匹配的短链" : scope === "mine" ? "还没有你的短链" : "还没有短链"}
              description={filtered ? undefined : "在上面粘贴一条长链接生成第一条"}
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
          <Table flush className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>分组</TableHead>
                <TableHead className="w-24 text-right">短链</TableHead>
                <TableHead className="w-24 text-right @max-3xl/data:hidden">被访问</TableHead>
                <TableHead className="w-28 text-right">累计访问</TableHead>
                <TableHead className="w-32 @max-3xl/data:hidden">归属人</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody key={`${scope}-${text}`}>
              {visibleGroups.map((g) => (
                <TableRow key={g.id} onClick={rowClick(() => update({ g: g.id }, true))} className="cursor-pointer">
                  <TableCell className="truncate">
                    <button type="button" className="truncate text-sm font-medium text-fg" onClick={() => update({ g: g.id }, true)}>
                      {g.name}
                    </button>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(g.link_count)}</TableCell>
                  <TableCell className="text-right tabular-nums @max-3xl/data:hidden">{formatNumber(g.visited_links)}</TableCell>
                  <TableCell className="text-right text-fg tabular-nums">{formatNumber(g.visits)}</TableCell>
                  <TableCell className="truncate @max-3xl/data:hidden">{g.owner?.name || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title={text ? `没有找到「${text}」` : "还没有你名下的分组"} />
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
      <QuotaDialog open={quotaOpen} usage={usage} userName={boot.user.name} onClose={() => setQuotaOpen(false)} />
      <EditLinkDrawer link={editing} onClose={() => setEditing(null)} onSaved={replaceLink} />
      <LinkDrawer id={openLinkId} initial={openLinkId ? items.find((l) => l.id === openLinkId) || null : null} onClose={() => update({ link: null }, true)} onChanged={replaceLink} />
      <GroupDrawer id={openGroupId} onClose={() => update({ g: null }, true)} onShowLinks={(id) => update({ g: null, view: null, group: id })} />
    </div>
  );
}
