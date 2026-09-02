import { useEffect, useRef, useState } from 'react';
import { useAudioStore } from '../state/audioStore';
import { useEnvironmentStore } from '../state/environmentStore';
import { ENVIRONMENTS } from '../scenes/registry';
import { envTheme } from './environmentThemes';

const IDS = Object.keys(ENVIRONMENTS);

function looksLikeAudio(file: File): boolean {
  if (file.type) return file.type.startsWith('audio/');
  return /\.(mp3|wav|m4a|ogg|flac|aac|webm)$/i.test(file.name);
}

/**
 * The opening screen. The environment renders live behind it (idling), and
 * picking a cell swaps that preview — so you choose the world you want,
 * then drop a track. Once a track is loaded it starts playing and an
 * "Enter" button dismisses the screen.
 *
 * Re-openable from the in-world HUD (click the filename) to change the
 * environment or load a different track without a reload.
 */
export function TitleScreen({ onEnter }: { onEnter: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCount = useRef(0);
  const [drag, setDrag] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const activeId = useEnvironmentStore((s) => s.activeId);
  const setActive = useEnvironmentStore((s) => s.setActive);
  const status = useAudioStore((s) => s.status);
  const fileName = useAudioStore((s) => s.fileName);
  const storeErr = useAudioStore((s) => s.error);
  const loadFile = useAudioStore((s) => s.loadFile);

  const theme = envTheme(activeId);
  const hasTrack = !!fileName && status !== 'loading' && status !== 'error';

  const tryLoad = (file: File) => {
    if (!looksLikeAudio(file)) {
      setLocalErr('That doesn’t look like an audio file.');
      return;
    }
    setLocalErr(null);
    loadFile(file); // auto-plays; the "Enter" button then dismisses this screen
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && hasTrack) onEnter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasTrack, onEnter]);

  const err = localErr ?? storeErr;

  return (
    <div
      className={`title-screen${drag ? ' dragging' : ''}`}
      style={{ ['--accent' as string]: theme.accent }}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCount.current += 1;
        if (e.dataTransfer.types.includes('Files')) setDrag(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCount.current = Math.max(0, dragCount.current - 1);
        if (dragCount.current === 0) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCount.current = 0;
        setDrag(false);
        const file = e.dataTransfer.files?.[0];
        if (file) tryLoad(file);
      }}
    >
      <div className="title-inner">
        <h1 className="title-heading">Select Environment</h1>

        <div className="env-grid">
          {IDS.map((id) => {
            const t = envTheme(id);
            const selected = id === activeId;
            return (
              <button
                key={id}
                className={`env-cell${selected ? ' selected' : ''}`}
                style={{ ['--cell-accent' as string]: t.accent }}
                onClick={() => setActive(id)}
              >
                {ENVIRONMENTS[id].name}
              </button>
            );
          })}
        </div>

        <div
          className="file-zone"
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) tryLoad(file);
              e.target.value = '';
            }}
          />
          {status === 'loading' ? (
            <span className="fz-main">
              <span className="spinner" /> Decoding…
            </span>
          ) : (
            <>
              <span className="fz-main">{drag ? 'Drop to load' : fileName ? 'Replace track' : 'Input file'}</span>
              <span className="fz-sub">{fileName ?? 'drop an MP3 / WAV, or click to browse'}</span>
            </>
          )}
        </div>

        {err && <div className="fz-err">⚠ {err}</div>}

        {hasTrack && (
          <button className="enter-btn" onClick={onEnter}>
            Enter &#9654;
          </button>
        )}
      </div>
    </div>
  );
}
