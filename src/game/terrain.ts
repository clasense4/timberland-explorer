import * as THREE from 'three';
import type { BridgeSpec, RampSpec } from './types';
import type { ProceduralTextureSet } from './textures';

export const WORLD_RADIUS = 400;
export const TERRAIN_SIZE = 1120;
export const WATER_LEVEL = -0.45;

export const RAMPS: RampSpec[] = [
  { x: 22, z: -32, yaw: 0.28, width: 8.0, length: 13, height: 2.8 },
  { x: 88, z: -96, yaw: -0.7, width: 9.0, length: 14, height: 3.4 },
  { x: 132, z: -58, yaw: 2.3, width: 8.5, length: 14, height: 3.1 },
  { x: -64, z: 72, yaw: 1.05, width: 8.0, length: 13, height: 2.8 },
  { x: -165, z: -36, yaw: -0.4, width: 8.5, length: 14, height: 3.2 },
  { x: 24, z: 156, yaw: 1.7, width: 8.5, length: 14, height: 3.0 },
  { x: 210, z: 95, yaw: -1.1, width: 9.0, length: 15, height: 3.5 },
  { x: -195, z: 165, yaw: 0.65, width: 8.5, length: 14, height: 3.2 },
  { x: 45, z: -245, yaw: 2.8, width: 9.0, length: 15, height: 3.4 },
  { x: -240, z: -140, yaw: -0.95, width: 8.5, length: 14, height: 3.1 },
];

export const BRIDGES: BridgeSpec[] = [
  { x: -16, z: -86, yaw: 0.15, width: 9.0, length: 28, deckHeight: 0.9 },
  { x: 135, z: -48, yaw: -0.68, width: 9.0, length: 28, deckHeight: 0.9 },
  { x: -190, z: -98, yaw: 0.32, width: 9.0, length: 28, deckHeight: 0.9 },
];

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Computes distance to the wide meandering alpine creek and pond.
 */
export function creekSignedDistance(x: number, z: number): number {
  const curveZ = -88 + Math.sin(x * 0.014) * 32 + Math.cos(x * 0.028) * 11;
  const dMain = Math.abs(z - curveZ);
  // Alpine lake near (64, -74)
  const pondDist = Math.hypot(x - 64, z + 74) - 22;
  // Second mountain tarn near (-145, -108)
  const tarnDist = Math.hypot(x + 145, z + 108) - 18;
  return Math.min(dMain, pondDist + 8, tarnDist + 8);
}

/**
 * Returns 0..1 indicating proximity to the sprawling dirt exploration loop trails.
 */
export function trailFactorAt(x: number, z: number): number {
  const rx = x / 165;
  const rz = z / 150;
  const angle = Math.atan2(rz, rx);
  const targetR = 1.0 + 0.16 * Math.sin(angle * 3.0 + 0.4);
  const r = Math.hypot(rx, rz);
  const distToOuterLoop = Math.abs(r - targetR) * 145;

  // Inner meadow loop
  const ir = Math.hypot(x / 72, z / 68);
  const distToInnerLoop = Math.abs(ir - 1.0) * 68;

  // Central meadow connector through spawn (0, 0)
  const distToCenterRoad =
    Math.abs(x * 0.85 + z * 0.52) < 180 ? Math.abs(x * 0.52 - z * 0.85) : 999;

  const d = Math.min(distToOuterLoop, distToInnerLoop, distToCenterRoad);
  return 1 - smoothstep(3.5, 9.5, d);
}

/**
 * Pure analytical terrain heightfield for the expansive mountain forest valley.
 */
