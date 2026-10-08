import { useEffect, useState } from "react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { LinkDetail } from "@/components/link-detail";
import { api, type LinkItem } from "@/lib/api";
import { shortUrlDisplay } from "@/lib/format";

/** 右侧抽屉里的短链详情：列表留在后面，关掉回到原位；由 ?link=<id> 驱动，刷新后仍开着。 */
export function LinkDrawer({ id, initial, onClose, onChanged }: { id: number | null; initial?: LinkItem | null; onClose: () => void; onChanged?: (link: LinkItem) => void }) {
  const [head, setHead] = useState<LinkItem | null>(initial ?? null);
  useEffect(() => {
    setHead(initial ?? null);
    if (id && !initial) api.getLink(id).then((r) => setHead(r.link)).catch(() => undefined);
  }, [id, initial]);

  return (
    <Drawer open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent side="right" className="max-w-3xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector<HTMLElement>("button[aria-label=关闭]")?.focus();
        }}
        title={head ? shortUrlDisplay(head.link_url) : "短链"} description={head ? <span className="block truncate" title={head.target_url}>{head.target_url}</span> : undefined}>
        {id !== null ? (
          <LinkDetail
            id={id}
            onChanged={(l) => {
              setHead(l);
              onChanged?.(l);
            }}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
