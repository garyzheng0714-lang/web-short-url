import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ActionButton } from "@/components/ui/action-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { Avatar } from "@/components/ui/avatar";
import { useBootstrap } from "@/app/bootstrap";
import { api, ApiError, type SyncStatus } from "@/lib/api";
import { fmtDateTime, formatNumber, relativeTime } from "@/lib/format";

const NONE = "__none";
const JOB_LABEL: Record<string, string> = { inventory_full: "全量盘点", inventory: "增量盘点", totals_hot: "热门累计", totals_initial: "新短链累计", totals_warm: "常规累计", totals_cold: "冷门累计" };

export function SettingsPage() {
  const { data: boot, refresh } = useBootstrap();
  const [settings, setSettings] = useState(boot.settings);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [quota, setQuota] = useState<Awaited<ReturnType<typeof api.quota>> | null>(null);
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.users>>["items"]>([]);

  const save = async (patch: Partial<typeof settings>) => {
    const prev = settings;
    setSettings({ ...settings, ...patch });
    try {
      const r = await api.saveSettings(patch);
      setSettings(r.settings);
      toast.success("已保存");
      void refresh();
    } catch (e) {
      setSettings(prev);
      toast.error(e instanceof ApiError ? e.message : "保存失败");
    }
  };

  const loadAdmin = useCallback(async () => {
    if (!boot.user.is_admin) return;
    const [s, q, u] = await Promise.allSettled([api.syncStatus(), api.quota(), api.users()]);
    if (s.status === "fulfilled") setSync(s.value);
    if (q.status === "fulfilled") setQuota(q.value);
    if (u.status === "fulfilled") setUsers(u.value.items);
  }, [boot.user.is_admin]);
  useEffect(() => {
    void loadAdmin();
    if (!boot.user.is_admin) return;
    const t = window.setInterval(() => api.syncStatus().then(setSync).catch(() => undefined), 15_000);
    return () => window.clearInterval(t);
  }, [loadAdmin, boot.user.is_admin]);

  const run = (job: "inventory" | "inventory_full" | "totals") => async () => {
    await api.runSync(job);
    window.setTimeout(() => api.syncStatus().then(setSync).catch(() => undefined), 1500);
  };

  const domains = [...new Set([...boot.domains.map((d) => d.domain), boot.default_domain_fallback])];

  return (
    <div className="grid gap-10 px-6 pb-10">
      <div className="flex h-(--ds-header-h) shrink-0 items-center">
        <h2 className="text-base font-semibold">设置</h2>
      </div>

      <section className="grid max-w-xl gap-6" aria-labelledby="s-defaults">
        <h3 id="s-defaults" className="text-sm font-medium">
          生成短链的默认值
        </h3>
        <Field>
          <FieldLabel>默认域名</FieldLabel>
          <Select value={settings.default_domain || domains[0]} onValueChange={(v) => void save({ default_domain: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {domains.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>默认分组</FieldLabel>
          <Select value={settings.default_group_id || NONE} onValueChange={(v) => void save({ default_group_id: v === NONE ? "" : v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>第一个分组</SelectItem>
              {boot.groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>每次打开生成区时预选的分组</FieldDescription>
        </Field>
        <Switch label="统计默认排除机器访问" checked={settings.exclude_bot} onCheckedChange={(v) => void save({ exclude_bot: v })} />
      </section>

      <section className="grid gap-3" aria-labelledby="s-account">
        <h3 id="s-account" className="text-sm font-medium">
          账号
        </h3>
        <div className="flex items-center gap-3">
          <Avatar name={boot.user.name || "用户"} src={boot.user.avatar_url || undefined} size={32} shape="circle" />
          <div className="grid">
            <span className="text-sm text-fg">{boot.user.name}</span>
            <span className="text-xs text-fg-muted">{boot.user.is_admin ? "管理员" : "成员"} · 租户 {boot.user.tenant_key}</span>
          </div>
        </div>
      </section>

      {boot.user.is_admin ? (
        <>
          <section className="grid gap-3" aria-labelledby="s-sync">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="s-sync" className="mr-auto text-sm font-medium">
                与小码同步
              </h3>
              <ActionButton variant="secondary" size="sm" label="增量盘点" pendingLabel="已排队" successLabel="已开始" onAction={run("inventory")} />
              <ActionButton variant="secondary" size="sm" label="全量盘点" pendingLabel="已排队" successLabel="已开始" onAction={run("inventory_full")} />
              <ActionButton variant="secondary" size="sm" label="补齐累计数据" pendingLabel="已排队" successLabel="已开始" onAction={run("totals")} />
            </div>
            {sync ? (
              <>
                <p className="text-xs text-fg-muted tabular-nums">
                  本地镜像 {formatNumber(sync.counts.live)} 条短链，{formatNumber(sync.counts.with_stats)} 条有累计数据，{formatNumber(sync.counts.pending_stats)} 条待拉取，{formatNumber(sync.counts.attributed)} 条有归属 · 上次盘点 {relativeTime(sync.inventory_at)} · 小码调用 {formatNumber(sync.client.calls)} 次，失败 {formatNumber(sync.client.failed)} 次
                  {sync.client.pausedUntil ? ` · 已暂停到 ${fmtDateTime(sync.client.pausedUntil)}` : ""}
                  {sync.running.length ? ` · 正在运行 ${sync.running.map((j) => JOB_LABEL[j] || j).join("、")}` : ""}
                </p>
                <Table flush>
                  <TableHeader>
                    <TableRow>
                      <TableHead>任务</TableHead>
                      <TableHead className="w-40">开始</TableHead>
                      <TableHead className="w-20 text-right">处理</TableHead>
                      <TableHead className="w-20 text-right">调用</TableHead>
                      <TableHead className="w-24">结果</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sync.last_runs.map((r) => (
                      <TableRow key={r.job}>
                        <TableCell>{JOB_LABEL[r.job] || r.job}</TableCell>
                        <TableCell className="tabular-nums">{fmtDateTime(r.started_at)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(r.items)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(r.calls)}</TableCell>
                        <TableCell>
                          {r.ok === null ? (
                            <Tag variant="neutral">进行中</Tag>
                          ) : r.ok ? (
                            <Tag variant="success">成功</Tag>
                          ) : (
                            <Tag variant="danger" title={r.error || undefined}>
                              失败
                            </Tag>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : (
              <p className="text-sm text-fg-muted">正在读取同步状态</p>
            )}
          </section>

          <section className="grid gap-3" aria-labelledby="s-quota">
            <h3 id="s-quota" className="text-sm font-medium">
              小码账号
            </h3>
            {quota ? (
              <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <dt className="text-fg-muted">剩余建链额度</dt>
                <dd className="tabular-nums">{formatNumber(quota.quota.link_quota)}</dd>
                <dt className="text-fg-muted">自有域名</dt>
                <dd>{quota.private_domains.map((d) => d.domain).join("、") || "—"}</dd>
                <dt className="text-fg-muted">白名单域名</dt>
                <dd>
                  {quota.whitelist.domains.join("、") || "—"}
                  <span className="text-fg-muted tabular-nums">
                    {" "}
                    · 上限 {quota.whitelist.max_whitelist_size}，本月还可提交 {quota.whitelist.available_submissions} 次
                  </span>
                </dd>
              </dl>
            ) : (
              <p className="text-sm text-fg-muted">正在读取</p>
            )}
          </section>

          <section className="grid gap-3" aria-labelledby="s-users">
            <h3 id="s-users" className="text-sm font-medium">
              成员
            </h3>
            <Table flush>
              <TableHeader>
                <TableRow>
                  <TableHead>成员</TableHead>
                  <TableHead className="w-40">租户</TableHead>
                  <TableHead className="w-24">角色</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.open_id}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <Avatar name={u.name || "用户"} src={u.avatar_url || undefined} size={24} shape="circle" />
                        {u.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-fg-muted">{u.tenant_key || "—"}</TableCell>
                    <TableCell>{u.is_admin ? <Tag variant="chip">管理员</Tag> : <span className="text-fg-muted">成员</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </>
      ) : null}
    </div>
  );
}
