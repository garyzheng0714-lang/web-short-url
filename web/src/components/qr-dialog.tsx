import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { shortUrlDisplay } from "@/lib/format";

export function QrDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
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

  return (
    <Dialog open={Boolean(url)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="二维码" description={url ? shortUrlDisplay(url) : undefined} size="sm">
        <div className="grid place-items-center">
          {dataUrl ? (
            <img src={dataUrl} alt={`${url} 的二维码`} width={240} height={240} className="rounded-sm bg-white" />
          ) : error ? (
            <p className="text-sm text-fg-muted">{error}</p>
          ) : (
            <div className="grid size-60 place-items-center">
              <Spinner delay={400} label="正在生成" />
            </div>
          )}
        </div>
        <DialogFooter>
          {url ? <CopyButton variant="secondary" value={url} label="复制短链" /> : null}
          <Button asChild variant="primary" aria-disabled={!dataUrl}>
            <a href={dataUrl || "#"} download={url ? `qrcode-${shortUrlDisplay(url).replace(/[^\w-]+/g, "_")}.png` : undefined}>
              保存图片
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
