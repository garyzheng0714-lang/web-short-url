import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Check, PencilLine, X } from "lucide-react";
import { useBootstrap } from "@/app/bootstrap";
import { Avatar } from "@/components/ui/avatar";
import { cachedWriter, easeInOut, sCurve, span, vCurve } from "@/components/ui/flow-path";
import { MediaFrame } from "@/components/ui/media-frame";
import { StorySteps } from "@/components/ui/story-steps";
import { Tag } from "@/components/ui/tag";
import { useStoryClock } from "@/lib/story-clock";
import { cn } from "@/lib/utils";

/**
 * 首页的短链图解：一个群聊窗口一镜到底，16 秒一圈，画面是时间的纯函数（lib/story-clock 的帧循环直接写 DOM，不渲染 React）。
 * 1 长链接（之前）：长链接贴进输入框，发出去，气泡里一长串。
 * 2 变短链（之后）：同一个气泡里，长链接收成短链，气泡跟着变小；客户回「收到」；镜头左移，短链拉出一条线连到报名表。
 * 3 换表单要重发（之前）：表单换了，得再发一条新链接（红框气泡，同 ChatThread 的发送失败样式）。
 * 4 只改跳转（之后）：那条新链接收回，线上出现「改跳转」，报名表换成新版；客户再点同一条短链，到的是新版。
 * 每处衔接都有东西留下：输入框里的字 → 气泡；长链接 → 短链（同一个气泡）；短链 → 线 → 报名表；换版时线和短链都不动。
 * 只动 transform / opacity；气泡收缩动宽高（折叠类）；模糊只给链接这一行字（≤ 4px）。
 * 窄于 700 时竖排：聊天在上、报名表在下，不移镜头。离开视口、标签页隐藏、暂停时停；悬停放慢到 0.6。
 * 减少动态时不跑，每步一帧静止画面，点步骤换画面。
 */

type Range = readonly [number, number];

const CYCLE = 16;
/**
 * 时间表（秒）。一次性的大场景，§4.2 的三档管不到，具名写在这里：动作 0.2–0.8 秒、停顿 0.6–1.8 秒，长短差 4 倍以上，
 * 停顿让动作落得住；镜头移动用 expoInOut，落点用 expoOut。
 */
const T = {
  paste: [1.0, 1.3],
  send: [1.9, 2.45],
  badgeIn: [2.45, 2.65],
  shorten: [4.4, 4.9],
  badgeOk: [4.65, 4.85],
  reply: [5.4, 5.7],
  pan: [6.6, 7.4],
  destIn: [6.75, 7.45],
  draw: [7.45, 8.05],
  bump1: [8.05, 8.3],
  ghostIn: [9.1, 9.45],
  ghostBadge: [9.4, 9.6],
  ghostOut: [11.4, 11.7],
  editIn: [11.5, 11.7],
  swap: [11.75, 12.2],
  editOut: [12.3, 12.45],
  mark: [12.3, 12.5],
  tap: [12.5, 13.1],
  bump2: [13.1, 13.35],
  exit: [14.6, 14.9],
  panBack: [14.8, 15.5],
  clear: [15.0, 15.3],
} as const satisfies Record<string, Range>;

const STEPS = [
  { name: "长链接", from: 0, ok: false },
  { name: "变短链", from: 4.4, ok: true },
  { name: "换表单要重发", from: 9.1, ok: false },
  { name: "只改跳转", from: 11.4, ok: true },
] as const;
/** 每一步的静止画面取哪一刻（减少动态、暂停时点步骤） */
const SETTLED = [3.5, 8.6, 10.6, 14.0];

const LONG = "https://foodtalks.feishu.cn/share/base/form/shrcncPhtlIelE9Qk6XxC7k6UEh?prefill_来源=公众号&prefill_渠道=销售部&hide_来源=1";
const RESEND = "foodtalks.feishu.cn/share/base/form/shrcnB2x…";

