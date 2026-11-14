import { useCallback, useEffect, useRef, useState } from 'react';
import { HudOverlay } from './components/HudOverlay';
import { MonsterTruckGameEngine } from './game/engine';
import type {
  CameraMode,
  HudSnapshot,
  InputState,
  TimeOfDay,
  TruckColorId,
} from './game/types';

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<MonsterTruckGameEngine | null>(null);

  const [truckColor, setTruckColor] = useState<TruckColorId>('crimson');
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('morning');
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [muted, setMuted] = useState(false);
  const [hud, setHud] = useState<HudSnapshot>({
    speedKmh: 0,
    rpm: 850,
    gear: 1,
    starsCollected: 0,
    totalStars: 12,
    zoneName: 'Base Clearing',
    inWater: false,
    airborne: false,
    webglLost: false,
  });

  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const engine = new MonsterTruckGameEngine(mountEl, (snapshot) => {
      setHud(snapshot);
    });
    engineRef.current = engine;

    const handleKey = (down: boolean) => (e: KeyboardEvent) => {
      const code = e.code;
      if (
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight' ||
        code === 'Space'
      ) {
        e.preventDefault();
      }
      if (code === 'KeyW' || code === 'ArrowUp') engine.setInputKey('forward', down);
      if (code === 'KeyS' || code === 'ArrowDown') engine.setInputKey('backward', down);
      if (code === 'KeyA' || code === 'ArrowLeft') engine.setInputKey('left', down);
      if (code === 'KeyD' || code === 'ArrowRight') engine.setInputKey('right', down);
      if (code === 'Space') engine.setInputKey('boost', down);

      if (down && !e.repeat) {
        if (code === 'KeyH') engine.honk();
        if (code === 'KeyR') engine.resetTruck();
      }
    };

    const onKeyDown = handleKey(true);
    const onKeyUp = handleKey(false);
    const onBlur = () => {
      engine.setInputKey('forward', false);
      engine.setInputKey('backward', false);
      engine.setInputKey('left', false);
      engine.setInputKey('right', false);
      engine.setInputKey('boost', false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleSelectColor = useCallback((color: TruckColorId) => {
    setTruckColor(color);
    engineRef.current?.setTruckColor(color);
  }, []);

  const handleSelectTime = useCallback((time: TimeOfDay) => {
    setTimeOfDay(time);
    engineRef.current?.setTimeOfDay(time);
  }, []);

  const handleSelectCamera = useCallback((mode: CameraMode) => {
    setCameraMode(mode);
    engineRef.current?.setCameraMode(mode);
  }, []);

  const handleRecenterCamera = useCallback(() => {
    engineRef.current?.recenterCamera();
  }, []);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      engineRef.current?.audio.setMuted(next);
      return next;
    });
  }, []);

  const handleHonk = useCallback(() => {
    engineRef.current?.honk();
  }, []);

  const handleReset = useCallback(() => {
    engineRef.current?.resetTruck();
  }, []);

  const handleVirtualInput = useCallback((key: keyof InputState, down: boolean) => {
    engineRef.current?.setInputKey(key, down);
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0d1712]">
      {/* Dedicated isolated WebGL canvas container */}
      <div
        ref={canvasMountRef}
        className="h-full w-full"
        onPointerDown={() => engineRef.current?.audio.unlock()}
      />

      {hud.webglLost && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center p-6 text-center"
          style={{ backgroundColor: 'rgba(13, 23, 18, 0.94)' }}
        >
          <div className="max-w-md rounded-2xl border border-white/15 bg-[#16241d] p-6 shadow-2xl">
            <h2 className="font-display text-xl font-bold text-white">
              Restoring 3D Mountain Forest
            </h2>
            <p className="mt-2 text-sm text-stone-300">
              Your browser temporarily paused WebGL graphics. Refresh the page if the 3D valley does not resume automatically.
            </p>
          </div>
        </div>
      )}

      <HudOverlay
        hud={hud}
        truckColor={truckColor}
        timeOfDay={timeOfDay}
        cameraMode={cameraMode}
        muted={muted}
        onSelectColor={handleSelectColor}
        onSelectTimeOfDay={handleSelectTime}
        onSelectCamera={handleSelectCamera}
        onRecenterCamera={handleRecenterCamera}
        onToggleMute={handleToggleMute}
        onHonk={handleHonk}
        onReset={handleReset}
        onVirtualInput={handleVirtualInput}
      />
    </main>
  );
}
