import * as THREE from 'three';

export interface ProceduralTextureSet {
  terrainDetailMap: THREE.CanvasTexture;
  tireTreadMap: THREE.CanvasTexture;
  woodPlankMap: THREE.CanvasTexture;
  barkMap: THREE.CanvasTexture;
  waterRippleMap: THREE.CanvasTexture;
  contactShadowMap: THREE.CanvasTexture;
  particleMap: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  // 1. Subtle organic grass/earth detail texture for terrain
  const terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = 256;
  terrainCanvas.height = 256;
  const tCtx = terrainCanvas.getContext('2d')!;
  tCtx.fillStyle = '#e5e5e5';
  tCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4800; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const shade = 205 + Math.floor(Math.random() * 48);
    tCtx.fillStyle = `rgb(${shade},${shade},${shade})`;
    tCtx.fillRect(x, y, 2, 2);
  }
  const terrainDetailMap = new THREE.CanvasTexture(terrainCanvas);
  terrainDetailMap.wrapS = THREE.RepeatWrapping;
  terrainDetailMap.wrapT = THREE.RepeatWrapping;
  terrainDetailMap.repeat.set(36, 36);
  terrainDetailMap.colorSpace = THREE.SRGBColorSpace;
  terrainDetailMap.anisotropy = maxAnisotropy;

  // 2. Monster truck deep chevron tire tread bump/albedo texture
  const tireCanvas = document.createElement('canvas');
  tireCanvas.width = 256;
  tireCanvas.height = 256;
  const tireCtx = tireCanvas.getContext('2d')!;
  tireCtx.fillStyle = '#1d1f22';
  tireCtx.fillRect(0, 0, 256, 256);
  tireCtx.fillStyle = '#33363b';
  for (let y = -32; y < 288; y += 32) {
    tireCtx.beginPath();
    tireCtx.moveTo(16, y);
    tireCtx.lineTo(120, y + 18);
    tireCtx.lineTo(120, y + 32);
    tireCtx.lineTo(16, y + 14);
    tireCtx.closePath();
    tireCtx.fill();

    tireCtx.beginPath();
    tireCtx.moveTo(240, y + 14);
    tireCtx.lineTo(136, y + 32);
    tireCtx.lineTo(136, y + 18);
    tireCtx.lineTo(240, y);
    tireCtx.closePath();
    tireCtx.fill();
  }
  const tireTreadMap = new THREE.CanvasTexture(tireCanvas);
  tireTreadMap.wrapS = THREE.RepeatWrapping;
  tireTreadMap.wrapT = THREE.RepeatWrapping;
  tireTreadMap.repeat.set(1, 3);
  tireTreadMap.colorSpace = THREE.SRGBColorSpace;
  tireTreadMap.anisotropy = maxAnisotropy;

  // 3. Warm weathered timber plank texture for bridges, ramps, and lookout cabin
  const woodCanvas = document.createElement('canvas');
  woodCanvas.width = 256;
  woodCanvas.height = 256;
  const wCtx = woodCanvas.getContext('2d')!;
  wCtx.fillStyle = '#9c6b43';
  wCtx.fillRect(0, 0, 256, 256);
  for (let p = 0; p < 8; p++) {
    const py = p * 32;
    const tone = p % 2 === 0 ? '#a8754b' : '#8d5d38';
    wCtx.fillStyle = tone;
    wCtx.fillRect(0, py + 2, 256, 28);
    wCtx.fillStyle = '#5a381e';
    wCtx.fillRect(0, py, 256, 2);
    for (let g = 0; g < 18; g++) {
      wCtx.fillStyle = 'rgba(65, 38, 16, 0.18)';
      wCtx.fillRect(Math.random() * 200, py + 4 + Math.random() * 22, 30 + Math.random() * 60, 1.5);
    }
  }
  const woodPlankMap = new THREE.CanvasTexture(woodCanvas);
  woodPlankMap.wrapS = THREE.RepeatWrapping;
  woodPlankMap.wrapT = THREE.RepeatWrapping;
  woodPlankMap.repeat.set(2, 2);
  woodPlankMap.colorSpace = THREE.SRGBColorSpace;
  woodPlankMap.anisotropy = maxAnisotropy;

  // 4. Pine bark texture
  const barkCanvas = document.createElement('canvas');
  barkCanvas.width = 128;
  barkCanvas.height = 128;
  const bCtx = barkCanvas.getContext('2d')!;
  bCtx.fillStyle = '#5a3f2d';
  bCtx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 160; i++) {
    bCtx.fillStyle = i % 2 === 0 ? '#432d1f' : '#6c4d38';
    bCtx.fillRect(Math.random() * 124, Math.random() * 120, 3, 14 + Math.random() * 22);
  }
  const barkMap = new THREE.CanvasTexture(barkCanvas);
  barkMap.wrapS = THREE.RepeatWrapping;
  barkMap.wrapT = THREE.RepeatWrapping;
  barkMap.colorSpace = THREE.SRGBColorSpace;
  barkMap.anisotropy = maxAnisotropy;

  // 5. Shimmering tileable alpine water ripple texture
  const waterCanvas = document.createElement('canvas');
  waterCanvas.width = 256;
  waterCanvas.height = 256;
  const waCtx = waterCanvas.getContext('2d')!;
  waCtx.fillStyle = '#38a7c7';
  waCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    const cx = Math.random() * 256;
    const cy = Math.random() * 256;
    const rx = 14 + Math.random() * 28;
    const ry = 4 + Math.random() * 8;
    waCtx.strokeStyle = i % 3 === 0 ? 'rgba(224, 247, 255, 0.34)' : 'rgba(125, 226, 248, 0.25)';
    waCtx.lineWidth = 2;
    waCtx.beginPath();
    waCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    waCtx.stroke();
  }
  const waterRippleMap = new THREE.CanvasTexture(waterCanvas);
  waterRippleMap.wrapS = THREE.RepeatWrapping;
  waterRippleMap.wrapT = THREE.RepeatWrapping;
  waterRippleMap.repeat.set(38, 38);
  waterRippleMap.colorSpace = THREE.SRGBColorSpace;
  waterRippleMap.anisotropy = maxAnisotropy;

  // 6. Soft radial contact shadow beneath monster truck
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const sCtx = shadowCanvas.getContext('2d')!;
  const sGrad = sCtx.createRadialGradient(64, 64, 12, 64, 64, 62);
  sGrad.addColorStop(0, 'rgba(10, 16, 12, 0.72)');
  sGrad.addColorStop(0.55, 'rgba(10, 16, 12, 0.34)');
  sGrad.addColorStop(1, 'rgba(10, 16, 12, 0)');
  sCtx.fillStyle = sGrad;
  sCtx.fillRect(0, 0, 128, 128);
  const contactShadowMap = new THREE.CanvasTexture(shadowCanvas);
  contactShadowMap.colorSpace = THREE.SRGBColorSpace;

  // 7. Soft dust / water splash particle sprite
  const partCanvas = document.createElement('canvas');
  partCanvas.width = 64;
  partCanvas.height = 64;
  const pCtx = partCanvas.getContext('2d')!;
  const pGrad = pCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
  pGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  pGrad.addColorStop(0.45, 'rgba(255, 255, 255, 0.45)');
  pGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  pCtx.fillStyle = pGrad;
  pCtx.fillRect(0, 0, 64, 64);
  const particleMap = new THREE.CanvasTexture(partCanvas);
  particleMap.colorSpace = THREE.SRGBColorSpace;

  return {
    terrainDetailMap,
    tireTreadMap,
    woodPlankMap,
    barkMap,
    waterRippleMap,
    contactShadowMap,
    particleMap,
    dispose: () => {
      terrainDetailMap.dispose();
      tireTreadMap.dispose();
      woodPlankMap.dispose();
      barkMap.dispose();
      waterRippleMap.dispose();
      contactShadowMap.dispose();
      particleMap.dispose();
    },
  };
}
