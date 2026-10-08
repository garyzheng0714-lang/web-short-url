import { useState } from "react";
import { ExternalLink, Link2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/ui/copy-button";
import { useBootstrap } from "@/app/bootstrap";
import { api, ApiError, type LinkItem, type Usage } from "@/lib/api";
import { shortUrlDisplay } from "@/lib/format";

function normalizeTarget(raw: string) {
  const text = raw.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[\w-]+(\.[\w-]+)+/.test(text) && !/\s/.test(text)) return `https://${text}`;
  return text;
}

/**
 * 生成短链：一个输入框 + 一个按钮。域名、分组用设置里的默认值，不在这里摆出来。
 * 输入框与按钮同一行、同高、顶边对齐；出错时下面一行写原因，左缘与输入框同线。额度只在用完时弹窗，平时不显示。
 */
export function CreateLink({ usage, onUsage, onCreated, onShowQr, onOpen, onQuotaExceeded }: {
  usage: Usage;
  onUsage: (u: Usage) => void;
  onCreated: (link: LinkItem) => void;
  onShowQr: (url: string) => void;
  onOpen: (link: LinkItem) => void;
  onQuotaExceeded: () => void;
}) {
  const { data } = useBootstrap();
  const domain = data.domains.some((d) => d.domain === data.settings.default_domain) ? data.settings.default_domain : data.domains[0]?.domain || data.default_domain_fallback;
  const group = data.groups.find((g) => g.id === data.settings.default_group_id) || data.groups[0];
  const [target, setTarget] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<LinkItem | null>(null);

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError("");
    if (usage.remaining <= 0) return onQuotaExceeded();
    const url = normalizeTarget(target);
    if (!url) return setError("先粘贴一条要缩短的链接");
    if (!/^https?:\/\//i.test(url)) return setError("链接要以 http:// 或 https:// 开头");
    if (!group) return setError("小码账号里还没有分组");
    setPending(true);
    try {
      const r = await api.createLink({ target_url: url, group_id: group.id, domain, key_length: data.defaults.key_length, advanced_bot_detection: data.defaults.advanced_bot_detection, webhook: data.defaults.webhook });
      setCreated(r.link);
      setTarget("");
      onUsage(r.usage);
      onCreated(r.link);
      toast.success(`已生成 ${shortUrlDisplay(r.link.link_url)}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "quota_exceeded") {
        onQuotaExceeded();
        api.usage().then(onUsage).catch(() => undefined);
      } else setError(err instanceof ApiError ? err.message : "生成失败，请稍后重试");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-2" aria-label="生成短链">
      <div className="flex items-center gap-2">
        <Input
          icon={Link2}
          className="min-w-0 flex-1"
          type="text"
          inputMode="url"
          autoComplete="off"
          aria-label="长链接"
          placeholder="粘贴长链接"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
        <Button type="submit" variant="primary" loading={pending}>
          生成
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      {created ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-row bg-well py-1 pr-1 pl-3" role="status">
          <button type="button" className="min-w-0 truncate text-sm font-medium text-fg hover:underline" onClick={() => onOpen(created)}>
            {shortUrlDisplay(created.link_url)}
          </button>
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
