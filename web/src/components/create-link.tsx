import { useId, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Link2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CopyButton } from "@/components/ui/copy-button";
import { useBootstrap } from "@/app/bootstrap";
import { api, ApiError, type LinkItem } from "@/lib/api";
import { shortUrlDisplay } from "@/lib/format";

function normalizeTarget(raw: string) {
  const text = raw.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[\w-]+(\.[\w-]+)+/.test(text) && !/\s/.test(text)) return `https://${text}`;
  return text;
}

export function CreateLink({ onCreated, onShowQr }: { onCreated: (link: LinkItem) => void; onShowQr: (url: string) => void }) {
  const { data } = useBootstrap();
  const id = useId();
  const domains = useMemo(() => {
    const list = data.domains.map((d) => d.domain);
    return list.length ? list : [data.default_domain_fallback];
  }, [data.domains, data.default_domain_fallback]);
  const [target, setTarget] = useState("");
  const [domain, setDomain] = useState(() => (domains.includes(data.settings.default_domain) ? data.settings.default_domain : domains[0]));
  const [groupId, setGroupId] = useState(() => (data.groups.some((g) => g.id === data.settings.default_group_id) ? data.settings.default_group_id : data.groups[0]?.id || ""));
  const [more, setMore] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyLength, setKeyLength] = useState(String(data.defaults.key_length));
  const [bot, setBot] = useState(data.defaults.advanced_bot_detection);
  const [wechat, setWechat] = useState(data.defaults.escape_from_wechat);
  const [webhook, setWebhook] = useState(data.defaults.webhook);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<LinkItem | null>(null);

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const url = normalizeTarget(target);
    setError("");
    if (!url) return setError("先粘贴一条要缩短的链接");
    if (!/^https?:\/\//i.test(url)) return setError("链接要以 http:// 或 https:// 开头");
    if (!groupId) return setError("先在小码后台或「分组」页创建一个分组");
    if (key && !/^[A-Za-z0-9_-]{1,32}$/.test(key)) return setError("自定义后缀只能用字母、数字、连字符、下划线，不超过 32 位");
    setPending(true);
    try {
      const { link } = await api.createLink({
        target_url: url,
        group_id: groupId,
        domain,
        name: name || undefined,
        key: key || undefined,
        key_length: key ? undefined : Number(keyLength),
        escape_from_wechat: wechat,
        advanced_bot_detection: bot,
        webhook,
      });
      setCreated(link);
      setTarget("");
      setName("");
      setKey("");
      onCreated(link);
      toast.success(`已生成 ${shortUrlDisplay(link.link_url)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "生成失败，请稍后重试");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-3" aria-label="生成短链">
      <div className="flex flex-wrap items-start gap-2">
        <Field className="min-w-0 flex-1 basis-72">
          <FieldLabel className="sr-only">长链接</FieldLabel>
          <Input
            icon={Link2}
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="粘贴长链接，回车生成短链"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
          <FieldError>{error}</FieldError>
        </Field>
        <Select value={domain} onValueChange={setDomain}>
          <SelectTrigger aria-label="短链域名" className="w-44">
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
        <Button type="submit" variant="primary" loading={pending}>
          生成短链
        </Button>
      </div>

      <div className="-ml-3 flex flex-wrap items-center gap-x-1">
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger variant="inline" aria-label="分组">
            <SelectValue placeholder="选择分组" />
          </SelectTrigger>
          <SelectContent>
            {data.groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="ghost" size="sm" aria-expanded={more} aria-controls={`${id}-more`} onClick={() => setMore((v) => !v)}>
          更多选项
          <ChevronDown aria-hidden className={more ? "rotate-180 transition-transform" : "transition-transform"} />
        </Button>
      </div>

      {more ? (
        <div id={`${id}-more`} className="grid gap-6 @xl/main:grid-cols-2">
          <Field>
            <FieldLabel>名称</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={128} placeholder="选填" />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <Field>
              <FieldLabel>自定义后缀</FieldLabel>
              <Input value={key} onChange={(e) => setKey(e.target.value.trim())} maxLength={32} placeholder="选填" />
              <FieldDescription>字母、数字、连字符、下划线</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>随机长度</FieldLabel>
              <Select value={keyLength} onValueChange={setKeyLength} disabled={Boolean(key)}>
                <SelectTrigger aria-label="随机后缀长度">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["4", "5", "6", "7", "8"].map((n) => (
                    <SelectItem key={n} value={n}>
                      {n} 位
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 @xl/main:col-span-2">
            <Switch
              label="深度过滤机器访问"
              checked={bot}
              onCheckedChange={(v) => {
                setBot(v);
                if (v) setWechat(false);
              }}
            />
            <Switch
              label="微信内强制浏览器打开"
              checked={wechat}
              onCheckedChange={(v) => {
                setWechat(v);
                if (v) setBot(false);
              }}
            />
            <Switch label="事件推送" checked={webhook} onCheckedChange={setWebhook} />
          </div>
        </div>
      ) : null}

      {created ? (
        <div className="flex flex-wrap items-center gap-2 rounded-row bg-well px-3 py-2" role="status">
          <a href={created.link_url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono text-sm text-fg">
            {created.link_url}
          </a>
          <span className="ml-auto flex items-center gap-1">
            <CopyButton value={created.link_url} label="复制" size="sm" variant="secondary" />
            <Button type="button" variant="ghost" size="sm" onClick={() => onShowQr(created.link_url)}>
              <QrCode aria-hidden />
              二维码
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href={`/go?url=${encodeURIComponent(created.link_url)}`} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden />
                打开
              </a>
            </Button>
          </span>
        </div>
      ) : null}
    </form>
  );
}
