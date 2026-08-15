import { create } from 'zustand';
import { audioEngine } from '../audio/AudioEngine';

export type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';

interface AudioStoreState {
  status: PlaybackStatus;
  fileName: string | null;
  duration: number;
  currentTime: number;
  error: string | null;

  loadFile: (file: File) => Promise<void>;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  /** Called on a low-frequency interval (see TransportControls) to refresh
   *  currentTime for the UI — kept separate from the 60fps audio-feature
   *  path, which never touches this store. */
  tickTime: () => void;
}

export const useAudioStore = create<AudioStoreState>((set, get) => ({
  status: 'idle',
  fileName: null,
  duration: 0,
  currentTime: 0,
  error: null,

  loadFile: async (file: File) => {
    // Resume/create the AudioContext synchronously, inside the click
    // handler's call stack, before the async decode below — required for
    // autoplay policies to allow playback to start once decoding finishes.
    audioEngine.ensureContext();
    audioEngine.pause();
    set({ status: 'loading', error: null, fileName: file.name, currentTime: 0 });

    try {
      await audioEngine.loadFile(file);
      audioEngine.setOnEnded(() => set({ status: 'ready', currentTime: 0 }));
      set({ status: 'ready', duration: audioEngine.duration, currentTime: 0 });
      audioEngine.play();
      set({ status: 'playing' });
    } catch (err) {
      console.error('Failed to decode audio file:', err);
      set({
        status: 'error',
        error: 'Could not play this file. Try a different MP3/WAV/OGG.',
        duration: 0,
      });
    }
  },

  play: () => {
    const { status } = get();
    if (status !== 'ready' && status !== 'paused') return;
    audioEngine.play();
    set({ status: 'playing' });
  },

  pause: () => {
    if (get().status !== 'playing') return;
    audioEngine.pause();
    set({ status: 'paused', currentTime: audioEngine.getCurrentTime() });
  },

  togglePlay: () => {
    const { status, play, pause } = get();
    if (status === 'playing') pause();
    else if (status === 'ready' || status === 'paused') play();
  },

  tickTime: () => {
    if (get().status === 'playing') {
      set({ currentTime: audioEngine.getCurrentTime() });
    }
  },
}));
