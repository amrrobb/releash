import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FPS, MONO, SANS } from "./theme";
import feed from "./feed.json";
import deployment from "../../deployments/46630.json";

const ease = Easing.bezier(0.3, 0, 0.1, 1);
const appear = (f: number, at: number, dur = 0.5) =>
  interpolate(f / FPS, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });

const Bg: React.FC<{ children: React.ReactNode; tone?: "green" | "red" | "none" }> = ({ children, tone = "none" }) => (
  <AbsoluteFill
    style={{
      background:
        tone === "red"
          ? `radial-gradient(ellipse at 50% 30%, rgba(255,80,0,0.10), transparent 60%), ${C.bg}`
          : tone === "green"
            ? `radial-gradient(ellipse at 50% 30%, rgba(0,200,5,0.09), transparent 60%), ${C.bg}`
            : C.bg,
      color: C.text,
      fontFamily: SANS,
    }}
  >
    {children}
  </AbsoluteFill>
);

export const Logo: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <div style={{ display: "inline-flex", alignItems: "center", gap: size * 0.36, fontWeight: 800, fontSize: size, letterSpacing: "-0.02em" }}>
    <svg width={size * 1.1} height={size * 1.1} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.4" strokeLinecap="round">
      <path d="M5 19c0-8 6-14 14-14" />
      <circle cx="19" cy="5" r="1.6" fill={C.green} stroke="none" />
      <path d="M5 19h6" />
    </svg>
    Releash
  </div>
);

const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = C.muted }) => (
  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color }}>{children}</div>
);