/** 几何（px）：聊天窗宽高、MediaFrame 标题栏高（h-10）、报名表窗宽高、竖排的分界宽、输入栏一行时的高（上下 8 + 发送钮 28 + 顶线 1） */
const CW = 340;
const CH = 340;
const BAR = 40;
const DW = 280;
const DH = 272;
const WIDE = 700;
const C1 = 45;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const at = (t: number, r: Range) => span(t, r[0], r[1]);
/** 落点：快出慢停 */
const expoOut = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : (1 - 2 ** (-10 * x)) / (1 - 2 ** -10));
/** 镜头：起落都缓 */
const expoInOut = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2);
const blur = (k: number) => (k > 0 && k < 1 ? `blur(${(k * 4).toFixed(2)}px)` : "none");

type Measure = { line1W: number; line1H: number; shortW: number; shortH: number; longH: number; draftH: number };
const GUESS: Measure = { line1W: 190, line1H: 20, shortW: 130, shortH: 20, longH: 100, draftH: 80 };

function Verdict({ ok, className }: { ok: boolean; className?: string }) {
  return (
    <span className={cn("grid size-5 shrink-0 place-items-center rounded-full text-card", ok ? "bg-success" : "bg-danger", className)}>
      {ok ? <Check aria-hidden className="size-3" strokeWidth={2.5} /> : <X aria-hidden className="size-3" strokeWidth={2.5} />}
    </span>
  );
}

const BUBBLE = "rounded-card [--chat-bubble:color-mix(in_oklab,var(--ds-line),var(--ds-surface,var(--ds-canvas))_45%)] bg-(--chat-bubble)";

function FormPage({ ref, tag, fields, initiallyHidden }: { ref: (n: HTMLElement | null) => void; tag: ReactNode; fields: string[]; initiallyHidden?: boolean }) {
  return (
    <div ref={ref} className="absolute inset-0 grid content-start gap-2 p-4" style={initiallyHidden ? { opacity: 0 } : undefined}>
      <div className="flex items-center gap-2 pb-1">
        <span className="text-sm font-medium text-fg">FBIF2026 报名表</span>
        {tag}
      </div>
      {fields.map((f) => (
        <div key={f} className="grid gap-1">
          <span className="text-xs text-fg-muted">{f}</span>
          <span className="h-7 rounded-control bg-well" />
        </div>
      ))}
    </div>
  );
}

