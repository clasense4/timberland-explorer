import * as THREE from 'three';
import type { BridgeSpec, RampSpec } from './types';
import type { ProceduralTextureSet } from './textures';

export const WORLD_RADIUS = 195;
export const TERRAIN_SIZE = 540;
export const WATER_LEVEL = -0.45;

export const RAMPS: RampSpec[] = [
  { x: 18, z: -26, yaw: 0.28, width: 7.5, length: 13, height: 2.8 },
  { x: 56, z: -56, yaw: -0.7, width: 8.5, length: 14, height: 3.3 },
  { x: 74, z: -38, yaw: 2.3, width: 8.0, length: 13, height: 3.0 },
  { x: -34, z: 38, yaw: 1.05, width: 7.5, length: 13, height: 2.6 },
  { x: -82, z: -18, yaw: -0.4, width: 8.0, length: 14, height: 3.1 },
  { x: 12, z: 76, yaw: 1.7, width: 8.0, length: 13, height: 2.9 },
];

export const BRIDGES: BridgeSpec[] = [
  { x: -8, z: -48, yaw: 0.15, width: 8.5, length: 24, deckHeight: 0.85 },
  { x: 68, z: 22, yaw: -0.82, width: 8.5, length: 24, deckHeight: 0.85 },
];

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Computes the meandering alpine creek centerline X for a given Z,
 * plus an east fork so the creek winds naturally across the valley.
 */
export function creekSignedDistance(x: number, z: number): number {
  const curveZ = -48 + Math.sin(x * 0.022) * 18 + Math.cos(x * 0.045) * 6;
  const dMain = Math.abs(z - curveZ);
  // Pond expansion near x = 28, z = -34
  const pondDist = Math.hypot(x - 32, z + 38) - 14;
  return Math.min(dMain, pondDist + 8);
}

/**
 * Returns 0..1 indicating proximity to the main scenic dirt exploration loop.
 */
export function trailFactorAt(x: number, z: number): number {
  const rx = x / 76;
  const rz = z / 68;
  const angle = Math.atan2(rz, rx);
  const targetR = 1.0 + 0.14 * Math.sin(angle * 3.0 + 0.4);
  const r = Math.hypot(rx, rz);
  const distToLoop = Math.abs(r - targetR) * 72;

  // Plus a central meadow connector through spawn (0, 0)
  const distToCenterRoad = Math.abs(x * 0.85 + z * 0.52) < 90 ? Math.abs(x * 0.52 - z * 0.85) : 999;
  const d = Math.min(distToLoop, distToCenterRoad);
  return 1 - smoothstep(3.2, 8.8, d);
}

/**
 * Pure analytical terrain heightfield (no ramps/bridges).
 * Used for rendering terrain mesh and checking ground base elevation.
 */
export function groundHeightAt(x: number, z: number): number {
  // Spawn clearing is gently level
  const spawnDist = Math.hypot(x, z);
  const spawnFlatten = smoothstep(10, 34, spawnDist);

  // Rolling forest hills
  const rolling =
    Math.sin(x * 0.028) * Math.cos(z * 0.024) * 3.4 +
    Math.sin(x * 0.062 + 1.1) * Math.sin(z * 0.055) * 1.35 +
    Math.cos((x + z) * 0.015) * 2.2;

  // Scenic Lookout Hill in the northwest quadrant
  const hillDist = Math.hypot(x + 76, z + 76);
  const lookoutHill = Math.max(0, 1 - smoothstep(10, 56, hillDist)) * 13.5;

  // Pine Ridge in the southeast
  const ridgeDist = Math.hypot(x - 96, z - 86);
  const pineRidge = Math.max(0, 1 - smoothstep(12, 62, ridgeDist)) * 11.0;

  // Southern Sunny Knoll
  const knollDist = Math.hypot(x + 28, z - 92);
  const sunnyKnoll = Math.max(0, 1 - smoothstep(8, 46, knollDist)) * 7.5;

  // Natural mountain perimeter surrounding the open valley
  const r = Math.hypot(x, z);
  const rimT = smoothstep(145, 255, r);
  const mountainNoise =
    0.72 +
    0.28 * Math.sin(Math.atan2(z, x) * 7.0 + 0.5) +
    0.16 * Math.cos(Math.atan2(z, x) * 13.0);
  const mountainRim = rimT * rimT * 46 * mountainNoise;

  let h = rolling * spawnFlatten + lookoutHill + pineRidge + sunnyKnoll + mountainRim;

  // Carve gentle creek bed & alpine pond
  const creekD = creekSignedDistance(x, z);
  const creekCarve = 1 - smoothstep(5.5, 15.0, creekD);
  if (creekCarve > 0) {
    const targetBed = -1.15;
    h = THREE.MathUtils.lerp(h, Math.min(h, targetBed), creekCarve);
  }

  return h;
}

/**
 * Evaluates full drivable surface height including wooden stunt ramps and creek bridges.
 */