export function groundHeightAt(x: number, z: number): number {
  const spawnDist = Math.hypot(x, z);
  const spawnFlatten = smoothstep(14, 42, spawnDist);

  // Broad rolling forest hills
  const rolling =
    Math.sin(x * 0.016) * Math.cos(z * 0.015) * 4.8 +
    Math.sin(x * 0.038 + 1.1) * Math.sin(z * 0.034) * 2.1 +
    Math.cos((x + z) * 0.009) * 3.2;

  // Lookout Peak in the northwest quadrant
  const hillDist = Math.hypot(x + 150, z + 150);
  const lookoutHill = Math.max(0, 1 - smoothstep(14, 88, hillDist)) * 18.5;

  // Pine Ridge in the southeast
  const ridgeDist = Math.hypot(x - 195, z - 175);
  const pineRidge = Math.max(0, 1 - smoothstep(16, 98, ridgeDist)) * 16.0;

  // Southern Sunny Knoll
  const knollDist = Math.hypot(x + 62, z - 195);
  const sunnyKnoll = Math.max(0, 1 - smoothstep(12, 76, knollDist)) * 12.5;

  // Northeast Cedar Summit
  const cedarDist = Math.hypot(x - 210, z + 165);
  const cedarSummit = Math.max(0, 1 - smoothstep(15, 86, cedarDist)) * 15.0;

  // Towering mountain perimeter surrounding the valley
  const r = Math.hypot(x, z);
  const rimT = smoothstep(330, 520, r);
  const mountainNoise =
    0.74 +
    0.26 * Math.sin(Math.atan2(z, x) * 7.0 + 0.5) +
    0.18 * Math.cos(Math.atan2(z, x) * 13.0);
  const mountainRim = rimT * rimT * 74 * mountainNoise;

  let h =
    rolling * spawnFlatten +
    lookoutHill +
    pineRidge +
    sunnyKnoll +
    cedarSummit +
    mountainRim;

  // Carve gentle creek bed & alpine ponds
  const creekD = creekSignedDistance(x, z);
  const creekCarve = 1 - smoothstep(6.0, 16.5, creekD);
  if (creekCarve > 0) {
    const targetBed = -1.2;
    h = THREE.MathUtils.lerp(h, Math.min(h, targetBed), creekCarve);
  }

  return h;
}

/**
 * Evaluates full drivable surface height including wooden stunt ramps and creek bridges.
 */
export function surfaceHeightAt(x: number, z: number): number {
  let h = groundHeightAt(x, z);

  for (let i = 0; i < RAMPS.length; i++) {
    const ramp = RAMPS[i];
    const dx = x - ramp.x;
    const dz = z - ramp.z;
    const cos = Math.cos(-ramp.yaw);
    const sin = Math.sin(-ramp.yaw);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;

    const halfW = ramp.width * 0.5;
    const halfL = ramp.length * 0.5;
    if (Math.abs(lx) <= halfW && Math.abs(lz) <= halfL) {
      const t = (lz + halfL) / ramp.length;
      const baseH = groundHeightAt(ramp.x, ramp.z);
      const rampSurface = baseH + Math.pow(t, 1.18) * ramp.height;
      if (rampSurface > h) {
        h = rampSurface;
      }
    }
  }

  for (let i = 0; i < BRIDGES.length; i++) {
    const br = BRIDGES[i];
    const dx = x - br.x;
    const dz = z - br.z;
    const cos = Math.cos(-br.yaw);
    const sin = Math.sin(-br.yaw);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;

    const halfW = br.width * 0.5;
    const halfL = br.length * 0.5;
    if (Math.abs(lx) <= halfW && Math.abs(lz) <= halfL) {
      const normZ = lz / halfL;
      const arch = (1 - normZ * normZ) * 1.25;
      const deckY = br.deckHeight + arch;
      if (deckY > h) {
        h = deckY;
      }
    }
  }

  return h;
}

export function getZoneNameAt(x: number, z: number): string {
  if (groundHeightAt(x, z) < WATER_LEVEL + 0.08) return 'Crystal Creek';
  if (Math.hypot(x + 150, z + 150) < 70) return 'Lookout Peak';
  if (Math.hypot(x - 110, z + 78) < 64) return 'Jump Meadow';
  if (Math.hypot(x - 195, z - 175) < 76) return 'Whispering Pines';
  if (Math.hypot(x - 210, z + 165) < 68) return 'Cedar Summit';
  if (Math.hypot(x + 62, z - 195) < 60) return 'Sunny Knoll';
  if (Math.hypot(x, z) < 38) return 'Base Clearing';
  if (Math.hypot(x, z) > 315) return 'Alpine Foothills';
  return 'Timberland Valley';
}

