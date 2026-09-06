import { useEffect, useState } from 'react';
import { VisualizerCanvas } from './core/VisualizerCanvas';
import { TitleScreen } from './ui/TitleScreen';
import { MiniHud } from './ui/MiniHud';
import { useViewModeStore } from './state/viewModeStore';
import { useAudioStore } from './state/audioStore';
import './App.css';

/**
 * Shell: the environment renders full-bleed at all times. Over it sits
 * either the title screen (pick an environment, drop a track) or, once
 * you've entered, a minimal top-left HUD. `V` toggles first/third person;
 * `Esc` toggles the title screen (only closes it once a track is loaded).
 */
export default function App() {
  const [showTitle, setShowTitle] = useState(true);
  const toggleViewMode = useViewModeStore((s) => s.toggle);
  const hasTrack = useAudioStore((s) => s.status !== 'idle' && s.status !== 'loading' && !!s.fileName);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'v') {
        toggleViewMode();
      } else if (e.key === 'Escape') {
        setShowTitle((cur) => (cur ? (hasTrack ? false : cur) : true));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleViewMode, hasTrack]);

  return (
    <div className="app-root">
      <VisualizerCanvas />
      {showTitle ? (
        <TitleScreen onEnter={() => setShowTitle(false)} />
      ) : (
        <MiniHud onOpenTitle={() => setShowTitle(true)} />
      )}
    </div>
  );
}
