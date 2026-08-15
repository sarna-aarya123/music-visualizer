import { useRef } from 'react';
import { useAudioStore } from '../state/audioStore';

export function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const status = useAudioStore((s) => s.status);
  const fileName = useAudioStore((s) => s.fileName);
  const error = useAudioStore((s) => s.error);
  const loadFile = useAudioStore((s) => s.loadFile);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = '';
  };

  return (
    <div className="panel">
      <button onClick={() => inputRef.current?.click()} disabled={status === 'loading'}>
        {status === 'loading' ? 'Decoding…' : fileName ? 'Replace Song' : 'Upload Song'}
      </button>
      <input ref={inputRef} type="file" accept="audio/*" hidden onChange={handleChange} />
      {fileName && <span className="filename">{fileName}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
