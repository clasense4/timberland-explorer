import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ProceduralAudio } from './audio';
import {
  WATER_LEVEL,
  WORLD_RADIUS,
  createTerrainAndWater,
  getZoneNameAt,
  groundHeightAt,
  surfaceHeightAt,
} from './terrain';
import { createProceduralTextures } from './textures';
import { createMonsterTruck } from './truck';
import type {
  CameraMode,
  HudSnapshot,
  InputState,
  TimeOfDay,
  TruckColorId,
} from './types';
import { createWorldProps } from './worldProps';

// Pre-allocated math helpers outside render loop (zero per-frame GC)
const _camDesired = new THREE.Vector3();
const _camLookTarget = new THREE.Vector3();
const _forwardVec = new THREE.Vector3();

const TRUCK_SCALE = 0.75;

interface SkyPreset {
  bg: number;
  fog: number;
  fogDensity: number;
  sunColor: number;
  sunIntensity: number;
  sunPos: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  isNight: boolean;
}

const SKY_PRESETS: Record<TimeOfDay, SkyPreset> = {
  morning: {
    bg: 0x9ad4f5,
    fog: 0xaedcf5,
    fogDensity: 0.0021,
    sunColor: 0xfff3d6,
    sunIntensity: 2.1,
    sunPos: [75, 110, 58],
    hemiSky: 0x9fd8ff,
    hemiGround: 0x3f5e36,
    hemiIntensity: 0.95,
    isNight: false,
  },
  sunset: {
    bg: 0xf4a261,
    fog: 0xeb9458,
    fogDensity: 0.0026,
    sunColor: 0xffb36b,
    sunIntensity: 2.25,
    sunPos: [-110, 42, -68],
    hemiSky: 0xffcda3,
    hemiGround: 0x3c2c2e,
    hemiIntensity: 0.85,
    isNight: false,
  },
  starlight: {
    bg: 0x132036,
    fog: 0x16243b,
    fogDensity: 0.0028,
    sunColor: 0xa5c8ff,
    sunIntensity: 1.05,
    sunPos: [55, 95, -70],
    hemiSky: 0x4b6a9b,
    hemiGround: 0x18251e,
    hemiIntensity: 0.65,
    isNight: true,
  },
};

interface ParticleItem {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  isWater: boolean;
}

