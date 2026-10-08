import { useMemo } from "react";
import { LineChart, type LineChartDatum } from "@/components/ui/line-chart";
import { BarChart } from "@/components/ui/bar-chart";
import { DonutChart } from "@/components/ui/donut-chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Chart, DailyPoint } from "@/lib/api";
import { BROWSER_LABEL, DEVICE_LABEL, NETWORK_LABEL, OS_LABEL, fmtAxisDay, formatNumber, hostOf, labelOf } from "@/lib/format";

const WEEK = "日一二三四五六";

function dayLabel(date: string) {
  const d = new Date(`${date}T00:00:00+08:00`);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${WEEK[d.getDay()]}`;
}

export function toLineData(daily: DailyPoint[]): LineChartDatum[] {
  return daily.map((d) => ({ key: d.date, label: dayLabel(d.date), axisLabel: fmtAxisDay(d.date), values: { visits: d.visit_count, visitors: d.visitor_count } }));
}

function BreakdownTable({ title, rows, nameLabel, emptyLabel = "这段时间没有数据" }: { title: string; rows: { name: string; count: number }[]; nameLabel: string; emptyLabel?: string }) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <section aria-label={title} className="grid min-w-0 content-start gap-2">
      <h3 className="flex h-(--ds-h-md) items-center text-sm font-medium">{title}</h3>
      {rows.length ? (
        <Table flush>
          <TableHeader>
            <TableRow>
              <TableHead>{nameLabel}</TableHead>
              <TableHead className="text-right">访问</TableHead>
              <TableHead className="w-16 text-right">占比</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.name}>
                <TableCell className="truncate text-fg" title={r.name}>
                  {r.name}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(r.count)}</TableCell>
                <TableCell className="text-right text-fg-muted tabular-nums">{total ? `${((r.count / total) * 100).toFixed(1)}%` : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-fg-muted">{emptyLabel}</p>
      )}
    </section>
  );
}

export function StatsPanel({ daily, chart, period, loading, error, onRetry }: { daily: DailyPoint[]; chart: Chart | null; period: string; loading?: boolean; error?: string; onRetry?: () => void }) {
  const lineData = useMemo(() => toLineData(daily), [daily]);
  const hours = useMemo(
    () =>
      Array.from({ length: 24 }, (_, h) => {
        const row = chart?.hour_stats?.find((x) => x.hour === h);
        const value = row ? (row.count ?? row.visit_count ?? 0) : 0;
        return { key: String(h), label: `${h}:00 到 ${h + 1}:00`, axisLabel: h % 6 === 0 ? `${h} 时` : "", value };
      }),
    [chart]
  );
  const devices = (chart?.device_stats || []).map((d) => ({ key: d.device, label: labelOf(DEVICE_LABEL, d.device), value: d.count }));
  const asRows = (list: { count: number }[] | undefined, pick: (x: never) => string) => (list || []).map((x) => ({ name: pick(x as never), count: x.count })).sort((a, b) => b.count - a.count);
  const osRows = asRows(chart?.os_stats, (x: { os: string }) => labelOf(OS_LABEL, x.os));
  const browserRows = asRows(chart?.browser_stats, (x: { browser: string }) => labelOf(BROWSER_LABEL, x.browser));
  const networkRows = asRows(chart?.network_stats, (x: { network: string }) => labelOf(NETWORK_LABEL, x.network));
  const chinaRows = asRows(chart?.china_stats, (x: { region: string }) => x.region || "未知").slice(0, 10);
  const worldRows = asRows(chart?.world_stats, (x: { country: string }) => x.country || "未知").slice(0, 10);
  const refererRows = asRows(chart?.top_referer_stats, (x: { referer: string }) => (x.referer ? hostOf(x.referer) : "直接访问"));
  const ipRows = asRows(chart?.top_ip_stats, (x: { ip: string }) => x.ip);

  return (
    <div className="grid gap-8">
      <div className="grid min-w-0 gap-2">
        <h3 className="text-sm font-medium">每日访问</h3>
        <LineChart
          label={`每日访问，${period}`}
          data={lineData}
          series={[
            { key: "visits", label: "访问次数" },
            { key: "visitors", label: "访客数", dashed: true },
          ]}
          loading={loading}
          error={error}
          onRetry={onRetry}
        />
      </div>

      <div className="grid gap-8 @2xl:grid-cols-2 @2xl:gap-12">
        <div className="grid min-w-0 gap-2">
          <h3 className="text-sm font-medium">24 小时分布</h3>
          <BarChart label={`24 小时分布，${period}`} data={hours} period={period} categoryLabel="时段" averageLabel="平均每小时" loading={loading} error={error} onRetry={onRetry} />
        </div>
        <div className="grid min-w-0 gap-2">
          <h3 className="text-sm font-medium">设备</h3>
          <DonutChart label={`设备分布，${period}`} data={devices} period={period} size={176} loading={loading} error={error} onRetry={onRetry} />
        </div>
      </div>

      <div className="grid gap-8 @2xl:grid-cols-2 @2xl:gap-12">
        <BreakdownTable title="系统" nameLabel="系统" rows={osRows} />
        <BreakdownTable title="浏览器" nameLabel="浏览器" rows={browserRows} />
        <BreakdownTable title="网络" nameLabel="网络" rows={networkRows} />
        <BreakdownTable title="来源" nameLabel="来源" rows={refererRows} />
        <BreakdownTable title="地区" nameLabel="省份或地区" rows={chinaRows} />
        {worldRows.length > 1 ? <BreakdownTable title="国家与地区" nameLabel="国家" rows={worldRows} /> : <BreakdownTable title="高频 IP" nameLabel="IP" rows={ipRows} />}
      </div>
    </div>
  );
}
