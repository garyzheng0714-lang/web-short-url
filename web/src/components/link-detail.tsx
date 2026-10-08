import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Pause, Pencil, Play, QrCode, Route, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Tag } from "@/components/ui/tag";
import { Avatar } from "@/components/ui/avatar";
import { MetricCard } from "@/components/ui/metric-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { StatsPanel } from "@/components/stats-panel";
import { QrDialog } from "@/components/qr-dialog";
import { BotSwitch, RangeSegmented, rangeLabel, type RangeKey } from "@/components/range-control";
import { EditLinkDrawer, claimLink, toggleSuspend } from "@/components/link-actions";
import { useBootstrap } from "@/app/bootstrap";
import { api, type LinkItem, type LinkStats, type VisitRecord } from "@/lib/api";
import { BROWSER_LABEL, DEVICE_LABEL, OS_LABEL, STATUS_LABEL, fmtDateTime, formatNumber, hostOf, labelOf, relativeTime, shortUrlDisplay } from "@/lib/format";

const STATUS_TAG: Record<string, "neutral" | "success" | "warning" | "danger"> = { active: "success", suspended: "warning", banned: "danger", missing: "neutral" };
const VISITS_PAGE = 20;

/**
 * 一条短链的详情与数据。放在抽屉里（列表页 ?link=id），不独占页面。
 * 头部的短链地址由抽屉标题承担，这里从目标链接开始。
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
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<LinkItem | null>(null);
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
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          {link.status !== "active" ? (
            <Tag variant={STATUS_TAG[link.status]} className="text-sm text-fg">
              {STATUS_LABEL[link.status]}
            </Tag>
          ) : null}
          {link.name && !/^短链/.test(link.name) ? <span className="text-fg">{link.name}</span> : null}
          <Link to={`/data?group=${encodeURIComponent(link.group_id || "")}`} className="hover:text-fg">
            {link.group_name || "未分组"}
          </Link>
          {link.creator ? (
            <span className="flex items-center gap-1">
              <Avatar name={link.creator.name || "用户"} src={link.creator.avatar_url || undefined} size={16} shape="circle" />
              {link.creator.name}
            </span>
          ) : (
            <Button variant="ghost" size="sm" className="-mx-2 h-6" onClick={() => void claimLink(link, setLink)}>
              <UserRoundPlus aria-hidden />
              认领到我名下
            </Button>
          )}
          <span className="tabular-nums">创建于 {fmtDateTime(link.created_at)}</span>
          {link.stats.fetched_at ? <span>数据更新于 {relativeTime(link.stats.fetched_at)}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton value={link.link_url} label="复制短链" variant="secondary" size="md" />
          <Button variant="secondary" onClick={() => setQrUrl(link.link_url)}>
            <QrCode aria-hidden />
            二维码
          </Button>
          <Tooltip content="打开短链">
            <Button asChild variant="secondary" size="icon" aria-label="打开短链">
              <a href={`/go?url=${encodeURIComponent(link.link_url)}`} target="_blank" rel="noreferrer">
                <ExternalLink />
              </a>
            </Button>
          </Tooltip>
          <Tooltip content="查看跳转链路">
            <Button variant="secondary" size="icon" aria-label="查看跳转链路" onClick={() => void resolveRoute()}>
              <Route />
            </Button>
          </Tooltip>
          {link.can_manage ? (
            <>
              <Tooltip content="编辑名称、目标链接与开关">
                <Button variant="secondary" size="icon" aria-label="编辑" onClick={() => setEditing(link)}>
                  <Pencil />
                </Button>
              </Tooltip>
              {link.status === "banned" ? null : (
                <Tooltip content={link.status === "suspended" ? "恢复跳转" : "暂停跳转"}>
                  <Button variant="secondary" size="icon" aria-label={link.status === "suspended" ? "恢复跳转" : "暂停跳转"} onClick={() => void toggleSuspend(link, setLink)}>
                    {link.status === "suspended" ? <Play /> : <Pause />}
                  </Button>
                </Tooltip>
              )}
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <RangeSegmented group={`${uid}-range`} value={range} onChange={setRange} />
        <BotSwitch includeBots={includeBots} onChange={setIncludeBots} />
        {stats?.realtime.events ? <span className="ml-auto text-xs text-fg-muted">实时事件 {formatNumber(stats.realtime.events)} 条 · 最近 {relativeTime(stats.realtime.last_visit_at)}</span> : null}
      </div>

      <div role="group" aria-label="指标" className="grid grid-cols-2 gap-6 @2xl/detail:grid-cols-4">
        <MetricCard label={`${period}访问`} value={stats?.period.visit_count ?? 0} loading={statsState === "loading" && !stats} context={period} />
        <MetricCard label={`${period}访客`} value={stats?.period.visitor_count ?? 0} loading={statsState === "loading" && !stats} context={`IP ${formatNumber(stats?.period.ip_count ?? 0)}`} />
        <MetricCard label="新访客" value={stats?.chart.new_visitor_count ?? 0} loading={statsState === "loading" && !stats} context={period} />
        <MetricCard label="累计访问" value={link.stats.visit_count} context={`访客 ${formatNumber(link.stats.visitor_count)} · IP ${formatNumber(link.stats.ip_count)}`} />
      </div>

      <StatsPanel daily={stats?.daily || []} chart={stats?.chart || null} period={period} loading={statsState === "loading" && !stats} error={statsState === "error" ? statsError : undefined} onRetry={() => void loadStats()} />

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

      <QrDialog url={qrUrl} onClose={() => setQrUrl(null)} />
      <EditLinkDrawer link={editing} onClose={() => setEditing(null)} onSaved={setLink} />
      <Dialog open={route.open} onOpenChange={(open) => !open && setRoute((r) => ({ ...r, open: false }))}>
        <DialogContent title="跳转链路" description={shortUrlDisplay(link.link_url)} size="lg">
          {route.loading ? (
            <div className="grid h-24 place-items-center">
              <Spinner delay={400} label="正在解析" />
            </div>
          ) : route.error ? (
            <p className="text-sm text-fg-muted">{route.error}</p>
          ) : (
            <ol className="grid gap-2 text-sm">
              {route.steps.map((s, i) => (
                <li key={i} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
                  <span className="text-fg-muted tabular-nums">{s.status}</span>
                  <span className="truncate font-mono" title={s.url}>
                    {s.url}
                  </span>
                </li>
              ))}
              <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 border-t border-line pt-2">
                <span className="text-fg-muted">落地</span>
                <a href={route.final} target="_blank" rel="noreferrer" className="truncate font-mono text-fg hover:underline" title={route.final}>
                  {route.final}
                </a>
              </li>
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
