import { useCallback, useEffect, useRef } from 'react';
import { VisualizerCanvas } from './core/VisualizerCanvas';
import { UploadPanel } from './ui/UploadPanel';
import { TransportControls } from './ui/TransportControls';
import { useViewModeStore } from './state/viewModeStore';
import { useEnvironmentStore } from './state/environmentStore';
import { ENVIRONMENTS } from './scenes/registry';
import './App.css';

const ENVIRONMENT_IDS = Object.keys(ENVIRONMENTS);

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mode = useViewModeStore((s) => s.mode);
  const toggleViewMode = useViewModeStore((s) => s.toggle);
  const activeEnvironmentId = useEnvironmentStore((s) => s.activeId);
  const setActiveEnvironment = useEnvironmentStore((s) => s.setActive);

  const cycleEnvironment = useCallback(() => {
    const idx = ENVIRONMENT_IDS.indexOf(activeEnvironmentId);
    const next = ENVIRONMENT_IDS[(idx + 1) % ENVIRONMENT_IDS.length];
    setActiveEnvironment(next);
  }, [activeEnvironmentId, setActiveEnvironment]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'v' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        toggleViewMode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleViewMode]);

  return (
    <div ref={containerRef} className="app-root">
      <VisualizerCanvas />
      <div className="ui-overlay">
        <UploadPanel />
        <TransportControls />
        <button className="fullscreen-btn" onClick={toggleFullscreen}>
          ⛶ Fullscreen
        </button>
        <button className="fullscreen-btn" onClick={toggleViewMode} title="Press V to toggle">
          {mode === 'third' ? '🚶 Third Person' : '👁 First Person'} (V)
        </button>
        <button className="fullscreen-btn" onClick={cycleEnvironment} title="Switch environment">
          🌍 {ENVIRONMENTS[activeEnvironmentId]?.name ?? activeEnvironmentId}
        </button>
      </div>
    </div>
  );
}
