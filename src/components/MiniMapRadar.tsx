import React, { useEffect, useRef } from 'react';
import { Maximize2 } from 'lucide-react';
import {
  BRIDGES,
  RAMPS,
  WATER_LEVEL,
  WORLD_RADIUS,
  creekSignedDistance,
  groundHeightAt,
  trailFactorAt,
} from '../game/terrain';

interface MiniMapRadarProps {
  truckX: number;
  truckZ: number;
  truckYaw: number;
  uncollectedStars: { x: number; z: number }[];
  helperMode: boolean;
  onOpenBigMap: () => void;
}

const MAP_WORLD_HALF = WORLD_RADIUS + 40;
const MAP_WORLD_SPAN = MAP_WORLD_HALF * 2;
const OFF_PX = 220;
const PX_PER_METER = OFF_PX / MAP_WORLD_SPAN;
const RADAR_VIEW_RADIUS_M = 135;

export const MiniMapRadar: React.FC<MiniMapRadarProps> = ({
  truckX,
  truckZ,
  truckYaw,
  uncollectedStars,
  helperMode,
  onOpenBigMap,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const terrainBitmapRef = useRef<HTMLCanvasElement | null>(null);

  // Pre-render the static mountain forest valley terrain, trails, water, ramps & bridges once
  useEffect(() => {
    const off = document.createElement('canvas');
    off.width = OFF_PX;
    off.height = OFF_PX;
    const ctx = off.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(OFF_PX, OFF_PX);
    const data = img.data;

    for (let py = 0; py < OFF_PX; py++) {
      const wz = -MAP_WORLD_HALF + (py / OFF_PX) * MAP_WORLD_SPAN;
      for (let px = 0; px < OFF_PX; px++) {
        const wx = -MAP_WORLD_HALF + (px / OFF_PX) * MAP_WORLD_SPAN;
        const idx = (py * OFF_PX + px) * 4;

        const rDist = Math.hypot(wx, wz);
        const h = groundHeightAt(wx, wz);
        const creekD = creekSignedDistance(wx, wz);
        const trail = trailFactorAt(wx, wz);

        let r = 56;
        let g = 112;
        let b = 58;

        if (h < WATER_LEVEL + 0.05 || creekD < 8.5) {
          r = 56;
          g = 178;
          b = 216;
        } else if (trail > 0.32) {
          r = 166;
          g = 130;
          b = 92;
        } else if (h > 24 || rDist > WORLD_RADIUS) {
          r = 110;
          g = 120;
          b = 128;
        } else if (h > 11) {
          r = 46;
          g = 92;
          b = 52;
        }

        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    BRIDGES.forEach((br) => {
      const bx = (br.x + MAP_WORLD_HALF) * PX_PER_METER;
      const bz = (br.z + MAP_WORLD_HALF) * PX_PER_METER;
      ctx.save();
      ctx.translate(bx, bz);
      ctx.rotate(-br.yaw);
      ctx.fillStyle = '#d97706';
      ctx.fillRect(
        (-br.width * PX_PER_METER) / 2,
        (-br.length * PX_PER_METER) / 2,
        Math.max(2.5, br.width * PX_PER_METER),
        Math.max(4, br.length * PX_PER_METER)
      );
      ctx.restore();
    });

    RAMPS.forEach((rmp) => {
      const rx = (rmp.x + MAP_WORLD_HALF) * PX_PER_METER;
      const rz = (rmp.z + MAP_WORLD_HALF) * PX_PER_METER;
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.arc(rx, rz, 2.3, 0, Math.PI * 2);
      ctx.fill();
    });

    terrainBitmapRef.current = off;
  }, []);

  // Redraw radar frame whenever truck, stars, or helperMode update
  useEffect(() => {
    const canvas = canvasRef.current;
    const terrainBmp = terrainBitmapRef.current;
    if (!canvas || !terrainBmp) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = cx - 4;
    const screenPxPerMeter = radius / RADAR_VIEW_RADIUS_M;

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#182b20';
    ctx.fillRect(0, 0, w, h);

    const truckMapX = (truckX + MAP_WORLD_HALF) * PX_PER_METER;
    const truckMapZ = (truckZ + MAP_WORLD_HALF) * PX_PER_METER;
    const bmpScale = screenPxPerMeter / PX_PER_METER;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(truckYaw);
    ctx.scale(bmpScale, bmpScale);
    ctx.drawImage(terrainBmp, -truckMapX, -truckMapZ);
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
    ctx.stroke();

    const fx = -Math.sin(truckYaw);
    const fz = -Math.cos(truckYaw);
    const rx = Math.cos(truckYaw);
    const rz = -Math.sin(truckYaw);

    let nearestIdx = -1;
    let nearestDistSq = Infinity;
    if (helperMode && uncollectedStars.length > 0) {
      for (let i = 0; i < uncollectedStars.length; i++) {
        const st = uncollectedStars[i];
        const dSq = (st.x - truckX) * (st.x - truckX) + (st.z - truckZ) * (st.z - truckZ);
        if (dSq < nearestDistSq) {
          nearestDistSq = dSq;
          nearestIdx = i;
        }
      }
    }

    for (let i = 0; i < uncollectedStars.length; i++) {
      const st = uncollectedStars[i];
      const dx = st.x - truckX;
      const dz = st.z - truckZ;
      const localRight = dx * rx + dz * rz;
      const localAhead = dx * fx + dz * fz;

      let px = localRight * screenPxPerMeter;
      let py = -localAhead * screenPxPerMeter;
      const pxDist = Math.hypot(px, py);
      const edgeR = radius - 6;
      const isFar = pxDist > edgeR;
      if (isFar && pxDist > 0.001) {
        px = (px / pxDist) * edgeR;
        py = (py / pxDist) * edgeR;
      }

      if (i === nearestIdx) {
        ctx.save();
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + px, cy + py);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(cx + px, cy + py);
      if (i === nearestIdx) {
        ctx.strokeStyle = 'rgba(253, 224, 71, 0.95)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 7.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, isFar ? 3.5 : 4.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    ctx.strokeStyle = helperMode ? 'rgba(250, 204, 21, 0.72)' : 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    const nAngle = truckYaw - Math.PI / 2;
    const nx = cx + Math.cos(nAngle) * (radius - 2);
    const ny = cy + Math.sin(nAngle) * (radius - 2);
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.arc(nx, ny, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0f1813';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5.5, 5.5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-5.5, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, [truckX, truckZ, truckYaw, uncollectedStars, helperMode]);

  return (
    <button
      type="button"
      onClick={onOpenBigMap}
      className="pointer-events-auto group relative h-[84px] w-[84px] shrink-0 cursor-pointer rounded-full shadow-xl transition-transform hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-amber-400 sm:h-[108px] sm:w-[108px]"
      style={{ backgroundColor: 'rgba(15, 24, 19, 0.86)' }}
      aria-label="Open full forest map"
      title="Tap to open big map"
    >
      <canvas
        ref={canvasRef}
        width={120}
        height={120}
        className="h-full w-full rounded-full"
      />
      <span
        className="pointer-events-none absolute -bottom-1 right-0 flex items-center gap-0.5 rounded-md border border-white/25 px-1.5 py-0.5 text-[9px] font-bold text-stone-100 shadow"
        style={{ backgroundColor: 'rgba(15, 24, 19, 0.92)' }}
      >
        <Maximize2 className="h-2.5 w-2.5 text-amber-300" />
        <span>MAP</span>
      </span>
    </button>
  );
};
