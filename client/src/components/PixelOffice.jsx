// Animated pixel-art office for the live meeting room. Wraps the vendored
// canvas engine (client/src/pixel-office/, MIT — xmanrui/OpenClaw-bot-review)
// and drives it from meeting state: each participant is a character that walks
// in, sits at a desk, and types while it's their turn to speak.
//
// The engine is framework-agnostic (plain TS + Canvas 2D). This component owns
// the React lifecycle: it loads sprites once, builds an OfficeState, runs a
// requestAnimationFrame loop (update + renderFrame), and on every meeting-state
// change maps our turns → the engine's AgentActivity[] via syncAgentsToOffice.
import { useEffect, useMemo, useRef, useState } from 'react';
import { OfficeState } from '../pixel-office/engine/officeState';
import { renderFrame } from '../pixel-office/engine/renderer';
import { startGameLoop } from '../pixel-office/engine/gameLoop';
import { loadCharacterPNGs, loadWallPNG } from '../pixel-office/sprites/pngLoader';
import { syncAgentsToOffice } from '../pixel-office/agentBridge';

const TILE = 16;      // engine tile size
const MAX_ZOOM = 3;   // don't upscale past this (keeps pixels crisp)
const MAX_HEIGHT = 460; // cap the office panel height so the transcript stays visible
const PAD = 22;       // breathing room so name labels above top-row characters aren't clipped

// Map a meeting's participants + who's currently speaking → the engine's
// AgentActivity[]. The active speaker "works" (types, shows its tool); everyone
// meeting → AgentActivity[]. The engine has two behaviours: 'working' (sit at a
// desk) and everything-else (wander the office). Meeting participants are all
// 'working' so they stay SEATED — the current speaker gets a speech bubble (turn
// text) and a tool tag when that turn used one. To keep the office alive, a few
// colleagues who AREN'T in this meeting are added as 'idle' so they wander in the
// background.
function buildActivities(participants, wanderers, active) {
  const now = Date.now();
  const seated = participants.map((p) => {
    const isSpeaking = active && active.speakerId === p.id;
    return {
      agentId: p.id,
      name: p.name,
      emoji: '🧑‍💼',
      state: 'working', // seated at their desk — no wandering during a meeting
      currentTool: isSpeaking && active.tool ? active.tool : undefined,
      lastActive: now,
      lastTask: isSpeaking ? active.task : undefined, // → speech bubble over the speaker
    };
  });
  const roaming = wanderers.map((w) => ({
    agentId: w.id,
    name: w.name,
    emoji: '🧑‍💼',
    state: 'idle', // not in this meeting → mills around the office
    lastActive: now,
  }));
  return [...seated, ...roaming];
}

export default function PixelOffice({ participants = [], wanderPool = [], active = null, height = 380 }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const officeRef = useRef(null);
  const agentIdMap = useRef(new Map());
  const nextId = useRef({ current: 0 });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Mount: load sprites, build the office, run the render loop. Once per mount.
  useEffect(() => {
    let stop = () => {};
    let disposed = false;
    (async () => {
      try {
        await Promise.all([loadCharacterPNGs(), loadWallPNG()]);
        if (disposed) return;
        const office = new OfficeState(undefined, 'zh-TW');
        // The engine's default "值班工程師" (on-duty engineer) + cat / lobster
        // easter eggs are kept as ambient office life — they wander in the
        // background alongside the meeting participants.
        officeRef.current = office;
        setReady(true);

        const canvas = canvasRef.current;
        stop = startGameLoop(canvas, {
          update: (dt) => office.update(dt),
          render: (ctx) => {
            const wrap = wrapRef.current;
            if (!wrap) return;
            const avail = wrap.clientWidth;
            if (!avail) return;
            const cols = office.layout.cols;
            const rows = office.layout.rows;
            // Fit the WHOLE office (both dimensions) — never crop. Size the canvas
            // to exactly the office so it sits as a crisp centred block, and cap
            // both the zoom and the height so it doesn't dominate the room.
            const zoom = Math.min(
              MAX_ZOOM,
              (avail - 2 * PAD) / (cols * TILE),
              (MAX_HEIGHT - 2 * PAD) / (rows * TILE),
            );
            const ow = Math.round(cols * TILE * zoom);
            const oh = Math.round(rows * TILE * zoom);
            // Canvas is the office + a PAD frame; renderFrame centres the map, so
            // the padding lands on every side — room for the top row's labels.
            const cw = ow + 2 * PAD;
            const chh = oh + 2 * PAD;
            const dpr = window.devicePixelRatio || 1;
            if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(chh * dpr)) {
              canvas.width = Math.round(cw * dpr);
              canvas.height = Math.round(chh * dpr);
              canvas.style.width = `${cw}px`;
              canvas.style.height = `${chh}px`;
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.imageSmoothingEnabled = false;
            renderFrame(
              ctx, cw, chh,
              office.tileMap, office.furniture, office.getCharacters(),
              zoom, 0, 0,
              { selectedAgentId: null, hoveredAgentId: null, hoveredTile: null, seats: office.seats, characters: office.characters },
              undefined, office.layout.tileColors, office.layout.cols, office.layout.rows,
              office.getBugs(),
            );
          },
        });
      } catch (e) {
        console.warn('[PixelOffice] failed to start:', e);
        setFailed(true);
      }
    })();
    return () => { disposed = true; stop(); officeRef.current = null; agentIdMap.current = new Map(); nextId.current = { current: 0 }; };
  }, []);

  // Pick a STABLE 2–3 background wanderers from the non-participant pool. Stable
  // so they don't churn (re-picking every render would make them repeatedly walk
  // in from the door). Re-picks only if the pool's membership changes.
  const poolKey = wanderPool.map((e) => e.id).sort().join(',');
  const wanderers = useMemo(() => {
    const pool = wanderPool.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(pool.length, 2 + Math.floor(Math.random() * 2))); // 2–3
  }, [poolKey]);

  // Sync meeting state → office characters whenever participants, the speaker, or
  // the wanderer set changes.
  useEffect(() => {
    const office = officeRef.current;
    if (!office || !ready) return;
    syncAgentsToOffice(buildActivities(participants, wanderers, active), office, agentIdMap.current, nextId.current);
    // The engine labels agents as "Name (agentId)"; our agentId is the raw
    // emp_… DB id, which is ugly over a character's head. Relabel to just the
    // display name after each sync (sync rewrites labels, so this must follow).
    for (const p of [...participants, ...wanderers]) {
      const charId = agentIdMap.current.get(p.id);
      const ch = charId != null && office.characters.get(charId);
      if (ch) ch.label = p.name;
    }
  }, [ready, participants, wanderers, active]);

  if (failed) return null; // graceful: no office, meeting still fully usable

  return (
    <div className="pixel-office" ref={wrapRef} style={{ minHeight: ready ? undefined : Math.min(height, MAX_HEIGHT) }}>
      <canvas ref={canvasRef} className="pixel-office-canvas" />
      {!ready && <div className="pixel-office-loading">載入辦公室…</div>}
    </div>
  );
}
