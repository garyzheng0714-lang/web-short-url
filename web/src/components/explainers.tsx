import type { ReactNode } from "react";
import { ArrowRight, Check, X } from "lucide-react";

/**
 * 首页的两张对比图：用真实的聊天界面讲清「短链是什么、有什么用」。
 * 全部用设计变量画，不用位图；每张图左「之前」右「之后」。
 */

function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
      <span className={ok ? "grid size-4 place-items-center rounded-full bg-success text-card" : "grid size-4 place-items-center rounded-full bg-danger text-card"}>
        {ok ? <Check aria-hidden className="size-3" strokeWidth={2.5} /> : <X aria-hidden className="size-3" strokeWidth={2.5} />}
      </span>
      {children}
    </span>
  );
}

/** 一段聊天：浅底窗口里，发送者一行 + 若干气泡 */
function Chat({ children }: { children: ReactNode }) {
  return <div className="grid content-start gap-2 rounded-row bg-well p-3">{children}</div>;
}
function Bubble({ who, children }: { who: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-fg-muted">{who}</span>
      <div className="w-fit max-w-full rounded-row bg-card px-3 py-2 text-sm text-fg shadow-raised">{children}</div>
    </div>
  );
}
const Url = ({ children }: { children: ReactNode }) => <span className="break-all text-accent-text">{children}</span>;

function Panel({ title, before, after }: { title: string; before: ReactNode; after: ReactNode }) {
  return (
    <figure className="@container/fig grid content-start gap-3">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <div className="grid gap-3 @sm/fig:grid-cols-2">
        <div className="grid content-start gap-2">
          <Verdict ok={false}>之前</Verdict>
          {before}
        </div>
        <div className="grid content-start gap-2">
          <Verdict ok>之后</Verdict>
          {after}
        </div>
      </div>
    </figure>
  );
}

export function Explainers() {
  return (
    <section aria-label="短链是什么" className="@container/explain">
      <div className="grid gap-8 @3xl/explain:grid-cols-2 @3xl/explain:gap-12">
      <Panel
        title="发出去更清爽"
        before={
          <Chat>
            <Bubble who="你">
              FBIF2026 报名表，点这里填写：
              <br />
              <Url>https://foodtalks.feishu.cn/share/base/form/shrcncPhtlIelE9Qk6XxC7k6UEh?prefill_来源=公众号&prefill_渠道=销售部&hide_来源=1</Url>
            </Bubble>
          </Chat>
        }
        after={
          <Chat>
            <Bubble who="你">
              FBIF2026 报名表，点这里填写：
              <br />
              <Url>t.fbif.com/fbif26</Url>
            </Bubble>
          </Chat>
        }
      />
      <Panel
        title="换页面，不用重发"
        before={
          <Chat>
            <Bubble who="你">
              报名表：<Url>foodtalks.feishu.cn/share/base/form/shrcnA8…</Url>
            </Bubble>
            <Bubble who="你">
              抱歉，表单换了，请用这个新链接：<Url>foodtalks.feishu.cn/share/base/form/shrcnB2…</Url>
            </Bubble>
          </Chat>
        }
        after={
          <Chat>
            <Bubble who="你">
              报名表：<Url>t.fbif.com/fbif26</Url>
            </Bubble>
            <div className="grid gap-1 pt-1 text-xs text-fg-muted">
              <span className="flex items-center gap-1.5">
                <span className="text-fg">t.fbif.com/fbif26</span>
                <ArrowRight aria-hidden className="size-3.5" />
                <span className="line-through">旧表单</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-fg">t.fbif.com/fbif26</span>
                <ArrowRight aria-hidden className="size-3.5" />
                <span className="text-fg">新表单</span>
              </span>
              <span>后台改一下跳转，客户手里的链接照常能用</span>
            </div>
          </Chat>
        }
      />
      </div>
    </section>
  );
}
