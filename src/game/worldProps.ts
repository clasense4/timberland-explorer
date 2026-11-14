import * as THREE from 'three';
import {
  BRIDGES,
  RAMPS,
  WATER_LEVEL,
  creekSignedDistance,
  groundHeightAt,
  trailFactorAt,
} from './terrain';
import type { ProceduralTextureSet } from './textures';
import type { ObstacleCircle } from './types';

export interface CollectibleStar {
  id: number;
  group: THREE.Group;
  x: number;
  y: number;
  z: number;
  collected: boolean;
}

export interface WorldPropsRig {
  group: THREE.Group;
  obstacles: ObstacleCircle[];
  stars: CollectibleStar[];
  update: (elapsed: number, dt: number, isStarlight: boolean) => void;
  dispose: () => void;
}

// Deterministic seeded PRNG so the forest layout is consistently lush & well-placed
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isNearFeature(x: number, z: number): boolean {
  // Keep spawn clearing wide open
  if (Math.hypot(x, z) < 22) return true;
  // Keep lookout cabin clearing open
  if (Math.hypot(x + 76, z + 76) < 16) return true;
  // Keep trails clear
  if (trailFactorAt(x, z) > 0.25) return true;
  // Keep ramps clear
  for (const r of RAMPS) {
    if (Math.hypot(x - r.x, z - r.z) < 14) return true;
  }
  // Keep bridges clear
  for (const b of BRIDGES) {
    if (Math.hypot(x - b.x, z - b.z) < 18) return true;
  }
  return false;
}