export function createTerrainAndWater(textures: ProceduralTextureSet): {
  group: THREE.Group;
  waterMesh: THREE.Mesh;
  dispose: () => void;
} {
  const group = new THREE.Group();

  const segments = 240;
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cMeadow = new THREE.Color('#4c8c42');
  const cPineFloor = new THREE.Color('#326334');
  const cDirtTrail = new THREE.Color('#9e7b56');
  const cSand = new THREE.Color('#b69d74');
  const cRock = new THREE.Color('#6f757a');
  const cSnow = new THREE.Color('#e8eff5');
  const tmpColor = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = groundHeightAt(x, z);
    pos.setY(i, h);

    const trail = trailFactorAt(x, z);
    const creekD = creekSignedDistance(x, z);
    const r = Math.hypot(x, z);

    const forestPatch = 0.5 + 0.5 * Math.sin(x * 0.025) * Math.cos(z * 0.025);
    tmpColor.copy(cMeadow).lerp(cPineFloor, forestPatch * 0.72);

    if (trail > 0.02) {
      tmpColor.lerp(cDirtTrail, trail * 0.88);
    }

    if (h < WATER_LEVEL + 0.65) {
      const bankT = 1 - smoothstep(WATER_LEVEL - 0.5, WATER_LEVEL + 0.65, h);
      tmpColor.lerp(cSand, bankT * 0.85);
    }

    if (h > 13.5 || r > 345) {
      const rockT = smoothstep(13.5, 25.0, h);
      tmpColor.lerp(cRock, rockT * 0.9);
    }
    if (h > 28.0) {
      const snowT = smoothstep(28.0, 42.0, h);
      tmpColor.lerp(cSnow, snowT * 0.92);
    }

    const micro = Math.sin(x * 0.25) * Math.cos(z * 0.28) * 0.035;
    colors[i * 3] = Math.min(1, Math.max(0, tmpColor.r + micro));
    colors[i * 3 + 1] = Math.min(1, Math.max(0, tmpColor.g + micro));
    colors[i * 3 + 2] = Math.min(1, Math.max(0, tmpColor.b + micro));

    if (creekD < 7 && h < WATER_LEVEL) {
      colors[i * 3] *= 0.82;
      colors[i * 3 + 1] *= 0.86;
      colors[i * 3 + 2] *= 0.88;
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // Repeat detail texture cleanly across larger world
  textures.terrainDetailMap.repeat.set(72, 72);

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: textures.terrainDetailMap,
    roughness: 0.92,
    metalness: 0.02,
  });

  const terrainMesh = new THREE.Mesh(geo, terrainMat);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  // Expanded creek water surface across the larger valley
  const waterGeo = new THREE.PlaneGeometry(820, 260, 64, 32);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x3ba6c4,
    roughness: 0.14,
    metalness: 0.08,
    clearcoat: 0.9,
    clearcoatRoughness: 0.12,
    transparent: true,
    opacity: 0.78,
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.set(0, WATER_LEVEL, -88);
  waterMesh.receiveShadow = true;
  group.add(waterMesh);

  // Wooden stunt ramps
  const woodMat = new THREE.MeshStandardMaterial({
    map: textures.woodPlankMap,
    color: 0xd4a373,
    roughness: 0.78,
    metalness: 0.05,
  });
  const braceMat = new THREE.MeshStandardMaterial({
    color: 0x5c3d28,
    roughness: 0.88,
    metalness: 0.04,
  });
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.45,
    metalness: 0.1,
  });

  const rampGeos: THREE.BufferGeometry[] = [];

  RAMPS.forEach((ramp) => {
    const rGroup = new THREE.Group();
    const baseH = groundHeightAt(ramp.x, ramp.z);
    rGroup.position.set(ramp.x, baseH, ramp.z);
    rGroup.rotation.y = ramp.yaw;

    const shape = new THREE.Shape();
    const halfL = ramp.length * 0.5;
    shape.moveTo(-halfL, -0.35);
    shape.lineTo(halfL, -0.35);
    shape.lineTo(halfL, ramp.height);
    shape.quadraticCurveTo(0, ramp.height * 0.36, -halfL, 0.02);
    shape.closePath();

    const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
      depth: ramp.width,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.06,
      bevelSegments: 2,
    });
    extrudeGeo.translate(0, 0, -ramp.width * 0.5);
    extrudeGeo.rotateY(-Math.PI / 2);
    rampGeos.push(extrudeGeo);

    const wedge = new THREE.Mesh(extrudeGeo, woodMat);
    wedge.castShadow = true;
    wedge.receiveShadow = true;
    rGroup.add(wedge);

    const lipGeo = new THREE.BoxGeometry(ramp.width - 0.3, 0.14, 0.55);
    rampGeos.push(lipGeo);
    const lip = new THREE.Mesh(lipGeo, stripeMat);
    lip.position.set(0, ramp.height - 0.02, halfL - 0.35);
    rGroup.add(lip);

    [-ramp.width * 0.46, ramp.width * 0.46].forEach((sx) => {
      const postGeo = new THREE.BoxGeometry(0.32, ramp.height + 0.5, 0.36);
      rampGeos.push(postGeo);
      const post = new THREE.Mesh(postGeo, braceMat);
      post.position.set(sx, (ramp.height + 0.1) * 0.5, halfL - 0.4);
      post.castShadow = true;
      rGroup.add(post);
    });

    group.add(rGroup);
  });

  // Arched wooden log bridges across the creek
  BRIDGES.forEach((br) => {
    const bGroup = new THREE.Group();
    bGroup.position.set(br.x, 0, br.z);
    bGroup.rotation.y = br.yaw;

    const plankCount = 20;
    const plankLen = br.length / plankCount;
    const plankGeo = new THREE.BoxGeometry(br.width, 0.32, plankLen * 0.88);
    rampGeos.push(plankGeo);

    for (let i = 0; i < plankCount; i++) {
      const lz = -br.length * 0.5 + (i + 0.5) * plankLen;
      const normZ = lz / (br.length * 0.5);
      const arch = (1 - normZ * normZ) * 1.25;
      const plank = new THREE.Mesh(plankGeo, woodMat);
      plank.position.set(0, br.deckHeight + arch - 0.16, lz);
      plank.castShadow = true;
      plank.receiveShadow = true;
      bGroup.add(plank);
    }

    const postGeo = new THREE.CylinderGeometry(0.2, 0.22, 2.2, 8);
    rampGeos.push(postGeo);
    [-br.width * 0.48, br.width * 0.48].forEach((sx) => {
      for (let p = -2; p <= 2; p++) {
        const pz = p * (br.length * 0.22);
        const normZ = pz / (br.length * 0.5);
        const arch = (1 - normZ * normZ) * 1.25;
        const post = new THREE.Mesh(postGeo, braceMat);
        post.position.set(sx, br.deckHeight + arch + 0.3, pz);
        post.castShadow = true;
        bGroup.add(post);
      }
      const railGeo = new THREE.BoxGeometry(0.24, 0.24, br.length * 0.92);
      rampGeos.push(railGeo);
      const rail = new THREE.Mesh(railGeo, braceMat);
      rail.position.set(sx, br.deckHeight + 1.15, 0);
      rail.castShadow = true;
      bGroup.add(rail);
    });

    group.add(bGroup);
  });

  return {
    group,
    waterMesh,
    dispose: () => {
      geo.dispose();
      terrainMat.dispose();
      waterGeo.dispose();
      waterMat.dispose();
      woodMat.dispose();
      braceMat.dispose();
      stripeMat.dispose();
      rampGeos.forEach((g) => g.dispose());
    },
  };
}
