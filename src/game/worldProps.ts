import * as THREE from 'three';
import {
  BRIDGES,
  RAMPS,
  WATER_LEVEL,
  WORLD_RADIUS,
  creekSignedDistance,
  groundHeightAt,
  surfaceHeightAt,
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
  randomizeStars: () => void;
  getRandomSafeSpot: (minRadius?: number, maxRadius?: number) => { x: number; y: number; z: number; yaw: number };
  update: (elapsed: number, dt: number, isStarlight: boolean) => void;
  dispose: () => void;
}

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
  if (Math.hypot(x, z) < 28) return true;
  if (Math.hypot(x + 150, z + 150) < 20) return true;
  if (trailFactorAt(x, z) > 0.25) return true;
  for (const r of RAMPS) {
    if (Math.hypot(x - r.x, z - r.z) < 16) return true;
  }
  for (const b of BRIDGES) {
    if (Math.hypot(x - b.x, z - b.z) < 22) return true;
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
  // 1. Multi-Tier Pine Trees across expanded valley
  // =========================================================================
  const PINE_COUNT = 820;
  const pineTrunkGeo = trackGeo(new THREE.CylinderGeometry(0.32, 0.54, 4.4, 7));
  pineTrunkGeo.translate(0, 2.2, 0);

  const pineTier1Geo = trackGeo(new THREE.ConeGeometry(2.7, 4.6, 8));
  pineTier1Geo.translate(0, 4.8, 0);

  const pineTier2Geo = trackGeo(new THREE.ConeGeometry(2.15, 4.0, 8));
  pineTier2Geo.translate(0, 7.1, 0);

  const pineTier3Geo = trackGeo(new THREE.ConeGeometry(1.5, 3.3, 8));
  pineTier3Geo.translate(0, 9.2, 0);

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

  while (placedPines < PINE_COUNT && attempts < 9000) {
    attempts++;
    const angle = rand() * Math.PI * 2;
    const dist = 30 + Math.sqrt(rand()) * 360;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    if (isNearFeature(x, z)) continue;
    if (creekSignedDistance(x, z) < 12) continue;
    const y = groundHeightAt(x, z);
    if (y < WATER_LEVEL + 0.5 || y > 30) continue;

    const scale = 0.8 + rand() * 0.68;
    dummy.position.set(x, y - 0.15, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(scale, scale * (0.9 + rand() * 0.25), scale);
    dummy.updateMatrix();

    pineTrunks.setMatrixAt(placedPines, dummy.matrix);
    pineT1.setMatrixAt(placedPines, dummy.matrix);
    pineT2.setMatrixAt(placedPines, dummy.matrix);
    pineT3.setMatrixAt(placedPines, dummy.matrix);

    const g = 0.28 + rand() * 0.15;
    colorTmp.setRGB(0.08 + rand() * 0.05, g, 0.12 + rand() * 0.06, THREE.SRGBColorSpace);
    pineT1.setColorAt(placedPines, colorTmp);
    colorTmp.offsetHSL(0, 0.02, 0.025);
    pineT2.setColorAt(placedPines, colorTmp);
    colorTmp.offsetHSL(0, 0.02, 0.03);
    pineT3.setColorAt(placedPines, colorTmp);

    if (dist < WORLD_RADIUS - 20) {
      obstacles.push({ x, z, radius: 1.0 * scale });
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
  const BIRCH_COUNT = 160;
  const birchTrunkGeo = trackGeo(new THREE.CylinderGeometry(0.22, 0.34, 4.8, 7));
  birchTrunkGeo.translate(0, 2.4, 0);
  const birchCrownGeo = trackGeo(new THREE.IcosahedronGeometry(2.35, 1));
  birchCrownGeo.translate(0, 5.5, 0);

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
  while (placedBirch < BIRCH_COUNT && attempts < 4000) {
    attempts++;
    const x = (rand() - 0.5) * 620;
    const z = (rand() - 0.5) * 580;
    if (isNearFeature(x, z)) continue;
    const creekD = creekSignedDistance(x, z);
    if (creekD < 10 || creekD > 62) continue;
    const y = groundHeightAt(x, z);
    if (y < WATER_LEVEL + 0.5) continue;

    const scale = 0.85 + rand() * 0.45;
    dummy.position.set(x, y - 0.1, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();

    birchTrunks.setMatrixAt(placedBirch, dummy.matrix);
    birchCrowns.setMatrixAt(placedBirch, dummy.matrix);

    if (rand() > 0.3) {
      colorTmp.setRGB(0.24 + rand() * 0.1, 0.48 + rand() * 0.14, 0.14, THREE.SRGBColorSpace);
    } else {
      colorTmp.setRGB(0.72 + rand() * 0.14, 0.48 + rand() * 0.12, 0.12, THREE.SRGBColorSpace);
    }
    birchCrowns.setColorAt(placedBirch, colorTmp);
    obstacles.push({ x, z, radius: 0.85 * scale });
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
  // 3. Mossy Granite Boulders
  // =========================================================================
  const ROCK_COUNT = 260;
  const rockGeo = trackGeo(new THREE.DodecahedronGeometry(1.45, 0));
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
  while (placedRocks < ROCK_COUNT && attempts < 4000) {
    attempts++;
    const angle = rand() * Math.PI * 2;
    const dist = 34 + rand() * 340;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    if (isNearFeature(x, z)) continue;

    const y = groundHeightAt(x, z);
    const s = 0.7 + rand() * 1.3;
    dummy.position.set(x, y + s * 0.32, z);
    dummy.rotation.set(rand() * 1.2, rand() * Math.PI * 2, rand() * 1.2);
    dummy.scale.set(
      s * (0.9 + rand() * 0.4),
      s * (0.6 + rand() * 0.35),
      s * (0.9 + rand() * 0.4)
    );
    dummy.updateMatrix();
    rocks.setMatrixAt(placedRocks, dummy.matrix);

    const shade = 0.32 + rand() * 0.18;
    colorTmp.setRGB(shade, shade + (rand() > 0.5 ? 0.03 : 0), shade * 0.95, THREE.SRGBColorSpace);
    rocks.setColorAt(placedRocks, colorTmp);

    if (s > 1.1 && y > WATER_LEVEL) {
      obstacles.push({ x, z, radius: s * 1.1 });
    }
    placedRocks++;
  }
  rocks.count = placedRocks;
  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  rocks.computeBoundingSphere();
  group.add(rocks);

  // =========================================================================
  // 4. Scenic Ranger Lookout Cabin on Lookout Peak (-150, -150)
  // =========================================================================
  const cabinGroup = new THREE.Group();
  const cabinX = -150;
  const cabinZ = -150;
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
  // 5. Helper to pick clean random locations anywhere in the valley
  // =========================================================================
  const getRandomSafeSpot = (
    minRadius = 24,
    maxRadius = WORLD_RADIUS - 55
  ): { x: number; y: number; z: number; yaw: number } => {
    for (let tries = 0; tries < 200; tries++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = minRadius + Math.sqrt(Math.random()) * (maxRadius - minRadius);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      // Avoid deep water & steep high rocks
      const gh = groundHeightAt(x, z);
      if (gh < WATER_LEVEL + 0.35 || gh > 22) continue;

      let blocked = false;
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        if (Math.hypot(x - o.x, z - o.z) < o.radius + 3.2) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        return {
          x,
          y: surfaceHeightAt(x, z),
          z,
          yaw: Math.random() * Math.PI * 2,
        };
      }
    }
    return { x: 0, y: surfaceHeightAt(0, 8), z: 8, yaw: 0 };
  };

  // =========================================================================
  // 6. 12 Collectible Golden Pine Stars (Randomized on Start & Reset!)
  // =========================================================================
  const STAR_COUNT = 12;
  const starGeo = trackGeo(new THREE.OctahedronGeometry(1.2, 0));
  const haloGeo = trackGeo(new THREE.TorusGeometry(1.75, 0.08, 8, 28));
  const starMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.78,
      roughness: 0.18,
      metalness: 0.85,
    })
  );
  const haloMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.65,
    })
  );

  const stars: CollectibleStar[] = Array.from({ length: STAR_COUNT }, (_, idx) => {
    const sGroup = new THREE.Group();
    const gem = new THREE.Mesh(starGeo, starMat);
    gem.castShadow = true;
    sGroup.add(gem);

    const halo = new THREE.Mesh(haloGeo, haloMat);
    sGroup.add(halo);

    group.add(sGroup);
    return { id: idx, group: sGroup, x: 0, y: 2, z: 0, collected: false };
  });

  const randomizeStars = (): void => {
    const placed: { x: number; z: number }[] = [];
    for (let i = 0; i < stars.length; i++) {
      let chosen = getRandomSafeSpot(18, WORLD_RADIUS - 48);
      // Ensure stars are nicely spread out across the forest
      for (let spreadAttempt = 0; spreadAttempt < 25; spreadAttempt++) {
        const tooClose = placed.some((p) => Math.hypot(p.x - chosen.x, p.z - chosen.z) < 48);
        if (!tooClose) break;
        chosen = getRandomSafeSpot(18, WORLD_RADIUS - 48);
      }
      placed.push({ x: chosen.x, z: chosen.z });

      const sy = chosen.y + 2.1;
      const st = stars[i];
      st.x = chosen.x;
      st.y = sy;
      st.z = chosen.z;
      st.collected = false;
      st.group.position.set(st.x, st.y, st.z);
      st.group.visible = true;
    }
  };

  randomizeStars();

  // =========================================================================
  // 7. Floating Forest Fireflies / Sunbeams (Points)
  // =========================================================================
  const moteCount = 260;
  const moteGeo = trackGeo(new THREE.BufferGeometry());
  const motePos = new Float32Array(moteCount * 3);
  const motePhase = new Float32Array(moteCount);
  for (let i = 0; i < moteCount; i++) {
    const mx = (rand() - 0.5) * 560;
    const mz = (rand() - 0.5) * 560;
    const my = groundHeightAt(mx, mz) + 1.2 + rand() * 6.5;
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
      size: 0.72,
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
    randomizeStars,
    getRandomSafeSpot,
    update: (elapsed: number, dt: number, isStarlight: boolean) => {
      for (let i = 0; i < stars.length; i++) {
        const st = stars[i];
        if (st.collected) continue;
        st.group.rotation.y += dt * 1.8;
        st.group.position.y = st.y + Math.sin(elapsed * 2.6 + st.id) * 0.35;
      }

      moteMat.opacity = isStarlight ? 0.92 : 0.42;
      moteMat.size = isStarlight ? 1.05 : 0.6;
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
