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
  beacon: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  collected: boolean;
}

export type SmashableKind = 'crate' | 'hay' | 'cone';

export interface SmashableProp {
  id: number;
  kind: SmashableKind;
  group: THREE.Group;
  homeX: number;
  homeY: number;
  homeZ: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rotVx: number;
  rotVy: number;
  rotVz: number;
  radius: number;
  smashed: boolean;
  respawnTimer: number;
  popScale: number;
}

export type AnimalKind = 'deer' | 'fox' | 'duck';

export interface ForestAnimal {
  id: number;
  kind: AnimalKind;
  group: THREE.Group;
  homeX: number;
  homeZ: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  phase: number;
  hopVelY: number;
  hopOffset: number;
  excitedTimer: number;
  fleeVx: number;
  fleeVz: number;
  soundCooldown: number;
}

export interface WorldPropsRig {
  group: THREE.Group;
  obstacles: ObstacleCircle[];
  stars: CollectibleStar[];
  smashables: SmashableProp[];
  animals: ForestAnimal[];
  smashProp: (prop: SmashableProp, impactVx: number, impactVz: number) => void;
  reactAnimalsToTruck: (tx: number, tz: number, isHonking: boolean) => AnimalKind | null;
  randomizeStars: () => void;
  getRandomSafeSpot: (minRadius?: number, maxRadius?: number) => { x: number; y: number; z: number; yaw: number };
  update: (elapsed: number, dt: number, isStarlight: boolean, helperMode: boolean) => void;
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

    // Register obstacle collision for every pine tree so none are passable
    obstacles.push({ x, z, radius: Math.max(0.85, 1.05 * scale) });
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
    const scaleX = s * (0.9 + rand() * 0.4);
    const scaleY = s * (0.6 + rand() * 0.35);
    const scaleZ = s * (0.9 + rand() * 0.4);
    dummy.position.set(x, y + s * 0.32, z);
    dummy.rotation.set(rand() * 1.2, rand() * Math.PI * 2, rand() * 1.2);
    dummy.scale.set(scaleX, scaleY, scaleZ);
    dummy.updateMatrix();
    rocks.setMatrixAt(placedRocks, dummy.matrix);

    const shade = 0.32 + rand() * 0.18;
    colorTmp.setRGB(shade, shade + (rand() > 0.5 ? 0.03 : 0), shade * 0.95, THREE.SRGBColorSpace);
    rocks.setColorAt(placedRocks, colorTmp);

    // Register solid collision for EVERY boulder regardless of size or shoreline
    obstacles.push({ x, z, radius: Math.max(0.95, 1.38 * Math.max(scaleX, scaleZ)) });
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

