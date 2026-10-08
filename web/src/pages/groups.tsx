import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SortableDataTable, type DataColumn } from "@/components/ui/sortable-data-table";
import { Avatar } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ActionButton } from "@/components/ui/action-button";
import { EmptyState } from "@/components/ui/empty-state";
import { useBootstrap } from "@/app/bootstrap";
import { api, ApiError, type GroupItem } from "@/lib/api";
import { fmtDate, formatNumber } from "@/lib/format";

const NONE = "__none";

export function GroupsPage() {
  const { data: boot, refresh } = useBootstrap();
  const [items, setItems] = useState<GroupItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [users, setUsers] = useState<{ open_id: string; name: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const r = await api.groups();
      setItems(r.items);
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setState("error");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (boot.user.is_admin) api.users().then((r) => setUsers(r.items)).catch(() => undefined);
  }, [boot.user.is_admin]);

  const assign = async (g: GroupItem, open_id: string) => {
    try {
      const r = await api.updateGroup(g.id, { owner_open_id: open_id === NONE ? null : open_id });
      setItems((list) => list.map((x) => (x.id === g.id ? { ...x, owner: r.group.owner ? { ...r.group.owner, avatar_url: null } : null, is_mine: r.group.owner?.open_id === boot.user.open_id } : x)));
      toast.success(r.group.owner ? `「${g.name}」已归到 ${r.group.owner.name} 名下` : `「${g.name}」已取消归属`);
      void refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败");
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) {
      setCreateError("输入分组名称");
      throw new Error("empty");
    }
    try {
      await api.createGroup(name);
      toast.success(`已创建分组「${name}」`);
      setCreating(false);
      setNewName("");
      setCreateError("");
      await Promise.all([load(), refresh()]);
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : "创建失败");
      throw e;
    }
  };

  const columns = useMemo<DataColumn<GroupItem>[]>(
    () => [
      {
        key: "name",
        label: "分组",
        render: (g) => (
          <Link to={`/groups/${encodeURIComponent(g.id)}`} className="block truncate text-fg hover:underline">
            {g.name}
          </Link>
        ),
      },
      { key: "link_count", label: "短链", numeric: true, width: 88, render: (g) => <span className="tabular-nums">{formatNumber(g.link_count)}</span> },
      { key: "visited_links", label: "被访问", numeric: true, width: 88, render: (g) => <span className="tabular-nums">{formatNumber(g.visited_links)}</span> },
      { key: "visits", label: "累计访问", numeric: true, width: 112, render: (g) => <span className="text-fg tabular-nums">{formatNumber(g.visits)}</span> },
      { key: "visitors", label: "访客", numeric: true, width: 96, render: (g) => <span className="tabular-nums">{formatNumber(g.visitors)}</span> },
      {
        key: "owner",
        label: "归属人",
        sortable: false,
        width: 160,
        render: (g) =>
          boot.user.is_admin ? (
            <Select value={g.owner?.open_id || NONE} onValueChange={(v) => void assign(g, v)}>
              <SelectTrigger variant="inline" aria-label={`${g.name} 的归属人`} className="-ml-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>无归属</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.open_id} value={u.open_id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : g.owner ? (
            <span className="flex items-center gap-1.5">
              <Avatar name={g.owner.name || "用户"} src={g.owner.avatar_url || undefined} size={16} shape="circle" />
              <span className="truncate">{g.owner.name}</span>
            </span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      { key: "latest_created_at", label: "最近创建", width: 112, render: (g) => <span className="tabular-nums">{fmtDate(g.latest_created_at)}</span>, sortValue: (g) => g.latest_created_at || "" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boot.user.is_admin, users]
  );

  return (
    <div className="grid gap-3 pb-6">
      <div className="flex h-(--ds-header-h) shrink-0 items-center justify-between px-6">
        <h2 className="text-base font-semibold">分组</h2>
        <Button variant="primary" onClick={() => setCreating(true)}>
          新建分组
        </Button>
      </div>
      <SortableDataTable
        caption="分组列表"
        rows={items}
        columns={columns}
        rowKey="id"
        defaultSort={{ key: "visits", direction: "desc" }}
        status={state}
        onRetry={() => void load()}
        errorTitle={error || "加载失败"}
        unit="个分组"
        empty={<EmptyState title="还没有分组" description="新建一个分组，把短链按活动或渠道分开" action={<Button onClick={() => setCreating(true)}>新建分组</Button>} />}
      />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="新建分组" size="sm">
          <Field>
            <FieldLabel>名称</FieldLabel>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={64} placeholder="例如 FBIF2026 观展票" autoFocus aria-invalid={createError ? true : undefined} />
            <FieldError>{createError}</FieldError>
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              取消
            </Button>
            <ActionButton label="创建" pendingLabel="正在创建" successLabel="已创建" onAction={create} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
