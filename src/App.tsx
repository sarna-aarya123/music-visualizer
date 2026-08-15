import { useCallback, useRef } from 'react';
import { VisualizerCanvas } from './core/VisualizerCanvas';
import { UploadPanel } from './ui/UploadPanel';
import { TransportControls } from './ui/TransportControls';
import './App.css';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  return (
    <div ref={containerRef} className="app-root">
      <VisualizerCanvas />
      <div className="ui-overlay">
        <UploadPanel />
        <TransportControls />
        <button className="fullscreen-btn" onClick={toggleFullscreen}>
          ⛶ Fullscreen
        </button>
      </div>
    </div>
  );
}