  const beaconGeo = trackGeo(new THREE.CylinderGeometry(0.42, 1.18, 64, 12, 1, true));
  beaconGeo.translate(0, 32, 0);
  const beaconMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.44,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );

  const stars: CollectibleStar[] = Array.from({ length: STAR_COUNT }, (_, idx) => {
    const sGroup = new THREE.Group();
    const gem = new THREE.Mesh(starGeo, starMat);
    gem.castShadow = true;
    sGroup.add(gem);

    const halo = new THREE.Mesh(haloGeo, haloMat);
    sGroup.add(halo);

    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.visible = false;
    sGroup.add(beacon);

    group.add(sGroup);
    return { id: idx, group: sGroup, beacon, x: 0, y: 2, z: 0, collected: false };
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

  // =========================================================================
  // 8. Crushable / Smashable Props (Crates, Hay Bales, Traffic Cones)
  // =========================================================================
  const smashables: SmashableProp[] = [];
  const crateMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.woodPlankMap,
      color: 0xe3a857,
      roughness: 0.78,
      metalness: 0.04,
    })
  );
  const crateTrimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x8b5a2b,
      roughness: 0.85,
    })
  );
  const hayMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xeab308,
      roughness: 0.92,
      metalness: 0.02,
    })
  );
  const twineMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x92400e,
      roughness: 0.85,
    })
  );
  const coneMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xf97316,
      roughness: 0.45,
      metalness: 0.05,
    })
  );
  const coneStripeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.32,
      emissive: 0xffffff,
      emissiveIntensity: 0.12,
    })
  );
  const coneBaseMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      roughness: 0.85,
    })
  );

  const crateBoxGeo = trackGeo(new THREE.BoxGeometry(1.15, 1.15, 1.15));
  crateBoxGeo.translate(0, 0.575, 0);
  const crateBraceGeo = trackGeo(new THREE.BoxGeometry(1.22, 0.16, 1.22));

  const hayCylGeo = trackGeo(new THREE.CylinderGeometry(0.68, 0.68, 1.15, 12));
  hayCylGeo.rotateZ(Math.PI / 2);
  hayCylGeo.translate(0, 0.68, 0);
  const hayBandGeo = trackGeo(new THREE.TorusGeometry(0.69, 0.045, 6, 16));
  hayBandGeo.rotateY(Math.PI / 2);
  hayBandGeo.translate(0, 0.68, 0);

  const coneBaseGeo = trackGeo(new THREE.BoxGeometry(0.92, 0.12, 0.92));
  coneBaseGeo.translate(0, 0.06, 0);
  const coneBodyGeo = trackGeo(new THREE.ConeGeometry(0.36, 1.15, 12));
  coneBodyGeo.translate(0, 0.66, 0);
  const coneBandGeo = trackGeo(new THREE.CylinderGeometry(0.2, 0.27, 0.24, 12));
  coneBandGeo.translate(0, 0.68, 0);

  const buildSmashableMesh = (kind: SmashableKind): THREE.Group => {
    const g = new THREE.Group();
    if (kind === 'crate') {
      const box = new THREE.Mesh(crateBoxGeo, crateMat);
      box.castShadow = true;
      box.receiveShadow = true;
      g.add(box);

      const topTrim = new THREE.Mesh(crateBraceGeo, crateTrimMat);
      topTrim.position.y = 1.07;
      g.add(topTrim);

      const botTrim = new THREE.Mesh(crateBraceGeo, crateTrimMat);
      botTrim.position.y = 0.08;
      g.add(botTrim);
    } else if (kind === 'hay') {
      const bale = new THREE.Mesh(hayCylGeo, hayMat);
      bale.castShadow = true;
      bale.receiveShadow = true;
      g.add(bale);

      [-0.3, 0.3].forEach((ox) => {
        const band = new THREE.Mesh(hayBandGeo, twineMat);
        band.position.x = ox;
        g.add(band);
      });
    } else {
      const base = new THREE.Mesh(coneBaseGeo, coneBaseMat);
      base.castShadow = true;
      g.add(base);

      const body = new THREE.Mesh(coneBodyGeo, coneMat);
      body.castShadow = true;
      g.add(body);

      const band = new THREE.Mesh(coneBandGeo, coneStripeMat);
      g.add(band);
    }
    return g;
  };

  // Curated playful starter clusters near spawn + along trails & ramps
  const smashSpots: { x: number; z: number; kind: SmashableKind }[] = [
    { x: -7, z: -6, kind: 'cone' },
    { x: -5, z: -8, kind: 'cone' },
    { x: -3, z: -10, kind: 'cone' },
    { x: 9, z: -8, kind: 'crate' },
    { x: 10.6, z: -8.3, kind: 'crate' },
    { x: 9.8, z: -9.8, kind: 'crate' },
    { x: -16, z: 10, kind: 'hay' },
    { x: -18, z: 11.4, kind: 'hay' },
    { x: 16, z: -20, kind: 'cone' },
    { x: 20, z: -22, kind: 'crate' },
  ];

  const kinds: SmashableKind[] = ['crate', 'hay', 'cone'];
  for (let i = 0; i < 22; i++) {
    for (let tries = 0; tries < 80; tries++) {
      const angle = rand() * Math.PI * 2;
      const dist = 24 + rand() * 260;
      const sx = Math.cos(angle) * dist;
      const sz = Math.sin(angle) * dist;
      if (creekSignedDistance(sx, sz) < 16) continue;
      const sy = groundHeightAt(sx, sz);
      if (sy < WATER_LEVEL + 0.5 || sy > 16) continue;
      const blocked = obstacles.some((o) => Math.hypot(sx - o.x, sz - o.z) < o.radius + 2.5);
      if (blocked) continue;
      smashSpots.push({ x: sx, z: sz, kind: kinds[i % kinds.length] });
      break;
    }
  }

  smashSpots.forEach((sp, idx) => {
    const sy = surfaceHeightAt(sp.x, sp.z);
    const propGroup = buildSmashableMesh(sp.kind);
    propGroup.position.set(sp.x, sy, sp.z);
    propGroup.rotation.y = rand() * Math.PI * 2;
    group.add(propGroup);
    smashables.push({
      id: idx,
      kind: sp.kind,
      group: propGroup,
      homeX: sp.x,
      homeY: sy,
      homeZ: sp.z,
      x: sp.x,
      y: sy,
      z: sp.z,
      vx: 0,
      vy: 0,
      vz: 0,
      rotVx: 0,
      rotVy: 0,
      rotVz: 0,
      radius: sp.kind === 'cone' ? 0.65 : 0.85,
      smashed: false,
      respawnTimer: 0,
      popScale: 1,
    });
  });

  const smashProp = (prop: SmashableProp, impactVx: number, impactVz: number): void => {
    if (prop.smashed) return;
    prop.smashed = true;
    prop.respawnTimer = 7.5;
    const speedMag = Math.max(6, Math.hypot(impactVx, impactVz));
    prop.vx = impactVx * 1.15 + (Math.random() - 0.5) * 6;
    prop.vy = Math.min(13, 5.5 + speedMag * 0.28);
    prop.vz = impactVz * 1.15 + (Math.random() - 0.5) * 6;
    prop.rotVx = (Math.random() - 0.5) * 14;
    prop.rotVy = (Math.random() - 0.5) * 14;
    prop.rotVz = (Math.random() - 0.5) * 14;
  };

  // =========================================================================
  // 9. Interactive Forest Animals (Deer, Foxes & Creek Ducks)
  // =========================================================================
  const animals: ForestAnimal[] = [];
  const deerBodyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xb97a4b, roughness: 0.85 }));
  const deerBellyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf1dec9, roughness: 0.88 }));
  const antlerMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x5c4028, roughness: 0.8 }));
  const foxFurMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xe26328, roughness: 0.82 }));
  const darkEyeMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.35 }));
  const duckBodyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65 }));
  const duckHeadMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.55 }));
  const duckBeakMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.45 }));

  const legGeo = trackGeo(new THREE.CylinderGeometry(0.06, 0.05, 0.72, 6));
  legGeo.translate(0, 0.36, 0);
  const deerTorsoGeo = trackGeo(new THREE.BoxGeometry(0.56, 0.52, 1.15));
  const deerNeckGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.18, 0.56, 7));
  const deerHeadGeo = trackGeo(new THREE.BoxGeometry(0.28, 0.28, 0.44));
  const earGeo = trackGeo(new THREE.ConeGeometry(0.08, 0.22, 5));
  const tailPupGeo = trackGeo(new THREE.SphereGeometry(0.14, 7, 7));

  const foxTorsoGeo = trackGeo(new THREE.BoxGeometry(0.42, 0.38, 0.84));
  const foxLegGeo = trackGeo(new THREE.CylinderGeometry(0.05, 0.04, 0.4, 6));
  foxLegGeo.translate(0, 0.2, 0);
  const foxHeadGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.28, 0.36));
  const foxTailGeo = trackGeo(new THREE.ConeGeometry(0.14, 0.62, 7));

  const duckBodyGeo = trackGeo(new THREE.SphereGeometry(0.34, 10, 8));
  duckBodyGeo.scale(0.88, 0.72, 1.28);
  const duckHeadGeo = trackGeo(new THREE.SphereGeometry(0.2, 9, 8));
  const duckBeakGeo = trackGeo(new THREE.BoxGeometry(0.12, 0.07, 0.22));
  const duckWingGeo = trackGeo(new THREE.BoxGeometry(0.08, 0.18, 0.42));

  const buildAnimalGroup = (kind: AnimalKind): THREE.Group => {
    const g = new THREE.Group();
    if (kind === 'deer') {
      const torso = new THREE.Mesh(deerTorsoGeo, deerBodyMat);
      torso.position.set(0, 0.9, 0);
      torso.castShadow = true;
      g.add(torso);

      [
        [-0.18, 0.42],
        [0.18, 0.42],
        [-0.18, -0.42],
        [0.18, -0.42],
      ].forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(legGeo, deerBodyMat);
        leg.position.set(lx, 0, lz);
        leg.castShadow = true;
        g.add(leg);
      });

      const neck = new THREE.Mesh(deerNeckGeo, deerBodyMat);
      neck.position.set(0, 1.32, -0.46);
      neck.rotation.x = 0.28;
      g.add(neck);

      const head = new THREE.Mesh(deerHeadGeo, deerBodyMat);
      head.position.set(0, 1.56, -0.62);
      head.castShadow = true;
      g.add(head);

      [-0.12, 0.12].forEach((ex) => {
        const ear = new THREE.Mesh(earGeo, deerBodyMat);
        ear.position.set(ex, 1.74, -0.5);
        ear.rotation.z = ex > 0 ? -0.45 : 0.45;
        g.add(ear);

        const ant = new THREE.Mesh(earGeo, antlerMat);
        ant.position.set(ex * 0.7, 1.82, -0.56);
        ant.scale.set(0.8, 1.35, 0.8);
        g.add(ant);
      });

      const tail = new THREE.Mesh(tailPupGeo, deerBellyMat);
      tail.position.set(0, 1.04, 0.62);
      g.add(tail);
    } else if (kind === 'fox') {
      const torso = new THREE.Mesh(foxTorsoGeo, foxFurMat);
      torso.position.set(0, 0.52, 0);
      torso.castShadow = true;
      g.add(torso);

      [
        [-0.13, 0.28],
        [0.13, 0.28],
        [-0.13, -0.28],
        [0.13, -0.28],
      ].forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(foxLegGeo, darkEyeMat);
        leg.position.set(lx, 0, lz);
        g.add(leg);
      });

      const head = new THREE.Mesh(foxHeadGeo, foxFurMat);
      head.position.set(0, 0.78, -0.45);
      head.castShadow = true;
      g.add(head);

      [-0.11, 0.11].forEach((ex) => {
        const ear = new THREE.Mesh(earGeo, foxFurMat);
        ear.position.set(ex, 0.98, -0.38);
        g.add(ear);
      });

      const tail = new THREE.Mesh(foxTailGeo, foxFurMat);
      tail.position.set(0, 0.62, 0.62);
      tail.rotation.x = -0.95;
      g.add(tail);

      const tailTip = new THREE.Mesh(tailPupGeo, deerBellyMat);
      tailTip.position.set(0, 0.78, 0.84);
      tailTip.scale.setScalar(0.85);
      g.add(tailTip);
    } else {
      const body = new THREE.Mesh(duckBodyGeo, duckBodyMat);
      body.position.set(0, 0.22, 0);
      body.castShadow = true;
      g.add(body);

      const head = new THREE.Mesh(duckHeadGeo, duckHeadMat);
      head.position.set(0, 0.54, -0.26);
      head.castShadow = true;
      g.add(head);

      const beak = new THREE.Mesh(duckBeakGeo, duckBeakMat);
      beak.position.set(0, 0.5, -0.46);
      g.add(beak);

      [-0.28, 0.28].forEach((wx) => {
        const wing = new THREE.Mesh(duckWingGeo, duckBodyMat);
        wing.position.set(wx, 0.26, 0.02);
        g.add(wing);
      });
    }
    return g;
  };

  // Place 6 Deer & 4 Foxes in forest meadows, plus 6 Ducks in the lakes & creek
  const landAnimalSpecs: { kind: AnimalKind; count: number }[] = [
    { kind: 'deer', count: 6 },
    { kind: 'fox', count: 4 },
  ];
  landAnimalSpecs.forEach(({ kind, count }) => {
    for (let i = 0; i < count; i++) {
      const spot = getRandomSafeSpot(22, WORLD_RADIUS - 70);
      const aGroup = buildAnimalGroup(kind);
      aGroup.position.set(spot.x, spot.y, spot.z);
      aGroup.rotation.y = spot.yaw;
      group.add(aGroup);
      animals.push({
        id: animals.length,
        kind,
        group: aGroup,
        homeX: spot.x,
        homeZ: spot.z,
        x: spot.x,
        y: spot.y,
        z: spot.z,
        yaw: spot.yaw,
        phase: rand() * Math.PI * 2,
        hopVelY: 0,
        hopOffset: 0,
        excitedTimer: 0,
        fleeVx: 0,
        fleeVz: 0,
        soundCooldown: 0,
      });
    }
  });

  const duckSpots = [
    { x: 60, z: -72 },
    { x: 68, z: -78 },
    { x: 56, z: -80 },
    { x: -142, z: -106 },
    { x: -149, z: -112 },
    { x: -8, z: -90 },
  ];
  duckSpots.forEach((ds) => {
    const aGroup = buildAnimalGroup('duck');
    const dy = WATER_LEVEL - 0.04;
    aGroup.position.set(ds.x, dy, ds.z);
    const yaw = rand() * Math.PI * 2;
    aGroup.rotation.y = yaw;
    group.add(aGroup);
    animals.push({
      id: animals.length,
      kind: 'duck',
      group: aGroup,
      homeX: ds.x,
      homeZ: ds.z,
      x: ds.x,
      y: dy,
      z: ds.z,
      yaw,
      phase: rand() * Math.PI * 2,
      hopVelY: 0,
      hopOffset: 0,
      excitedTimer: 0,
      fleeVx: 0,
      fleeVz: 0,
      soundCooldown: 0,
    });
  });

  const reactAnimalsToTruck = (tx: number, tz: number, isHonking: boolean): AnimalKind | null => {
    const triggerRadius = isHonking ? 34 : 14;
    let reactedKind: AnimalKind | null = null;
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i];
      const dx = a.x - tx;
      const dz = a.z - tz;
      const dist = Math.hypot(dx, dz);
      if (dist < triggerRadius && dist > 0.01) {
        if (isHonking || a.excitedTimer <= 0.1) {
          a.hopVelY = a.kind === 'duck' ? 3.2 : 4.8;
          a.excitedTimer = isHonking ? 2.6 : 1.8;
          const nx = dx / dist;
          const nz = dz / dist;
          const fleeSpeed = a.kind === 'duck' ? 2.5 : 5.2;
          a.fleeVx = nx * fleeSpeed;
          a.fleeVz = nz * fleeSpeed;
          a.yaw = Math.atan2(-nx, -nz);
        }
        if (a.soundCooldown <= 0) {
          a.soundCooldown = isHonking ? 1.1 : 3.2;
          reactedKind = a.kind;
        }
      }
    }
    return reactedKind;
  };

  return {
    group,
    obstacles,
    stars,
    smashables,
    animals,
    smashProp,
    reactAnimalsToTruck,
    randomizeStars,
    getRandomSafeSpot,
    update: (elapsed: number, dt: number, isStarlight: boolean, helperMode: boolean) => {
      for (let i = 0; i < stars.length; i++) {
        const st = stars[i];
        if (st.collected) {
          st.beacon.visible = false;
          continue;
        }
        st.group.rotation.y += dt * 1.8;
        st.group.position.y = st.y + Math.sin(elapsed * 2.6 + st.id) * 0.35;
        st.beacon.visible = helperMode;
      }
      if (helperMode) {
        beaconMat.opacity = 0.42 + Math.sin(elapsed * 3.8) * 0.1;
      }

      // Animate smashable props flying & respawning
      for (let i = 0; i < smashables.length; i++) {
        const p = smashables[i];
        if (p.smashed) {
          p.respawnTimer -= dt;
          p.vy -= 22.0 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.group.rotation.x += p.rotVx * dt;
          p.group.rotation.y += p.rotVy * dt;
          p.group.rotation.z += p.rotVz * dt;

          const floorY = surfaceHeightAt(p.x, p.z);
          if (p.y < floorY) {
            p.y = floorY;
            p.vy = Math.abs(p.vy) > 2.2 ? -p.vy * 0.38 : 0;
            p.vx *= 0.68;
            p.vz *= 0.68;
            p.rotVx *= 0.65;
            p.rotVz *= 0.65;
          }
          p.group.position.set(p.x, p.y, p.z);

          if (p.respawnTimer <= 0.4) {
            const shrink = Math.max(0.01, p.respawnTimer / 0.4);
            p.group.scale.setScalar(shrink);
          }
          if (p.respawnTimer <= 0) {
            p.smashed = false;
            p.x = p.homeX;
            p.y = p.homeY;
            p.z = p.homeZ;
            p.vx = 0;
            p.vy = 0;
            p.vz = 0;
            p.group.position.set(p.homeX, p.homeY, p.homeZ);
            p.group.rotation.set(0, p.id * 0.9, 0);
            p.popScale = 0.1;
          }
        } else if (p.popScale < 1) {
          p.popScale = Math.min(1, p.popScale + dt * 4.5);
          p.group.scale.setScalar(p.popScale);
        }
      }

      // Animate forest animals (idle grazing / paddling + playful hops)
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        if (a.soundCooldown > 0) a.soundCooldown -= dt;

        if (a.excitedTimer > 0) {
          a.excitedTimer -= dt;
          a.x += a.fleeVx * dt;
          a.z += a.fleeVz * dt;
          a.fleeVx *= Math.exp(-1.5 * dt);
          a.fleeVz *= Math.exp(-1.5 * dt);
        } else if (a.kind === 'duck') {
          const orbitAngle = elapsed * 0.42 + a.phase;
          a.x = a.homeX + Math.cos(orbitAngle) * 3.2;
          a.z = a.homeZ + Math.sin(orbitAngle) * 3.2;
          a.yaw = -orbitAngle;
        } else {
          // Gently pull back toward home clearing if wandered far
          const hx = a.homeX - a.x;
          const hz = a.homeZ - a.z;
          const hd = Math.hypot(hx, hz);
          if (hd > 18) {
            a.x += (hx / hd) * 1.8 * dt;
            a.z += (hz / hd) * 1.8 * dt;
            a.yaw = Math.atan2(-hx, -hz);
          }
        }

        if (a.hopOffset > 0 || a.hopVelY > 0) {
          a.hopVelY -= 18 * dt;
          a.hopOffset += a.hopVelY * dt;
          if (a.hopOffset <= 0) {
            a.hopOffset = 0;
            a.hopVelY = a.excitedTimer > 0.6 ? 3.2 : 0;
          }
        }

        const baseY = a.kind === 'duck' ? WATER_LEVEL - 0.04 + Math.sin(elapsed * 2.8 + a.phase) * 0.04 : groundHeightAt(a.x, a.z);
        a.y = baseY + a.hopOffset;
        a.group.position.set(a.x, a.y, a.z);
        a.group.rotation.y = a.yaw + (a.excitedTimer <= 0 && a.kind !== 'duck' ? Math.sin(elapsed * 0.8 + a.phase) * 0.22 : 0);
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
