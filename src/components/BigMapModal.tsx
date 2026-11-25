import React, { useEffect, useRef } from 'react';
import { Compass, X } from 'lucide-react';
import {
  BRIDGES,
  RAMPS,
  WATER_LEVEL,
  WORLD_RADIUS,
  creekSignedDistance,
  groundHeightAt,
  trailFactorAt,
} from '../game/terrain';

interface BigMapModalProps {
  open: boolean;
  truckX: number;
  truckZ: number;
  truckYaw: number;
  uncollectedStars: { x: number; z: number }[];
  totalStars: number;
  helperMode: boolean;
  onToggleHelper: () => void;
  onClose: () => void;
}

const MAP_WORLD_HALF = WORLD_RADIUS + 32;
const MAP_WORLD_SPAN = MAP_WORLD_HALF * 2;
const CANVAS_PX = 480;

const ZONE_LABELS: { name: string; x: number; z: number }[] = [
  { name: 'Base Clearing', x: 0, z: 16 },
  { name: 'Crystal Creek', x: 16, z: -98 },
  { name: 'Lookout Peak', x: -150, z: -150 },
  { name: 'Jump Meadow', x: 132, z: -46 },
  { name: 'Whispering Pines', x: 195, z: 175 },
  { name: 'Cedar Summit', x: 210, z: -165 },
  { name: 'Sunny Knoll', x: -62, z: 195 },
];

