import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { CreateLink } from "@/components/create-link";
import { QuotaDialog } from "@/components/quota-dialog";
import { QrDialog } from "@/components/qr-dialog";
import { useBootstrap } from "@/app/bootstrap";
import type { Usage } from "@/lib/api";

/** 上一版首页的查询串（视图、筛选、抽屉）都属于数据页 */
const DATA_PARAMS = ["view", "scope", "group", "q", "sort", "dir", "page", "link", "g"];

/**
 * 生成短链：只有一个输入框和一个按钮，居中、宽不超过 672（用户 2026-10-08：「只有一个输入框，然后一个生成按钮，很简单」）。
 * 不放可见标题：标题复述按钮是多余的，页名留给读屏。生成后的结果条紧贴在下，点短链去数据页看它的抽屉。
 */
export function CreatePage() {
  const { data: boot } = useBootstrap();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [usage, setUsage] = useState<Usage>(boot.usage);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const params = new URLSearchParams(search);
  if (DATA_PARAMS.some((k) => params.has(k))) return <Navigate replace to={`/data${search}`} />;

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4 pt-32">
      <h1 className="sr-only">生成短链</h1>
      <CreateLink usage={usage} onUsage={setUsage} onCreated={() => undefined} onShowQr={setQrUrl} onOpen={(l) => navigate(`/data?link=${l.id}`)} onQuotaExceeded={() => setQuotaOpen(true)} />
      <QrDialog url={qrUrl} onClose={() => setQrUrl(null)} />
      <QuotaDialog open={quotaOpen} usage={usage} userName={boot.user.name} onClose={() => setQuotaOpen(false)} />
    </div>
  );
}
