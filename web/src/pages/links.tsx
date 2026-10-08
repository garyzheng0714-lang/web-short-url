import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Segmented } from "@/components/ui/segmented";
import { FilterToolbar, type FilterValue } from "@/components/ui/filter-toolbar";
import { SortableDataTable, type DataColumn, type SortState } from "@/components/ui/sortable-data-table";
import { Sparkline } from "@/components/ui/sparkline";
import { Tag } from "@/components/ui/tag";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { CreateLink } from "@/components/create-link";
import { QrDialog } from "@/components/qr-dialog";
import { EditLinkDrawer, LinkRowMenu } from "@/components/link-actions";
import { useBootstrap } from "@/app/bootstrap";
import { api, type LinkItem, type ListLinksResult } from "@/lib/api";
import { STATUS_LABEL, fmtDate, formatNumber, hostOf, shortUrlDisplay } from "@/lib/format";

const PAGE_SIZE = 20;
const STATUS_TAG: Record<string, "neutral" | "success" | "warning" | "danger"> = { active: "success", suspended: "warning", banned: "danger", missing: "neutral" };
const SORT_TO_PARAM: Record<string, { asc: string; desc: string }> = {
  created_at: { asc: "created_asc", desc: "created" },
  visits: { asc: "visits", desc: "visits" },
  visitors: { asc: "visitors", desc: "visitors" },
};

function pageWindow(current: number, pages: number) {
  const set = new Set<number>([1, pages, current, current - 1, current + 1, current - 2, current + 2]);
  return [...set].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
}

