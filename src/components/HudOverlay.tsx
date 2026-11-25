import React, { useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ChevronDown,
  ChevronUp,
  Compass,
  Gamepad2,
  Megaphone,
  RotateCcw,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  Waves,
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
import { BigMapModal } from './BigMapModal';
import { MiniMapRadar } from './MiniMapRadar';

interface HudOverlayProps {
  hud: HudSnapshot;
  truckColor: TruckColorId;
  timeOfDay: TimeOfDay;
  cameraMode: CameraMode;
  muted: boolean;
  bigMapOpen: boolean;
  onSelectColor: (color: TruckColorId) => void;
  onSelectTimeOfDay: (time: TimeOfDay) => void;
  onSelectCamera: (mode: CameraMode) => void;
  onRecenterCamera: () => void;
  onToggleMute: () => void;
  onToggleHelper: () => void;
  onSetBigMapOpen: (open: boolean) => void;
  onHonk: () => void;
  onReset: () => void;
  onDismissCelebration: () => void;
  onVirtualInput: (key: keyof InputState, down: boolean) => void;
}

const GasPedalIcon: React.FC<{ className?: string }> = ({ className = 'h-6 w-6' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M8.5 3.5h7l1.8 15.5a1.5 1.5 0 0 1-1.5 1.7H8.2a1.5 1.5 0 0 1-1.5-1.7L8.5 3.5Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path
      d="M9.5 8h5M9.2 12h5.6M8.9 16h6.2"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const BrakePedalIcon: React.FC<{ className?: string }> = ({ className = 'h-6 w-6' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <rect
      x="4.5"
      y="6.5"
      width="15"
      height="11"
      rx="2.5"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M8.5 9.5v5M12 9.5v5M15.5 9.5v5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const TachometerGauge: React.FC<{ rpm: number; speedKmh: number }> = ({ rpm, speedKmh }) => {
  const maxRpm = 7500;
  const clampedRpm = Math.min(maxRpm, Math.max(0, rpm));
  const ratio = clampedRpm / maxRpm;
  const needleAngle = -125 + ratio * 250;

  const rpmArcLength = 158;
  const activeStroke = ratio * rpmArcLength;
  const arcColor = ratio > 0.82 ? '#ef4444' : ratio > 0.62 ? '#f59e0b' : '#22c55e';

  return (
    <div
      className="relative h-[50px] w-[58px] shrink-0 lg:h-[68px] lg:w-[78px]"
      aria-label={`${speedKmh} km/h`}
    >
      <svg viewBox="0 0 100 90" className="h-full w-full" aria-hidden="true">
        <path
          d="M 20.5 67.5 A 36 36 0 1 1 79.5 67.5"
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="7.5"
          strokeLinecap="round"
        />
        <path
          d="M 20.5 67.5 A 36 36 0 1 1 79.5 67.5"
          fill="none"
          stroke={arcColor}
          strokeWidth="7.5"
          strokeLinecap="round"
          strokeDasharray={`${activeStroke} ${rpmArcLength}`}
        />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((tick) => {
          const tRatio = tick / 7;
          const deg = (-125 + tRatio * 250 - 90) * (Math.PI / 180);
          const x1 = 50 + Math.cos(deg) * 28;
          const y1 = 46 + Math.sin(deg) * 28;
          const x2 = 50 + Math.cos(deg) * 34;
          const y2 = 46 + Math.sin(deg) * 34;
          return (
            <line
              key={tick}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={tick >= 6 ? '#f87171' : 'rgba(255,255,255,0.55)'}
              strokeWidth="1.8"
            />
          );
        })}
        <g transform={`rotate(${needleAngle} 50 46)`}>
          <polygon points="48.5,48 50,15 51.5,48" fill="#fbbf24" />
          <circle cx="50" cy="46" r="4.4" fill="#f8fafc" />
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 text-center leading-none">
        <div className="font-mono-tabular text-xs font-bold text-white lg:text-sm">
          {speedKmh}
        </div>
        <div className="text-[8px] font-medium text-stone-400 lg:text-[9px]">km/h</div>
      </div>
    </div>
  );
};

export const HudOverlay: React.FC<HudOverlayProps> = ({
  hud,
  truckColor,
  timeOfDay,
  cameraMode,
  muted,
  bigMapOpen,
  onSelectColor,
  onSelectTimeOfDay,
  onSelectCamera,
  onRecenterCamera,
  onToggleMute,
  onToggleHelper,
  onSetBigMapOpen,
  onHonk,
  onReset,
  onDismissCelebration,
  onVirtualInput,
}) => {
  const isMobileDefault =
    typeof window !== 'undefined' &&
    (window.innerWidth < 768 || window.matchMedia('(pointer: coarse)').matches);

  const [dockOpen, setDockOpen] = useState(!isMobileDefault);
  const [touchPadOpen, setTouchPadOpen] = useState(isMobileDefault);

  const pedalHeldRef = useRef(false);
  const turboHeldRef = useRef(false);

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

  const syncForwardAndBoost = () => {
    onVirtualInput('forward', pedalHeldRef.current || turboHeldRef.current);
    onVirtualInput('boost', turboHeldRef.current);
  };

  const bindHold = (key: keyof InputState) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture is unsupported
      }
      if (key === 'forward') {
        pedalHeldRef.current = true;
        syncForwardAndBoost();
      } else if (key === 'boost') {
        turboHeldRef.current = true;
        syncForwardAndBoost();
      } else {
        onVirtualInput(key, true);
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (key === 'forward') {
        pedalHeldRef.current = false;
        syncForwardAndBoost();
      } else if (key === 'boost') {
        turboHeldRef.current = false;
        syncForwardAndBoost();
      } else {
        onVirtualInput(key, false);
      }
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (key === 'forward') {
        pedalHeldRef.current = false;
        syncForwardAndBoost();
      } else if (key === 'boost') {
        turboHeldRef.current = false;
        syncForwardAndBoost();
      } else {
        onVirtualInput(key, false);
      }
    },
  });

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-2 sm:p-4 lg:p-5">
      {/* Top Bar: Compact Title, Area, Stars & Tachometer + Top-Right Actions & Mini-Map Radar */}
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        <div className="flex flex-col items-start gap-1.5">
          <div
            className="pointer-events-auto flex min-w-0 items-center gap-2.5 rounded-xl border border-white/15 px-2.5 py-1.5 shadow-lg sm:gap-3 sm:px-3.5 sm:py-2"
            style={{ backgroundColor: 'rgba(15, 24, 19, 0.84)' }}
          >
            <div className="min-w-0">
              <h1 className="font-display truncate text-xs font-bold tracking-tight text-stone-50 sm:text-sm lg:text-base">
                Timberland Explorer
              </h1>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-stone-300 sm:text-xs">
                <span className="max-w-[92px] truncate font-medium text-amber-300 sm:max-w-[140px]">
                  {hud.zoneName}
                </span>
                <span aria-hidden="true" className="text-stone-500">
                  ·
                </span>
                <span className="font-mono-tabular shrink-0 whitespace-nowrap text-amber-200">
                  {hud.starsCollected}/{hud.totalStars} Stars
                </span>
              </div>
            </div>

            <div className="h-8 w-px shrink-0 bg-white/10 lg:h-10" />

            <TachometerGauge rpm={hud.rpm} speedKmh={hud.speedKmh} />
          </div>

          {hud.inWater && (
            <div
              className="flex items-center gap-1.5 rounded-lg border border-sky-300/40 px-2.5 py-1 text-[11px] font-bold text-sky-200 shadow-md"
              style={{ backgroundColor: 'rgba(12, 74, 110, 0.85)' }}
            >
              <Waves className="h-3.5 w-3.5 text-sky-300" />
              <span>SPLASH!</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5 sm:gap-2">
          <div className="pointer-events-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={onToggleHelper}
              className={`flex min-h-[40px] min-w-[40px] items-center justify-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 whitespace-nowrap shrink-0 sm:min-h-[42px] sm:px-3 ${
                hud.helperMode
                  ? 'border-amber-300 text-stone-950'
                  : 'border-white/15 text-stone-100 hover:bg-white/15'
              }`}
              style={{
                backgroundColor: hud.helperMode ? '#facc15' : 'rgba(15, 24, 19, 0.84)',
              }}
              aria-pressed={hud.helperMode}
              title="Helper Mode: Star Beacons & Guide Arrow (G)"
              aria-label="Toggle Helper Mode to find stars"
            >
              <Compass
                className={`h-4 w-4 shrink-0 ${
                  hud.helperMode ? 'text-stone-950' : 'text-amber-300'
                }`}
              />
              <span className="hidden md:inline">
                {hud.helperMode ? 'Helper ON' : 'Helper'}
              </span>
            </button>

            <button
              type="button"
              onClick={onRecenterCamera}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center gap-1.5 rounded-xl border border-white/15 px-2.5 py-1.5 text-xs font-semibold text-stone-100 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-amber-400 whitespace-nowrap shrink-0 sm:min-h-[42px] sm:px-3"
              style={{ backgroundColor: 'rgba(15, 24, 19, 0.84)' }}
              title="Center camera behind truck"
              aria-label="Center camera behind truck"
            >
              <Camera className="h-4 w-4 shrink-0 text-stone-300" />
              <span className="hidden md:inline">Center View</span>
            </button>

            <button
              type="button"
              onClick={() => setTouchPadOpen((prev) => !prev)}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center gap-2 rounded-xl border border-white/15 px-2.5 py-1.5 text-xs font-semibold text-stone-100 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-amber-400 whitespace-nowrap shrink-0 sm:min-h-[42px] sm:px-3"
              style={{
                backgroundColor: touchPadOpen
                  ? 'rgba(217, 119, 6, 0.88)'
                  : 'rgba(15, 24, 19, 0.84)',
              }}
              aria-pressed={touchPadOpen}
              aria-label="Toggle on-screen drive pad"
            >
              <Gamepad2 className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">Drive Pad</span>
            </button>

            <button
              type="button"
              onClick={onToggleMute}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-white/15 px-2.5 py-1.5 text-xs font-semibold text-stone-100 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-amber-400 whitespace-nowrap shrink-0 sm:min-h-[42px] sm:px-3"
              style={{ backgroundColor: 'rgba(15, 24, 19, 0.84)' }}
              aria-label={muted ? 'Unmute sound' : 'Mute sound'}
            >
              {muted ? (
                <VolumeX className="h-4 w-4 text-rose-300" />
              ) : (
                <Volume2 className="h-4 w-4 text-emerald-300" />
              )}
            </button>
          </div>

          <MiniMapRadar
            truckX={hud.truckX}
            truckZ={hud.truckZ}
            truckYaw={hud.truckYaw}
            uncollectedStars={hud.uncollectedStars}
            helperMode={hud.helperMode}
            onOpenBigMap={() => onSetBigMapOpen(true)}
          />
        </div>
      </div>

      {/* Fireworks All-Stars Celebration Banner */}
      {hud.celebrating && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-20 flex justify-center px-3 sm:top-20">
          <div
            className="pointer-events-auto flex max-w-md flex-col items-center gap-2 rounded-2xl border-2 border-amber-300/70 px-5 py-3.5 text-center shadow-2xl"
            style={{ backgroundColor: 'rgba(15, 24, 19, 0.92)' }}
          >
            <div className="flex items-center gap-2 text-amber-300">
              <Trophy className="h-6 w-6 shrink-0" />
              <span className="font-display text-base font-extrabold tracking-tight text-white sm:text-lg">
                All {hud.totalStars} Stars Found!
              </span>
              <Sparkles className="h-5 w-5 shrink-0" />
            </div>
            <p className="text-xs text-stone-200 sm:text-sm">
              Amazing driving! Ready for new stars in a fresh spot?
            </p>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={onReset}
                className="flex min-h-[38px] items-center gap-1.5 rounded-xl bg-amber-400 px-4 py-1.5 text-xs font-extrabold text-stone-950 shadow transition-colors hover:bg-amber-300 sm:text-sm"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Play Again!</span>
              </button>
              <button
                type="button"
                onClick={onDismissCelebration}
                className="min-h-[38px] rounded-xl border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-stone-100 transition-colors hover:bg-white/20 sm:text-sm"
              >
                Keep Exploring
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Controls Container: Touch Drive Pad + Collapsible Customization Dock */}
      <div className="pointer-events-none flex flex-col gap-1.5 sm:gap-2">
        {touchPadOpen && (
          <div className="pointer-events-none flex items-end justify-between gap-4 px-1">
            {/* Left Side: Arrow Icon Steering */}
            <div className="pointer-events-auto flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                {...bindHold('left')}
                className="flex h-14 w-14 touch-none select-none items-center justify-center rounded-2xl border border-white/20 text-white shadow-lg transition-transform active:scale-95 [@media(max-height:480px)]:h-12 [@media(max-height:480px)]:w-12 sm:h-16 sm:w-16"
                style={{ backgroundColor: 'rgba(15, 24, 19, 0.86)' }}
                aria-label="Steer Left"
              >
                <ArrowLeft className="h-7 w-7" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                {...bindHold('right')}
                className="flex h-14 w-14 touch-none select-none items-center justify-center rounded-2xl border border-white/20 text-white shadow-lg transition-transform active:scale-95 [@media(max-height:480px)]:h-12 [@media(max-height:480px)]:w-12 sm:h-16 sm:w-16"
                style={{ backgroundColor: 'rgba(15, 24, 19, 0.86)' }}
                aria-label="Steer Right"
              >
                <ArrowRight className="h-7 w-7" strokeWidth={2.5} />
              </button>
            </div>

            {/* Right Side: Icon Buttons for Honk, Turbo, Brake & Gas Pedal */}
            <div className="pointer-events-auto grid grid-cols-2 gap-1.5 sm:gap-2">
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onHonk();
                }}
                className="flex h-12 w-14 touch-none select-none flex-col items-center justify-center gap-0.5 rounded-2xl border border-white/20 text-sky-200 shadow-lg transition-transform active:scale-95 [@media(max-height:480px)]:h-11 [@media(max-height:480px)]:w-13 sm:h-14 sm:w-16"
                style={{ backgroundColor: 'rgba(15, 24, 19, 0.86)' }}
                aria-label="Honk Horn"
                title="Honk"
              >
                <Megaphone className="h-5 w-5" />
                <span className="text-[9px] font-semibold text-stone-300">Honk</span>
              </button>

              <button
                type="button"
                {...bindHold('boost')}
                className="flex h-12 w-14 touch-none select-none flex-col items-center justify-center gap-0.5 rounded-2xl border border-amber-300/45 text-amber-300 shadow-lg transition-transform active:scale-95 [@media(max-height:480px)]:h-11 [@media(max-height:480px)]:w-13 sm:h-14 sm:w-16"
                style={{ backgroundColor: 'rgba(120, 53, 15, 0.88)' }}
                aria-label="Turbo Boost"
                title="Turbo"
              >
                <Zap className="h-5 w-5" />
                <span className="text-[9px] font-semibold text-amber-200">Turbo</span>
              </button>

              <button
                type="button"
                {...bindHold('backward')}
                className="flex h-14 w-14 touch-none select-none flex-col items-center justify-center gap-0.5 rounded-2xl border border-rose-400/35 text-rose-200 shadow-lg transition-transform active:scale-95 [@media(max-height:480px)]:h-12 [@media(max-height:480px)]:w-13 sm:h-16 sm:w-16"
                style={{ backgroundColor: 'rgba(42, 18, 22, 0.88)' }}
                aria-label="Brake or Reverse"
                title="Brake"
              >
                <BrakePedalIcon className="h-6 w-6" />
                <span className="text-[9px] font-semibold text-rose-200">Brake</span>
              </button>

              <button
                type="button"
                {...bindHold('forward')}
                className="flex h-14 w-14 touch-none select-none flex-col items-center justify-center gap-0.5 rounded-2xl border border-amber-300/50 text-stone-950 shadow-lg transition-transform active:scale-95 [@media(max-height:480px)]:h-12 [@media(max-height:480px)]:w-13 sm:h-16 sm:w-16"
                style={{ backgroundColor: '#f59e0b' }}
                aria-label="Drive Pedal"
                title="Pedal"
              >
                <GasPedalIcon className="h-6 w-6" />
                <span className="text-[9px] font-bold text-stone-950">Pedal</span>
              </button>
            </div>
          </div>
        )}

        {/* Collapsible Bottom Control Dock */}
        <div className="pointer-events-none flex flex-col items-center">
          <button
            type="button"
            onClick={() => setDockOpen((prev) => !prev)}
            className="pointer-events-auto mb-1 flex items-center gap-1.5 rounded-t-lg rounded-b-md border border-white/15 px-3 py-1 text-[11px] font-semibold text-stone-200 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-amber-400 whitespace-nowrap sm:mb-1.5 sm:px-3.5 sm:py-1.5 sm:text-xs"
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
              className="pointer-events-auto w-full max-w-[940px] rounded-2xl border border-white/15 px-4 py-3 shadow-2xl"
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

                {/* Playful Actions: Honk, Turbo, Random Reset */}
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
                    <span>Random Reset (R)</span>
                  </button>
                </div>
              </div>

              {/* Quiet Single-Line Legend */}
              <div className="mt-2 hidden border-t border-white/10 pt-1.5 text-center text-xs text-stone-300 sm:block">
                Drive: WASD / Arrows · Look: Drag mouse &amp; scroll · Turbo: Space · Honk: H · Map: M · Helper: G · Reset: R
              </div>
            </div>
          )}
        </div>
      </div>

      <BigMapModal
        open={bigMapOpen}
        truckX={hud.truckX}
        truckZ={hud.truckZ}
        truckYaw={hud.truckYaw}
        uncollectedStars={hud.uncollectedStars}
        totalStars={hud.totalStars}
        helperMode={hud.helperMode}
        onToggleHelper={onToggleHelper}
        onClose={() => onSetBigMapOpen(false)}
      />
    </div>
  );
};