export function createWorldProps(textures: ProceduralTextureSet): WorldPropsRig {
  const group = new THREE.Group();
  const obstacles: ObstacleCircle[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const rand = mulberry32(20261114);

  // =========================================================================
  // 1. Multi-Tier Pine Trees (InstancedMesh: Trunk + 3 Foliage Cones)
  // =========================================================================
  const PINE_COUNT = 380;
  const pineTrunkGeo = trackGeo(new THREE.CylinderGeometry(0.32, 0.52, 4.2, 7));
  pineTrunkGeo.translate(0, 2.1, 0);

  const pineTier1Geo = trackGeo(new THREE.ConeGeometry(2.6, 4.4, 8));
  pineTier1Geo.translate(0, 4.6, 0);

  const pineTier2Geo = trackGeo(new THREE.ConeGeometry(2.1, 3.8, 8));
  pineTier2Geo.translate(0, 6.8, 0);

  const pineTier3Geo = trackGeo(new THREE.ConeGeometry(1.45, 3.2, 8));
  pineTier3Geo.translate(0, 8.8, 0);

  const trunkMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.barkMap,
      color: 0x7a563c,
      roughness: 0.94,
      metalness: 0.02,
    })
  );

  const foliageMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0.02,
    })
  );

  const pineTrunks = new THREE.InstancedMesh(pineTrunkGeo, trunkMat, PINE_COUNT);
  const pineT1 = new THREE.InstancedMesh(pineTier1Geo, foliageMat, PINE_COUNT);
  const pineT2 = new THREE.InstancedMesh(pineTier2Geo, foliageMat, PINE_COUNT);
  const pineT3 = new THREE.InstancedMesh(pineTier3Geo, foliageMat, PINE_COUNT);

  [pineTrunks, pineT1, pineT2, pineT3].forEach((m) => {
    m.castShadow = true;
    m.receiveShadow = true;
  });

  const dummy = new THREE.Object3D();
  const colorTmp = new THREE.Color();
  let placedPines = 0;
  let attempts = 0;

  while (placedPines < PINE_COUNT && attempts < 4000) {
    attempts++;
    const angle = rand() * Math.PI * 2;
    const dist = 24 + Math.sqrt(rand()) * 170;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    if (isNearFeature(x, z)) continue;
    if (creekSignedDistance(x, z) < 11) continue;
    const y = groundHeightAt(x, z);
    if (y < WATER_LEVEL + 0.5 || y > 24) continue;

    const scale = 0.78 + rand() * 0.62; // +-15%+ organic scale variety
    dummy.position.set(x, y - 0.15, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(scale, scale * (0.9 + rand() * 0.25), scale);
    dummy.updateMatrix();

    pineTrunks.setMatrixAt(placedPines, dummy.matrix);
    pineT1.setMatrixAt(placedPines, dummy.matrix);
    pineT2.setMatrixAt(placedPines, dummy.matrix);
    pineT3.setMatrixAt(placedPines, dummy.matrix);

    // Rich forest spruce-to-pine hue shift
    const g = 0.36 + rand() * 0.16;
    colorTmp.setRGB(0.11 + rand() * 0.06, g, 0.16 + rand() * 0.08);
    pineT1.setColorAt(placedPines, colorTmp);
    colorTmp.offsetHSL(0, 0.02, 0.03);
    pineT2.setColorAt(placedPines, colorTmp);
    colorTmp.offsetHSL(0, 0.02, 0.04);
    pineT3.setColorAt(placedPines, colorTmp);

    // Gentle tree-trunk push radius (soft deflection, never traps truck)
    if (dist < 165) {
      obstacles.push({ x, z, radius: 1.05 * scale });
    }
    placedPines++;
  }

  [pineTrunks, pineT1, pineT2, pineT3].forEach((m) => {
    m.count = placedPines;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    group.add(m);
  });

  // =========================================================================
  // 2. Meadow Birch / Aspen Trees along Creek Banks & Clearings
  // =========================================================================
  const BIRCH_COUNT = 75;
  const birchTrunkGeo = trackGeo(new THREE.CylinderGeometry(0.22, 0.34, 4.8, 7));
  birchTrunkGeo.translate(0, 2.4, 0);
  const birchCrownGeo = trackGeo(new THREE.IcosahedronGeometry(2.3, 1));
  birchCrownGeo.translate(0, 5.4, 0);

  const birchTrunkMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe6e2d8,
      roughness: 0.85,
      metalness: 0.02,
    })
  );

  const birchTrunks = new THREE.InstancedMesh(birchTrunkGeo, birchTrunkMat, BIRCH_COUNT);
  const birchCrowns = new THREE.InstancedMesh(birchCrownGeo, foliageMat, BIRCH_COUNT);
  birchTrunks.castShadow = true;
  birchCrowns.castShadow = true;
  birchCrowns.receiveShadow = true;

  let placedBirch = 0;
  attempts = 0;
  while (placedBirch < BIRCH_COUNT && attempts < 1800) {
    attempts++;
    const x = (rand() - 0.5) * 260;
    const z = (rand() - 0.5) * 240;
    if (isNearFeature(x, z)) continue;
    const creekD = creekSignedDistance(x, z);
    if (creekD < 9 || creekD > 38) continue;
    const y = groundHeightAt(x, z);
    if (y < WATER_LEVEL + 0.5) continue;

    const scale = 0.82 + rand() * 0.4;
    dummy.position.set(x, y - 0.1, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();

    birchTrunks.setMatrixAt(placedBirch, dummy.matrix);
    birchCrowns.setMatrixAt(placedBirch, dummy.matrix);

    // Warm sunlit spring/autumn aspen greens and golds
    if (rand() > 0.3) {
      colorTmp.setRGB(0.36 + rand() * 0.12, 0.62 + rand() * 0.14, 0.22);
    } else {
      colorTmp.setRGB(0.76 + rand() * 0.12, 0.58 + rand() * 0.12, 0.18);
    }
    birchCrowns.setColorAt(placedBirch, colorTmp);
    obstacles.push({ x, z, radius: 0.9 * scale });
    placedBirch++;
  }

  [birchTrunks, birchCrowns].forEach((m) => {
    m.count = placedBirch;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    group.add(m);
  });

  // =========================================================================
  // 3. Mossy Granite Boulders (InstancedMesh)
  // =========================================================================
  const ROCK_COUNT = 120;
  const rockGeo = trackGeo(new THREE.DodecahedronGeometry(1.4, 0));
  const rockMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0.06,
      flatShading: true,
    })
  );
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_COUNT);
  rocks.castShadow = true;
  rocks.receiveShadow = true;

  let placedRocks = 0;
  attempts = 0;
  while (placedRocks < ROCK_COUNT && attempts < 1800) {
    attempts++;
    const angle = rand() * Math.PI * 2;
    const dist = 26 + rand() * 160;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    if (isNearFeature(x, z)) continue;

    const y = groundHeightAt(x, z);
    const s = 0.65 + rand() * 1.15;
    dummy.position.set(x, y + s * 0.32, z);
    dummy.rotation.set(rand() * 1.2, rand() * Math.PI * 2, rand() * 1.2);
    dummy.scale.set(s * (0.9 + rand() * 0.4), s * (0.6 + rand() * 0.35), s * (0.9 + rand() * 0.4));
    dummy.updateMatrix();
    rocks.setMatrixAt(placedRocks, dummy.matrix);

    const shade = 0.42 + rand() * 0.22;
    colorTmp.setRGB(shade, shade + (rand() > 0.5 ? 0.04 : 0), shade * 0.96);
    rocks.setColorAt(placedRocks, colorTmp);

    if (s > 1.05 && y > WATER_LEVEL) {
      obstacles.push({ x, z, radius: s * 1.15 });
    }
    placedRocks++;
  }
  rocks.count = placedRocks;
  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  rocks.computeBoundingSphere();
  group.add(rocks);

  // =========================================================================
  // 4. Scenic Ranger Lookout Cabin on Lookout Peak (-76, -76)
  // =========================================================================
  const cabinGroup = new THREE.Group();
  const cabinX = -76;
  const cabinZ = -76;
  const cabinY = groundHeightAt(cabinX, cabinZ);
  cabinGroup.position.set(cabinX, cabinY, cabinZ);
  cabinGroup.rotation.y = 0.72;

  const cabinWoodMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.woodPlankMap,
      color: 0xb67b4b,
      roughness: 0.82,
    })
  );
  const roofMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3b4d3e,
      roughness: 0.76,
    })
  );
  const stoneMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x70757a,
      roughness: 0.9,
      flatShading: true,
    })
  );
  const lanternMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffd166,
      emissive: 0xff9f1c,
      emissiveIntensity: 1.5,
      roughness: 0.25,
    })
  );

  const deckGeo = trackGeo(new THREE.BoxGeometry(9.6, 0.55, 8.8));
  const deck = new THREE.Mesh(deckGeo, cabinWoodMat);
  deck.position.set(0, 0.27, 0);
  deck.castShadow = true;
  deck.receiveShadow = true;
  cabinGroup.add(deck);

  const wallGeo = trackGeo(new THREE.BoxGeometry(7.2, 4.2, 5.8));
  const walls = new THREE.Mesh(wallGeo, cabinWoodMat);
  walls.position.set(0, 2.6, -0.5);
  walls.castShadow = true;
  walls.receiveShadow = true;
  cabinGroup.add(walls);

  const roofGeo = trackGeo(new THREE.ConeGeometry(6.4, 3.2, 4));
  roofGeo.rotateY(Math.PI / 4);
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(0, 6.2, -0.4);
  roof.castShadow = true;
  cabinGroup.add(roof);

  const chimneyGeo = trackGeo(new THREE.BoxGeometry(1.0, 2.8, 1.0));
  const chimney = new THREE.Mesh(chimneyGeo, stoneMat);
  chimney.position.set(2.1, 6.1, -1.3);
  chimney.castShadow = true;
  cabinGroup.add(chimney);

  const lanternGeo = trackGeo(new THREE.SphereGeometry(0.32, 10, 10));
  const lantern = new THREE.Mesh(lanternGeo, lanternMat);
  lantern.position.set(2.2, 3.2, 2.65);
  cabinGroup.add(lantern);

  const cabinWindowGeo = trackGeo(new THREE.BoxGeometry(1.6, 1.3, 0.16));
  const cabinWin = new THREE.Mesh(cabinWindowGeo, lanternMat);
  cabinWin.position.set(-1.5, 2.7, 2.42);
  cabinGroup.add(cabinWin);

  obstacles.push({ x: cabinX, z: cabinZ, radius: 5.5 });
  group.add(cabinGroup);

  // =========================================================================
  // 5. 12 Collectible Golden Pine Stars for Joyful Open-World Discovery
  // =========================================================================
  const starPositions: [number, number][] = [
    [0, -24],        // Down the first trail
    [18, -24],       // Above Ramp 1!
    [-8, -48],       // Center of West Log Bridge
    [32, -38],       // Crystal Creek Pond splash spot
    [56, -56],       // Jump Meadow ramp
    [68, 22],        // East Log Bridge
    [-76, -64],      // Lookout Peak cabin porch
    [96, 86],        // Whispering Pines ridge
    [-34, 38],       // Southwest meadow ramp
    [12, 76],        // Southern ramp
    [-82, -18],      // Western trail ramp
    [-28, 92],       // Sunny Knoll summit
  ];

  const starGeo = trackGeo(new THREE.OctahedronGeometry(1.15, 0));
  const haloGeo = trackGeo(new THREE.TorusGeometry(1.65, 0.08, 8, 28));
  const starMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.75,
      roughness: 0.18,
      metalness: 0.85,
    })
  );
  const haloMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.6,
    })
  );

  const stars: CollectibleStar[] = starPositions.map(([sx, sz], idx) => {
    const sy = Math.max(groundHeightAt(sx, sz), WATER_LEVEL + 0.5) + 2.3;
    const sGroup = new THREE.Group();
    sGroup.position.set(sx, sy, sz);

    const gem = new THREE.Mesh(starGeo, starMat);
    gem.castShadow = true;
    sGroup.add(gem);

    const halo = new THREE.Mesh(haloGeo, haloMat);
    sGroup.add(halo);

    group.add(sGroup);
    return { id: idx, group: sGroup, x: sx, y: sy, z: sz, collected: false };
  });

  // =========================================================================
  // 6. Floating Forest Fireflies / Sunbeams (Points)
  // =========================================================================
  const moteCount = 160;
  const moteGeo = trackGeo(new THREE.BufferGeometry());
  const motePos = new Float32Array(moteCount * 3);
  const motePhase = new Float32Array(moteCount);
  for (let i = 0; i < moteCount; i++) {
    const mx = (rand() - 0.5) * 240;
    const mz = (rand() - 0.5) * 240;
    const my = groundHeightAt(mx, mz) + 1.2 + rand() * 5.5;
    motePos[i * 3] = mx;
    motePos[i * 3 + 1] = my;
    motePos[i * 3 + 2] = mz;
    motePhase[i] = rand() * Math.PI * 2;
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = trackMat(
    new THREE.PointsMaterial({
      color: 0xfef08a,
      map: textures.particleMap,
      size: 0.65,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
  );
  const motes = new THREE.Points(moteGeo, moteMat);
  group.add(motes);

  return {
    group,
    obstacles,
    stars,
    update: (elapsed: number, dt: number, isStarlight: boolean) => {
      // Spin & bob stars
      for (let i = 0; i < stars.length; i++) {
        const st = stars[i];
        if (st.collected) continue;
        st.group.rotation.y += dt * 1.8;
        st.group.position.y = st.y + Math.sin(elapsed * 2.6 + st.id) * 0.35;
      }

      // Gentle firefly / sun-mote drift
      moteMat.opacity = isStarlight ? 0.92 : 0.42;
      moteMat.size = isStarlight ? 0.95 : 0.55;
      const posAttr = moteGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < moteCount; i++) {
        const py = posAttr.getY(i);
        posAttr.setY(i, py + Math.sin(elapsed * 1.6 + motePhase[i]) * dt * 0.35);
      }
      posAttr.needsUpdate = true;
    },
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
