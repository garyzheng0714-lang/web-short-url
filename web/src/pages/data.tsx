import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChartNoAxesColumn, ChevronRight, CornerDownRight, FolderOpen, Globe, X } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchField } from "@/components/ui/search-field";
import { CopyButton } from "@/components/ui/copy-button";
import { Sparkline } from "@/components/ui/sparkline";
import { Tag } from "@/components/ui/tag";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { QrDialog } from "@/components/qr-dialog";
import { LinkDrawer } from "@/components/link-drawer";
import { GroupDrawer } from "@/components/group-drawer";
import { EditLinkDrawer, LinkRowMenu, LinkStatus, SuspendDialog } from "@/components/link-actions";
import { useBootstrap } from "@/app/bootstrap";
import { api, type GroupItem, type LinkItem, type ListLinksResult } from "@/lib/api";
import { fmtDateShort, formatCount, shortUrlDisplay } from "@/lib/format";

const PAGE_SIZE = 20;

function pageWindow(current: number, pages: number) {
  return [...new Set([1, pages, current, current - 1, current + 1])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
}

/** 列表容器：一块白底柔影的面，行之间一条细线；行的悬停底贴到面的圆角里 */
const LIST = "overflow-hidden rounded-card bg-card shadow-card divide-y divide-line";
const ROW = "relative flex min-h-16 items-center gap-4 px-4 py-3 transition-colors duration-(--ds-dur-fast) hover:bg-hover";
/** 整行是点击目标：一层盖满的按钮；复制、菜单浮在它上面（z-10） */
const ROW_HIT = "absolute inset-0 outline-none focus-visible:focus-ring";

function VisitsPill({ value }: { value: number }) {
  return (
    <Tag variant="chip" className="shrink-0 text-fg tabular-nums">
      <ChartNoAxesColumn aria-hidden className="size-3.5" />
      {formatCount(value)}
    </Tag>
  );
}

/** 一条短链（Dub 链接列表的排法）：图标 · 短链 + 复制 / 目标链接 · 近 7 天 · 分组 · 创建日期 · 访问次数 · ⋯ */
function LinkRow({ link, trend, onOpen, onChanged, onQr, onEdit, onSuspend }: { link: LinkItem; trend?: number[]; onOpen: (l: LinkItem) => void; onChanged: (l: LinkItem) => void; onQr: (url: string) => void; onEdit: (l: LinkItem) => void; onSuspend: (l: LinkItem) => void }) {
  const short = shortUrlDisplay(link.link_url);
  const target = `${link.name && !/^短链/.test(link.name) ? `${link.name} · ` : ""}${shortUrlDisplay(link.target_url)}`;
  return (
    <li className={ROW}>
      <button type="button" className={ROW_HIT} aria-label={`查看 ${short} 的数据`} onClick={() => onOpen(link)} />
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-well text-fg-muted">
        <Globe className="size-4" />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-sm font-medium text-fg">
            <span className="font-normal text-fg-muted">{link.domain}/</span>
            {link.key || short}
          </span>
          <CopyButton value={link.link_url} label="复制短链" iconOnly size="icon-sm" className="relative z-10 shrink-0" />
        </div>
        <div className="flex min-w-0 items-center gap-1 text-xs text-fg-muted">
          <CornerDownRight aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate" title={link.target_url}>
            {target}
          </span>
        </div>
      </div>
      <span className="hidden w-20 shrink-0 @2xl/data:block">
        {trend && trend.some((v) => v > 0) ? <Sparkline data={trend} label={`${short} 近 7 天访问`} readout={false} interactive={false} height={24} area={false} /> : null}
      </span>
      <span className="hidden w-36 shrink-0 truncate text-xs text-fg-muted @4xl/data:block">{link.group_name || "未分组"}</span>
      <span className="hidden w-12 shrink-0 text-right text-xs text-fg-muted tabular-nums @xl/data:block">{fmtDateShort(link.created_at)}</span>
      <span data-part="status" className="hidden w-16 shrink-0 @md/data:block">
        <LinkStatus status={link.status} />
      </span>
      <span data-part="visits" className="flex w-20 shrink-0 justify-end">
        <VisitsPill value={link.stats.visit_count} />
      </span>
      <span className="relative z-10 shrink-0">
        <LinkRowMenu link={link} onChanged={onChanged} onQr={onQr} onEdit={onEdit} onOpen={onOpen} onSuspend={onSuspend} />
      </span>
    </li>
  );
}

/** 一个分组：图标 · 分组名 / 短链数 · 被访问过 · 归属 · 访问次数 */
function GroupRow({ group, onOpen }: { group: GroupItem; onOpen: (g: GroupItem) => void }) {
  return (
    <li className={ROW}>
      <button type="button" className={ROW_HIT} aria-label={`查看分组 ${group.name}`} onClick={() => onOpen(group)} />
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-well text-fg-muted">
        <FolderOpen className="size-4" />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-sm font-medium text-fg">{group.name}</span>
        <span className="truncate text-xs text-fg-muted tabular-nums">
          {formatCount(group.link_count)} 条短链 · {formatCount(group.visited_links)} 条被访问过
          {group.owner?.name ? ` · 归属 ${group.owner.name}` : ""}
        </span>
      </div>
      <span className="flex w-24 shrink-0 justify-end">
        <VisitsPill value={group.visits} />
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle" />
    </li>
  );
}

/** 短链访问数据：纯列表（短链 / 分组两种视图），数据概览在「仪表盘」。成员只看得到自己创建的短链（服务端强制） */
export function DataPage() {
  const { data: boot } = useBootstrap();
  const admin = boot.user.is_admin;
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "groups" ? "groups" : "list";
  const scope = admin && params.get("scope") === "mine" ? "mine" : admin ? "all" : "mine";
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
  const [suspending, setSuspending] = useState<LinkItem | null>(null);

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
    <div className="@container/data grid gap-6 pt-4">
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
      </header>

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
            <ul aria-label="短链" className={LIST}>
              {items.map((l) => (
                <LinkRow key={l.id} link={l} trend={trends[l.id]} onOpen={openLink} onChanged={replaceLink} onQr={setQrUrl} onEdit={setEditing} onSuspend={setSuspending} />
              ))}
            </ul>
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
          <ul aria-label="分组" className={LIST}>
            {visibleGroups.map((g) => (
              <GroupRow key={g.id} group={g} onOpen={openGroup} />
            ))}
          </ul>
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
      <SuspendDialog link={suspending} onClose={() => setSuspending(null)} onChanged={replaceLink} />
      <LinkDrawer id={openLinkId} initial={openLinkId ? items.find((l) => l.id === openLinkId) || null : null} onClose={() => update({ link: null }, true)} onChanged={replaceLink} />
      <GroupDrawer id={openGroupId} onClose={() => update({ g: null }, true)} onShowLinks={(id) => update({ g: null, view: null, group: id })} />
    </div>
  );
}
