import { useEffect } from 'react';
import { useAudioStore } from '../state/audioStore';
import { useEnvironmentStore } from '../state/environmentStore';
import { envTheme } from './environmentThemes';

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * The whole in-world UI: a "menu" button + the track name (drawn in the
 * active environment's own type/colour) top-left, then a faint transport
 * row (play-pause, a thin seek line, time, fullscreen) that only comes up
 * to full opacity on hover. The menu button — and clicking the name, and
 * Esc (handled in App) — all reopen the title screen to change the
 * environment or load a different track.
 */
export function MiniHud({ onOpenTitle }: { onOpenTitle: () => void }) {
  const status = useAudioStore((s) => s.status);
  const fileName = useAudioStore((s) => s.fileName);
  const currentTime = useAudioStore((s) => s.currentTime);
  const duration = useAudioStore((s) => s.duration);
  const togglePlay = useAudioStore((s) => s.togglePlay);
  const seek = useAudioStore((s) => s.seek);
  const tickTime = useAudioStore((s) => s.tickTime);
  const activeId = useEnvironmentStore((s) => s.activeId);

  const theme = envTheme(activeId);

  useEffect(() => {
    const id = window.setInterval(() => tickTime(), 200);
    return () => window.clearInterval(id);
  }, [tickTime]);

  const canPlay = status === 'ready' || status === 'playing' || status === 'paused';
  const frac = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  return (
    <div className="mini-hud" style={{ ['--accent' as string]: theme.accent }}>
      <div className="mh-top">
        <button className="mh-menu" onClick={onOpenTitle} title="Menu — change environment / track (Esc)" aria-label="Open menu">
          &#9776;
        </button>
        <button
          className="mh-name"
          title="Change environment / track"
          onClick={onOpenTitle}
          style={{
            fontFamily: theme.font,
            textTransform: theme.upper ? 'uppercase' : 'none',
            letterSpacing: theme.tracking ?? 'normal',
            fontWeight: theme.weight ?? 400,
          }}
        >
          {fileName ?? '—'}
        </button>
      </div>

      <div className="mh-transport">
        <button className="mh-btn" onClick={togglePlay} disabled={!canPlay} aria-label={status === 'playing' ? 'Pause' : 'Play'}>
          {status === 'playing' ? '❚❚' : '▶'}
        </button>
        <div
          className="mh-bar"
          onClick={(e) => {
            if (!canPlay || duration <= 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            seek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration);
          }}
        >
          <div className="mh-fill" style={{ width: `${frac * 100}%` }} />
        </div>
        <span className="mh-time">{fmt(currentTime)}</span>
        <button className="mh-btn" onClick={toggleFullscreen} aria-label="Fullscreen">
          &#9974;
        </button>
      </div>
    </div>
  );
}