// ─────────────────────────────────────────────────────────── 1. the live read of the mainnet feed
export const ColdOpen: React.FC = () => {
  const f = useCurrentFrame();
  const cmd = feed.command;
  const typed = cmd.slice(0, Math.floor(interpolate(f / FPS, [0.4, 2.4], [0, cmd.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  const labels = ["roundId", "answer", "startedAt", "updatedAt", "answeredInRound"];
  const hl = appear(f, 4.2, 0.4);
  return (
    <Bg>
      <AbsoluteFill style={{ padding: "110px 160px", gap: 34 }}>
        <div style={{ opacity: appear(f, 0, 0.4) }}>
          <Eyebrow>Chainlink {feed.description.replace(/"/g, "")} · Robinhood Chain mainnet (4663)</Eyebrow>
        </div>
        <div style={{ background: "#060807", border: `1px solid ${C.line2}`, borderRadius: 20, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }}>
          <div style={{ display: "flex", gap: 10, padding: "16px 22px", borderBottom: `1px solid ${C.line}` }}>
            {["#3a403d", "#3a403d", "#3a403d"].map((c, i) => <span key={i} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />)}
          </div>
          <div style={{ padding: "30px 38px", fontFamily: MONO, fontSize: 30, lineHeight: 1.6 }}>
            <div><span style={{ color: C.green }}>$ </span>{typed}<span style={{ opacity: f % 30 < 15 && typed.length < cmd.length ? 1 : 0 }}>▍</span></div>
            {feed.lines.map((l, i) => {
              const o = appear(f, 2.7 + i * 0.18, 0.2);
              const isUpd = i === 3;
              return (
                <div key={i} style={{ opacity: o, display: "flex", gap: 40, color: isUpd ? C.text : C.muted, background: isUpd ? `rgba(242,179,61,${0.16 * hl})` : "transparent", margin: "0 -14px", padding: "0 14px", borderRadius: 8 }}>
                  <span style={{ width: 600 }}>{l.split(" ")[0]}</span>
                  <span style={{ color: isUpd ? C.amber : C.dim }}>{labels[i]}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 60, fontSize: 36, opacity: hl }}>
          <div>
            <div style={{ color: C.muted, fontSize: 24, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Last update</div>
            <div style={{ fontFamily: MONO, color: C.amber }}>{feed.updatedAtUtc.replace(" GMT", " UTC").replace(/:\d\d UTC/, " UTC")}</div>
          </div>
          <div>
            <div style={{ color: C.muted, fontSize: 24, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Read at</div>
            <div style={{ fontFamily: MONO }}>{feed.readAtUtc.replace(" GMT", " UTC").replace(/:\d\d UTC/, " UTC")}</div>
          </div>
          <div>
            <div style={{ color: C.muted, fontSize: 24, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Market hours</div>
            <div style={{ fontFamily: MONO }}>24/5</div>
          </div>
        </div>
      </AbsoluteFill>
    </Bg>
  );
};

// ─────────────────────────────────────────────────────────── 2. the weekend silences (docs/RESEARCH.md)
const GAPS = [
  { label: "Labor Day · Fri 4 Sep → Tue 8 Sep", h: 78.2 },
  { label: "Fri 11 Sep → Mon 14 Sep", h: 51.9 },
  { label: "Fri 18 Sep → Mon 21 Sep", h: 52.1 },
  { label: "Fri 25 Sep → Mon 28 Sep", h: 52.1 },
];
export const Freeze: React.FC = () => {
  const f = useCurrentFrame();
  const MAXH = 92, BAR = 1000;
  const hb = appear(f, 2.6, 0.5);
  return (
    <Bg>
      <AbsoluteFill style={{ padding: "120px 160px", gap: 26 }}>
        <div style={{ opacity: appear(f, 0, 0.4) }}>
          <Eyebrow>Same feed · hours without an update</Eyebrow>
          <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 12 }}>
            Every weekend, the price <span style={{ color: C.amber }}>stops.</span>
          </div>
        </div>
        <div style={{ position: "relative", marginTop: 40, display: "flex", flexDirection: "column", gap: 34 }}>
          {GAPS.map((g, i) => {
            const k = appear(f, 0.6 + i * 0.35, 0.9);
            return (
              <div key={g.label} style={{ display: "flex", alignItems: "center", gap: 36 }}>
                <div style={{ width: 470, fontSize: 30, color: C.muted, textAlign: "right" }}>{g.label}</div>
                <div style={{ position: "relative", width: BAR, height: 64 }}>
                  <div style={{ position: "absolute", inset: 0, background: C.surface, borderRadius: 12 }} />
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (BAR * g.h * k) / MAXH, background: i === 0 ? C.red : C.amber, borderRadius: 12 }} />
                  <div style={{ position: "absolute", left: (BAR * g.h * k) / MAXH + 18, top: 6, fontFamily: MONO, fontSize: 40, fontWeight: 600, opacity: k, whiteSpace: "nowrap" }}>{(g.h * k).toFixed(1)} h</div>
                </div>
              </div>
            );
          })}
          {/* the feed's own heartbeat */}
          <div style={{ position: "absolute", left: 470 + 36 + (BAR * 24) / MAXH, top: -26, bottom: -40, borderLeft: `3px dashed ${C.text}`, opacity: hb }}>
            <div style={{ position: "absolute", bottom: -14, left: 12, fontSize: 26, color: C.text, whiteSpace: "nowrap", fontWeight: 600 }}>24 h heartbeat</div>
          </div>
        </div>
        <div style={{ marginTop: 70, fontSize: 24, color: C.dim, fontFamily: MONO, opacity: appear(f, 1.5, 0.5) }}>
          Round history of {feed.feed.slice(0, 6)}…{feed.feed.slice(-4)} read with getRoundData, 3 Oct 2026 (docs/RESEARCH.md)
        </div>
      </AbsoluteFill>
    </Bg>
  );
};

// ─────────────────────────────────────────────────────────── 3. Friday → Monday
const DAYS = [
  { day: "Fri 16:00", title: "Market closes", body: "The stock stops trading. The on-chain price freezes. Your loan doesn't.", tone: C.amber },
  { day: "Sat – Sun", title: "You're offline", body: "News breaks. Nobody watches your position.", tone: C.muted },
  { day: "Mon open", title: "Gap down −35%", body: "Thin pool, liquidation bonus: a fire sale of your collateral.", tone: C.red },
];
export const Weekend: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Bg tone="red">
      <AbsoluteFill style={{ padding: "150px 140px", justifyContent: "center", gap: 60 }}>
        <div style={{ display: "flex", gap: 36 }}>
          {DAYS.map((d, i) => {
            const s = spring({ frame: f - Math.round((0.3 + i * 1.6) * fps), fps, config: { damping: 200 } });
            const last = i === DAYS.length - 1;
            return (
              <div key={d.day} style={{ flex: 1, opacity: s, transform: `translateY(${(1 - s) * 40}px)`, background: last ? "rgba(255,80,0,0.08)" : C.surface, border: `1px solid ${last ? C.red : C.line2}`, borderRadius: 24, padding: "44px 44px 52px", minHeight: 420 }}>
                <div style={{ fontFamily: MONO, fontSize: 32, color: d.tone }}>{d.day}</div>
                <div style={{ fontSize: 60, fontWeight: 800, marginTop: 26, letterSpacing: "-0.02em", color: last ? C.red : C.text }}>{d.title}</div>
                <div style={{ fontSize: 34, color: C.muted, marginTop: 22, lineHeight: 1.4 }}>{d.body}</div>
                {last && (
                  <div style={{ marginTop: 34, display: "inline-block", fontSize: 28, fontWeight: 800, letterSpacing: "0.1em", color: C.red, background: C.redSoft, border: `1px solid ${C.red}`, borderRadius: 999, padding: "8px 22px", opacity: appear(f, 4.3, 0.3) }}>
                    LIQUIDATED
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Bg>
  );
};

// ─────────────────────────────────────────────────────────── title over the hero
export const Title: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Bg tone="green">
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
        <div style={{ opacity: appear(f, 0, 0.5), transform: `scale(${0.96 + 0.04 * appear(f, 0, 0.8)})` }}>
          <Logo size={130} />
        </div>
        <div style={{ fontSize: 52, fontWeight: 700, opacity: appear(f, 0.6, 0.5), textAlign: "center", lineHeight: 1.25 }}>
          Close always.<br />
          <span style={{ color: C.green }}>Open only while you're alive.</span>
        </div>
      </AbsoluteFill>
    </Bg>
  );
};

// ─────────────────────────────────────────────────────────── contract quality
const CHECKS: { k: string; v: string }[] = [
  { k: "No owner · no admin · no upgrade path", v: "src/ReleashVault.sol" },
  { k: "41 Foundry tests passing", v: "unit · invariant · end-to-end" },
  { k: "Invariants: agent never above its authority; deleverage never blocked by authority, revoke or stale price", v: "random sequences of time, price, revoke, renew" },
  { k: "Both product invariants checked against deliberately broken contracts", v: "remove the authority check → fails" },
  { k: "Adversarial review: 2 signature-replay defects + 1 liquidation issue fixed", v: "regression tests; design limits disclosed" },
];
export const Contract: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Bg>
      <AbsoluteFill style={{ padding: "64px 150px", gap: 16 }}>
        <div style={{ opacity: appear(f, 0, 0.4) }}>
          <Eyebrow>The contract</Eyebrow>
          <div style={{ fontSize: 60, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 4 }}>ReleashVault</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
          {CHECKS.map((c, i) => {
            const o = appear(f, 0.5 + i * 0.45, 0.4);
            return (
              <div key={c.k} style={{ display: "flex", alignItems: "flex-start", gap: 24, opacity: o, transform: `translateX(${(1 - o) * -24}px)`, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "12px 28px" }}>
                <div style={{ width: 40, height: 40, flex: "none", borderRadius: 20, background: C.greenSoft, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 800, marginTop: 2 }}>✓</div>
                <div>
                  <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.25 }}>{c.k}</div>
                  <div style={{ fontSize: 22, color: C.muted, fontFamily: MONO, marginTop: 2 }}>{c.v}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 28, alignItems: "center", opacity: appear(f, 3.0, 0.5) }}>
          <div style={{ fontFamily: MONO, fontSize: 30, background: C.surface2, border: `1px solid ${C.line2}`, borderRadius: 12, padding: "12px 22px" }}>{deployment.vault}</div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "0.08em", color: C.green, background: C.greenSoft, border: `1px solid ${C.green}`, borderRadius: 999, padding: "8px 20px" }}>VERIFIED ON BLOCKSCOUT</div>
        </div>
        <div style={{ fontSize: 24, color: C.dim, opacity: appear(f, 3.4, 0.5) }}>
          Robinhood Chain testnet (46630) · testnet assets are mocks: MockUSDG (6 dp) → target Paxos USDG 0x5fc5…d168 · NVDA feed target 0x379E…9F15
        </div>
      </AbsoluteFill>
    </Bg>
  );
};

// ─────────────────────────────────────────────────────────── close
export const Closing: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Bg tone="green">
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 44 }}>
        <div style={{ opacity: appear(f, 0, 0.5) }}><Logo size={120} /></div>
        <div style={{ fontSize: 40, color: C.muted, opacity: appear(f, 0.4, 0.5) }}>Auto-deleverage for stock-backed loans</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, marginTop: 10, opacity: appear(f, 0.9, 0.5) }}>
          <div style={{ fontFamily: MONO, fontSize: 48, color: C.green }}>releash.robbyn.xyz</div>
          <div style={{ fontFamily: MONO, fontSize: 40, color: C.text }}>github.com/amrrobb/releash</div>
        </div>
        <div style={{ marginTop: 26, fontSize: 32, fontWeight: 600, color: C.muted, opacity: appear(f, 1.4, 0.5) }}>
          Built on Robinhood Chain · USDG · World ID · Jev
        </div>
      </AbsoluteFill>
    </Bg>
  );
};