export function surfaceHeightAt(x: number, z: number): number {
  let h = groundHeightAt(x, z);

  // Check wooden ramps
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
      // lz goes from -halfL (entry) to +halfL (lip)
      const t = (lz + halfL) / ramp.length;
      const baseH = groundHeightAt(ramp.x, ramp.z);
      const rampSurface = baseH + Math.pow(t, 1.18) * ramp.height;
      if (rampSurface > h) {
        h = rampSurface;
      }
    }
  }

  // Check wooden log bridges
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
      // Arched bridge deck
      const normZ = lz / halfL; // -1 to +1
      const arch = (1 - normZ * normZ) * 1.15;
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
  if (Math.hypot(x + 76, z + 76) < 42) return 'Lookout Peak';
  if (Math.hypot(x - 62, z + 48) < 40) return 'Jump Meadow';
  if (Math.hypot(x - 96, z - 86) < 46) return 'Whispering Pines';
  if (Math.hypot(x, z) < 28) return 'Sunny Clearing';
  if (Math.hypot(x, z) > 148) return 'Alpine Foothills';
  return 'Timberland Valley';
}

export function createTerrainAndWater(textures: ProceduralTextureSet): {
  group: THREE.Group;
  waterMesh: THREE.Mesh;
  dispose: () => void;
} {
  const group = new THREE.Group();

  // 1. Subdivided vertex-colored terrain mesh
  const segments = 210;
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

    // Determine surface biome color
    const trail = trailFactorAt(x, z);
    const creekD = creekSignedDistance(x, z);
    const r = Math.hypot(x, z);

    // Base meadow-to-pine noise
    const forestPatch = 0.5 + 0.5 * Math.sin(x * 0.045) * Math.cos(z * 0.045);
    tmpColor.copy(cMeadow).lerp(cPineFloor, forestPatch * 0.72);

    // Dirt trail blend
    if (trail > 0.02) {
      tmpColor.lerp(cDirtTrail, trail * 0.88);
    }

    // Creek bank sandy pebbles
    if (h < WATER_LEVEL + 0.65) {
      const bankT = 1 - smoothstep(WATER_LEVEL - 0.5, WATER_LEVEL + 0.65, h);
      tmpColor.lerp(cSand, bankT * 0.85);
    }

    // Rocky mountain slopes & snow peaks
    if (h > 9.5 || r > 158) {
      const rockT = smoothstep(9.5, 19.0, h);
      tmpColor.lerp(cRock, rockT * 0.9);
    }
    if (h > 22.0) {
      const snowT = smoothstep(22.0, 32.0, h);
      tmpColor.lerp(cSnow, snowT * 0.92);
    }

    // Subtle organic variation
    const micro = (Math.sin(x * 0.37) * Math.cos(z * 0.41)) * 0.035;
    colors[i * 3] = Math.min(1, Math.max(0, tmpColor.r + micro));
    colors[i * 3 + 1] = Math.min(1, Math.max(0, tmpColor.g + micro));
    colors[i * 3 + 2] = Math.min(1, Math.max(0, tmpColor.b + micro));

    // Keep creek bed slightly darker underwater
    if (creekD < 6 && h < WATER_LEVEL) {
      colors[i * 3] *= 0.82;
      colors[i * 3 + 1] *= 0.86;
      colors[i * 3 + 2] *= 0.88;
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: textures.terrainDetailMap,
    roughness: 0.92,
    metalness: 0.02,
  });

  const terrainMesh = new THREE.Mesh(geo, terrainMat);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  // 2. Shimmering alpine creek water surface
  const waterGeo = new THREE.PlaneGeometry(360, 170, 48, 24);
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
  waterMesh.position.set(15, WATER_LEVEL, -46);
  waterMesh.receiveShadow = true;
  group.add(waterMesh);

  // 3. Build wooden stunt ramps
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

    // Wedge profile extruded across ramp width
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

    // Side safety rails & yellow chevron lip strip
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

  // 4. Build arched wooden log bridges across the creek
  BRIDGES.forEach((br) => {
    const bGroup = new THREE.Group();
    bGroup.position.set(br.x, 0, br.z);
    bGroup.rotation.y = br.yaw;

    const plankCount = 18;
    const plankLen = br.length / plankCount;
    const plankGeo = new THREE.BoxGeometry(br.width, 0.32, plankLen * 0.88);
    rampGeos.push(plankGeo);

    for (let i = 0; i < plankCount; i++) {
      const lz = -br.length * 0.5 + (i + 0.5) * plankLen;
      const normZ = lz / (br.length * 0.5);
      const arch = (1 - normZ * normZ) * 1.15;
      const plank = new THREE.Mesh(plankGeo, woodMat);
      plank.position.set(0, br.deckHeight + arch - 0.16, lz);
      plank.castShadow = true;
      plank.receiveShadow = true;
      bGroup.add(plank);
    }

    // Bridge side guard beams + posts
    const postGeo = new THREE.CylinderGeometry(0.2, 0.22, 2.2, 8);
    rampGeos.push(postGeo);
    [-br.width * 0.48, br.width * 0.48].forEach((sx) => {
      for (let p = -2; p <= 2; p++) {
        const pz = p * (br.length * 0.22);
        const normZ = pz / (br.length * 0.5);
        const arch = (1 - normZ * normZ) * 1.15;
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
