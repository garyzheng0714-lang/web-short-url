import { useEffect, useState } from "react";
import { Copy, Ellipsis, ExternalLink, Pause, Pencil, Play, QrCode, UserRoundPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Drawer, DrawerContent, DrawerFooter } from "@/components/ui/drawer";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ActionButton } from "@/components/ui/action-button";
import { writeClipboard } from "@/components/ui/copy-button";
import { api, ApiError, type LinkItem } from "@/lib/api";
import { shortUrlDisplay } from "@/lib/format";

export async function toggleSuspend(link: LinkItem, onChanged: (l: LinkItem) => void) {
  const suspend = link.status !== "suspended";
  try {
    const { link: next } = suspend ? await api.suspendLink(link.id) : await api.resumeLink(link.id);
    onChanged(next);
    toast(suspend ? `已暂停 ${shortUrlDisplay(link.link_url)} 的跳转` : `已恢复 ${shortUrlDisplay(link.link_url)} 的跳转`, {
      action: {
        label: "撤销",
        onClick: () => {
          (suspend ? api.resumeLink(link.id) : api.suspendLink(link.id)).then((r) => onChanged(r.link)).catch(() => toast.error("撤销失败"));
        },
      },
    });
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : "操作失败");
  }
}

export async function claimLink(link: LinkItem, onChanged: (l: LinkItem) => void) {
  try {
    const { link: next } = await api.claimLink(link.id);
    onChanged(next);
    toast.success(`已把 ${shortUrlDisplay(link.link_url)} 归到你名下`);
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : "认领失败");
  }
}

export function LinkRowMenu({ link, onChanged, onQr, onEdit, onOpen }: { link: LinkItem; onChanged: (l: LinkItem) => void; onQr: (url: string) => void; onEdit: (l: LinkItem) => void; onOpen: (l: LinkItem) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${shortUrlDisplay(link.link_url)} 的更多操作`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => writeClipboard(link.link_url).then(() => toast.success("已复制短链")).catch(() => toast.error("复制失败"))}>
          <Copy aria-hidden />
          复制短链
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onQr(link.link_url)}>
          <QrCode aria-hidden />
          二维码
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => window.open(`/go?url=${encodeURIComponent(link.link_url)}`, "_blank", "noopener,noreferrer")}>
          <ExternalLink aria-hidden />
          打开短链
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onOpen(link)}>查看数据</DropdownMenuItem>
        {link.can_manage ? (
          <>
            <DropdownMenuItem onSelect={() => onEdit(link)}>
              <Pencil aria-hidden />
              编辑
            </DropdownMenuItem>
            {link.status === "banned" ? null : (
              <DropdownMenuItem onSelect={() => void toggleSuspend(link, onChanged)}>
                {link.status === "suspended" ? <Play aria-hidden /> : <Pause aria-hidden />}
                {link.status === "suspended" ? "恢复跳转" : "暂停跳转"}
              </DropdownMenuItem>
            )}
          </>
        ) : null}
        {!link.creator ? (
          <DropdownMenuItem onSelect={() => void claimLink(link, onChanged)}>
            <UserRoundPlus aria-hidden />
            认领到我名下
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EditLinkDrawer({ link, onClose, onSaved }: { link: LinkItem | null; onClose: () => void; onSaved: (l: LinkItem) => void }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [bot, setBot] = useState(false);
  const [wechat, setWechat] = useState(false);
  const [webhook, setWebhook] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!link) return;
    setName(link.name);
    setTarget(link.target_url);
    setBot(link.flags.advanced_bot_detection);
    setWechat(link.flags.escape_from_wechat);
    setWebhook(link.flags.webhook);
    setError("");
  }, [link]);

  const save = async () => {
    if (!link) return;
    const url = target.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError("目标链接要以 http:// 或 https:// 开头");
      throw new Error("invalid");
    }
    setError("");
    const patch: Parameters<typeof api.updateLink>[1] = {};
    if (name !== link.name) patch.name = name;
    if (url !== link.target_url) patch.target_url = url;
    if (bot !== link.flags.advanced_bot_detection) patch.advanced_bot_detection = bot;
    if (wechat !== link.flags.escape_from_wechat) patch.escape_from_wechat = wechat;
    if (webhook !== link.flags.webhook) patch.webhook = webhook;
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    try {
      const { link: next } = await api.updateLink(link.id, patch);
      onSaved(next);
      toast.success("已保存");
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败");
      throw e;
    }
  };

  return (
    <Drawer open={Boolean(link)} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent title="编辑短链" description={link ? shortUrlDisplay(link.link_url) : undefined} side="right">
        <div className="grid gap-6 p-inset">
          <Field>
            <FieldLabel>名称</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={128} />
          </Field>
          <Field>
            <FieldLabel>目标链接</FieldLabel>
            <Input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="url" aria-invalid={error ? true : undefined} />
            <FieldDescription>改了之后已发出去的短链会跳到新地址</FieldDescription>
            <FieldError>{error}</FieldError>
          </Field>
          <div className="grid gap-3">
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
        <DrawerFooter>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <ActionButton label="保存" pendingLabel="正在保存" successLabel="已保存" errorLabel="保存失败" onAction={save} />
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
