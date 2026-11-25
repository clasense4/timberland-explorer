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
  r: number;
  g: number;
  b: number;
}

interface WaterRippleItem {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  life: number;
  maxLife: number;
  maxScale: number;
}

interface FireworkItem {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  r: number;
  g: number;
  b: number;
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

  // Particle pool for tire dust, water splashes & prop smash sparks
  private readonly PARTICLE_MAX = 180;
  private particles: ParticleItem[] = [];
  private particleGeo: THREE.BufferGeometry;
  private particlePositions: Float32Array;
  private particleColors: Float32Array;
  private particleMat: THREE.PointsMaterial;
  private particleCursor = 0;

  // Expanding 3D water ripple rings pool
  private rippleGeo: THREE.RingGeometry;
  private ripples: WaterRippleItem[] = [];
  private rippleCursor = 0;
  private waterRippleTimer = 0;

  // Sky fireworks particle pool (triggered on collecting all stars)
  private readonly FIREWORK_MAX = 220;
  private fireworks: FireworkItem[] = [];
  private fireworkGeo: THREE.BufferGeometry;
  private fireworkPositions: Float32Array;
  private fireworkColors: Float32Array;
  private fireworkMat: THREE.PointsMaterial;
  private fireworkCursor = 0;
  private celebrating = false;
  private celebrationTriggered = false;
  private fireworkShowTimer = 0;
  private fireworkBurstTimer = 0;

  // Vehicle state
  private pos = new THREE.Vector3(0, 1.5, 8);
  private velY = 0;
  private yaw = 0;
  private speed = 0;
  private steerAngle = 0;
  private wheelSpin = 0;
  private pitchAngle = 0;
  private pitchVel = 0;
  private rollAngle = 0;
  private rollVel = 0;
  private wheelTravel: [number, number, number, number] = [0, 0, 0, 0];
  private chassisBounce = 0;
  private chassisBounceVel = 0;
  private airborne = false;
  private airTime = 0;
  private peakFallVel = 0;
  private prevAvgGroundY = 0;
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
  private helperMode = false;
  private helperArrowGroup: THREE.Group;
  private helperArrowGeo1: THREE.BufferGeometry;
  private helperArrowGeo2: THREE.BufferGeometry;
  private helperArrowMat: THREE.MeshStandardMaterial;
  private helperArrowYaw = 0;
  private webglLost = false;

  // Loop & lifecycle
  private isSoftwareGl: boolean;
  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;
  private hudTimer = 0;
  private particleEmitTimer = 0;
  private animalCheckTimer = 0;
  private resizeObserver: ResizeObserver | null = null;
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
    this.renderer.domElement.style.touchAction = 'none';
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
    this.prevAvgGroundY = this.pos.y;
    this.truck.root.position.copy(this.pos);
    this.scene.add(this.truck.root);

    this.worldProps = createWorldProps(this.textures);
    this.scene.add(this.worldProps.group);