export function ShortLinkStory({ className }: { className?: string }) {
  const { data } = useBootstrap();
  const domain = data.domains.some((d) => d.domain === data.settings.default_domain) ? data.settings.default_domain : data.domains[0]?.domain || data.default_domain_fallback;
  const short = `${domain}/fbif26`;
  const notes = ["一长串链接发进群里，又长又乱", `换成 ${short}，清清爽爽，点开就是报名表`, "表单换了，以前只能再发一条新链接", "现在后台改一下跳转，客户手里的链接照常能用"];

  const root = useRef<HTMLDivElement & { seek?: (t: number) => void }>(null);
  const steps = useRef<HTMLDivElement>(null);
  const el = useRef<Record<string, Element | null>>({});
  const refs = useMemo(() => new Map<string, (n: Element | null) => void>(), []);
  const r = (key: string) => {
    let fn = refs.get(key);
    if (!fn) refs.set(key, (fn = (n) => void (el.current[key] = n)));
    return fn;
  };
  const write = useMemo(() => cachedWriter(), []);
  const [w, setW] = useState(0);
  const [m, setM] = useState<Measure | null>(null);
  const [fonts, setFonts] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [step, setStep] = useState(0);
  const [stillStep, setStillStep] = useState(3);
  const stepRef = useRef(0);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () => setW(node.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => alive && setFonts(true));
    return () => {
      alive = false;
    };
  }, []);

  const wide = w >= WIDE;
  const cw = wide ? CW : clamp(w, 280, 400);
  const dw = wide ? DW : clamp(w - 32, 248, 320);
  const bodyW = cw - 32;
  const maxW = Math.min(Math.round(bodyW * 0.8), bodyW - 28);

  // 量字：文字的实际宽高决定气泡两种状态的尺寸与短链的位置（只在宽度、字体、域名变化时量，逐帧不读布局）
  useLayoutEffect(() => {
    const g = (k: string) => el.current[k] as HTMLElement | null;
    const [line1, shortText, long, draft] = [g("line1"), g("shortText"), g("long"), g("draft")];
    if (!line1 || !shortText || !long || !draft) return;
    const next = { line1W: line1.offsetWidth, line1H: line1.offsetHeight, shortW: shortText.offsetWidth, shortH: shortText.offsetHeight, longH: long.offsetHeight, draftH: draft.offsetHeight };
    setM((prev) => (prev && (Object.keys(next) as (keyof Measure)[]).every((k) => prev[k] === next[k]) ? prev : next));
  }, [cw, short, fonts]);

  const geo = useMemo(() => {
    const mm = m ?? GUESS;
    const urlTop = 8 + mm.line1H + 2;
    const wS = Math.max(mm.line1W, mm.shortW) + 32;
    const hS = urlTop + mm.shortH + 8;
    const hL = urlTop + mm.longH + 8;
    const c3 = mm.draftH + 25;
    // 发送：气泡从展开的输入栏顶上升到第一条消息的位置（消息区上内边距 16）
    const sendDy = CH - BAR - c3 - 16;
    // 短链文字在聊天窗里的位置（气泡靠右，左内边距 16）
    const linkLeft = 16 + bodyW - wS + 16;
    const linkY = BAR + 16 + urlTop + mm.shortH / 2;
    if (wide) {
      const gap = clamp(w - cw - dw - 160, 80, 220);
      const left = (w - cw - gap - dw) / 2;
      const chatY = 20;
      const destX = left + cw + gap;
      const destY = chatY + (CH - DH) / 2 + 24;
      const track = sCurve({ x: left + linkLeft + mm.shortW + 6, y: chatY + linkY }, { x: destX - 2, y: destY + DH / 2 });
      return { h: 380, x0: (w - cw) / 2, x1: left, chatY, destX, destY, track, urlTop, wS, hS, wL: maxW, hL, c3, sendDy };
    }
    const x = (w - cw) / 2;
    const destX = (w - dw) / 2;
    const destY = CH + 64;
    const track = vCurve({ x: x + linkLeft + mm.shortW / 2, y: CH + 2 }, { x: destX + dw / 2, y: destY - 2 });
    return { h: destY + DH + 4, x0: x, x1: x, chatY: 0, destX, destY, track, urlTop, wS, hS, wL: maxW, hL, c3, sendDy };
  }, [m, w, wide, cw, dw, bodyW, maxW]);

  const paint = (time: number) => {
    const t = ((time % CYCLE) + CYCLE) % CYCLE;
    const E = el.current;
    const alive = 1 - at(t, T.clear);

    // 镜头：聊天窗从正中滑到左边，给报名表让位；一圈结束滑回
    const pan = expoInOut(at(t, T.pan)) - expoInOut(at(t, T.panBack));
    write(E.chat, "style.transform", `translate(${lerp(geo.x0, geo.x1, pan).toFixed(1)}px, ${geo.chatY}px)`);

    // 输入栏：贴进长链接时长高，发出去时收回；字跟着气泡走
    const grow = expoOut(at(t, T.paste)) - expoOut(at(t, [T.send[0], T.send[0] + 0.3]));
    write(E.composer, "style.height", `${lerp(C1, geo.c3, grow).toFixed(1)}px`);
    const drafted = at(t, [T.paste[0], T.paste[0] + 0.12]) - at(t, [T.send[0], T.send[0] + 0.1]);
    write(E.draft, "style.opacity", drafted.toFixed(3));
    write(E.ph, "style.opacity", (1 - drafted).toFixed(3));

    // 第一条：从输入栏升上来；长链接在同一个气泡里收成短链
    const sent = at(t, T.send);
    write(E.row1, "style.opacity", (Math.min(1, sent * 4) * alive).toFixed(3));
    write(E.row1, "style.transform", `translateY(${(geo.sendDy * (1 - expoOut(sent))).toFixed(1)}px)`);
    const s = expoOut(at(t, T.shorten));
    write(E.bubble1, "style.width", `${lerp(geo.wL, geo.wS, s).toFixed(1)}px`);
    write(E.bubble1, "style.height", `${lerp(geo.hL, geo.hS, s).toFixed(1)}px`);
    const longOut = at(t, [T.shorten[0], T.shorten[0] + 0.22]);
    write(E.long, "style.opacity", (1 - longOut).toFixed(3));
    write(E.long, "style.filter", blur(longOut));
    const shortIn = at(t, [T.shorten[0] + 0.12, T.shorten[0] + 0.36]);
    write(E.short, "style.opacity", shortIn.toFixed(3));
    write(E.short, "style.filter", blur(1 - shortIn));
    const mark = expoOut(at(t, T.mark)) * (1 - at(t, T.exit));
    write(E.mark, "style.transform", `scaleX(${mark.toFixed(3)})`);

    // 判定：先叉后勾，同一格交叉（出现的走全长，消失的更快、缩到 .6）；客户再点短链时勾跳一下
    const xIn = expoOut(at(t, T.badgeIn));
    const ok = at(t, T.badgeOk);
    write(E.b1x, "style.opacity", (xIn * (1 - Math.min(1, ok * 1.6))).toFixed(3));
    write(E.b1x, "style.transform", `scale(${(ok > 0 ? 1 - 0.4 * ok : 0.6 + 0.4 * xIn).toFixed(3)})`);
    const okIn = expoOut(ok);
    write(E.b1ok, "style.opacity", okIn.toFixed(3));
    write(E.b1ok, "style.transform", `scale(${(0.6 + 0.4 * okIn + 0.18 * Math.sin(Math.PI * at(t, T.mark))).toFixed(3)})`);

    // 客户回复
    const rep = expoOut(at(t, T.reply));
    write(E.reply, "style.opacity", (rep * alive).toFixed(3));
    write(E.reply, "style.transform", `translateY(${(8 * (1 - rep)).toFixed(1)}px)`);

    // 以前的做法：再发一条新链接；随后收回
    const gIn = expoOut(at(t, T.ghostIn));
    const gOut = at(t, T.ghostOut);
    write(E.ghost, "style.opacity", (gIn * (1 - gOut)).toFixed(3));
    write(E.ghost, "style.transform", `translateY(${(12 * (1 - gIn) - 6 * expoOut(gOut)).toFixed(1)}px) scale(${(1 - 0.03 * gOut).toFixed(3)})`);
    const gx = expoOut(at(t, T.ghostBadge));
    write(E.gx, "style.opacity", gx.toFixed(3));
    write(E.gx, "style.transform", `scale(${(0.6 + 0.4 * gx).toFixed(3)})`);

    // 报名表：跟在镜头后面进来；线到了轻轻顶一下；换版时旧的上滑淡出、新的从下面落定
    const dIn = expoOut(at(t, T.destIn));
    const bump = 3 * Math.sin(Math.PI * at(t, T.bump1)) + 3 * Math.sin(Math.PI * at(t, T.bump2));
    const dx = wide ? geo.destX + 16 * (1 - dIn) + bump : geo.destX;
    const dy = wide ? geo.destY : geo.destY + 16 * (1 - dIn) + bump;
    write(E.dest, "style.transform", `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`);
    write(E.dest, "style.opacity", (Math.min(1, at(t, T.destIn) * 2.5) * (1 - at(t, T.exit))).toFixed(3));
    const sw = at(t, T.swap);
    const oldOut = expoOut(Math.min(1, sw * 1.6));
    write(E.v1, "style.opacity", (1 - oldOut).toFixed(3));
    write(E.v1, "style.transform", `translateY(${(-16 * oldOut).toFixed(1)}px)`);
    const newIn = expoOut(at(t, [T.swap[0] + 0.12, T.swap[1]]));
    write(E.v2, "style.opacity", newIn.toFixed(3));
    write(E.v2, "style.transform", `translateY(${(24 * (1 - newIn)).toFixed(1)}px)`);

    // 「改跳转」挂在线的正中
    const edit = expoOut(at(t, T.editIn)) * (1 - at(t, T.editOut));
    write(E.edit, "style.opacity", edit.toFixed(3));
    write(E.edit, "style.transform", `translate(-50%, -50%) scale(${(0.96 + 0.04 * edit).toFixed(3)})`);

    // 线：从短链长到报名表，结尾缩回短链；点：画线时在线头，客户再点一次时从短链走到报名表
    const drawn = easeInOut(at(t, T.draw)) * (1 - easeInOut(at(t, T.exit)));
    write(E.line, "d", drawn > 0.001 ? geo.track.slice(0, drawn, 48) : "M0 0");
    write(E.line, "style.opacity", drawn > 0.001 ? "1" : "0");
    write(E.end, "style.opacity", (at(t, [T.draw[1] - 0.06, T.draw[1]]) * (1 - at(t, T.exit))).toFixed(3));
    let u = 0;
    let dot = 0;
    if (t >= T.draw[0] && t < T.bump1[1]) {
      u = easeInOut(at(t, T.draw));
      dot = 1 - at(t, T.bump1);
    } else if (t >= T.tap[0] - 0.15 && t < T.bump2[1]) {
      u = easeInOut(at(t, T.tap));
      dot = Math.min(at(t, [T.tap[0] - 0.15, T.tap[0]]), 1 - at(t, T.bump2));
    }
    const p = geo.track.at(u);
    write(E.dot, "transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    write(E.dot, "style.opacity", dot.toFixed(3));

    // 步骤条：当前步、进度
    const now = STEPS.findLastIndex((x) => t >= x.from);
    steps.current?.querySelectorAll<HTMLElement>("[data-fill]").forEach((f, i) => {
      const from = STEPS[i].from;
      const to = STEPS[i + 1]?.from ?? CYCLE;
      write(f, "style.transform", `scaleX(${i < now ? 1 : i === now ? ((t - from) / (to - from)).toFixed(4) : 0})`);
    });
    if (now !== stepRef.current) {
      stepRef.current = now;
      setStep(now);
    }
  };

  const clock = useStoryClock(root, { duration: CYCLE, onFrame: paint, paused, hovering, still: SETTLED[stillStep] });
  useLayoutEffect(() => paint(clock.reduce ? SETTLED[stillStep] : clock.time()));
  // 走查脚本用它定格到任意时刻，逐格检查衔接（同 onetake 的 __seek）
  useLayoutEffect(() => {
    if (root.current) root.current.seek = clock.seek;
  });

  /** 跳到第 i 步：播放时到这一步开头；暂停时停在这一步的代表画面；减少动态时换静止画面 */
  const goStep = (i: number) => {
    if (clock.reduce) setStillStep(i);
    else clock.seek(paused ? SETTLED[i] : STEPS[i].from + 0.001);
  };
  const shown = clock.reduce ? stillStep : step;
  const mid = geo.track.at(0.5);
  const end = geo.track.at(1);
  const label = `短链怎么用：一长串链接发进群里，又长又乱；换成 ${short} 之后清清爽爽，点开就是报名表；表单换了，以前只能再发一条新链接，现在后台改一下跳转，客户手里的链接照常能用`;

  return (
    <figure data-slot="short-link-story" className={cn("m-0 grid w-full min-w-0 gap-4", className)}>
      <div
        ref={root}
        role="img"
        aria-label={label}
        data-running={clock.running || undefined}
        className="relative w-full overflow-x-clip"
        style={{ height: geo.h }}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHovering(true)}
        onPointerLeave={() => setHovering(false)}
      >
        <div ref={r("chat")} data-part="chat" className="absolute top-0 left-0" style={{ width: cw }}>
          <MediaFrame chrome title="报名咨询群" style={{ height: CH }}>
            <div className="relative min-h-0 flex-1">
              <div className="grid content-start gap-3 p-4">
                <div ref={r("row1")} data-part="message" className="flex items-start justify-end gap-2" style={{ opacity: 0 }}>
                  <span className="relative mt-2 size-5 shrink-0">
                    <span ref={r("b1x")} className="absolute inset-0" style={{ opacity: 0 }}>
                      <Verdict ok={false} />
                    </span>
                    <span ref={r("b1ok")} className="absolute inset-0" style={{ opacity: 0 }}>
                      <Verdict ok />
                    </span>
                  </span>
                  <div ref={r("bubble1")} data-part="bubble" className={cn(BUBBLE, "relative overflow-hidden")}>
                    <p ref={r("line1")} className="absolute top-2 left-4 w-max text-sm whitespace-nowrap text-fg">
                      FBIF2026 报名表，点这里填写：
                    </p>
                    <p ref={r("long")} className="absolute left-4 text-sm break-all text-accent-text" style={{ top: geo.urlTop, width: geo.wL - 32 }}>
                      {LONG}
                    </p>
                    <p ref={r("short")} data-part="short-link" className="absolute left-4 w-max text-sm whitespace-nowrap text-accent-text" style={{ top: geo.urlTop, opacity: 0 }}>
                      <span ref={r("shortText")} className="relative inline-block">
                        {short}
                        <span ref={r("mark")} className="absolute inset-x-0 -bottom-px h-px origin-left bg-accent" style={{ transform: "scaleX(0)" }} />
                      </span>
                    </p>
                  </div>
                </div>
                <div ref={r("reply")} className="flex items-start gap-2" style={{ opacity: 0 }}>
                  <Avatar name="客户" size={24} shape="circle" />
                  <div className="grid gap-0.5">
                    <span className="text-xs text-fg-muted">客户</span>
                    <p className="text-sm text-fg">收到，马上填</p>
                  </div>
                </div>
                <div ref={r("ghost")} data-part="resend" className="flex items-start justify-end gap-2" style={{ opacity: 0 }}>
                  <span ref={r("gx")} className="mt-2" style={{ opacity: 0 }}>
                    <Verdict ok={false} />
                  </span>
                  <div className={cn(BUBBLE, "max-w-[80%] px-4 py-2 text-sm text-fg shadow-[inset_0_0_0_1px_var(--ds-danger)]")}>
                    表单换了，请用这个新链接：<span className="[overflow-wrap:anywhere] text-accent-text">{RESEND}</span>
                  </div>
                </div>
              </div>
              <div ref={r("composer")} className="absolute inset-x-0 bottom-0 flex items-end gap-2 overflow-hidden border-t border-line py-2 pr-3 pl-4">
                <div className="relative min-w-0 flex-1 self-stretch">
                  <span ref={r("ph")} className="absolute inset-x-0 top-1 text-sm text-fg-subtle">
                    发消息
                  </span>
                  <span ref={r("draft")} className="absolute inset-x-0 top-1 text-sm break-all text-fg" style={{ opacity: 0 }}>
                    {LONG}
                  </span>
                </div>
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fg text-canvas">
                  <ArrowUp aria-hidden className="size-4" />
                </span>
              </div>
            </div>
          </MediaFrame>
        </div>

        <div ref={r("dest")} data-part="page" className="absolute top-0 left-0" style={{ width: dw, opacity: 0 }}>
          <MediaFrame chrome title="报名表" style={{ height: DH }}>
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <FormPage ref={r("v1")} tag={<Tag variant="chip">旧版</Tag>} fields={["姓名", "公司", "职位"]} />
              <FormPage ref={r("v2")} tag={<Tag variant="success" solid>新版</Tag>} fields={["姓名", "公司", "参会日期"]} initiallyHidden />
            </div>
          </MediaFrame>
        </div>

        <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${Math.max(1, w)} ${geo.h}`}>
          <path ref={r("line")} data-part="route" d="M0 0" fill="none" className="stroke-fg-subtle" strokeWidth={1.5} strokeLinecap="round" style={{ opacity: 0 }} />
          <circle ref={r("end")} cx={end.x} cy={end.y} r={3} className="fill-fg-subtle" style={{ opacity: 0 }} />
          <circle ref={r("dot")} r={4.5} className="fill-accent" style={{ opacity: 0 }} />
        </svg>

        <span
          ref={r("edit")}
          data-part="edit"
          className="absolute inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2 py-0.5 text-xs whitespace-nowrap text-fg shadow-raised"
          style={{ left: mid.x, top: mid.y, opacity: 0, transform: "translate(-50%, -50%)" }}
        >
          <PencilLine aria-hidden className="size-3.5 text-fg-muted" />
          改跳转
        </span>
      </div>
      <StorySteps ref={steps} steps={STEPS.map((x) => x.name)} current={shown} onStep={goStep} paused={paused} onPausedChange={setPaused} />
      <p aria-hidden data-slot="short-link-story-note" className="flex items-center justify-center gap-2 text-center text-sm text-fg">
        <Verdict ok={STEPS[shown].ok} />
        {notes[shown]}
      </p>
    </figure>
  );
}
