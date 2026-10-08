import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import type { Usage } from "@/lib/api";

export function QuotaDialog({ open, usage, userName, onClose }: { open: boolean; usage: Usage; userName: string; onClose: () => void }) {
  const ask = `${usage.contact} 你好，我是${userName}，本月 ${usage.limit} 条短链额度已用完，想申请增加额度。`;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="本月额度已用完" size="sm">
        <p className="text-sm text-fg">
          每人每月可以生成 {usage.limit} 条短链，你本月已生成 {usage.used} 条。需要更多，请联系 {usage.contact} 开通。
        </p>
        <DialogFooter>
          <CopyButton variant="secondary" value={ask} label="复制申请内容" />
          <Button variant="primary" onClick={onClose}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