export function LinksPage() {
  const { data: boot } = useBootstrap();
  const [params, setParams] = useSearchParams();
  const scope = params.get("scope") === "mine" ? "mine" : "all";
  const group = params.get("group") || "";
  const status = params.get("status") || "";
  const domain = params.get("domain") || "";
  const q = params.get("q") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const sortKey = params.get("sort") === "visits" ? "visits" : params.get("sort") === "visitors" ? "visitors" : "created_at";
  const sortDir = params.get("dir") === "asc" ? "asc" : "desc";

  const [text, setText] = useState(q);
  const [result, setResult] = useState<ListLinksResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [trends, setTrends] = useState<Record<string, number[]>>({});
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<LinkItem | null>(null);

  const update = useCallback(
    (patch: Record<string, string | null>, keepPage = false) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || v === undefined) next.delete(k);
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
      const sort = SORT_TO_PARAM[sortKey][sortDir] as "created" | "created_asc" | "visits" | "visitors";
      const r = await api.listLinks({ scope, group, status, domain, q, page, page_size: PAGE_SIZE, sort });
      setResult(r);
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setState("error");
    }
  }, [scope, group, status, domain, q, page, sortKey, sortDir]);

  useEffect(() => {
    void load();
  }, [load]);

  // 7 日迷你趋势：列表渲染后再按需补齐，不拖慢首屏
  useEffect(() => {
    const ids = (result?.items || []).map((l) => l.id).filter((id) => !(id in trends));
    if (!ids.length) return;
    let cancelled = false;
    api
      .trends(ids)
      .then((r) => !cancelled && setTrends((t) => ({ ...t, ...r.trends })))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const replaceLink = (next: LinkItem) => setResult((r) => (r ? { ...r, items: r.items.map((l) => (l.id === next.id ? next : l)) } : r));
  const onCreated = () => {
    setTrends({});
    if (page !== 1 || sortKey !== "created_at" || sortDir !== "desc") update({ page: null, sort: null, dir: null });
    else void load();
  };

  const columns = useMemo<DataColumn<LinkItem>[]>(
    () => [
      {
        key: "link_url",
        label: "短链",
        sortable: false,
        width: 232,
        render: (l) => (
          <span className="grid min-w-0">
            <Link to={`/links/${l.id}`} className="truncate font-mono text-sm text-fg hover:underline">
              {shortUrlDisplay(l.link_url)}
            </Link>
            {l.name && !/^短链/.test(l.name) ? <span className="truncate text-xs text-fg-muted">{l.name}</span> : null}
          </span>
        ),
      },
      {
        key: "target_url",
        label: "目标",
        sortable: false,
        render: (l) => (
          <a href={l.target_url} target="_blank" rel="noreferrer" title={l.target_url} className="block truncate text-fg-muted hover:text-fg">
            {hostOf(l.target_url)}
            <span className="text-fg-subtle">{l.target_url.replace(/^https?:\/\/[^/]+/, "").slice(0, 60)}</span>
          </a>
        ),
      },
      { key: "group_name", label: "分组", sortable: false, width: 168, render: (l) => <span className="block truncate">{l.group_name || "—"}</span> },
      {
        key: "creator",
        label: "创建者",
        sortable: false,
        width: 136,
        render: (l) =>
          l.creator ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar name={l.creator.name || "用户"} src={l.creator.avatar_url || undefined} size={16} shape="circle" />
              <span className="truncate">{l.creator.name}</span>
            </span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      { key: "created_at", label: "创建", width: 124, render: (l) => <span className="tabular-nums">{fmtDate(l.created_at)}</span>, sortValue: (l) => l.created_at || "" },
      { key: "visits", label: "累计访问", numeric: true, width: 104, render: (l) => <span className="text-fg tabular-nums">{formatNumber(l.stats.visit_count)}</span>, sortValue: (l) => l.stats.visit_count },
      {
        key: "trend",
        label: "近 7 天",
        sortable: false,
        width: 96,
        render: (l) => {
          const t = trends[l.id];
          if (l.stats.visit_count === 0) return <span className="text-fg-subtle">—</span>;
          if (!t) return <span className="text-fg-subtle">…</span>;
          return t.some((v) => v > 0) ? <Sparkline data={t} label={`${shortUrlDisplay(l.link_url)} 近 7 天访问`} readout={false} interactive={false} height={24} area={false} /> : <span className="text-fg-muted tabular-nums">0</span>;
        },
      },
      {
        key: "status",
        label: "状态",
        sortable: false,
        width: 88,
        render: (l) => (
          <Tag variant={STATUS_TAG[l.status]} className="text-sm text-fg">
            {STATUS_LABEL[l.status]}
          </Tag>
        ),
      },
      { key: "actions", label: "操作", sortable: false, align: "end", width: 72, render: (l) => <LinkRowMenu link={l} onChanged={replaceLink} onQr={setQrUrl} onEdit={setEditing} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trends]
  );

  const groupOptions = boot.groups.map((g) => ({ value: g.id, label: g.name }));
  const domainOptions = [...new Set([...boot.domains.map((d) => d.domain), boot.default_domain_fallback])].map((d) => ({ value: d, label: d }));
  const filterValue: FilterValue = { ...(group ? { group: [group] } : {}), ...(status ? { status: [status] } : {}), ...(domain ? { domain: [domain] } : {}) };
  const filtered = Boolean(group || status || domain || q);
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sort: SortState = { key: sortKey, direction: sortDir };

  return (
    <div className="grid gap-6 pb-6">
      <div className="flex h-(--ds-header-h) shrink-0 items-center justify-between px-6">
        <h2 className="text-base font-semibold">短链</h2>
        {result ? (
          <span className="text-xs text-fg-muted tabular-nums">
            {formatNumber(total)} 条 · 累计访问 {formatNumber(result.summary.visits)}
          </span>
        ) : null}
      </div>

      <div className="px-6">
        <CreateLink onCreated={onCreated} onShowQr={setQrUrl} />
      </div>

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2 px-6">
          <Segmented
            aria-label="范围"
            group="links-scope"
            value={scope}
            onValueChange={(v) => update({ scope: v === "mine" ? "mine" : null })}
            items={[
              { value: "all", label: "全部" },
              { value: "mine", label: "我的" },
            ]}
          />
          <FilterToolbar
            className="min-w-0 flex-1"
            label="筛选"
            fields={[
              { id: "group", label: "分组", options: groupOptions },
              {
                id: "status",
                label: "状态",
                options: [
                  { value: "active", label: "可用" },
                  { value: "suspended", label: "已暂停" },
                  { value: "banned", label: "已封禁" },
                ],
              },
              { id: "domain", label: "域名", options: domainOptions },
            ]}
            value={filterValue}
            onValueChange={(v) => update({ group: v.group?.[0] || null, status: v.status?.[0] || null, domain: v.domain?.[0] || null })}
            query={text}
            onQueryChange={(v) => {
              setText(v);
              update({ q: v || null });
            }}
            searchPlaceholder="搜索短链、目标或名称"
          />
        </div>

        <SortableDataTable
          caption="短链列表"
          rows={result?.items || []}
          columns={columns}
          rowKey="id"
          sort={sort}
          onSortChange={(s) => update({ sort: s.key === "created_at" ? null : s.key, dir: s.direction === "desc" ? null : "asc" })}
          status={state}
          onRetry={() => void load()}
          errorTitle={error || "加载失败"}
          unit="条"
          empty={
            <EmptyState
              title={filtered ? "没有匹配的短链" : scope === "mine" ? "还没有归到你名下的短链" : "还没有短链"}
              description={filtered ? undefined : scope === "mine" ? "在上面生成一条，或在列表里认领已有的短链" : "粘贴一条长链接生成第一条短链"}
              action={
                filtered ? (
                  <Button
                    onClick={() => {
                      setText("");
                      update({ group: null, status: null, domain: null, q: null });
                    }}
                  >
                    清除筛选
                  </Button>
                ) : null
              }
            />
          }
        />

        {pages > 1 ? (
          <div className="border-t border-line py-3">
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
          </div>
        ) : null}
      </div>

      <QrDialog url={qrUrl} onClose={() => setQrUrl(null)} />
      <EditLinkDrawer link={editing} onClose={() => setEditing(null)} onSaved={replaceLink} />
    </div>
  );
}