    // 6. Particle Pool, Water Ripple Pool & Sky Firework Pool Setup
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
        r: 0.78,
        g: 0.68,
        b: 0.52,
      });
      this.particlePositions[i * 3 + 1] = -999;
    }
    this.particleGeo = new THREE.BufferGeometry();
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeo.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    this.particleMat = new THREE.PointsMaterial({
      size: 1.45,
      map: this.textures.particleMap,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    const particlePoints = new THREE.Points(this.particleGeo, this.particleMat);
    particlePoints.frustumCulled = false;
    this.scene.add(particlePoints);

    // Expanding water ripple rings
    this.rippleGeo = new THREE.RingGeometry(0.42, 0.78, 24);
    this.rippleGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const rMat = new THREE.MeshBasicMaterial({
        color: 0xe0f7ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const rMesh = new THREE.Mesh(this.rippleGeo, rMat);
      rMesh.visible = false;
      rMesh.position.set(0, WATER_LEVEL + 0.05, 0);
      this.scene.add(rMesh);
      this.ripples.push({
        mesh: rMesh,
        mat: rMat,
        active: false,
        life: 0,
        maxLife: 0.9,
        maxScale: 5.0,
      });
    }

    // Sky Fireworks sparks
    this.fireworkPositions = new Float32Array(this.FIREWORK_MAX * 3);
    this.fireworkColors = new Float32Array(this.FIREWORK_MAX * 3);
    for (let i = 0; i < this.FIREWORK_MAX; i++) {
      this.fireworks.push({
        active: false,
        x: 0,
        y: -999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1.2,
        r: 1,
        g: 0.8,
        b: 0.2,
      });
      this.fireworkPositions[i * 3 + 1] = -999;
    }
    this.fireworkGeo = new THREE.BufferGeometry();
    this.fireworkGeo.setAttribute('position', new THREE.BufferAttribute(this.fireworkPositions, 3));
    this.fireworkGeo.setAttribute('color', new THREE.BufferAttribute(this.fireworkColors, 3));
    this.fireworkMat = new THREE.PointsMaterial({
      size: 2.1,
      map: this.textures.particleMap,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const fireworkPoints = new THREE.Points(this.fireworkGeo, this.fireworkMat);
    fireworkPoints.frustumCulled = false;
    this.scene.add(fireworkPoints);

    // 7. Helper Mode 3D Floating Guide Arrow (hovers above truck pointing to nearest star)
    this.helperArrowGroup = new THREE.Group();
    this.helperArrowMat = new THREE.MeshStandardMaterial({
      color: 0xfde047,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.92,
      roughness: 0.2,
      metalness: 0.35,
    });
    this.helperArrowGeo1 = new THREE.BoxGeometry(0.42, 0.28, 1.15);
    this.helperArrowGeo1.translate(0, 0, 0.28);
    const arrowShaft = new THREE.Mesh(this.helperArrowGeo1, this.helperArrowMat);
    this.helperArrowGroup.add(arrowShaft);

    this.helperArrowGeo2 = new THREE.ConeGeometry(0.62, 0.92, 4);
    this.helperArrowGeo2.rotateY(Math.PI / 4);
    this.helperArrowGeo2.rotateX(-Math.PI / 2);
    this.helperArrowGeo2.translate(0, 0, -0.68);
    const arrowTip = new THREE.Mesh(this.helperArrowGeo2, this.helperArrowMat);
    this.helperArrowGroup.add(arrowTip);

    this.helperArrowGroup.visible = false;
    this.scene.add(this.helperArrowGroup);

    // Initial camera placement behind the scaled monster truck
    this.camera.position.set(0, this.pos.y + 5.0, this.pos.z + 11.0);
    this.camera.lookAt(this.pos.x, this.pos.y + 1.8, this.pos.z - 4);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('orientationchange', this.handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.container);
    }
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

  public setHelperMode(enabled: boolean): void {
    this.helperMode = enabled;
    this.emitHud();
  }

  public toggleHelperMode(): void {
    this.setHelperMode(!this.helperMode);
  }

  public honk(): void {
    this.audio.playHorn();
    this.chassisBounceVel += 2.2;
    const reacted = this.worldProps.reactAnimalsToTruck(this.pos.x, this.pos.z, true);
    if (reacted) {
      this.audio.playAnimalChirp(reacted);
    }
  }

  public dismissCelebration(): void {
    this.celebrating = false;
    this.emitHud();
  }

  public resetTruck(): void {
    this.audio.unlock();
    const spot = this.worldProps.getRandomSafeSpot(28, WORLD_RADIUS - 65);
    this.pos.set(spot.x, spot.y + 1.1, spot.z);
    this.yaw = spot.yaw;
    this.velY = 0;
    this.speed = 0;
    this.pitchAngle = 0;
    this.pitchVel = 0;
    this.rollAngle = 0;
    this.rollVel = 0;
    this.wheelTravel[0] = 0;
    this.wheelTravel[1] = 0;
    this.wheelTravel[2] = 0;
    this.wheelTravel[3] = 0;
    this.chassisBounce = 0.22;
    this.chassisBounceVel = 0;
    this.airborne = false;
    this.airTime = 0;
    this.peakFallVel = 0;
    this.prevAvgGroundY = spot.y;
    this.celebrating = false;
    this.celebrationTriggered = false;
    this.fireworkShowTimer = 0;
    this.recenterCamera();

    // Randomize all star locations on reset too
    this.worldProps.randomizeStars();
    this.starsCollected = 0;
    this.emitHud();
  }

  private emitParticle(
    x: number,
    y: number,
    z: number,
    isWater: boolean,
    vyBoost = 0,
    spread = 2.4,
    r?: number,
    g?: number,
    b?: number
  ): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % this.PARTICLE_MAX;
    p.active = true;
    p.x = x + (Math.random() - 0.5) * 0.6;
    p.y = y + 0.16;
    p.z = z + (Math.random() - 0.5) * 0.6;
    p.vx = (Math.random() - 0.5) * spread;
    p.vy = (isWater ? 2.8 + Math.random() * 2.6 : 0.9 + Math.random() * 1.4) + vyBoost;
    p.vz = (Math.random() - 0.5) * spread;
    p.life = 0;
    p.maxLife = isWater ? 0.58 + Math.random() * 0.28 : 0.62 + Math.random() * 0.35;
    p.isWater = isWater;
    if (r !== undefined && g !== undefined && b !== undefined) {
      p.r = r;
      p.g = g;
      p.b = b;
    } else if (isWater) {
      p.r = 0.78;
      p.g = 0.95;
      p.b = 1.0;
    } else {
      p.r = 0.78;
      p.g = 0.68;
      p.b = 0.52;
    }
  }

  private spawnWaterRipple(x: number, z: number, maxScale = 4.5): void {
    const r = this.ripples[this.rippleCursor];
    this.rippleCursor = (this.rippleCursor + 1) % this.ripples.length;
    r.active = true;
    r.life = 0;
    r.maxLife = 0.85 + Math.random() * 0.25;
    r.maxScale = maxScale;
    r.mesh.position.set(x, WATER_LEVEL + 0.05, z);
    r.mesh.scale.setScalar(0.8);
    r.mesh.visible = true;
    r.mat.opacity = 0.78;
  }

  private launchFireworkBurst(): void {
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const aheadX = this.pos.x - sinY * (14 + Math.random() * 18) + (Math.random() - 0.5) * 26;
    const aheadZ = this.pos.z - cosY * (14 + Math.random() * 18) + (Math.random() - 0.5) * 26;
    const burstY = this.pos.y + 16 + Math.random() * 10;

    const palette: [number, number, number][] = [
      [1.0, 0.85, 0.2],
      [1.0, 0.28, 0.62],
      [0.25, 0.92, 1.0],
      [0.45, 1.0, 0.35],
      [1.0, 0.52, 0.18],
      [0.75, 0.52, 1.0],
    ];
    const [r, g, b] = palette[Math.floor(Math.random() * palette.length)];

    for (let i = 0; i < 36; i++) {
      const fw = this.fireworks[this.fireworkCursor];
      this.fireworkCursor = (this.fireworkCursor + 1) % this.FIREWORK_MAX;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const spd = 7 + Math.random() * 9;
      fw.active = true;
      fw.x = aheadX;
      fw.y = burstY;
      fw.z = aheadZ;
      fw.vx = Math.sin(phi) * Math.cos(theta) * spd;
      fw.vy = Math.cos(phi) * spd + 2.5;
      fw.vz = Math.sin(phi) * Math.sin(theta) * spd;
      fw.life = 0;
      fw.maxLife = 1.05 + Math.random() * 0.45;
      fw.r = r;
      fw.g = g;
      fw.b = b;
    }
    this.audio.playFireworkBurst();
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
      p.vy -= (p.isWater ? 11.2 : 1.4) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const fade = 1 - p.life / p.maxLife;
      this.particlePositions[i * 3] = p.x;
      this.particlePositions[i * 3 + 1] = p.y;
      this.particlePositions[i * 3 + 2] = p.z;
      this.particleColors[i * 3] = p.r * fade;
      this.particleColors[i * 3 + 1] = p.g * fade;
      this.particleColors[i * 3 + 2] = p.b * fade;
    }
    this.particleGeo.attributes.position.needsUpdate = true;
    this.particleGeo.attributes.color.needsUpdate = true;

    // Update water ripples
    for (let i = 0; i < this.ripples.length; i++) {
      const r = this.ripples[i];
      if (!r.active) continue;
      r.life += dt;
      if (r.life >= r.maxLife) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const t = r.life / r.maxLife;
      const s = 0.8 + t * (r.maxScale - 0.8);
      r.mesh.scale.setScalar(s);
      r.mat.opacity = (1 - t) * 0.72;
    }

    // Update celebratory fireworks
    if (this.fireworkShowTimer > 0) {
      this.fireworkShowTimer -= dt;
      this.fireworkBurstTimer -= dt;
      if (this.fireworkBurstTimer <= 0) {
        this.fireworkBurstTimer = 0.58 + Math.random() * 0.25;
        this.launchFireworkBurst();
      }
    }
    for (let i = 0; i < this.FIREWORK_MAX; i++) {
      const fw = this.fireworks[i];
      if (!fw.active) continue;
      fw.life += dt;
      if (fw.life >= fw.maxLife) {
        fw.active = false;
        this.fireworkPositions[i * 3 + 1] = -999;
        continue;
      }
      fw.vx *= Math.exp(-1.1 * dt);
      fw.vz *= Math.exp(-1.1 * dt);
      fw.vy -= 7.2 * dt;
      fw.x += fw.vx * dt;
      fw.y += fw.vy * dt;
      fw.z += fw.vz * dt;
      const fade = 1 - fw.life / fw.maxLife;
      this.fireworkPositions[i * 3] = fw.x;
      this.fireworkPositions[i * 3 + 1] = fw.y;
      this.fireworkPositions[i * 3 + 2] = fw.z;
      this.fireworkColors[i * 3] = fw.r * fade;
      this.fireworkColors[i * 3 + 1] = fw.g * fade;
      this.fireworkColors[i * 3 + 2] = fw.b * fade;
    }
    this.fireworkGeo.attributes.position.needsUpdate = true;
    this.fireworkGeo.attributes.color.needsUpdate = true;
  }

  private updatePhysics(dt: number): void {
    const GRAVITY = 19.6;
    const REST_SAG = 0.26;
    const MAX_COMP = 0.54;
    const SPRING_K = (GRAVITY * 0.25) / REST_SAG;
    const DAMPER_COMP = 2.4;
    const DAMPER_REBOUND = 3.1;
    const halfTrack = 1.62 * TRUCK_SCALE;
    const halfWheelbase = 1.78 * TRUCK_SCALE;

    const maxSpeed = this.input.boost ? 36 : 24;
    const accel = this.input.boost ? 36 : 22;
    const reverseMax = -12;

    const targetSteer = (this.input.left ? 1 : 0) - (this.input.right ? 1 : 0);
    this.steerAngle = THREE.MathUtils.damp(this.steerAngle, targetSteer * 0.46, 10, dt);

    const subSteps = Math.max(1, Math.ceil(dt / 0.016));
    const subDt = dt / subSteps;

    let avgGroundY = this.pos.y;
    let groundedCount = 4;
    let maxImpactVel = 0;
    let compFL = REST_SAG;
    let compFR = REST_SAG;
    let compRL = REST_SAG;
    let compRR = REST_SAG;

    for (let step = 0; step < subSteps; step++) {
      const sinY = Math.sin(this.yaw);
      const cosY = Math.cos(this.yaw);
      const fx = -sinY;
      const fz = -cosY;
      const rx = cosY;
      const rz = -sinY;

      // Sample drivable terrain/ramps/bridges at the 4 wheel footprints
      const flX = this.pos.x + fx * halfWheelbase - rx * halfTrack;
      const flZ = this.pos.z + fz * halfWheelbase - rz * halfTrack;
      const frX = this.pos.x + fx * halfWheelbase + rx * halfTrack;
      const frZ = this.pos.z + fz * halfWheelbase + rz * halfTrack;
      const rlX = this.pos.x - fx * halfWheelbase - rx * halfTrack;
      const rlZ = this.pos.z - fz * halfWheelbase - rz * halfTrack;
      const rrX = this.pos.x - fx * halfWheelbase + rx * halfTrack;
      const rrZ = this.pos.z - fz * halfWheelbase + rz * halfTrack;

      const hFL = surfaceHeightAt(flX, flZ);
      const hFR = surfaceHeightAt(frX, frZ);
      const hRL = surfaceHeightAt(rlX, rlZ);
      const hRR = surfaceHeightAt(rrX, rrZ);
      avgGroundY = (hFL + hFR + hRL + hRR) * 0.25;

      const sinPitch = Math.sin(this.pitchAngle);
      const sinRoll = Math.sin(this.rollAngle);

      // Corner heights relative to truck center (rotation.order = 'YXZ')
      const yFL = this.pos.y + sinPitch * halfWheelbase - sinRoll * halfTrack;
      const yFR = this.pos.y + sinPitch * halfWheelbase + sinRoll * halfTrack;
      const yRL = this.pos.y - sinPitch * halfWheelbase - sinRoll * halfTrack;
      const yRR = this.pos.y - sinPitch * halfWheelbase + sinRoll * halfTrack;

      compFL = REST_SAG + (hFL - yFL);
      compFR = REST_SAG + (hFR - yFR);
      compRL = REST_SAG + (hRL - yRL);
      compRR = REST_SAG + (hRR - yRR);

      // Corner vertical velocities
      const vFL = this.velY + this.pitchVel * halfWheelbase - this.rollVel * halfTrack;
      const vFR = this.velY + this.pitchVel * halfWheelbase + this.rollVel * halfTrack;
      const vRL = this.velY - this.pitchVel * halfWheelbase - this.rollVel * halfTrack;
      const vRR = this.velY - this.pitchVel * halfWheelbase + this.rollVel * halfTrack;

      // 4-corner spring-damper forces (0 when wheel droops clear of ground)
      const fFL = compFL > 0 ? Math.max(0, SPRING_K * compFL - (vFL < 0 ? DAMPER_COMP : DAMPER_REBOUND) * vFL) : 0;
      const fFR = compFR > 0 ? Math.max(0, SPRING_K * compFR - (vFR < 0 ? DAMPER_COMP : DAMPER_REBOUND) * vFR) : 0;
      const fRL = compRL > 0 ? Math.max(0, SPRING_K * compRL - (vRL < 0 ? DAMPER_COMP : DAMPER_REBOUND) * vRL) : 0;
      const fRR = compRR > 0 ? Math.max(0, SPRING_K * compRR - (vRR < 0 ? DAMPER_COMP : DAMPER_REBOUND) * vRR) : 0;

      const gFL = compFL > 0 ? 1 : 0;
      const gFR = compFR > 0 ? 1 : 0;
      const gRL = compRL > 0 ? 1 : 0;
      const gRR = compRR > 0 ? 1 : 0;
      groundedCount = gFL + gFR + gRL + gRR;
      const groundedRatio = groundedCount * 0.25;
      const frontGrounded = gFL + gFR;
      const rearGrounded = gRL + gRR;

      // Ground-coupled drive acceleration, rolling/air drag, slope gravity & steering
      const driveTraction = groundedCount > 0 ? 0.35 + 0.65 * groundedRatio : 0;
      if (this.input.forward) {
        this.speed += accel * driveTraction * subDt;
      } else if (this.input.backward) {
        if (this.speed > 1.5) {
          this.speed -= 34 * driveTraction * subDt;
        } else {
          this.speed -= 16 * driveTraction * subDt;
        }
      } else {
        const dragRate = groundedCount > 0 ? 1.95 * groundedRatio + 0.15 : 0.16;
        this.speed *= Math.exp(-dragRate * subDt);
        if (groundedCount > 0 && Math.abs(this.speed) < 0.08) this.speed = 0;
      }

      if (groundedCount > 0) {
        // Gentle hill gravity pull on slopes without stalling climbs
        this.speed -= GRAVITY * sinPitch * groundedRatio * 0.32 * subDt;
      }
      this.speed = THREE.MathUtils.clamp(this.speed, reverseMax, maxSpeed);

      const speedFactor = Math.min(1, Math.abs(this.speed) / 4.2);
      const turnDir = this.speed >= -0.2 ? 1 : -1;
      const steerTraction = groundedCount > 0 ? 0.3 + 0.7 * groundedRatio : 0.05;
      this.yaw += this.steerAngle * 2.55 * speedFactor * turnDir * steerTraction * subDt;

      const nSinY = Math.sin(this.yaw);
      const nCosY = Math.cos(this.yaw);
      const nFx = -nSinY;
      const nFz = -nCosY;

      this.pos.x += nFx * this.speed * subDt;
      this.pos.z += nFz * this.speed * subDt;

      // Solid tree & boulder collision (2 passes + inward velocity cancellation)
      const truckRadius = 2.15 * TRUCK_SCALE;
      const obs = this.worldProps.obstacles;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < obs.length; i++) {
          const o = obs[i];
          const dx = this.pos.x - o.x;
          const dz = this.pos.z - o.z;
          const minD = truckRadius + o.radius;
          const distSq = dx * dx + dz * dz;
          if (distSq < minD * minD && distSq > 0.0001) {
            const dist = Math.sqrt(distSq);
            const nx = dx / dist;
            const nz = dz / dist;
            const push = minD - dist;
            this.pos.x += nx * push;
            this.pos.z += nz * push;

            if (pass === 0) {
              const vx = nFx * this.speed;
              const vz = nFz * this.speed;
              const inwardDot = vx * nx + vz * nz;
              if (inwardDot < 0) {
                const absSpd = Math.max(0.5, Math.abs(this.speed));
                const headOn = Math.min(1, -inwardDot / absSpd);
                this.speed *= 1 - headOn * 0.72;
                if (-inwardDot > 8.5) {
                  this.chassisBounceVel -= 1.6;
                }
              }
            }
          }
        }
      }

      // Water hydrodynamic resistance when submerged in creek/lake
      if (this.wasInWater) {
        this.speed *= Math.exp(-0.95 * subDt);
      }

      // Soft valley perimeter turn-in
      const radialDist = Math.hypot(this.pos.x, this.pos.z);
      if (radialDist > WORLD_RADIUS) {
        const nx = this.pos.x / radialDist;
        const nz = this.pos.z / radialDist;
        this.pos.x = nx * WORLD_RADIUS;
        this.pos.z = nz * WORLD_RADIUS;
        this.speed *= 0.88;
      }

      // Vertical spring integration + ballistic gravity
      const totalSpringAccel = fFL + fFR + fRL + fRR;
      this.velY += (totalSpringAccel - GRAVITY) * subDt;
      this.pos.y += this.velY * subDt;

      // Pitch & roll rotational dynamics from suspension forces + cornering body lean + air attitude control
      let rawPitchForce = (fFL + fFR) - (fRL + fRR);
      // Avoid premature nose-dive when front wheels clear a ramp lip while climbing
      if (frontGrounded === 0 && rearGrounded > 0 && this.velY > 1.2 && rawPitchForce < 0) {
        rawPitchForce *= 0.25;
      }
      const airNoseControl =
        groundedCount === 0
          ? (this.input.forward ? 1.15 : 0) + (this.input.backward ? -1.45 : 0) - 0.16
          : 0;
      const driveSquat = groundedCount > 0 && this.input.forward ? 1.35 * groundedRatio : 0;
      const pitchAccel = rawPitchForce * 0.44 - this.pitchVel * (groundedCount > 0 ? 5.2 : 1.8) + airNoseControl + driveSquat;
      this.pitchVel += pitchAccel * subDt;
      this.pitchAngle = THREE.MathUtils.clamp(this.pitchAngle + this.pitchVel * subDt, -0.56, 0.56);
      if (Math.abs(this.pitchAngle) >= 0.559) this.pitchVel *= 0.4;

      const rawRollForce = (fFR + fRR) - (fFL + fRL);
      const turnCentrifugalRoll = -this.steerAngle * (this.speed / 24) * 3.2 * groundedRatio;
      const rollAccel = rawRollForce * 0.48 + turnCentrifugalRoll - this.rollVel * (groundedCount > 0 ? 5.8 : 2.2);
      this.rollVel += rollAccel * subDt;
      this.rollAngle = THREE.MathUtils.clamp(this.rollAngle + this.rollVel * subDt, -0.42, 0.42);
      if (Math.abs(this.rollAngle) >= 0.419) this.rollVel *= 0.4;

      // Bump-stop constraint so chassis/tires never clip into terrain or ramp surfaces
      const maxSink = MAX_COMP - REST_SAG;
      const sinP2 = Math.sin(this.pitchAngle);
      const sinR2 = Math.sin(this.rollAngle);
      const cYFL = this.pos.y + sinP2 * halfWheelbase - sinR2 * halfTrack;
      const cYFR = this.pos.y + sinP2 * halfWheelbase + sinR2 * halfTrack;
      const cYRL = this.pos.y - sinP2 * halfWheelbase - sinR2 * halfTrack;
      const cYRR = this.pos.y - sinP2 * halfWheelbase + sinR2 * halfTrack;

      const penFL = hFL - maxSink - cYFL;
      const penFR = hFR - maxSink - cYFR;
      const penRL = hRL - maxSink - cYRL;
      const penRR = hRR - maxSink - cYRR;
      const maxPen = Math.max(penFL, penFR, penRL, penRR);

      const groundRiseVel = THREE.MathUtils.clamp((avgGroundY - this.prevAvgGroundY) / subDt, 0, 14);
      this.prevAvgGroundY = avgGroundY;

      if (maxPen > 0) {
        this.pos.y += maxPen;
        if (this.velY < -maxImpactVel) {
          maxImpactVel = -this.velY;
        }
        if (this.velY < 0) {
          // Cushion bump-stop bounce with realistic tire rebound
          this.velY = Math.max(0, -this.velY * 0.14);
        } else if (groundedCount >= 2 && groundRiseVel > 1.0) {
          // Ramp/crest upward deflection follows the ramp slope at high speed
          this.velY = Math.max(this.velY, groundRiseVel * 0.92);
        }
        // Align pitch on hard axle bump-stop hits
        if (penFL > 0 || penFR > 0) {
          this.pitchVel += Math.max(penFL, penFR) * 4.5;
        }
        if (penRL > 0 || penRR > 0) {
          this.pitchVel -= Math.max(penRL, penRR) * 4.5;
        }
      }
    }

    // Airborne state & touchdown impact feedback
    if (groundedCount === 0) {
      this.airTime += dt;
      if (this.velY < 0 && -this.velY > this.peakFallVel) {
        this.peakFallVel = -this.velY;
      }
    } else {
      const impactVel = Math.max(maxImpactVel, this.peakFallVel);
      if (this.airborne && (impactVel > 1.8 || this.airTime > 0.22)) {
        const impact = Math.min(1.6, Math.max(impactVel, this.airTime * 6.0) * 0.13);
        this.chassisBounceVel -= impact * 4.6;
        if (impact > 0.22) {
          this.audio.playLandingThump(impact);
        }
        // Landing dust / water splash burst around all 4 tires
        const sinY = Math.sin(this.yaw);
        const cosY = Math.cos(this.yaw);
        const fx = -sinY;
        const fz = -cosY;
        const rx = cosY;
        const rz = -sinY;
        const inCreek = groundHeightAt(this.pos.x, this.pos.z) < WATER_LEVEL + 0.15;
        for (let b = 0; b < 8; b++) {
          const side = b % 2 === 0 ? -1 : 1;
          const end = b < 4 ? 1 : -1;
          this.emitParticle(
            this.pos.x + fx * halfWheelbase * end + rx * halfTrack * side,
            this.pos.y + 0.15,
            this.pos.z + fz * halfWheelbase * end + rz * halfTrack * side,
            inCreek
          );
        }
      }
      this.airTime = 0;
      this.peakFallVel = 0;
    }

    const heightAboveGround = Math.max(0, this.pos.y - avgGroundY);
    this.airborne = groundedCount === 0 && (heightAboveGround > 0.26 || this.airTime > 0.09);

    const springForce = -72 * this.chassisBounce - 9.5 * this.chassisBounceVel;
    this.chassisBounceVel += springForce * dt;
    this.chassisBounce += this.chassisBounceVel * dt;
    this.chassisBounce = THREE.MathUtils.clamp(this.chassisBounce, -0.35, 0.42);

    this.truck.root.position.copy(this.pos);
    this.truck.root.rotation.order = 'YXZ';
    this.truck.root.rotation.set(this.pitchAngle, this.yaw, this.rollAngle);
    this.truck.chassisGroup.position.y = this.chassisBounce;

    // Independent 4-wheel suspension travel (droops in air, compresses over bumps/landings)
    this.wheelTravel[0] = THREE.MathUtils.damp(
      this.wheelTravel[0],
      THREE.MathUtils.clamp((compFL - REST_SAG) / TRUCK_SCALE, -0.38, 0.34),
      24,
      dt
    );
    this.wheelTravel[1] = THREE.MathUtils.damp(
      this.wheelTravel[1],
      THREE.MathUtils.clamp((compFR - REST_SAG) / TRUCK_SCALE, -0.38, 0.34),
      24,
      dt
    );
    this.wheelTravel[2] = THREE.MathUtils.damp(
      this.wheelTravel[2],
      THREE.MathUtils.clamp((compRL - REST_SAG) / TRUCK_SCALE, -0.38, 0.34),
      24,
      dt
    );
    this.wheelTravel[3] = THREE.MathUtils.damp(
      this.wheelTravel[3],
      THREE.MathUtils.clamp((compRR - REST_SAG) / TRUCK_SCALE, -0.38, 0.34),
      24,
      dt
    );
    this.truck.wheelPivots.fl.position.y = this.truck.wheelRadius + this.wheelTravel[0];
    this.truck.wheelPivots.fr.position.y = this.truck.wheelRadius + this.wheelTravel[1];
    this.truck.wheelPivots.rl.position.y = this.truck.wheelRadius + this.wheelTravel[2];
    this.truck.wheelPivots.rr.position.y = this.truck.wheelRadius + this.wheelTravel[3];

    const scaledWheelR = this.truck.wheelRadius * TRUCK_SCALE;
    if (groundedCount > 0) {
      this.wheelSpin -= (this.speed / scaledWheelR) * dt;
    } else if (this.input.forward) {
      this.wheelSpin -= (this.input.boost ? 28 : 19) * dt;
    } else if (this.input.backward) {
      this.wheelSpin += 9 * dt;
    } else {
      this.wheelSpin -= (this.speed / scaledWheelR) * 0.45 * dt;
    }
    this.truck.wheelPivots.fl.rotation.y = this.steerAngle;
    this.truck.wheelPivots.fr.rotation.y = this.steerAngle;
    this.truck.wheelSpinners.fl.rotation.x = this.wheelSpin;
    this.truck.wheelSpinners.fr.rotation.x = this.wheelSpin;
    this.truck.wheelSpinners.rl.rotation.x = this.wheelSpin;
    this.truck.wheelSpinners.rr.rotation.x = this.wheelSpin;

    const shadowScale = Math.max(0.55, 1 - heightAboveGround * 0.08);
    this.truck.contactShadow.scale.set(shadowScale, 1, shadowScale);
    this.truck.contactShadow.position.y = 0.05 - heightAboveGround / TRUCK_SCALE;
    const shadowMat = this.truck.contactShadow.material as THREE.MeshBasicMaterial;
    shadowMat.opacity = Math.max(0.1, 0.55 - heightAboveGround * 0.08);

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

    // Water entry splash, expanding ripples & 4-wheel wake plumes vs dry dust
    const baseTerrainY = groundHeightAt(this.pos.x, this.pos.z);
    const inWater = groundedCount > 0 && baseTerrainY < WATER_LEVEL + 0.04 && this.pos.y < WATER_LEVEL + 0.35;
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const fx = -sinY;
    const fz = -cosY;
    const rx = cosY;
    const rz = -sinY;

    if (inWater && !this.wasInWater) {
      this.audio.playSplash(Math.min(1.35, 0.7 + absSpeed * 0.04));
      this.chassisBounceVel -= Math.min(3.5, 1.2 + absSpeed * 0.12);
      this.spawnWaterRipple(this.pos.x, this.pos.z, 6.2);
      this.spawnWaterRipple(this.pos.x + fx * 1.1, this.pos.z + fz * 1.1, 4.4);
      for (let s = 0; s < 18; s++) {
        const angle = (s / 18) * Math.PI * 2;
        this.emitParticle(
          this.pos.x + Math.cos(angle) * 1.4,
          WATER_LEVEL + 0.1,
          this.pos.z + Math.sin(angle) * 1.4,
          true,
          2.2 + Math.random() * 1.8,
          6.2
        );
      }
    }
    this.wasInWater = inWater;

    this.waterRippleTimer += dt;
    if (inWater && absSpeed > 1.2 && this.waterRippleTimer > 0.15) {
      this.waterRippleTimer = 0;
      this.spawnWaterRipple(this.pos.x, this.pos.z, 3.8 + Math.min(2.2, absSpeed * 0.1));
      this.chassisBounceVel += Math.sin(this.clock.elapsedTime * 9) * 0.35;
    }

    this.particleEmitTimer += dt;
    if (groundedCount > 0 && absSpeed > (inWater ? 1.2 : 3.5) && this.particleEmitTimer > (inWater ? 0.036 : 0.045)) {
      this.particleEmitTimer = 0;
      const rearDist = 1.8 * TRUCK_SCALE;
      const sideDist = 1.5 * TRUCK_SCALE;
      const rearLx = this.pos.x - fx * rearDist - rx * sideDist;
      const rearLz = this.pos.z - fz * rearDist - rz * sideDist;
      const rearRx = this.pos.x - fx * rearDist + rx * sideDist;
      const rearRz = this.pos.z - fz * rearDist + rz * sideDist;
      this.emitParticle(rearLx, this.pos.y + 0.18, rearLz, inWater, inWater ? 1.1 : 0, inWater ? 3.8 : 2.2);
      this.emitParticle(rearRx, this.pos.y + 0.18, rearRz, inWater, inWater ? 1.1 : 0, inWater ? 3.8 : 2.2);
      if (inWater) {
        const frontLx = this.pos.x + fx * rearDist - rx * sideDist;
        const frontLz = this.pos.z + fz * rearDist - rz * sideDist;
        const frontRx = this.pos.x + fx * rearDist + rx * sideDist;
        const frontRz = this.pos.z + fz * rearDist + rz * sideDist;
        this.emitParticle(frontLx, WATER_LEVEL + 0.12, frontLz, true, 1.5, 4.4);
        this.emitParticle(frontRx, WATER_LEVEL + 0.12, frontRz, true, 1.5, 4.4);
      }
    }

    // Smashable Props (crates, hay bales, traffic cones)
    const smashables = this.worldProps.smashables;
    const hitRadius = 2.1 * TRUCK_SCALE;
    for (let i = 0; i < smashables.length; i++) {
      const sp = smashables[i];
      if (sp.smashed) continue;
      const dx = sp.x - this.pos.x;
      const dz = sp.z - this.pos.z;
      const minD = hitRadius + sp.radius;
      if (dx * dx + dz * dz < minD * minD && Math.abs(this.pos.y - sp.y) < 2.6) {
        this.worldProps.smashProp(sp, fx * this.speed, fz * this.speed);
        this.audio.playPropSmash();
        this.speed *= 0.985;
        this.chassisBounceVel += 0.9;
        const [pr, pg, pb] =
          sp.kind === 'cone' ? [1.0, 0.48, 0.12] : sp.kind === 'hay' ? [0.96, 0.78, 0.18] : [0.88, 0.62, 0.3];
        for (let k = 0; k < 8; k++) {
          this.emitParticle(sp.x, sp.y + 0.5, sp.z, false, 2.2, 5.2, pr, pg, pb);
        }
      }
    }

    // Forest Animal Proximity Reactions
    this.animalCheckTimer += dt;
    if (this.animalCheckTimer >= 0.25) {
      this.animalCheckTimer = 0;
      const nearAnimal = this.worldProps.reactAnimalsToTruck(this.pos.x, this.pos.z, false);
      if (nearAnimal) {
        this.audio.playAnimalChirp(nearAnimal);
      }
    }

    // Collect Golden Pine Stars & Trigger Fireworks Celebration
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
        if (this.starsCollected >= stars.length && !this.celebrationTriggered) {
          this.celebrationTriggered = true;
          this.celebrating = true;
          this.fireworkShowTimer = 9.5;
          this.fireworkBurstTimer = 0.05;
          this.audio.playCelebrationFanfare();
        }
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

    const isShortLandscape = this.camera.aspect > 1.75 && (this.container.clientHeight || window.innerHeight) < 520;
    const baseFov = isShortLandscape ? 68 : 62;
    const targetFov = this.input.boost ? baseFov + 8 : baseFov + Math.min(6, Math.abs(this.speed) * 0.22);
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
    const uncollectedStars: { x: number; z: number }[] = [];
    for (let i = 0; i < this.worldProps.stars.length; i++) {
      const st = this.worldProps.stars[i];
      if (!st.collected) {
        uncollectedStars.push({ x: st.x, z: st.z });
      }
    }
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
      truckX: this.pos.x,
      truckZ: this.pos.z,
      truckYaw: this.yaw,
      uncollectedStars,
      celebrating: this.celebrating,
      helperMode: this.helperMode,
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
    this.worldProps.update(elapsed, dt, this.timeOfDay === 'starlight', this.helperMode);

    // Update 3D floating guide arrow when Helper Mode is active
    if (this.helperMode) {
      let nearestDistSq = Infinity;
      let nearestX = 0;
      let nearestZ = 0;
      let foundStar = false;
      const stars = this.worldProps.stars;
      for (let i = 0; i < stars.length; i++) {
        const st = stars[i];
        if (st.collected) continue;
        const dx = st.x - this.pos.x;
        const dz = st.z - this.pos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < nearestDistSq) {
          nearestDistSq = dSq;
          nearestX = st.x;
          nearestZ = st.z;
          foundStar = true;
        }
      }
      if (foundStar) {
        this.helperArrowGroup.visible = true;
        const targetYaw = Math.atan2(-(nearestX - this.pos.x), -(nearestZ - this.pos.z));
        const delta = ((targetYaw - this.helperArrowYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        this.helperArrowYaw += delta * (1 - Math.exp(-10 * dt));
        this.helperArrowGroup.position.set(
          this.pos.x,
          this.pos.y + 2.85 + Math.sin(elapsed * 4.2) * 0.14,
          this.pos.z
        );
        this.helperArrowGroup.rotation.set(0, this.helperArrowYaw, 0);
      } else {
        this.helperArrowGroup.visible = false;
      }
    } else {
      this.helperArrowGroup.visible = false;
    }

    this.terrainRig.waterMesh.position.y = WATER_LEVEL + Math.sin(elapsed * 1.8) * 0.035;
    this.textures.waterRippleMap.offset.x = (this.textures.waterRippleMap.offset.x + dt * 0.06) % 1;
    this.textures.waterRippleMap.offset.y = (this.textures.waterRippleMap.offset.y + dt * 0.035) % 1;
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
    window.removeEventListener('orientationchange', this.handleResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
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
    this.rippleGeo.dispose();
    this.ripples.forEach((r) => r.mat.dispose());
    this.fireworkGeo.dispose();
    this.fireworkMat.dispose();
    this.helperArrowGeo1.dispose();
    this.helperArrowGeo2.dispose();
    this.helperArrowMat.dispose();
    this.envRT.dispose();
    this.renderer.dispose();

    if (canvas.parentNode === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
