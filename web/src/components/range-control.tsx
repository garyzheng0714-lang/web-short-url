import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";

export type RangeKey = "7d" | "30d" | "90d";
export const RANGE_ITEMS = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "90d", label: "近 90 天" },
] as const;
export const rangeLabel = (r: RangeKey) => RANGE_ITEMS.find((x) => x.value === r)?.label ?? r;

export function RangeSegmented({ value, onChange, group, className }: { value: RangeKey; onChange: (v: RangeKey) => void; group: string; className?: string }) {
  return <Segmented aria-label="时间范围" group={group} value={value} onValueChange={(v) => onChange(v as RangeKey)} items={RANGE_ITEMS} className={className} />;
}

/** 小码默认不排除机器访问；本工具默认排除，开关打开表示把机器访问也算进来 */
export function BotSwitch({ includeBots, onChange }: { includeBots: boolean; onChange: (v: boolean) => void }) {
  return <Switch label="含机器访问" checked={includeBots} onCheckedChange={onChange} />;
}