function drawStarShape(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number
): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export const BigMapModal: React.FC<BigMapModalProps> = ({
  open,
  truckX,
  truckZ,
  truckYaw,
  uncollectedStars,
  totalStars,
  helperMode,
  onToggleHelper,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const terrainBmpRef = useRef<HTMLCanvasElement | null>(null);

  // Pre-render high-resolution valley terrain bitmap once
  useEffect(() => {
    const off = document.createElement('canvas');
    off.width = CANVAS_PX;
    off.height = CANVAS_PX;
    const ctx = off.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(CANVAS_PX, CANVAS_PX);
    const data = img.data;
    const pxPerM = CANVAS_PX / MAP_WORLD_SPAN;

    for (let py = 0; py < CANVAS_PX; py++) {
      const wz = -MAP_WORLD_HALF + (py / CANVAS_PX) * MAP_WORLD_SPAN;
      for (let px = 0; px < CANVAS_PX; px++) {
        const wx = -MAP_WORLD_HALF + (px / CANVAS_PX) * MAP_WORLD_SPAN;
        const idx = (py * CANVAS_PX + px) * 4;

        const rDist = Math.hypot(wx, wz);
        const h = groundHeightAt(wx, wz);
        const creekD = creekSignedDistance(wx, wz);
        const trail = trailFactorAt(wx, wz);

        let r = 64;
        let g = 128;
        let b = 64;

        if (h < WATER_LEVEL + 0.05 || creekD < 8.5) {
          r = 52;
          g = 180;
          b = 220;
        } else if (trail > 0.3) {
          r = 172;
          g = 136;
          b = 96;
        } else if (h > 25 || rDist > WORLD_RADIUS) {
          r = 120;
          g = 130;
          b = 138;
        } else if (h > 11) {
          r = 50;
          g = 100;
          b = 58;
        }

        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Valley drivable boundary ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(CANVAS_PX / 2, CANVAS_PX / 2, WORLD_RADIUS * pxPerM, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Bridges
    BRIDGES.forEach((br) => {
      const bx = (br.x + MAP_WORLD_HALF) * pxPerM;
      const bz = (br.z + MAP_WORLD_HALF) * pxPerM;
      ctx.save();
      ctx.translate(bx, bz);
      ctx.rotate(-br.yaw);
      ctx.fillStyle = '#d97706';
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 1.2;
      const bw = Math.max(5, br.width * pxPerM);
      const bl = Math.max(10, br.length * pxPerM);
      ctx.fillRect(-bw / 2, -bl / 2, bw, bl);
      ctx.strokeRect(-bw / 2, -bl / 2, bw, bl);
      ctx.restore();
    });

    // Ramps
    RAMPS.forEach((rmp) => {
      const rx = (rmp.x + MAP_WORLD_HALF) * pxPerM;
      const rz = (rmp.z + MAP_WORLD_HALF) * pxPerM;
      ctx.fillStyle = '#fb923c';
      ctx.strokeStyle = '#7c2d12';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(rx, rz, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // Zone Landmark Labels
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ZONE_LABELS.forEach((z) => {
      const zx = (z.x + MAP_WORLD_HALF) * pxPerM;
      const zy = (z.z + MAP_WORLD_HALF) * pxPerM;
      const textW = ctx.measureText(z.name).width;
      ctx.fillStyle = 'rgba(15, 24, 19, 0.72)';
      ctx.beginPath();
      ctx.roundRect(zx - textW / 2 - 6, zy - 9, textW + 12, 18, 5);
      ctx.fill();
      ctx.fillStyle = '#fef3c7';
      ctx.fillText(z.name, zx, zy);
    });

    terrainBmpRef.current = off;
  }, []);

  // Draw live overlay on open
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    const bmp = terrainBmpRef.current;
    if (!canvas || !bmp) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pxPerM = CANVAS_PX / MAP_WORLD_SPAN;
    const toPx = (wx: number, wz: number) => ({
      x: (wx + MAP_WORLD_HALF) * pxPerM,
      y: (wz + MAP_WORLD_HALF) * pxPerM,
    });

    ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
    ctx.drawImage(bmp, 0, 0);

    const truckPt = toPx(truckX, truckZ);

    // Find nearest uncollected star for Helper Mode
    let nearestIdx = -1;
    let nearestDistM = Infinity;
    for (let i = 0; i < uncollectedStars.length; i++) {
      const st = uncollectedStars[i];
      const d = Math.hypot(st.x - truckX, st.z - truckZ);
      if (d < nearestDistM) {
        nearestDistM = d;
        nearestIdx = i;
      }
    }

    if (helperMode && nearestIdx >= 0) {
      const targetPt = toPx(uncollectedStars[nearestIdx].x, uncollectedStars[nearestIdx].z);
      ctx.save();
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 3.2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(truckPt.x, truckPt.y);
      ctx.lineTo(targetPt.x, targetPt.y);
      ctx.stroke();
      ctx.restore();
    }

    // Draw all remaining Golden Pine Stars
    for (let i = 0; i < uncollectedStars.length; i++) {
      const st = uncollectedStars[i];
      const pt = toPx(st.x, st.z);
      if (helperMode && i === nearestIdx) {
        ctx.save();
        ctx.strokeStyle = 'rgba(253, 224, 71, 0.95)';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      drawStarShape(ctx, pt.x, pt.y, 9.5, 4.4);
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 1.8;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Draw Monster Truck Marker
    ctx.save();
    ctx.translate(truckPt.x, truckPt.y);
    ctx.rotate(-truckYaw);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8.5, 8.5);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8.5, 8.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, [open, truckX, truckZ, truckYaw, uncollectedStars, helperMode]);

  if (!open) return null;

  let nearestDistance = 0;
  if (uncollectedStars.length > 0) {
    nearestDistance = Math.round(
      Math.min(...uncollectedStars.map((s) => Math.hypot(s.x - truckX, s.z - truckZ)))
    );
  }

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center p-2 sm:p-4"
      style={{ backgroundColor: 'rgba(9, 15, 12, 0.76)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Full Mountain Forest Map"
    >
      <div
        className="flex max-h-[94vh] w-full max-w-[min(94vw,520px)] flex-col overflow-hidden rounded-2xl border border-white/20 p-3 shadow-2xl sm:p-4"
        style={{ backgroundColor: 'rgba(15, 24, 19, 0.96)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-sm font-bold text-white sm:text-base">
              Timberland Valley Map
            </h2>
            <p className="text-[11px] text-amber-200 sm:text-xs">
              {uncollectedStars.length === 0
                ? `All ${totalStars} Stars Found!`
                : `${uncollectedStars.length} of ${totalStars} Stars Left${
                    helperMode ? ` · Nearest: ${nearestDistance}m` : ''
                  }`}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleHelper}
              className={`flex min-h-[36px] items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-bold transition-colors ${
                helperMode
                  ? 'border-amber-300 bg-amber-400 text-stone-950'
                  : 'border-white/20 bg-white/10 text-stone-100 hover:bg-white/20'
              }`}
            >
              <Compass className="h-4 w-4 shrink-0" />
              <span>Helper {helperMode ? 'ON' : 'OFF'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-stone-100 transition-colors hover:bg-white/20"
              aria-label="Close big map"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-[#15241b]">
          <canvas
            ref={canvasRef}
            width={CANVAS_PX}
            height={CANVAS_PX}
            className="aspect-square max-h-[68vh] w-full max-w-[460px] object-contain"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-stone-300">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-rose-500 bg-white" />
            Your Truck
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
            Missing Stars
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-orange-400" />
            Jump Ramps
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded-sm bg-amber-600" />
            Log Bridges
          </span>
        </div>
      </div>
    </div>
  );
};
