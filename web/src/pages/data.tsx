import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Segmented } from "@/components/ui/segmented";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchField } from "@/components/ui/search-field";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { SortableDataTable, type DataColumn, type SortState } from "@/components/ui/sortable-data-table";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { QrDialog } from "@/components/qr-dialog";
import { LinkDrawer } from "@/components/link-drawer";
import { GroupDrawer } from "@/components/group-drawer";
import { EditLinkDrawer, LinkRowMenu, LinkStatus, SuspendDialog } from "@/components/link-actions";
import { useBootstrap } from "@/app/bootstrap";
import { api, type GroupItem, type LinkItem, type ListLinksParams, type ListLinksResult } from "@/lib/api";
import { fmtDateShort, formatCount, shortUrlDisplay } from "@/lib/format";

const PAGE_SIZE = 20;
const ALL = "all";
const STATUS_ITEMS = [
  { value: ALL, label: "全部状态" },
  { value: "active", label: "正常" },
  { value: "suspended", label: "已暂停" },
  { value: "banned", label: "已封禁" },
];
/** 表头排序 ↔ 服务端排序（分页在服务端，表格只排当前这一页，顺序与服务端一致） */
const SERVER_SORT: Record<string, ListLinksParams["sort"]> = { "created:desc": "created", "created:asc": "created_asc", "visits:desc": "visits", "visits:asc": "visits_asc" };
const TABLE_SORT = Object.fromEntries(Object.entries(SERVER_SORT).map(([k, v]) => [v, k]));

