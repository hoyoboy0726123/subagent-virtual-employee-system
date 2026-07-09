// Animated pixel-art office for the live meeting room. Wraps the vendored
// canvas engine (client/src/pixel-office/, MIT — xmanrui/OpenClaw-bot-review)
// and drives it from meeting state: each participant is a character that walks
// in, sits at a desk, and types while it's their turn to speak.
//
// The engine is framework-agnostic (plain TS + Canvas 2D). This component owns
// the React lifecycle: it loads sprites once, builds an OfficeState, runs a
// requestAnimationFrame loop (update + renderFrame), and on every meeting-state
// change maps our turns → the engine's AgentActivity[] via syncAgentsToOffice.
import { useEffect, useRef, useState } from 'react';
import { OfficeState } from '../pixel-office/engine/officeState';
import { renderFrame } from '../pixel-office/engine/renderer';
import { startGameLoop } from '../pixel-office/engine/gameLoop';
import { loadCharacterPNGs, loadWallPNG } from '../pixel-office/sprites/pngLoader';
import { syncAgentsToOffice } from '../pixel-office/agentBridge';

const ZOOM = 2;

// Map a meeting's participants + who's currently speaking → the engine's
// AgentActivity[]. The active speaker "works" (types, shows its tool); everyone
// else sits idle. When the meeting isn't streaming, nobody is working.
function buildActivities(participants, active) {
  const now = Date.now();
  return participants.map((p) => {
    const isActive = active && active.speakerId === p.id;
    return {
      agentId: p.id,
      name: p.name,
      emoji: '🧑‍💼',
      state: isActive ? 'working' : 'idle',
      currentTool: isActive && active.tool ? active.tool : undefined,
      lastActive: now,
      lastTask: isActive ? active.task : undefined,
    };
  });
}

export default function PixelOffice({ participants = [], active = null, height = 380 }) {
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
        // The upstream engine spawns a "值班工程師" (gateway SRE) character that
        // belongs to OpenClaw's monitoring dashboard, not our meetings — it has a
        // human label and would read as a mystery participant. Suppress it (the
        // constructor + update() both call ensureGatewaySre) without touching the
        // vendored code, and drop the one already spawned. The unlabeled cat /
        // lobster easter eggs stay — they're just ambient office life.
        office.ensureGatewaySre = () => {};
        office.removeAgent(-9996);
        officeRef.current = office;
        setReady(true);

        const canvas = canvasRef.current;
        stop = startGameLoop(canvas, {
          update: (dt) => office.update(dt),
          render: (ctx) => {
            const wrap = wrapRef.current;
            if (!wrap) return;
            const width = wrap.clientWidth;
            const h = wrap.clientHeight;
            const dpr = window.devicePixelRatio || 1;
            if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(h * dpr)) {
              canvas.width = Math.floor(width * dpr);
              canvas.height = Math.floor(h * dpr);
              canvas.style.width = `${width}px`;
              canvas.style.height = `${h}px`;
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.imageSmoothingEnabled = false;
            renderFrame(
              ctx, width, h,
              office.tileMap, office.furniture, office.getCharacters(),
              ZOOM, 0, 0,
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

  // Sync meeting state → office characters whenever participants or the active
  // speaker changes.
  useEffect(() => {
    const office = officeRef.current;
    if (!office || !ready) return;
    syncAgentsToOffice(buildActivities(participants, active), office, agentIdMap.current, nextId.current);
  }, [ready, participants, active]);

  if (failed) return null; // graceful: no office, meeting still fully usable

  return (
    <div className="pixel-office" ref={wrapRef} style={{ height }}>
      <canvas ref={canvasRef} className="pixel-office-canvas" />
      {!ready && <div className="pixel-office-loading">載入辦公室…</div>}
    </div>
  );
}
