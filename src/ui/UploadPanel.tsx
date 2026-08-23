import { useRef, useState } from 'react';
import { useAudioStore } from '../state/audioStore';

/** A light pre-check before attempting a (potentially slow) decode of an
 *  obviously-wrong file — the real validation gate stays `AudioEngine`'s
 *  try/catch around `decodeAudioData`, which already produces a friendly
 *  store error for anything that merely LOOKS like audio but isn't. This
 *  just catches the "that's clearly not an audio file" case fast. */
function looksLikeAudio(file: File): boolean {
  if (file.type) return file.type.startsWith('audio/');
  // Some browsers/drag sources don't populate `type` — fall back to the
  // extension rather than rejecting outright.
  return /\.(mp3|wav|m4a|ogg|flac|aac|webm)$/i.test(file.name);
}

export function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const status = useAudioStore((s) => s.status);
  const fileName = useAudioStore((s) => s.fileName);
  const error = useAudioStore((s) => s.error);
  const loadFile = useAudioStore((s) => s.loadFile);
  const [dragActive, setDragActive] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const dragCounter = useRef(0);

  const tryLoad = (file: File) => {
    if (!looksLikeAudio(file)) {
      setLocalError('That doesn’t look like an audio file.');
      return;
    }
    setLocalError(null);
    loadFile(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) tryLoad(file);
    e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) setDragActive(true);
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragActive(false);
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) tryLoad(file);
  };

  const shownError = localError ?? error;
  // The gentle invite-glow and "drop a song" hint are only for the true
  // first-open moment — gone the instant a file has ever been chosen, so
  // they never linger over an active session.
  const isEmpty = status === 'idle' && !fileName;

  return (
    <div
      className={`panel upload-panel${dragActive ? ' drag-active' : ''}${isEmpty ? ' idle' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button onClick={() => inputRef.current?.click()} disabled={status === 'loading'}>
        {status === 'loading' ? (
          <>
            <span className="spinner" /> Decoding…
          </>
        ) : fileName ? (
          'Replace Song'
        ) : (
          'Upload Song'
        )}
      </button>
      <input ref={inputRef} type="file" accept="audio/*" hidden onChange={handleChange} />
      {dragActive ? (
        <span className="drop-hint">Drop to load</span>
      ) : (
        <>
          {isEmpty && !shownError && <span className="upload-hint">or drag &amp; drop an MP3/WAV</span>}
          {fileName && <span className="filename">{fileName}</span>}
          {shownError && <span className="error">⚠ {shownError}</span>}
        </>
      )}
    </div>
  );
}
