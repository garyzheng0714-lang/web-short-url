import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Bootstrap } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

type Ctx = { data: Bootstrap; refresh: () => Promise<void> };
const BootstrapContext = createContext<Ctx | null>(null);

export function BootstrapProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string>("");
  const load = useCallback(async () => {
    setError("");
    try {
      setData(await api.bootstrap());
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="grid h-dvh place-items-center bg-canvas">
        <EmptyState title="没能连上服务" description={error} action={<Button onClick={() => void load()}>重试</Button>} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="grid h-dvh place-items-center bg-canvas">
        <Spinner delay={400} label="正在加载" />
      </div>
    );
  }
  return <BootstrapContext.Provider value={{ data, refresh: load }}>{children}</BootstrapContext.Provider>;
}

export function useBootstrap() {
  const ctx = useContext(BootstrapContext);
  if (!ctx) throw new Error("useBootstrap outside provider");
  return ctx;
}
