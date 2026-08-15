import { useEffect } from 'react';
import { useAudioStore } from '../state/audioStore';

function formatTime(t: number): string {
  if (!isFinite(t) || t < 0) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export function TransportControls() {
  const status = useAudioStore((s) => s.status);
  const currentTime = useAudioStore((s) => s.currentTime);
  const duration = useAudioStore((s) => s.duration);
  const togglePlay = useAudioStore((s) => s.togglePlay);
  const tickTime = useAudioStore((s) => s.tickTime);

  // Low-frequency UI clock — separate from the 60fps audio-feature path,
  // which never goes through this store.
  useEffect(() => {
    const id = window.setInterval(() => tickTime(), 200);
    return () => window.clearInterval(id);
  }, [tickTime]);

  const canPlay = status === 'ready' || status === 'playing' || status === 'paused';
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <div className="panel transport">
      <button onClick={togglePlay} disabled={!canPlay}>
        {status === 'playing' ? '⏸ Pause' : '▶ Play'}
      </button>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <span className="time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );
}
