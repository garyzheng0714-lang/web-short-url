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
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tag } from "@/components/ui/tag";
import { writeClipboard } from "@/components/ui/copy-button";
import { api, ApiError, type LinkItem } from "@/lib/api";
import { STATUS_LABEL, STATUS_TONE, shortUrlDisplay } from "@/lib/format";

/** 短链状态：圆点 + 字（正常绿、暂停灰、封禁红） */
export function LinkStatus({ status, className }: { status: string; className?: string }) {
  return (
    <Tag variant={STATUS_TONE[status] || "neutral"} className={className}>
      {STATUS_LABEL[status] || status}
    </Tag>
  );
}

/**
 * 暂停 / 恢复跳转的确认：一句后果 + 取消 + 长按按钮（暂停是红色「按住暂停」，恢复是「按住恢复」）。
 * 暂停会让所有已经拿到这条短链的人都打不开，和删除同一档后果，所以要按住才执行（DESIGN.md：不可逆、后果一句说得清的动作用长按确认）。
 */
export function SuspendConfirm({ link, onDone, onCancel }: { link: LinkItem; onDone: (l: LinkItem) => void; onCancel: () => void }) {
  const suspend = link.status !== "suspended";
  const run = async () => {
    try {
      const { link: next } = suspend ? await api.suspendLink(link.id) : await api.resumeLink(link.id);
      toast.success(suspend ? `已暂停 ${shortUrlDisplay(link.link_url)} 的跳转` : `已恢复 ${shortUrlDisplay(link.link_url)} 的跳转`);
      onDone(next);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
      throw e;
    }
  };
  return (
    <div className="grid gap-4">
      <p className="text-sm text-fg">{suspend ? "暂停后，所有人打开这条短链都会失败，直到恢复为止。" : "恢复后，这条短链会重新跳到目标链接。"}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
        <HoldToConfirm
          label={suspend ? "按住暂停" : "按住恢复"}
          pendingLabel={suspend ? "正在暂停" : "正在恢复"}
          successLabel={suspend ? "已暂停" : "已恢复"}
          variant={suspend ? "danger" : "primary"}
          onConfirm={run}
        />
      </div>
    </div>
  );
}

/** 列表里用：对话框里的确认（下面没有抽屉，不叠模态） */
export function SuspendDialog({ link, onClose, onChanged }: { link: LinkItem | null; onClose: () => void; onChanged: (l: LinkItem) => void }) {
  return (
    <Dialog open={Boolean(link)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={link?.status === "suspended" ? "恢复跳转" : "暂停跳转"} description={link ? shortUrlDisplay(link.link_url) : undefined} size="sm">
        {link ? (
          <SuspendConfirm
            key={`${link.id}-${link.status}`}
            link={link}
            onCancel={onClose}
            onDone={(next) => {
              onChanged(next);
              onClose();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
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

export function LinkRowMenu({ link, onChanged, onQr, onEdit, onOpen, onSuspend }: { link: LinkItem; onChanged: (l: LinkItem) => void; onQr: (url: string) => void; onEdit: (l: LinkItem) => void; onOpen: (l: LinkItem) => void; onSuspend: (l: LinkItem) => void }) {
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
              <DropdownMenuItem onSelect={() => onSuspend(link)}>
                {link.status === "suspended" ? <Play aria-hidden /> : <Pause aria-hidden />}
                {link.status === "suspended" ? "恢复跳转…" : "暂停跳转…"}
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

/**
 * 编辑短链的表单（名称、目标链接、三个开关）。列表页在抽屉里用（EditLinkDrawer）；详情抽屉里原地切换成它，不在抽屉上再叠一层。
 * footer：放进抽屉底栏时由调用方包；不传时按钮排在表单下方右侧。
 */
export function EditLinkForm({ link, onCancel, onSaved, renderFooter }: { link: LinkItem; onCancel: () => void; onSaved: (l: LinkItem) => void; renderFooter?: (buttons: React.ReactNode) => React.ReactNode }) {
  const [name, setName] = useState(link.name);
  const [target, setTarget] = useState(link.target_url);
  const [bot, setBot] = useState(link.flags.advanced_bot_detection);
  const [wechat, setWechat] = useState(link.flags.escape_from_wechat);
  const [webhook, setWebhook] = useState(link.flags.webhook);
  const [error, setError] = useState("");

  const save = async () => {
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
      onCancel();
      return;
    }
    try {
      const { link: next } = await api.updateLink(link.id, patch);
      toast.success("已保存");
      onSaved(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败");
      throw e;
    }
  };

  const buttons = (
    <>
      <Button variant="secondary" onClick={onCancel}>
        取消
      </Button>
      <ActionButton label="保存" pendingLabel="正在保存" successLabel="已保存" errorLabel="保存失败" onAction={save} />
    </>
  );
  return (
    <>
      <div className="grid gap-6">
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
      {renderFooter ? renderFooter(buttons) : <div className="flex justify-end gap-2">{buttons}</div>}
    </>
  );
}

export function EditLinkDrawer({ link, onClose, onSaved }: { link: LinkItem | null; onClose: () => void; onSaved: (l: LinkItem) => void }) {
  return (
    <Drawer open={Boolean(link)} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent title="编辑短链" description={link ? shortUrlDisplay(link.link_url) : undefined} side="right">
        {link ? (
          <EditLinkForm
            key={link.id}
            link={link}
            onCancel={onClose}
            onSaved={(next) => {
              onSaved(next);
              onClose();
            }}
            renderFooter={(buttons) => <DrawerFooter>{buttons}</DrawerFooter>}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
