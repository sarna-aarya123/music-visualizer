import { create } from 'zustand';
import { audioEngine } from '../audio/AudioEngine';

export type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';

interface AudioStoreState {
  status: PlaybackStatus;
  fileName: string | null;
  duration: number;
  currentTime: number;
  error: string | null;
  volume: number;
  muted: boolean;
  /** Bumped whenever the audio-reactive baselines need a clean slate —
   *  a new track loading OR a seek within the current track. Watched by
   *  FeatureUpdater to reset FeatureExtractor/majorEventState/
   *  cinematicState so stale pre-jump baselines can't misfire. */
  resetToken: number;
  /** Bumped ONLY when a genuinely new track is loaded (never on seek) —
   *  used as a React `key` on CameraRig/Character so a new song starts
   *  its own fresh lap instead of continuing wherever the previous song
   *  had advanced the route to. */
  trackGeneration: number;

  loadFile: (file: File) => Promise<void>;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  restart: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
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
  volume: 1,
  muted: false,
  resetToken: 0,
  trackGeneration: 0,

  loadFile: async (file: File) => {
    // Resume/create the AudioContext synchronously, inside the click
    // handler's call stack, before the async decode below — required for
    // autoplay policies to allow playback to start once decoding finishes.
    audioEngine.ensureContext();
    audioEngine.pause();
    set({ status: 'loading', error: null, fileName: file.name, currentTime: 0 });

    try {
      await audioEngine.loadFile(file);
      // A natural end is a full playback boundary, same as loading a new
      // track — bump both counters so a replay starts exactly as fresh as
      // an explicit restart/new-track would (same reset architecture as
      // everywhere else, not a second mechanism): FeatureExtractor's
      // adaptive baselines, majorEventState/cinematicState, AND the
      // camera/character's route position all get a clean slate rather
      // than silently carrying over into the replay.
      audioEngine.setOnEnded(() =>
        set((s) => ({
          status: 'ready',
          currentTime: 0,
          resetToken: s.resetToken + 1,
          trackGeneration: s.trackGeneration + 1,
        }))
      );
      set({ status: 'ready', duration: audioEngine.duration, currentTime: 0 });
      audioEngine.play();
      set((s) => ({
        status: 'playing',
        resetToken: s.resetToken + 1,
        trackGeneration: s.trackGeneration + 1,
      }));
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

  seek: (time: number) => {
    const { status } = get();
    if (status !== 'playing' && status !== 'paused' && status !== 'ready') return;
    audioEngine.seek(time);
    set((s) => ({ currentTime: audioEngine.getCurrentTime(), resetToken: s.resetToken + 1 }));
  },

  restart: () => {
    const { status, seek, play } = get();
    if (status !== 'playing' && status !== 'paused' && status !== 'ready') return;
    seek(0);
    if (status !== 'playing') play();
  },

  setVolume: (v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    audioEngine.setVolume(clamped);
    set({ volume: clamped, muted: clamped === 0 });
  },

  toggleMute: () => {
    const { muted, volume } = get();
    if (muted) {
      audioEngine.setVolume(volume > 0 ? volume : 1);
      set({ muted: false, volume: volume > 0 ? volume : 1 });
    } else {
      audioEngine.setVolume(0);
      set({ muted: true });
    }
  },

  tickTime: () => {
    if (get().status === 'playing') {
      set({ currentTime: audioEngine.getCurrentTime() });
    }
  },
}));
