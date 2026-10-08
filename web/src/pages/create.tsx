import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Link2 } from "lucide-react";
import { CreateLink } from "@/components/create-link";
import { QuotaDialog } from "@/components/quota-dialog";
import { QrDialog } from "@/components/qr-dialog";
import { useBootstrap } from "@/app/bootstrap";
import type { Usage } from "@/lib/api";

/** 上一版首页的查询串（视图、筛选、抽屉）都属于数据页 */
const DATA_PARAMS = ["view", "scope", "group", "q", "sort", "dir", "page", "link", "g"];

/**
 * 生成短链：单输入工具的排法（Mindtrip、Bloom、Delphi、Chronicle 的共性）——图标、标题、输入组一列居中，落在主区视觉中心略偏上；
 * 标题说这页做什么，按钮只写动词「生成」，不复述标题。不放说明句、默认值与用量。生成后的结果条紧贴在输入组下面。
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
    <div className="grid flex-1 place-items-center pb-24">
      <div className="grid w-full max-w-xl justify-items-center gap-6">
        <span aria-hidden className="grid size-12 place-items-center rounded-card bg-card text-accent shadow-card">
          <Link2 className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold">生成短链</h1>
        <div className="w-full">
          <CreateLink usage={usage} onUsage={setUsage} onCreated={() => undefined} onShowQr={setQrUrl} onOpen={(l) => navigate(`/data?link=${l.id}`)} onQuotaExceeded={() => setQuotaOpen(true)} />
        </div>
      </div>
      <QrDialog url={qrUrl} onClose={() => setQrUrl(null)} />
      <QuotaDialog open={quotaOpen} usage={usage} userName={boot.user.name} onClose={() => setQuotaOpen(false)} />
    </div>
  );
}
