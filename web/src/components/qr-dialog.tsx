import { useEffect, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { shortUrlDisplay } from "@/lib/format";

function useQr(url: string | null) {
  const [dataUrl, setDataUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setDataUrl("");
    setError("");
    api
      .qrcode(url)
      .then((r) => !cancelled && setDataUrl(r.data_url))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "二维码生成失败"));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return { dataUrl, error };
}

function QrImage({ url, dataUrl, error, size }: { url: string; dataUrl: string; error: string; size: number }) {
  if (dataUrl) return <img src={dataUrl} alt={`${url} 的二维码`} width={size} height={size} className="rounded-sm bg-white" />;
  if (error) return <p className="text-sm text-fg-muted">{error}</p>;
  return (
    <div className="grid place-items-center" style={{ width: size, height: size }}>
      <Spinner delay={400} label="正在生成" />
    </div>
  );
}

function SaveButton({ url, dataUrl, size }: { url: string; dataUrl: string; size?: "sm" }) {
  return (
    <Button asChild variant="primary" size={size} aria-disabled={!dataUrl}>
      <a href={dataUrl || "#"} download={`qrcode-${shortUrlDisplay(url).replace(/[^\w-]+/g, "_")}.png`}>
        保存图片
      </a>
    </Button>
  );
}

/** 列表、生成页用：对话框（下面没有别的浮层时） */
export function QrDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
  const { dataUrl, error } = useQr(url);
  return (
    <Dialog open={Boolean(url)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="二维码" description={url ? shortUrlDisplay(url) : undefined} size="sm">
        <div className="grid place-items-center">{url ? <QrImage url={url} dataUrl={dataUrl} error={error} size={240} /> : null}</div>
        <DialogFooter>
          {url ? <CopyButton variant="secondary" value={url} label="复制短链" /> : null}
          {url ? <SaveButton url={url} dataUrl={dataUrl} /> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 详情抽屉里用：从按钮弹出的小浮层，不带遮罩——抽屉上不再叠一层模态 */
export function QrPopover({ url, children }: { url: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { dataUrl, error } = useQr(open ? url : null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="grid w-auto justify-items-center gap-3">
        <QrImage url={url} dataUrl={dataUrl} error={error} size={176} />
        <SaveButton url={url} dataUrl={dataUrl} size="sm" />
      </PopoverContent>
    </Popover>
  );
}
