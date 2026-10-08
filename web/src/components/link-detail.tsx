import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { Ellipsis, ExternalLink, Pause, Pencil, Play, QrCode, Route, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Tag } from "@/components/ui/tag";
import { Avatar } from "@/components/ui/avatar";
import { MetricCard } from "@/components/ui/metric-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatsPanel } from "@/components/stats-panel";
import { QrPopover } from "@/components/qr-dialog";
import { BotSwitch, RangeSegmented, rangeLabel, type RangeKey } from "@/components/range-control";
import { EditLinkForm, claimLink, toggleSuspend } from "@/components/link-actions";
import { useBootstrap } from "@/app/bootstrap";
import { api, type LinkItem, type LinkStats, type VisitRecord } from "@/lib/api";
import { BROWSER_LABEL, DEVICE_LABEL, OS_LABEL, STATUS_LABEL, fmtDateTime, formatNumber, hostOf, labelOf, relativeTime, shortUrlDisplay } from "@/lib/format";

const STATUS_TAG: Record<string, "neutral" | "success" | "warning" | "danger"> = { active: "success", suspended: "warning", banned: "danger", missing: "neutral" };
const VISITS_PAGE = 20;

/**
 * 一条短链的详情与数据。放在抽屉里（?link=id），不独占页面；短链地址与目标链接由抽屉标题和副标题承担。
 * 排法照 Dub、Bitly 的链接详情：最常用的两个动作（复制、二维码）在前，其余收进「⋯」；属性是一张标签 · 值的小表；
 * 「访问数据」一节自己带时间范围与含机器访问；指标三个，名字里不再重复时间范围。
 * 抽屉上不再叠模态：二维码是从按钮弹出的小浮层，跳转链路在属性下面原地展开，编辑是原地换成表单
 * （叠两层带背景模糊的遮罩时，Chrome 会漏画一块，用户截图里抽屉变灰、中间留一块没盖住）。
 */
