import { useEffect, useState } from 'react';
import { VisualizerCanvas } from './core/VisualizerCanvas';
import { TitleScreen } from './ui/TitleScreen';
import { MiniHud } from './ui/MiniHud';
import { useViewModeStore } from './state/viewModeStore';
import './App.css';

/**
 * Shell: the environment renders full-bleed at all times. Over it sits
 * either the title screen (pick an environment, drop a track) or, once
 * you've entered, a minimal top-left HUD. `V` toggles first/third person.
 */
export default function App() {
  const [showTitle, setShowTitle] = useState(true);
  const toggleViewMode = useViewModeStore((s) => s.toggle);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'v' && !e.metaKey && !e.ctrlKey && !e.altKey) toggleViewMode();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleViewMode]);

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