export class MonsterTruckGameEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private fog: THREE.FogExp2;
  private envRT: THREE.WebGLRenderTarget;

  private textures: ReturnType<typeof createProceduralTextures>;
  private terrainRig: ReturnType<typeof createTerrainAndWater>;
  private truck: ReturnType<typeof createMonsterTruck>;
  private worldProps: ReturnType<typeof createWorldProps>;
  public audio: ProceduralAudio;

  // Particle pool for tire dust & water splashes
  private readonly PARTICLE_MAX = 140;
  private particles: ParticleItem[] = [];
  private particleGeo: THREE.BufferGeometry;
  private particlePositions: Float32Array;
  private particleColors: Float32Array;
  private particleMat: THREE.PointsMaterial;
  private particleCursor = 0;

  // Vehicle state
  private pos = new THREE.Vector3(0, 1.5, 8);
  private velY = 0;
  private yaw = 0;
  private speed = 0;
  private steerAngle = 0;
  private wheelSpin = 0;
  private pitchAngle = 0;
  private rollAngle = 0;
  private chassisBounce = 0;
  private chassisBounceVel = 0;
  private airborne = false;
  private wasInWater = false;
  private rpm = 850;
  private gear = 1;

  // Mouse look-around orbit state
  private isDraggingLook = false;
  private dragPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private orbitYawOffset = 0;
  private orbitPitchOffset = 0;
  private orbitZoomScale = 1.0;

  // Mode & input state
  private input: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    boost: false,
  };
  private cameraMode: CameraMode = 'chase';
  private timeOfDay: TimeOfDay = 'morning';
  private starsCollected = 0;
  private webglLost = false;

  // Loop & lifecycle
  private isSoftwareGl: boolean;
  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;
  private hudTimer = 0;
  private particleEmitTimer = 0;
  private onHudUpdate: (snapshot: HudSnapshot) => void;

  constructor(container: HTMLElement, onHudUpdate: (snapshot: HudSnapshot) => void) {
    this.container = container;
    this.onHudUpdate = onHudUpdate;
    this.audio = new ProceduralAudio();

    // 1. Software WebGL detection
    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Renderer setup
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.cursor = 'grab';
    container.appendChild(this.renderer.domElement);

    // WebGL context loss & mouse look-around listeners
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('dblclick', this.handleDoubleClick);

    // 3. Scene, Environment Map (RoomEnvironment), Fog, Camera
    this.scene = new THREE.Scene();
    const initialPreset = SKY_PRESETS[this.timeOfDay];
    this.scene.background = new THREE.Color(initialPreset.bg);
    this.fog = new THREE.FogExp2(initialPreset.fog, initialPreset.fogDensity);
    this.scene.fog = this.fog;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(62, width / height, 0.3, 980);

    // 4. Outdoor 2-Light Rig
    this.hemiLight = new THREE.HemisphereLight(
      initialPreset.hemiSky,
      initialPreset.hemiGround,
      initialPreset.hemiIntensity
    );
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(initialPreset.sunColor, initialPreset.sunIntensity);
    this.sunLight.position.set(...initialPreset.sunPos);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 280;
    const d = 64;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // 5. Procedural Textures, Terrain, Monster Truck & Forest Props
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso);

    this.terrainRig = createTerrainAndWater(this.textures);
    this.scene.add(this.terrainRig.group);

    this.truck = createMonsterTruck(this.textures);
    this.truck.root.scale.setScalar(TRUCK_SCALE);
    this.pos.y = surfaceHeightAt(this.pos.x, this.pos.z);
    this.truck.root.position.copy(this.pos);
    this.scene.add(this.truck.root);

    this.worldProps = createWorldProps(this.textures);
    this.scene.add(this.worldProps.group);

    // 6. Particle Pool Setup
    this.particlePositions = new Float32Array(this.PARTICLE_MAX * 3);
    this.particleColors = new Float32Array(this.PARTICLE_MAX * 3);
    for (let i = 0; i < this.PARTICLE_MAX; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        isWater: false,
      });
      this.particlePositions[i * 3 + 1] = -999;
    }
    this.particleGeo = new THREE.BufferGeometry();
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeo.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    this.particleMat = new THREE.PointsMaterial({
      size: 1.25,
      map: this.textures.particleMap,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const particlePoints = new THREE.Points(this.particleGeo, this.particleMat);
    particlePoints.frustumCulled = false;
    this.scene.add(particlePoints);

    // Initial camera placement behind the scaled monster truck
    this.camera.position.set(0, this.pos.y + 5.0, this.pos.z + 11.0);
    this.camera.lookAt(this.pos.x, this.pos.y + 1.8, this.pos.z - 4);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    window.addEventListener('resize', this.handleResize);
    this.emitHud();
    this.clock.start();
    this.scheduleNextTick();
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.audio.unlock();
    this.isDraggingLook = true;
    this.dragPointerId = e.pointerId;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.isDraggingLook || e.pointerId !== this.dragPointerId) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    this.orbitYawOffset -= dx * 0.0072;
    this.orbitPitchOffset = THREE.MathUtils.clamp(
      this.orbitPitchOffset + dy * 0.0055,
      -0.25,
      0.85
    );
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (!this.isDraggingLook || e.pointerId !== this.dragPointerId) return;
    this.isDraggingLook = false;
    this.dragPointerId = null;
    this.renderer.domElement.style.cursor = 'grab';
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.orbitZoomScale = THREE.MathUtils.clamp(
      this.orbitZoomScale + e.deltaY * 0.0008,
      0.65,
      1.95
    );
  };

  private handleDoubleClick = (): void => {
    this.recenterCamera();
  };

  public recenterCamera(): void {
    this.orbitYawOffset = 0;
    this.orbitPitchOffset = 0;
    this.orbitZoomScale = 1.0;
  }

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.webglLost = true;
    this.emitHud();
  };

  private handleContextRestored = (): void => {
    this.webglLost = false;
    this.emitHud();
  };

  private handleResize = (): void => {
    if (this.disposed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  public setInputKey(key: keyof InputState, down: boolean): void {
    this.input[key] = down;
    if (down) {
      this.audio.unlock();
    }
  }

  public setTruckColor(colorId: TruckColorId): void {
    this.truck.setPaintColor(colorId);
  }

  public setTimeOfDay(presetKey: TimeOfDay): void {
    this.timeOfDay = presetKey;
    const p = SKY_PRESETS[presetKey];
    (this.scene.background as THREE.Color).setHex(p.bg);
    this.fog.color.setHex(p.fog);
    this.fog.density = p.fogDensity;
    this.sunLight.color.setHex(p.sunColor);
    this.sunLight.intensity = p.sunIntensity;
    this.hemiLight.color.setHex(p.hemiSky);
    this.hemiLight.groundColor.setHex(p.hemiGround);
    this.hemiLight.intensity = p.hemiIntensity;
    this.truck.setLightsNightMode(p.isNight);
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.recenterCamera();
  }

  public honk(): void {
    this.audio.playHorn();
    this.chassisBounceVel += 2.2;
  }

  public resetTruck(): void {
    this.audio.unlock();
    const spot = this.worldProps.getRandomSafeSpot(28, WORLD_RADIUS - 65);
    this.pos.set(spot.x, spot.y + 1.3, spot.z);
    this.yaw = spot.yaw;
    this.velY = 0;
    this.speed = 0;
    this.pitchAngle = 0;
    this.rollAngle = 0;
    this.chassisBounce = 0.25;
    this.chassisBounceVel = 0;
    this.airborne = false;
    this.recenterCamera();

    // Randomize all star locations on reset too
    this.worldProps.randomizeStars();
    this.starsCollected = 0;
    this.emitHud();
  }

  private emitParticle(x: number, y: number, z: number, isWater: boolean): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % this.PARTICLE_MAX;
    p.active = true;
    p.x = x + (Math.random() - 0.5) * 0.55;
    p.y = y + 0.16;
    p.z = z + (Math.random() - 0.5) * 0.55;
    p.vx = (Math.random() - 0.5) * 2.1;
    p.vy = isWater ? 2.4 + Math.random() * 2.1 : 0.8 + Math.random() * 1.2;
    p.vz = (Math.random() - 0.5) * 2.1;
    p.life = 0;
    p.maxLife = isWater ? 0.52 + Math.random() * 0.25 : 0.62 + Math.random() * 0.35;
    p.isWater = isWater;
  }

  private updateParticles(dt: number): void {
    for (let i = 0; i < this.PARTICLE_MAX; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        this.particlePositions[i * 3 + 1] = -999;
        continue;
      }
      p.vy -= (p.isWater ? 9.8 : 1.2) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const fade = 1 - p.life / p.maxLife;
      this.particlePositions[i * 3] = p.x;
      this.particlePositions[i * 3 + 1] = p.y;
      this.particlePositions[i * 3 + 2] = p.z;
      if (p.isWater) {
        this.particleColors[i * 3] = 0.78 * fade;
        this.particleColors[i * 3 + 1] = 0.94 * fade;
        this.particleColors[i * 3 + 2] = 1.0 * fade;
      } else {
        this.particleColors[i * 3] = 0.78 * fade;
        this.particleColors[i * 3 + 1] = 0.68 * fade;
        this.particleColors[i * 3 + 2] = 0.52 * fade;
      }
    }
    this.particleGeo.attributes.position.needsUpdate = true;
    this.particleGeo.attributes.color.needsUpdate = true;
  }

  private updatePhysics(dt: number): void {
    const maxSpeed = this.input.boost ? 36 : 24;
    const accel = this.input.boost ? 36 : 22;
    const reverseMax = -12;

    if (this.input.forward) {
      this.speed += accel * dt;
    } else if (this.input.backward) {
      if (this.speed > 1.5) {
        this.speed -= 34 * dt;
      } else {
        this.speed -= 16 * dt;
      }
    } else {
      this.speed *= Math.exp(-2.1 * dt);
      if (Math.abs(this.speed) < 0.08) this.speed = 0;
    }
    this.speed = THREE.MathUtils.clamp(this.speed, reverseMax, maxSpeed);

    const targetSteer = (this.input.left ? 1 : 0) - (this.input.right ? 1 : 0);
    this.steerAngle = THREE.MathUtils.damp(this.steerAngle, targetSteer * 0.46, 10, dt);

    const speedFactor = Math.min(1, Math.abs(this.speed) / 4.2);
    const turnDir = this.speed >= -0.2 ? 1 : -1;
    this.yaw += this.steerAngle * 2.55 * speedFactor * turnDir * dt;

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const fx = -sinY;
    const fz = -cosY;
    const rx = cosY;
    const rz = -sinY;

    this.pos.x += fx * this.speed * dt;
    this.pos.z += fz * this.speed * dt;

    // Gentle tree/boulder deflection
    const truckRadius = 2.0 * TRUCK_SCALE;
    const obs = this.worldProps.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const dx = this.pos.x - o.x;
      const dz = this.pos.z - o.z;
      const minD = truckRadius + o.radius;
      const distSq = dx * dx + dz * dz;
      if (distSq < minD * minD && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const push = minD - dist;
        this.pos.x += (dx / dist) * push;
        this.pos.z += (dz / dist) * push;
        this.speed *= 0.92;
      }
    }

    // Soft valley perimeter turn-in
    const radialDist = Math.hypot(this.pos.x, this.pos.z);
    if (radialDist > WORLD_RADIUS) {
      const nx = this.pos.x / radialDist;
      const nz = this.pos.z / radialDist;
      this.pos.x = nx * WORLD_RADIUS;
      this.pos.z = nz * WORLD_RADIUS;
      this.speed *= 0.85;
    }

    // 4-Wheel terrain sampling scaled to truck dimensions
    const halfTrack = 1.62 * TRUCK_SCALE;
    const halfWheelbase = 1.78 * TRUCK_SCALE;

    const hFL = surfaceHeightAt(this.pos.x + fx * halfWheelbase - rx * halfTrack, this.pos.z + fz * halfWheelbase - rz * halfTrack);
    const hFR = surfaceHeightAt(this.pos.x + fx * halfWheelbase + rx * halfTrack, this.pos.z + fz * halfWheelbase + rz * halfTrack);
    const hRL = surfaceHeightAt(this.pos.x - fx * halfWheelbase - rx * halfTrack, this.pos.z - fz * halfWheelbase - rz * halfTrack);
    const hRR = surfaceHeightAt(this.pos.x - fx * halfWheelbase + rx * halfTrack, this.pos.z - fz * halfWheelbase + rz * halfTrack);

    const avgGroundY = (hFL + hFR + hRL + hRR) * 0.25;
    const prevGroundY = surfaceHeightAt(this.pos.x - fx * 0.5, this.pos.z - fz * 0.5);
    const slopeLaunch = (avgGroundY - prevGroundY) * Math.max(0, this.speed) * 0.45;

    if (this.pos.y <= avgGroundY + 0.08 && this.velY <= 0.5) {
      if (this.airborne) {
        const impact = Math.min(1.5, Math.abs(this.velY) * 0.12);
        this.chassisBounceVel -= impact * 4.5;
        if (impact > 0.25) {
          this.audio.playLandingThump(impact);
        }
        this.airborne = false;
      }
      this.pos.y = avgGroundY;
      if (slopeLaunch > 3.0 && this.speed > 12) {
        this.velY = Math.min(12.0, slopeLaunch * 1.15);
        this.airborne = true;
      } else {
        this.velY = 0;
      }
    } else {
      this.airborne = true;
      this.velY -= 21.5 * dt;
      this.pos.y += this.velY * dt;
      if (this.pos.y <= avgGroundY) {
        const impact = Math.min(1.6, Math.abs(this.velY) * 0.12);
        this.chassisBounceVel -= impact * 4.8;
        if (impact > 0.25) {
          this.audio.playLandingThump(impact);
        }
        this.pos.y = avgGroundY;
        this.velY = 0;
        this.airborne = false;
      }
    }

    const targetPitch = Math.atan2((hFL + hFR) * 0.5 - (hRL + hRR) * 0.5, halfWheelbase * 2);
    const targetRoll = Math.atan2((hRL + hFL) * 0.5 - (hRR + hFR) * 0.5, halfTrack * 2);
    const turnBodyRoll = -this.steerAngle * (this.speed / 26) * 0.14;

    this.pitchAngle = THREE.MathUtils.damp(this.pitchAngle, targetPitch, 9, dt);
    this.rollAngle = THREE.MathUtils.damp(this.rollAngle, targetRoll + turnBodyRoll, 9, dt);

    const springForce = -72 * this.chassisBounce - 9.5 * this.chassisBounceVel;
    this.chassisBounceVel += springForce * dt;
    this.chassisBounce += this.chassisBounceVel * dt;
    this.chassisBounce = THREE.MathUtils.clamp(this.chassisBounce, -0.35, 0.42);

    this.truck.root.position.copy(this.pos);
    this.truck.root.rotation.order = 'YXZ';
    this.truck.root.rotation.set(this.pitchAngle, this.yaw, this.rollAngle);
    this.truck.chassisGroup.position.y = this.chassisBounce;

    const scaledWheelR = this.truck.wheelRadius * TRUCK_SCALE;
    this.wheelSpin -= (this.speed / scaledWheelR) * dt;
    this.truck.wheelPivots.fl.rotation.y = this.steerAngle;
    this.truck.wheelPivots.fr.rotation.y = this.steerAngle;
    this.truck.wheelSpinners.fl.rotation.x = this.wheelSpin;
    this.truck.wheelSpinners.fr.rotation.x = this.wheelSpin;
    this.truck.wheelSpinners.rl.rotation.x = this.wheelSpin;
    this.truck.wheelSpinners.rr.rotation.x = this.wheelSpin;

    const heightAboveGround = Math.max(0, this.pos.y - avgGroundY);
    const shadowScale = Math.max(0.55, 1 - heightAboveGround * 0.08);
    this.truck.contactShadow.scale.set(shadowScale, 1, shadowScale);
    this.truck.contactShadow.position.y = 0.05 - heightAboveGround * 0.85;

    // Simulated 4-speed automatic gearbox + Tachometer RPM
    const absSpeed = Math.abs(this.speed);
    if (this.speed < -0.5) {
      this.gear = 0; // Reverse
    } else if (absSpeed < 7) {
      this.gear = 1;
    } else if (absSpeed < 14) {
      this.gear = 2;
    } else if (absSpeed < 22) {
      this.gear = 3;
    } else {
      this.gear = 4;
    }

    const gearMin = [0, 0, 6.5, 13.5, 21.5][this.gear] ?? 0;
    const gearMax = [12, 8.2, 15.2, 23.2, 36.5][this.gear] ?? 36;
    const gearProgress = THREE.MathUtils.clamp((absSpeed - gearMin) / (gearMax - gearMin), 0, 1);
    const throttleBonus = this.input.forward || this.input.backward ? 950 : 0;
    const turboBonus = this.input.boost ? 1200 : 0;
    const airBonus = this.airborne && this.input.forward ? 900 : 0;
    const targetRpm = THREE.MathUtils.clamp(
      900 + gearProgress * 4650 + throttleBonus + turboBonus + airBonus,
      850,
      7200
    );
    this.rpm = THREE.MathUtils.damp(this.rpm, targetRpm, 9.5, dt);

    // Creek splash & dust particles
    const baseTerrainY = groundHeightAt(this.pos.x, this.pos.z);
    const inWater = !this.airborne && baseTerrainY < WATER_LEVEL + 0.05 && this.pos.y < WATER_LEVEL + 0.4;
    if (inWater && !this.wasInWater && absSpeed > 3.5) {
      this.audio.playSplash();
    }
    this.wasInWater = inWater;

    this.particleEmitTimer += dt;
    if (!this.airborne && absSpeed > 3.5 && this.particleEmitTimer > 0.045) {
      this.particleEmitTimer = 0;
      const rearDist = 1.8 * TRUCK_SCALE;
      const sideDist = 1.5 * TRUCK_SCALE;
      const rearLx = this.pos.x - fx * rearDist - rx * sideDist;
      const rearLz = this.pos.z - fz * rearDist - rz * sideDist;
      const rearRx = this.pos.x - fx * rearDist + rx * sideDist;
      const rearRz = this.pos.z - fz * rearDist + rz * sideDist;
      this.emitParticle(rearLx, this.pos.y + 0.15, rearLz, inWater);
      this.emitParticle(rearRx, this.pos.y + 0.15, rearRz, inWater);
    }

    // Collect Golden Pine Stars
    const stars = this.worldProps.stars;
    for (let i = 0; i < stars.length; i++) {
      const st = stars[i];
      if (st.collected) continue;
      const dist = Math.hypot(this.pos.x - st.x, this.pos.y + 1.2 - st.y, this.pos.z - st.z);
      if (dist < 4.5) {
        st.collected = true;
        st.group.visible = false;
        this.starsCollected++;
        this.audio.playStarChime();
        this.chassisBounceVel += 1.6;
        this.emitHud();
      }
    }

    this.audio.updateEngine(
      absSpeed / 24,
      this.input.forward || this.input.backward,
      this.input.boost
    );
  }

  private updateCamera(dt: number): void {
    const viewYaw = this.yaw + this.orbitYawOffset;
    const sinY = Math.sin(viewYaw);
    const cosY = Math.cos(viewYaw);
    _forwardVec.set(-sinY, 0, -cosY);

    if (this.cameraMode === 'hood') {
      const truckSin = Math.sin(this.yaw);
      const truckCos = Math.cos(this.yaw);
      _camDesired.set(
        this.pos.x - truckSin * 0.35,
        this.pos.y + 2.75,
        this.pos.z - truckCos * 0.35
      );
      _camLookTarget.set(
        this.pos.x + _forwardVec.x * 18.0,
        this.pos.y + 2.1 - Math.sin(this.orbitPitchOffset) * 8.0,
        this.pos.z + _forwardVec.z * 18.0
      );
    } else {
      const baseDist = (this.cameraMode === 'wide' ? 17.5 : 10.8) * this.orbitZoomScale;
      const baseHeight = (this.cameraMode === 'wide' ? 7.8 : 4.4) * this.orbitZoomScale;
      const pitchHeight = Math.sin(this.orbitPitchOffset) * baseDist * 0.72;
      const horizDist = Math.max(3.5, baseDist * Math.cos(this.orbitPitchOffset * 0.65));

      _camDesired.set(
        this.pos.x - _forwardVec.x * horizDist,
        this.pos.y + baseHeight + pitchHeight,
        this.pos.z - _forwardVec.z * horizDist
      );
      _camLookTarget.set(
        this.pos.x + _forwardVec.x * 3.5,
        this.pos.y + 1.85,
        this.pos.z + _forwardVec.z * 3.5
      );
    }

    const groundAtCam = surfaceHeightAt(_camDesired.x, _camDesired.z);
    if (_camDesired.y < groundAtCam + 1.35) {
      _camDesired.y = groundAtCam + 1.35;
    }

    const dampLambda = this.isDraggingLook ? 22 : this.cameraMode === 'hood' ? 16 : 7.8;
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camDesired.x, dampLambda, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camDesired.y, dampLambda, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camDesired.z, dampLambda, dt);
    this.camera.lookAt(_camLookTarget);

    const targetFov = this.input.boost ? 70 : 62 + Math.min(6, Math.abs(this.speed) * 0.22);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
      this.camera.updateProjectionMatrix();
    }

    const p = SKY_PRESETS[this.timeOfDay];
    this.sunLight.position.set(
      this.pos.x + p.sunPos[0],
      this.pos.y + p.sunPos[1],
      this.pos.z + p.sunPos[2]
    );
    this.sunLight.target.position.copy(this.pos);
    this.sunLight.target.updateMatrixWorld();
  }

  private emitHud(): void {
    this.onHudUpdate({
      speedKmh: Math.round(Math.abs(this.speed) * 2.8),
      rpm: Math.round(this.rpm),
      gear: this.gear,
      starsCollected: this.starsCollected,
      totalStars: this.worldProps.stars.length,
      zoneName: getZoneNameAt(this.pos.x, this.pos.z),
      inWater: this.wasInWater,
      airborne: this.airborne,
      webglLost: this.webglLost,
    });
  }

  private scheduleNextTick(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = (): void => {
    if (this.disposed) return;
    const rawDelta = this.clock.getDelta();
    const dt = Math.min(rawDelta, 0.05);
    const elapsed = this.clock.elapsedTime;

    this.updatePhysics(dt);
    this.updateParticles(dt);
    this.worldProps.update(elapsed, dt, this.timeOfDay === 'starlight');
    this.terrainRig.waterMesh.position.y = WATER_LEVEL + Math.sin(elapsed * 1.8) * 0.035;
    this.updateCamera(dt);

    this.hudTimer += dt;
    if (this.hudTimer >= 0.065) {
      this.hudTimer = 0;
      this.emitHud();
    }

    this.renderer.render(this.scene, this.camera);
    this.scheduleNextTick();
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('wheel', this.handleWheel);
    canvas.removeEventListener('dblclick', this.handleDoubleClick);

    this.audio.dispose();
    this.truck.dispose();
    this.worldProps.dispose();
    this.terrainRig.dispose();
    this.textures.dispose();
    this.particleGeo.dispose();
    this.particleMat.dispose();
    this.envRT.dispose();
    this.renderer.dispose();

    if (canvas.parentNode === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