export function LinkDetail({ id, onChanged }: { id: number; onChanged?: (link: LinkItem) => void }) {
  const uid = useId();
  const { data: boot } = useBootstrap();
  const [link, setLinkState] = useState<LinkItem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [range, setRange] = useState<RangeKey>("30d");
  const [includeBots, setIncludeBots] = useState(!boot.settings.exclude_bot);
  const [stats, setStats] = useState<LinkStats | null>(null);
  const [statsState, setStatsState] = useState<"loading" | "ready" | "error">("loading");
  const [statsError, setStatsError] = useState("");
  const [visits, setVisits] = useState<{ items: VisitRecord[]; total: number; page: number } | null>(null);
  const [visitsPage, setVisitsPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [route, setRoute] = useState<{ open: boolean; loading: boolean; steps: { url: string; status: number }[]; final: string; error: string }>({ open: false, loading: false, steps: [], final: "", error: "" });

  const setLink = useCallback(
    (next: LinkItem) => {
      setLinkState(next);
      onChanged?.(next);
    },
    [onChanged]
  );

  useEffect(() => {
    let cancelled = false;
    setLinkState(null);
    setNotFound(false);
    setStats(null);
    setVisits(null);
    setVisitsPage(1);
    api
      .getLink(id)
      .then((r) => !cancelled && setLinkState(r.link))
      .catch(() => !cancelled && setNotFound(true));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const loadStats = useCallback(async () => {
    setStatsState("loading");
    setStatsError("");
    try {
      setStats(await api.linkStats(id, { range, bot: includeBots ? "include" : "exclude" }));
      setStatsState("ready");
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : "加载失败");
      setStatsState("error");
    }
  }, [id, range, includeBots]);
  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    let cancelled = false;
    api
      .linkVisits(id, { range, bot: includeBots ? "include" : "exclude", page: visitsPage, page_size: VISITS_PAGE })
      .then((r) => !cancelled && setVisits({ items: r.items, total: r.total, page: r.page }))
      .catch(() => !cancelled && setVisits({ items: [], total: 0, page: 1 }));
    return () => {
      cancelled = true;
    };
  }, [id, range, includeBots, visitsPage]);
  useEffect(() => setVisitsPage(1), [range, includeBots]);

  const resolveRoute = async () => {
    if (!link) return;
    setRoute({ open: true, loading: true, steps: [], final: "", error: "" });
    try {
      const r = await api.resolveRedirect(link.link_url);
      setRoute({ open: true, loading: false, steps: r.steps, final: r.final_url, error: "" });
    } catch (e) {
      setRoute({ open: true, loading: false, steps: [], final: "", error: e instanceof Error ? e.message : "解析失败" });
    }
  };

  if (notFound) return <EmptyState title="没有这条短链" description="它可能已经在小码后台被删除" />;
  if (!link) {
    return (
      <div className="grid h-40 place-items-center">
        <Spinner delay={400} label="正在加载" />
      </div>
    );
  }

  const period = rangeLabel(range);
  const pages = Math.max(1, Math.ceil((visits?.total || 0) / VISITS_PAGE));

  return (
    <div className="@container/detail grid gap-8">
      {editing ? (
        <section aria-label="编辑短链" className="grid gap-6">
          <h3 className="text-sm font-medium">编辑</h3>
          <EditLinkForm
            link={link}
            onCancel={() => setEditing(false)}
            onSaved={(next) => {
              setLink(next);
              setEditing(false);
            }}
          />
        </section>
      ) : (
      <div className="grid gap-6">
        <div className="flex items-center gap-2">
          <CopyButton value={link.link_url} label="复制短链" variant="secondary" size="md" />
          <QrPopover url={link.link_url}>
            <Button variant="secondary">
              <QrCode aria-hidden />
              二维码
            </Button>
          </QrPopover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" aria-label="更多操作">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => window.open(`/go?url=${encodeURIComponent(link.link_url)}`, "_blank", "noopener,noreferrer")}>
                <ExternalLink aria-hidden />
                打开短链
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void resolveRoute()}>
                <Route aria-hidden />
                查看跳转链路
              </DropdownMenuItem>
              {link.can_manage ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil aria-hidden />
                    编辑
                  </DropdownMenuItem>
                  {link.status === "banned" ? null : (
                    <DropdownMenuItem onSelect={() => void toggleSuspend(link, setLink)}>
                      {link.status === "suspended" ? <Play aria-hidden /> : <Pause aria-hidden />}
                      {link.status === "suspended" ? "恢复跳转" : "暂停跳转"}
                    </DropdownMenuItem>
                  )}
                </>
              ) : null}
              {!link.creator && boot.user.is_admin ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void claimLink(link, setLink)}>
                    <UserRoundPlus aria-hidden />
                    认领到我名下
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {link.status !== "active" ? (
            <>
              <dt className="text-fg-muted">状态</dt>
              <dd>
                <Tag variant={STATUS_TAG[link.status]}>{STATUS_LABEL[link.status]}</Tag>
              </dd>
            </>
          ) : null}
          {link.name && !/^短链/.test(link.name) ? (
            <>
              <dt className="text-fg-muted">名称</dt>
              <dd className="truncate">{link.name}</dd>
            </>
          ) : null}
          <dt className="text-fg-muted">分组</dt>
          <dd className="truncate">
            <Link to={`/data?group=${encodeURIComponent(link.group_id || "")}`} className="hover:underline">
              {link.group_name || "未分组"}
            </Link>
          </dd>
          <dt className="text-fg-muted">创建者</dt>
          <dd className="flex min-w-0 items-center gap-1.5">
            {link.creator ? (
              <>
                <Avatar name={link.creator.name || "用户"} src={link.creator.avatar_url || undefined} size={16} shape="circle" />
                <span className="truncate">{link.creator.name}</span>
              </>
            ) : (
              <span className="text-fg-muted">无</span>
            )}
          </dd>
          <dt className="text-fg-muted">创建时间</dt>
          <dd className="tabular-nums">{fmtDateTime(link.created_at)}</dd>
        </dl>

        {route.open ? (
          <section aria-label="跳转链路" className="grid gap-2 rounded-row bg-well p-3 text-sm">
            <div className="flex items-center">
              <h4 className="mr-auto font-medium">跳转链路</h4>
              <Button variant="ghost" size="sm" className="edge-end" onClick={() => setRoute((r) => ({ ...r, open: false }))}>
                收起
              </Button>
            </div>
            {route.loading ? (
              <Spinner delay={400} label="正在解析" />
            ) : route.error ? (
              <p className="text-fg-muted">{route.error}</p>
            ) : (
              <ol className="grid gap-1.5">
                {route.steps.map((st, i) => (
                  <li key={i} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
                    <span className="text-fg-muted tabular-nums">{st.status}</span>
                    <span className="truncate font-mono" title={st.url}>
                      {st.url}
                    </span>
                  </li>
                ))}
                <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
                  <span className="text-fg-muted">落地</span>
                  <a href={route.final} target="_blank" rel="noreferrer" className="truncate font-mono text-fg hover:underline" title={route.final}>
                    {route.final}
                  </a>
                </li>
              </ol>
            )}
          </section>
        ) : null}
      </div>
      )}

      <section aria-labelledby={`${uid}-data`} className="grid gap-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h3 id={`${uid}-data`} className="mr-auto text-sm font-medium">
            访问数据
            {link.stats.fetched_at ? <span className="ml-2 text-xs font-normal text-fg-muted">更新于 {relativeTime(link.stats.fetched_at)}</span> : null}
          </h3>
          <BotSwitch includeBots={includeBots} onChange={setIncludeBots} />
          <RangeSegmented group={`${uid}-range`} value={range} onChange={setRange} />
        </div>

        <div role="group" aria-label="指标" className="grid grid-cols-3 gap-6">
          <MetricCard label="访问" value={stats?.period.visit_count ?? 0} loading={statsState === "loading" && !stats} context={`IP ${formatNumber(stats?.period.ip_count ?? 0)}`} />
          <MetricCard label="访客" value={stats?.period.visitor_count ?? 0} loading={statsState === "loading" && !stats} context={`新访客 ${formatNumber(stats?.chart.new_visitor_count ?? 0)}`} />
          <MetricCard label="累计访问" value={link.stats.visit_count} context={`访客 ${formatNumber(link.stats.visitor_count)}`} />
        </div>
        <StatsPanel daily={stats?.daily || []} chart={stats?.chart || null} period={period} loading={statsState === "loading" && !stats} error={statsState === "error" ? statsError : undefined} onRetry={() => void loadStats()} />
      </section>

      <section aria-labelledby={`${uid}-visits`} className="grid gap-2">
        <h3 id={`${uid}-visits`} className="flex h-(--ds-h-md) items-center text-sm font-medium">
          访问记录
          {visits ? <span className="ml-2 text-xs font-normal text-fg-muted tabular-nums">{formatNumber(visits.total)} 条</span> : null}
        </h3>
        {visits && visits.items.length ? (
          <>
            <Table flush className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">时间</TableHead>
                  <TableHead>地区</TableHead>
                  <TableHead>设备</TableHead>
                  <TableHead className="w-32">来源</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody key={`${range}-${includeBots}-${visits.page}`}>
                {visits.items.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="tabular-nums">{fmtDateTime(v.visited_at).slice(5)}</TableCell>
                    <TableCell className="truncate" title={v.ip}>
                      {[v.country !== "中国" ? v.country : "", v.region, v.city].filter(Boolean).join(" ") || "—"}
                      {v.is_robot ? <span className="text-fg-subtle"> · 机器</span> : v.new_visitor ? <span className="text-fg-subtle"> · 新</span> : null}
                    </TableCell>
                    <TableCell className="truncate">
                      {labelOf(DEVICE_LABEL, v.device)} · {labelOf(OS_LABEL, v.os)} · {labelOf(BROWSER_LABEL, v.browser)}
                    </TableCell>
                    <TableCell className="truncate" title={v.referer || undefined}>
                      {v.referer ? hostOf(v.referer) : "直接访问"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {pages > 1 ? (
              <Pagination className="pt-2">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious aria-disabled={visitsPage === 1} onClick={(e) => (e.preventDefault(), visitsPage > 1 && setVisitsPage(visitsPage - 1))} />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink isActive onClick={(e) => e.preventDefault()}>
                      {visitsPage} / {pages}
                    </PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext aria-disabled={visitsPage === pages} onClick={(e) => (e.preventDefault(), visitsPage < pages && setVisitsPage(visitsPage + 1))} />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-fg-muted">{visits ? `${period}没有访问记录` : "正在加载"}</p>
        )}
      </section>

    </div>
  );
}
