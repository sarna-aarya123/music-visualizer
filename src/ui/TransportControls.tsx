import { useEffect, useRef, useState } from 'react';
import { useAudioStore } from '../state/audioStore';

function formatTime(t: number): string {
  if (!isFinite(t) || t < 0) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Compact playback controls — restart / play-pause / a scrubbable
 * progress bar / time / mute / volume — styled as part of the visualizer's
 * own dark glass panel language rather than a generic `<audio>` player.
 *
 * Seeking only commits (calls the store's `seek`) on pointer release; while
 * dragging, the bar shows a local preview position so scrubbing feels
 * responsive without spamming the audio-reactive reset on every pixel of
 * movement.
 */
export function TransportControls() {
  const status = useAudioStore((s) => s.status);
  const currentTime = useAudioStore((s) => s.currentTime);
  const duration = useAudioStore((s) => s.duration);
  const volume = useAudioStore((s) => s.volume);
  const muted = useAudioStore((s) => s.muted);
  const togglePlay = useAudioStore((s) => s.togglePlay);
  const tickTime = useAudioStore((s) => s.tickTime);
  const seek = useAudioStore((s) => s.seek);
  const restart = useAudioStore((s) => s.restart);
  const setVolume = useAudioStore((s) => s.setVolume);
  const toggleMute = useAudioStore((s) => s.toggleMute);

  const trackRef = useRef<HTMLDivElement>(null);
  const [scrubFrac, setScrubFrac] = useState<number | null>(null);

  // Low-frequency UI clock — separate from the 60fps audio-feature path,
  // which never goes through this store.
  useEffect(() => {
    const id = window.setInterval(() => tickTime(), 200);
    return () => window.clearInterval(id);
  }, [tickTime]);

  const canPlay = status === 'ready' || status === 'playing' || status === 'paused';
  const canSeek = canPlay && duration > 0;
  const liveProgress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const progress = scrubFrac ?? liveProgress;
  const displayTime = scrubFrac !== null ? scrubFrac * duration : currentTime;

  const fracFromEvent = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canSeek) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubFrac(fracFromEvent(e.clientX));
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubFrac === null) return;
    setScrubFrac(fracFromEvent(e.clientX));
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubFrac === null) return;
    seek(fracFromEvent(e.clientX) * duration);
    setScrubFrac(null);
  };

  const volumeIcon = muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊';

  return (
    <div className="panel transport">
      <button className="icon-btn" onClick={restart} disabled={!canPlay} title="Restart">
        ⟲
      </button>
      <button className="icon-btn play-btn" onClick={togglePlay} disabled={!canPlay} title={status === 'playing' ? 'Pause' : 'Play'}>
        {status === 'playing' ? '⏸' : '▶'}
      </button>
      <div
        ref={trackRef}
        className={`progress-track${canSeek ? ' seekable' : ''}${scrubFrac !== null ? ' scrubbing' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
        {canSeek && <div className="progress-thumb" style={{ left: `${progress * 100}%` }} />}
      </div>
      <span className="time">
        {formatTime(displayTime)} / {formatTime(duration)}
      </span>
      <button className="icon-btn" onClick={toggleMute} disabled={!canPlay} title={muted ? 'Unmute' : 'Mute'}>
        {volumeIcon}
      </button>
      <input
        className="volume-slider"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        disabled={!canPlay}
        onChange={(e) => setVolume(parseFloat(e.target.value))}
        aria-label="Volume"
      />
    </div>
  );
}
