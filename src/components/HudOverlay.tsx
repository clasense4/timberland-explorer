import React, { useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Gamepad2,
  RotateCcw,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import {
  TRUCK_COLORS,
  type CameraMode,
  type HudSnapshot,
  type InputState,
  type TimeOfDay,
  type TruckColorId,
} from '../game/types';

interface HudOverlayProps {
  hud: HudSnapshot;
  truckColor: TruckColorId;
  timeOfDay: TimeOfDay;
  cameraMode: CameraMode;
  muted: boolean;
  onSelectColor: (color: TruckColorId) => void;
  onSelectTimeOfDay: (time: TimeOfDay) => void;
  onSelectCamera: (mode: CameraMode) => void;
  onToggleMute: () => void;
  onHonk: () => void;
  onReset: () => void;
  onVirtualInput: (key: keyof InputState, down: boolean) => void;
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  hud,
  truckColor,
  timeOfDay,
  cameraMode,
  muted,
  onSelectColor,
  onSelectTimeOfDay,
  onSelectCamera,
  onToggleMute,
  onHonk,
  onReset,
  onVirtualInput,
}) => {
  const [dockOpen, setDockOpen] = useState(true);
  const [touchPadOpen, setTouchPadOpen] = useState(false);

  const timeOptions: { id: TimeOfDay; label: string }[] = [
    { id: 'morning', label: 'Morning' },
    { id: 'sunset', label: 'Sunset' },
    { id: 'starlight', label: 'Starlight' },
  ];

  const cameraOptions: { id: CameraMode; label: string }[] = [
    { id: 'chase', label: 'Chase' },
    { id: 'wide', label: 'Wide' },
    { id: 'hood', label: 'Hood' },
  ];

  const bindHold = (key: keyof InputState) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      onVirtualInput(key, true);
    },
    onPointerUp: () => onVirtualInput(key, false),
    onPointerLeave: () => onVirtualInput(key, false),
    onPointerCancel: () => onVirtualInput(key, false),
  });

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-4 sm:p-5">
      {/* Top Bar: Unobtrusive Left Telemetry & Right Audio / Touch Pad */}
      <div className="flex items-start justify-between gap-4">
        <div
          className="pointer-events-auto rounded-xl border border-white/15 px-4 py-2.5 shadow-lg"
          style={{ backgroundColor: 'rgba(15, 24, 19, 0.84)' }}
        >
          <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-stone-50 whitespace-nowrap">
            Timberland Explorer
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs sm:text-sm text-stone-300">
            <span className="font-medium text-amber-300 whitespace-nowrap">{hud.zoneName}</span>
            <span aria-hidden="true" className="text-stone-500">
              ·
            </span>
            <span className="font-mono-tabular font-semibold text-white whitespace-nowrap">
              {hud.speedKmh} km/h
            </span>
            <span aria-hidden="true" className="text-stone-500">
              ·
            </span>
            <span className="font-mono-tabular text-amber-200 whitespace-nowrap">
              {hud.starsCollected} / {hud.totalStars} Stars
            </span>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTouchPadOpen((prev) => !prev)}
            className="flex min-h-[40px] items-center gap-2 rounded-xl border border-white/15 px-3.5 py-2 text-xs sm:text-sm font-semibold text-stone-100 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-amber-400 whitespace-nowrap shrink-0"
            style={{ backgroundColor: touchPadOpen ? 'rgba(217, 119, 6, 0.88)' : 'rgba(15, 24, 19, 0.84)' }}
            aria-pressed={touchPadOpen}
          >
            <Gamepad2 className="h-4 w-4 shrink-0" />
            <span>Drive Pad</span>
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-white/15 px-3 py-2 text-xs sm:text-sm font-semibold text-stone-100 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-amber-400 whitespace-nowrap shrink-0"
            style={{ backgroundColor: 'rgba(15, 24, 19, 0.84)' }}
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
          >
            {muted ? <VolumeX className="h-4 w-4 text-rose-300" /> : <Volume2 className="h-4 w-4 text-emerald-300" />}
          </button>
        </div>
      </div>

      {/* Optional On-Screen Drive Pad for Touch / Mouse Play */}
      {touchPadOpen && (
        <div className="pointer-events-none flex items-end justify-between gap-4 pb-2">
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              {...bindHold('left')}
              className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/20 text-base font-bold text-white active:scale-95"
              style={{ backgroundColor: 'rgba(15, 24, 19, 0.85)' }}
              aria-label="Steer Left"
            >
              Left
            </button>
            <button
              type="button"
              {...bindHold('right')}
              className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/20 text-base font-bold text-white active:scale-95"
              style={{ backgroundColor: 'rgba(15, 24, 19, 0.85)' }}
              aria-label="Steer Right"
            >
              Right
            </button>
          </div>

          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              {...bindHold('backward')}
              className="flex h-14 w-16 items-center justify-center rounded-xl border border-white/20 text-sm font-bold text-stone-200 active:scale-95"
              style={{ backgroundColor: 'rgba(15, 24, 19, 0.85)' }}
            >
              Brake
            </button>
            <button
              type="button"
              {...bindHold('forward')}
              className="flex h-14 w-20 items-center justify-center rounded-xl border border-amber-300/40 text-sm font-bold text-stone-950 active:scale-95"
              style={{ backgroundColor: '#f59e0b' }}
            >
              Drive
            </button>
          </div>
        </div>
      )}

      {/* Collapsible Bottom Control Dock */}
      <div className="pointer-events-none flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockOpen((prev) => !prev)}
          className="pointer-events-auto mb-1.5 flex items-center gap-1.5 rounded-t-lg rounded-b-md border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-stone-200 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-amber-400 whitespace-nowrap"
          style={{ backgroundColor: 'rgba(15, 24, 19, 0.86)' }}
        >
          {dockOpen ? (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              <span>Hide Controls</span>
            </>
          ) : (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              <span>Show Controls</span>
            </>
          )}
        </button>

        {dockOpen && (
          <div
            className="pointer-events-auto w-full max-w-[920px] rounded-2xl border border-white/15 px-4 py-3 shadow-2xl"
            style={{ backgroundColor: 'rgba(15, 24, 19, 0.88)' }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Truck Paint Color Swatches */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-stone-300 whitespace-nowrap">
                  Truck Color
                </span>
                <div className="flex items-center gap-1.5">
                  {TRUCK_COLORS.map((c) => {
                    const active = truckColor === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onSelectColor(c.id)}
                        title={c.label}
                        aria-label={`Select ${c.label}`}
                        className={`h-7 w-7 rounded-lg border-2 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-white ${
                          active ? 'border-white scale-110' : 'border-white/25'
                        }`}
                        style={{ backgroundColor: c.hex }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Sky Time of Day Switcher */}
              <div className="flex items-center gap-1 rounded-lg bg-black/35 p-1">
                {timeOptions.map((opt) => {
                  const active = timeOfDay === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onSelectTimeOfDay(opt.id)}
                      className={`min-h-[32px] rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-amber-500 text-stone-950'
                          : 'text-stone-300 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* Camera Mode Switcher */}
              <div className="flex items-center gap-1 rounded-lg bg-black/35 p-1">
                <Camera className="mx-1.5 h-3.5 w-3.5 text-stone-400 shrink-0" />
                {cameraOptions.map((opt) => {
                  const active = cameraMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onSelectCamera(opt.id)}
                      className={`min-h-[32px] rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-stone-100 text-stone-950'
                          : 'text-stone-300 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* Playful Actions: Honk, Turbo, Reset */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onHonk}
                  className="min-h-[36px] rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 whitespace-nowrap shrink-0"
                >
                  Honk (H)
                </button>
                <button
                  type="button"
                  {...bindHold('boost')}
                  className="flex min-h-[36px] items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-stone-950 transition-colors hover:bg-amber-400 whitespace-nowrap shrink-0"
                >
                  <Zap className="h-3.5 w-3.5 shrink-0" />
                  <span>Turbo (Space)</span>
                </button>
                <button
                  type="button"
                  onClick={onReset}
                  className="flex min-h-[36px] items-center gap-1 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-stone-200 transition-colors hover:bg-white/20 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                  <span>Reset (R)</span>
                </button>
              </div>
            </div>

            {/* Quiet Single-Line Keyboard Legend */}
            <div className="mt-2 border-t border-white/10 pt-1.5 text-center text-xs text-stone-300">
              Drive with Arrow Keys or WASD · Hold Space for Turbo · Press H to Honk · Explore the creek, bridges, lookout hill, and ramps
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
