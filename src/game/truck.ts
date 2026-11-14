import * as THREE from 'three';
import type { ProceduralTextureSet } from './textures';
import { TRUCK_COLORS, type TruckColorId } from './types';

export interface MonsterTruckRig {
  root: THREE.Group;
  chassisGroup: THREE.Group;
  contactShadow: THREE.Mesh;
  wheelPivots: {
    fl: THREE.Group;
    fr: THREE.Group;
    rl: THREE.Group;
    rr: THREE.Group;
  };
  wheelSpinners: {
    fl: THREE.Group;
    fr: THREE.Group;
    rl: THREE.Group;
    rr: THREE.Group;
  };
  wheelRadius: number;
  setPaintColor: (colorId: TruckColorId) => void;
  setLightsNightMode: (isNight: boolean) => void;
  dispose: () => void;
}

export function createMonsterTruck(textures: ProceduralTextureSet): MonsterTruckRig {
  const root = new THREE.Group();
  const chassisGroup = new THREE.Group();
  root.add(chassisGroup);

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

  // Materials with clear roughness/metalness contrast
  const initialColor = TRUCK_COLORS[0];
  const paintMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: initialColor.hex,
      roughness: 0.24,
      metalness: 0.35,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    })
  );

  const accentMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: initialColor.accentHex,
      roughness: 0.35,
      metalness: 0.45,
    })
  );

  const frameMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x22272e,
      roughness: 0.78,
      metalness: 0.25,
    })
  );

  const chromeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd9e1e8,
      roughness: 0.16,
      metalness: 0.92,
    })
  );

  const glassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x1a2c38,
      roughness: 0.08,
      metalness: 0.1,
      clearcoat: 1.0,
      opacity: 0.88,
      transparent: true,
    })
  );

  const rubberMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1e2024,
      map: textures.tireTreadMap,
      roughness: 0.88,
      metalness: 0.04,
    })
  );

  const headlightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfff8dc,
      emissive: 0xffe49e,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    })
  );

  const taillightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      emissive: 0xef4444,
      emissiveIntensity: 0.65,
      roughness: 0.25,
    })
  );

  // 1. Heavy-duty ladder chassis frame & belly skid plate
  const frameGeo = trackGeo(new THREE.BoxGeometry(1.75, 0.38, 4.35));
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.position.set(0, 1.38, 0);
  frameMesh.castShadow = true;
  chassisGroup.add(frameMesh);

  const skidGeo = trackGeo(new THREE.BoxGeometry(1.3, 0.16, 3.6));
  const skidMesh = new THREE.Mesh(skidGeo, chromeMat);
  skidMesh.position.set(0, 1.15, 0);
  chassisGroup.add(skidMesh);

  // Front & rear solid monster axles
  const axleGeo = trackGeo(new THREE.CylinderGeometry(0.16, 0.16, 3.1, 12));
  axleGeo.rotateZ(Math.PI / 2);
  [-1.78, 1.78].forEach((az) => {
    const axle = new THREE.Mesh(axleGeo, frameMat);
    axle.position.set(0, 1.05, az);
    axle.castShadow = true;
    chassisGroup.add(axle);

    const diffGeo = trackGeo(new THREE.SphereGeometry(0.28, 12, 10));
    const diff = new THREE.Mesh(diffGeo, chromeMat);
    diff.position.set(0, 1.05, az);
    chassisGroup.add(diff);
  });

  // 4 Coil suspension struts connecting frame to axles
  const strutGeo = trackGeo(new THREE.CylinderGeometry(0.11, 0.11, 0.72, 10));
  const strutPositions: [number, number][] = [
    [-0.95, 1.72],
    [0.95, 1.72],
    [-0.95, -1.72],
    [0.95, -1.72],
  ];
  strutPositions.forEach(([sx, sz]) => {
    const strut = new THREE.Mesh(strutGeo, accentMat);
    strut.position.set(sx, 1.35, sz);
    strut.rotation.z = sx > 0 ? 0.22 : -0.22;
    chassisGroup.add(strut);
  });

  // 2. Sculpted Pickup Body & Cab using ExtrudeGeometry (side silhouette extruded across X)
  // In Shape coordinates: X = forward (-Z is front, +Z is back), Y = height
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-2.35, 1.48); // Front nose bottom
  bodyShape.lineTo(-2.35, 2.15); // Front grille top
  bodyShape.quadraticCurveTo(-2.28, 2.32, -1.95, 2.34); // Hood front bevel
  bodyShape.lineTo(-0.85, 2.42); // Hood back
  bodyShape.lineTo(-0.28, 3.18); // Windshield slope
  bodyShape.lineTo(0.78, 3.18); // Cab roof
  bodyShape.lineTo(0.95, 2.38); // Cab rear pillar
  bodyShape.lineTo(2.38, 2.36); // Truck bed rail
  bodyShape.lineTo(2.42, 1.56); // Tailgate bottom
  bodyShape.lineTo(1.9, 1.48);
  bodyShape.lineTo(-2.35, 1.48);

  const bodyExtrude = trackGeo(
    new THREE.ExtrudeGeometry(bodyShape, {
      depth: 2.18,
      bevelEnabled: true,
      bevelThickness: 0.14,
      bevelSize: 0.1,
      bevelSegments: 3,
    })
  );
  // Center extruded depth on X and orient -X shape coordinate to -Z (forward)
  bodyExtrude.translate(0, 0, -1.09);
  bodyExtrude.rotateY(-Math.PI / 2);

  const bodyMesh = new THREE.Mesh(bodyExtrude, paintMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  chassisGroup.add(bodyMesh);

  // Flared monster wheel-arch fenders
  const fenderGeo = trackGeo(new THREE.BoxGeometry(0.42, 0.34, 1.55));
  [
    [-1.18, 1.72, -1.68],
    [1.18, 1.72, -1.68],
    [-1.18, 1.72, 1.68],
    [1.18, 1.72, 1.68],
  ].forEach(([fx, fy, fz]) => {
    const fender = new THREE.Mesh(fenderGeo, frameMat);
    fender.position.set(fx, fy, fz);
    fender.castShadow = true;
    chassisGroup.add(fender);
  });

  // 3. Racing side stripe accent
  const stripeGeo = trackGeo(new THREE.BoxGeometry(2.48, 0.22, 3.85));
  const stripe = new THREE.Mesh(stripeGeo, accentMat);
  stripe.position.set(0, 1.98, 0.15);
  chassisGroup.add(stripe);

  // 4. Tinted wrap-around windshield & side windows
  const windshieldGeo = trackGeo(new THREE.BoxGeometry(1.96, 0.72, 0.12));
  const windshield = new THREE.Mesh(windshieldGeo, glassMat);
  windshield.position.set(0, 2.76, -0.58);
  windshield.rotation.x = -0.64;
  chassisGroup.add(windshield);

  const sideWinGeo = trackGeo(new THREE.BoxGeometry(2.5, 0.56, 1.05));
  const sideWin = new THREE.Mesh(sideWinGeo, glassMat);
  sideWin.position.set(0, 2.76, 0.22);
  chassisGroup.add(sideWin);

  // 5. Front chrome grille, heavy bull-bar bumper & headlights
  const grilleGeo = trackGeo(new THREE.BoxGeometry(1.72, 0.52, 0.14));
  const grille = new THREE.Mesh(grilleGeo, chromeMat);
  grille.position.set(0, 1.94, -2.44);
  chassisGroup.add(grille);

  const bumperGeo = trackGeo(new THREE.BoxGeometry(2.42, 0.28, 0.36));
  const bumper = new THREE.Mesh(bumperGeo, frameMat);
  bumper.position.set(0, 1.5, -2.5);
  bumper.castShadow = true;
  chassisGroup.add(bumper);

  // Bull bar hoop
  const bullBarGeo = trackGeo(new THREE.TorusGeometry(0.65, 0.06, 8, 20, Math.PI));
  const bullBar = new THREE.Mesh(bullBarGeo, chromeMat);
  bullBar.position.set(0, 1.58, -2.62);
  chassisGroup.add(bullBar);

  const headGeo = trackGeo(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 14));
  headGeo.rotateX(Math.PI / 2);
  [-0.82, 0.82].forEach((hx) => {
    const hl = new THREE.Mesh(headGeo, headlightMat);
    hl.position.set(hx, 2.02, -2.46);
    chassisGroup.add(hl);
  });

  // Tail lights
  const tailGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.22, 0.12));
  [-0.9, 0.9].forEach((tx) => {
    const tl = new THREE.Mesh(tailGeo, taillightMat);
    tl.position.set(tx, 2.0, 2.46);
    chassisGroup.add(tl);
  });

  // 6. Tubular Roll Bar + 4 Roof Off-Road Spotlights + Twin Exhaust Stacks
  const rollBarGeo = trackGeo(new THREE.TorusGeometry(0.95, 0.08, 10, 20, Math.PI));
  const rollBar = new THREE.Mesh(rollBarGeo, frameMat);
  rollBar.position.set(0, 2.48, 0.98);
  rollBar.castShadow = true;
  chassisGroup.add(rollBar);

  const lightPodGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 12));
  lightPodGeo.rotateX(Math.PI / 2);
  [-0.62, -0.22, 0.22, 0.62].forEach((lx) => {
    const pod = new THREE.Mesh(lightPodGeo, headlightMat);
    pod.position.set(lx, 3.48, 0.95);
    chassisGroup.add(pod);
  });

  const stackGeo = trackGeo(new THREE.CylinderGeometry(0.08, 0.09, 1.35, 10));
  [-0.98, 0.98].forEach((ex) => {
    const stack = new THREE.Mesh(stackGeo, chromeMat);
    stack.position.set(ex, 2.82, 1.16);
    stack.rotation.x = 0.12;
    stack.castShadow = true;
    chassisGroup.add(stack);
  });

  // 7. Oversized Monster Truck Wheels (4 composite wheel groups)
  const wheelRadius = 1.02;
  const tireWidth = 0.88;
  const tireGeo = trackGeo(new THREE.CylinderGeometry(wheelRadius, wheelRadius, tireWidth, 24));
  tireGeo.rotateZ(Math.PI / 2);

  const rimGeo = trackGeo(new THREE.CylinderGeometry(0.56, 0.56, tireWidth + 0.04, 18));
  rimGeo.rotateZ(Math.PI / 2);

  const hubGeo = trackGeo(new THREE.CylinderGeometry(0.22, 0.26, tireWidth + 0.12, 12));
  hubGeo.rotateZ(Math.PI / 2);

  const lugGeo = trackGeo(new THREE.CylinderGeometry(0.05, 0.05, tireWidth + 0.1, 6));
  lugGeo.rotateZ(Math.PI / 2);

  const buildWheel = (x: number, z: number): { pivot: THREE.Group; spinner: THREE.Group } => {
    const pivot = new THREE.Group();
    pivot.position.set(x, wheelRadius, z);
    root.add(pivot);

    const spinner = new THREE.Group();
    pivot.add(spinner);

    const tire = new THREE.Mesh(tireGeo, rubberMat);
    tire.castShadow = true;
    tire.receiveShadow = true;
    spinner.add(tire);

    const rim = new THREE.Mesh(rimGeo, accentMat);
    spinner.add(rim);

    const hub = new THREE.Mesh(hubGeo, chromeMat);
    spinner.add(hub);

    // 6 wheel lug nuts around rim
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const lug = new THREE.Mesh(lugGeo, chromeMat);
      lug.position.set(0, Math.cos(a) * 0.38, Math.sin(a) * 0.38);
      spinner.add(lug);
    }

    return { pivot, spinner };
  };

  const fl = buildWheel(-1.62, -1.78);
  const fr = buildWheel(1.62, -1.78);
  const rl = buildWheel(-1.62, 1.78);
  const rr = buildWheel(1.62, 1.78);

  // 8. Soft radial contact shadow decal beneath truck
  const shadowGeo = trackGeo(new THREE.PlaneGeometry(5.2, 6.4));
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: textures.contactShadowMap,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    })
  );
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.set(0, 0.05, 0);
  root.add(contactShadow);

  return {
    root,
    chassisGroup,
    contactShadow,
    wheelPivots: {
      fl: fl.pivot,
      fr: fr.pivot,
      rl: rl.pivot,
      rr: rr.pivot,
    },
    wheelSpinners: {
      fl: fl.spinner,
      fr: fr.spinner,
      rl: rl.spinner,
      rr: rr.spinner,
    },
    wheelRadius,
    setPaintColor: (colorId: TruckColorId) => {
      const found = TRUCK_COLORS.find((c) => c.id === colorId);
      if (!found) return;
      paintMat.color.set(found.hex);
      accentMat.color.set(found.accentHex);
    },
    setLightsNightMode: (isNight: boolean) => {
      headlightMat.emissiveIntensity = isNight ? 2.4 : 0.9;
      taillightMat.emissiveIntensity = isNight ? 1.4 : 0.65;
    },
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