function pageWindow(current: number, pages: number) {
  return [...new Set([1, pages, current, current - 1, current + 1])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
}

/** 行里打开详情的主字：短链本身（Calendly、Shopify 的表：名字列可点） */
const OPEN = "min-w-0 truncate rounded-xs text-left font-medium text-fg outline-none hover:underline focus-visible:focus-ring";

/**
 * 短链访问数据（DESIGN.md §3.11 数据界面；先例 Shopify Companies、Calendly、Browserbase）：
 * 页头（标题 + 管理员的全部 / 我的）→ 短链 / 分组标签页 → 工具条（搜索、分组、状态，同高同外形）→ 表格（有表头，点「创建时间」「访问」排序）→ 底栏（第几条、共几条、分页）。
 * 表格不套卡片，首尾列与标题同一条内容线。成员只看得到自己创建的短链（服务端强制）。
 */
export function DataPage() {
  const { data: boot } = useBootstrap();
  const admin = boot.user.is_admin;
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "groups" ? "groups" : "list";
  const scope = admin && params.get("scope") === "mine" ? "mine" : admin ? "all" : "mine";
  const group = params.get("group") || "";
  const status = STATUS_ITEMS.some((s) => s.value === params.get("status")) ? params.get("status")! : "";
  const q = params.get("q") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const sort = (params.get("sort") && params.get("sort")! in TABLE_SORT ? params.get("sort") : "created") as NonNullable<ListLinksParams["sort"]>;
  const openLinkId = Number(params.get("link")) || null;
  const openGroupId = admin ? params.get("g") : null;

  const [text, setText] = useState(q);
  const [result, setResult] = useState<ListLinksResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
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
    try {
      setResult(await api.listLinks({ scope, group, status: status || undefined, q, page, page_size: PAGE_SIZE, sort }));
      setState("ready");
    } catch {
      setState("error");
    }
  }, [scope, group, status, q, page, sort]);
  useEffect(() => {
    if (view === "list") void load();
  }, [load, view]);

  useEffect(() => {
    if (view !== "groups" || groups) return;
    api.groups().then((r) => setGroups(r.items)).catch(() => setGroups([]));
  }, [view, groups]);

  const replaceLink = useCallback((next: LinkItem) => setResult((r) => (r ? { ...r, items: r.items.map((l) => (l.id === next.id ? next : l)) } : r)), []);
  const openLink = useCallback((l: LinkItem) => update({ link: String(l.id) }, true), [update]);
  // 管理员点分组看分组详情；成员看不到分组的整体数据，点了就按这个分组筛自己的短链
  const openGroup = useCallback((g: GroupItem) => (admin ? update({ g: g.id }, true) : update({ view: null, group: g.id })), [admin, update]);

  const linkColumns = useMemo<DataColumn<LinkItem>[]>(
    () => [
      {
        key: "link",
        label: "短链",
        sortable: false,
        width: 216,
        render: (l) => (
          <span className="flex min-w-0 items-center gap-1">
            <button type="button" className={OPEN} onClick={() => openLink(l)}>
              {shortUrlDisplay(l.link_url)}
            </button>
            <CopyButton value={l.link_url} label="复制短链" iconOnly size="icon-sm" className="shrink-0 opacity-0 focus-visible:opacity-100 in-[tr:hover]:opacity-100" />
          </span>
        ),
      },
      {
        key: "target",
        label: "目标链接",
        sortable: false,
        render: (l) => (
          <span className="block truncate" title={l.target_url}>
            {shortUrlDisplay(l.target_url)}
          </span>
        ),
      },
      // 文字列靠左在前，两个右对齐的数字列（创建时间、访问量）并排在后：右对齐的日期紧贴左对齐的状态会一边挤一边空
      // 列宽：目标链接是唯一不定宽的列，吃剩下的宽（主栏 992 时约 224，比原来窄）；分组定宽 232 放得下常见分组名。
      // 不定宽的列放在别处会被 SortableDataTable 量成 20px 左右，各列最小宽（非数字列 112）加起来也不能超过 992，否则整表变宽（已报 Su）
      { key: "group", label: "分组", sortable: false, width: 232, render: (l) => <span className="block truncate">{l.group_name || "未分组"}</span> },
      { key: "status", label: "状态", sortable: false, width: 88, render: (l) => <LinkStatus status={l.status} /> },
      { key: "created", label: "创建时间", width: 96, align: "end", sortValue: (l) => l.created_at, render: (l) => <span className="tabular-nums">{fmtDateShort(l.created_at)}</span> },
      { key: "visits", label: "访问量", width: 88, numeric: true, sortValue: (l) => l.stats.visit_count, render: (l) => formatCount(l.stats.visit_count) },
      {
        key: "actions",
        label: "",
        sortable: false,
        width: 48,
        align: "end",
        // 单元格默认按基线排，图标钮会比字高一截：放进 flex 落在行中线
        render: (l) => (
          <span className="flex justify-end">
            <LinkRowMenu link={l} onChanged={replaceLink} onQr={setQrUrl} onEdit={setEditing} onOpen={openLink} onSuspend={setSuspending} />
          </span>
        ),
      },
    ],
    [openLink, replaceLink]
  );

  // 归属人整列都空时不放这一列（DESIGN.md §3.11：整列同一个值就不要这一列）
  const hasOwner = Boolean(groups?.some((g) => g.owner?.name));
  const groupColumns = useMemo<DataColumn<GroupItem>[]>(
    () => [
      {
        key: "name",
        label: "分组",
        sortValue: (g) => g.name,
        render: (g) => (
          <button type="button" className={OPEN} onClick={() => openGroup(g)}>
            {g.name}
          </button>
        ),
      },
      ...(hasOwner ? [{ key: "owner", label: "归属人", width: 160, sortValue: (g: GroupItem) => g.owner?.name || "", render: (g: GroupItem) => <span className="block truncate">{g.owner?.name || "—"}</span> }] : []),
      { key: "link_count", label: "短链", width: 96, numeric: true, render: (g) => formatCount(g.link_count) },
      { key: "visited_links", label: "被访问过", width: 104, numeric: true, render: (g) => formatCount(g.visited_links) },
      { key: "visits", label: "访问量", width: 104, numeric: true, render: (g) => formatCount(g.visits) },
    ],
    [openGroup, hasOwner]
  );

  const groupName = group ? boot.groups.find((g) => g.id === group)?.name || group : "";
  const visibleGroups = useMemo(() => {
    const t = text.trim();
    return (groups || []).filter((g) => (scope === "all" || g.is_mine || !admin) && (!t || g.name.includes(t)));
  }, [groups, scope, text, admin]);
  const items = result?.items || [];
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(group || q || status);
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, page * PAGE_SIZE);
  const [sortKey, sortDir] = (TABLE_SORT[sort] || "created:desc").split(":") as [string, "asc" | "desc"];
  const clearFilters = () => {
    setText("");
    update({ group: null, q: null, status: null });
  };

  return (
    <div className="@container/data grid gap-6 pt-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">短链访问数据</h1>
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

      {/* 标签栏到下面的内容 16（Su Tabs），工具条到表格同样 16 */}
      <div className="grid gap-4">
        <Tabs value={view} onValueChange={(v) => update({ view: v === "groups" ? "groups" : null, group: null, status: null })}>
          <TabsList aria-label="对象">
            <TabsTrigger value="list">短链</TabsTrigger>
            <TabsTrigger value="groups">分组</TabsTrigger>
          </TabsList>
        </Tabs>

        <section aria-label={view === "list" ? "短链" : "分组"} className="grid gap-4">
          <div role="toolbar" aria-label="筛选" className="flex flex-wrap items-center gap-2">
            <SearchField
              className="w-full @xl/data:w-72"
              placeholder={view === "list" ? "搜索短链、目标或名称" : "搜索分组"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onQueryChange={(v) => view === "list" && update({ q: v || null })}
            />
            {view === "list" ? (
              <>
                <Select value={group || ALL} onValueChange={(v) => update({ group: v === ALL ? null : v })}>
                  <SelectTrigger aria-label="分组" className="w-44">
                    <SelectValue>{group ? groupName : "全部分组"}</SelectValue>
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
                <Select value={status || ALL} onValueChange={(v) => update({ status: v === ALL ? null : v })}>
                  <SelectTrigger aria-label="状态" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_ITEMS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filtered ? (
                  <Button variant="ghost" onClick={clearFilters}>
                    清除筛选
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>

          {view === "list" ? (
            <SortableDataTable
              key="links"
              caption="短链"
              flush
              rows={items}
              columns={linkColumns}
              rowKey="id"
              sort={{ key: sortKey, direction: sortDir }}
              onSortChange={(s: SortState) => update({ sort: SERVER_SORT[`${s.key}:${s.direction}`] === "created" ? null : SERVER_SORT[`${s.key}:${s.direction}`] || null })}
              status={state === "error" ? "error" : state === "loading" ? "loading" : "ready"}
              onRetry={() => void load()}
              errorTitle="没能加载短链"
              empty={
                <EmptyState
                  title={filtered ? "没有匹配的短链" : "还没有短链"}
                  description={filtered ? undefined : "去「生成短链」粘贴一条长链接"}
                  action={filtered ? <Button onClick={clearFilters}>清除筛选</Button> : null}
                />
              }
            />
          ) : (
            // 两张表各自一个实例：列宽是第一次有数据时量的，切换时不能沿用另一张表的
            <SortableDataTable
              key="groups"
              caption="分组"
              flush
              rows={visibleGroups}
              columns={groupColumns}
              rowKey="id"
              defaultSort={{ key: "visits", direction: "desc" }}
              status={groups === null ? "loading" : "ready"}
              empty={<EmptyState title={text ? `没有找到「${text}」` : "还没有分组"} />}
            />
          )}

          {view === "list" && total ? (
            <footer className="flex items-center gap-3 text-sm text-fg-muted">
              <span className="shrink-0 tabular-nums">
                第 {formatCount(from)}–{formatCount(to)} 条，共 {formatCount(total)} 条
              </span>
              {pages > 1 ? (
                // 分页按自己的宽度切窄版（< 384 只留当前页附近）：让它占满剩下的宽，只把页码靠右
                <Pagination className="min-w-0 flex-1 justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious aria-disabled={page === 1} onClick={(e) => (e.preventDefault(), page > 1 && update({ page: String(page - 1) }, true))} />
                    </PaginationItem>
                    {pageWindow(page, pages).flatMap((p, i, arr) => [
                      i > 0 && arr[i - 1] !== p - 1 ? (
                        <PaginationItem key={`gap-${p}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : null,
                      <PaginationItem key={p}>
                        <PaginationLink isActive={p === page} onClick={(e) => (e.preventDefault(), update({ page: String(p) }, true))}>
                          {p}
                        </PaginationLink>
                      </PaginationItem>,
                    ])}
                    <PaginationItem>
                      <PaginationNext aria-disabled={page === pages} onClick={(e) => (e.preventDefault(), page < pages && update({ page: String(page + 1) }, true))} />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              ) : null}
            </footer>
          ) : view === "groups" && groups?.length ? (
            <footer className="text-sm text-fg-muted tabular-nums">共 {formatCount(visibleGroups.length)} 个分组</footer>
          ) : null}
        </section>
      </div>

      <QrDialog url={qrUrl} onClose={() => setQrUrl(null)} />
      <EditLinkDrawer link={editing} onClose={() => setEditing(null)} onSaved={replaceLink} />
      <SuspendDialog link={suspending} onClose={() => setSuspending(null)} onChanged={replaceLink} />
      <LinkDrawer id={openLinkId} initial={openLinkId ? items.find((l) => l.id === openLinkId) || null : null} onClose={() => update({ link: null }, true)} onChanged={replaceLink} />
      <GroupDrawer id={openGroupId} onClose={() => update({ g: null }, true)} onShowLinks={(id) => update({ g: null, view: null, group: id })} />
    </div>
  );
}
