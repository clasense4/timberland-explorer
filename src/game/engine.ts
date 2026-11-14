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
const _upVec = new THREE.Vector3(0, 1, 0);

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
    fogDensity: 0.0042,
    sunColor: 0xfff3d6,
    sunIntensity: 2.1,
    sunPos: [65, 90, 48],
    hemiSky: 0x9fd8ff,
    hemiGround: 0x3f5e36,
    hemiIntensity: 0.95,
    isNight: false,
  },
  sunset: {
    bg: 0xf4a261,
    fog: 0xeb9458,
    fogDensity: 0.0052,
    sunColor: 0xffb36b,
    sunIntensity: 2.25,
    sunPos: [-90, 34, -55],
    hemiSky: 0xffcda3,
    hemiGround: 0x3c2c2e,
    hemiIntensity: 0.85,
    isNight: false,
  },
  starlight: {
    bg: 0x132036,
    fog: 0x16243b,
    fogDensity: 0.0055,
    sunColor: 0xa5c8ff,
    sunIntensity: 1.05,
    sunPos: [45, 85, -60],
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
  private yaw = 0; // 0 = facing -Z
  private speed = 0;
  private steerAngle = 0;
  private wheelSpin = 0;
  private pitchAngle = 0;
  private rollAngle = 0;
  private chassisBounce = 0;
  private chassisBounceVel = 0;
  private airborne = false;
  private wasInWater = false;

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

    // 1. Software WebGL detection (used strictly for render cost & frame pacing)
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
    container.appendChild(this.renderer.domElement);

    // WebGL context loss safety
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);

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

    this.camera = new THREE.PerspectiveCamera(62, width / height, 0.3, 480);

    // 4. Outdoor 2-Light Rig (Warm Directional Sun + Cool Hemisphere Fill)
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
    this.sunLight.shadow.camera.far = 230;
    const d = 58;
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
    this.pos.y = surfaceHeightAt(this.pos.x, this.pos.z);
    this.truck.root.position.copy(this.pos);
    this.scene.add(this.truck.root);

    this.worldProps = createWorldProps(this.textures);
    this.scene.add(this.worldProps.group);

    // 6. Particle Pool Setup (Dust & Water Splashes)
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
      size: 1.5,
      map: this.textures.particleMap,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const particlePoints = new THREE.Points(this.particleGeo, this.particleMat);
    particlePoints.frustumCulled = false;
    this.scene.add(particlePoints);

    // Place camera cleanly behind truck on start
    this.camera.position.set(0, this.pos.y + 6.5, this.pos.z + 14.5);
    this.camera.lookAt(this.pos.x, this.pos.y + 2.2, this.pos.z - 4);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    window.addEventListener('resize', this.handleResize);
    this.emitHud();
    this.clock.start();
    this.scheduleNextTick();
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
  }

  public honk(): void {
    this.audio.playHorn();
    // Playful happy bounce when honking!
    this.chassisBounceVel += 2.2;
  }

  public resetTruck(): void {
    this.audio.unlock();
    const groundY = surfaceHeightAt(this.pos.x, this.pos.z);
    // If near outer rim, return to sunny clearing
    if (Math.hypot(this.pos.x, this.pos.z) > WORLD_RADIUS - 20) {
      this.pos.set(0, surfaceHeightAt(0, 8), 8);
      this.yaw = 0;
    } else {
      this.pos.y = groundY + 1.4;
    }
    this.velY = 0;
    this.speed = 0;
    this.pitchAngle = 0;
    this.rollAngle = 0;
    this.chassisBounce = 0.25;
    this.chassisBounceVel = 0;
    this.airborne = false;
  }

  private emitParticle(x: number, y: number, z: number, isWater: boolean): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % this.PARTICLE_MAX;
    p.active = true;
    p.x = x + (Math.random() - 0.5) * 0.7;
    p.y = y + 0.2;
    p.z = z + (Math.random() - 0.5) * 0.7;
    p.vx = (Math.random() - 0.5) * 2.4;
    p.vy = isWater ? 2.8 + Math.random() * 2.4 : 1.0 + Math.random() * 1.4;
    p.vz = (Math.random() - 0.5) * 2.4;
    p.life = 0;
    p.maxLife = isWater ? 0.55 + Math.random() * 0.25 : 0.65 + Math.random() * 0.35;
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
    const maxSpeed = this.input.boost ? 34 : 23;
    const accel = this.input.boost ? 36 : 22;
    const reverseMax = -12;

    // 1. Longitudinal throttle & friendly braking
    if (this.input.forward) {
      this.speed += accel * dt;
    } else if (this.input.backward) {
      if (this.speed > 1.5) {
        this.speed -= 34 * dt; // Smooth brake
      } else {
        this.speed -= 16 * dt; // Reverse
      }
    } else {
      // Gentle rolling drag
      this.speed *= Math.exp(-2.1 * dt);
      if (Math.abs(this.speed) < 0.08) this.speed = 0;
    }
    this.speed = THREE.MathUtils.clamp(this.speed, reverseMax, maxSpeed);

    // 2. Smooth kid-friendly steering
    const targetSteer = (this.input.left ? 1 : 0) - (this.input.right ? 1 : 0);
    this.steerAngle = THREE.MathUtils.damp(this.steerAngle, targetSteer * 0.46, 10, dt);

    const speedFactor = Math.min(1, Math.abs(this.speed) / 4.5);
    const turnDir = this.speed >= -0.2 ? 1 : -1;
    // Allow slight stationary turning only when moving, crisp arc at speed
    this.yaw += this.steerAngle * 2.55 * speedFactor * turnDir * dt;

    // 3. Move along forward vector (-Z local)
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const fx = -sinY;
    const fz = -cosY;
    const rx = cosY;
    const rz = -sinY;

    this.pos.x += fx * this.speed * dt;
    this.pos.z += fz * this.speed * dt;

    // 4. Gentle tree/boulder deflection (never traps the child!)
    const truckRadius = 2.1;
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
        // Softly scrub a bit of speed without jarring full stop
        this.speed *= 0.92;
      }
    }

    // 5. Natural mountain perimeter turn-in (soft pushback inside valley)
    const radialDist = Math.hypot(this.pos.x, this.pos.z);
    if (radialDist > WORLD_RADIUS) {
      const nx = this.pos.x / radialDist;
      const nz = this.pos.z / radialDist;
      this.pos.x = nx * WORLD_RADIUS;
      this.pos.z = nz * WORLD_RADIUS;
      // Gently steer velocity inward
      this.speed *= 0.85;
    }

    // 6. 4-Wheel terrain contact sampling (supports hills, bridges & ramps!)
    const halfTrack = 1.62;
    const halfWheelbase = 1.78;

    const hFL = surfaceHeightAt(this.pos.x + fx * halfWheelbase - rx * halfTrack, this.pos.z + fz * halfWheelbase - rz * halfTrack);
    const hFR = surfaceHeightAt(this.pos.x + fx * halfWheelbase + rx * halfTrack, this.pos.z + fz * halfWheelbase + rz * halfTrack);
    const hRL = surfaceHeightAt(this.pos.x - fx * halfWheelbase - rx * halfTrack, this.pos.z - fz * halfWheelbase - rz * halfTrack);
    const hRR = surfaceHeightAt(this.pos.x - fx * halfWheelbase + rx * halfTrack, this.pos.z - fz * halfWheelbase + rz * halfTrack);

    const avgGroundY = (hFL + hFR + hRL + hRR) * 0.25;
    const prevGroundY = surfaceHeightAt(this.pos.x - fx * 0.5, this.pos.z - fz * 0.5);
    const slopeLaunch = (avgGroundY - prevGroundY) * Math.max(0, this.speed) * 0.45;

    // Gravity & ramp launch
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
      // Launch into air off steep ramp lips
      if (slopeLaunch > 3.2 && this.speed > 13) {
        this.velY = Math.min(11.5, slopeLaunch * 1.15);
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

    // 7. Chassis pitch, roll & bouncy monster suspension
    const targetPitch = Math.atan2((hFL + hFR) * 0.5 - (hRL + hRR) * 0.5, halfWheelbase * 2);
    const targetRoll = Math.atan2((hRL + hFL) * 0.5 - (hRR + hFR) * 0.5, halfTrack * 2);
    const turnBodyRoll = -this.steerAngle * (this.speed / 26) * 0.14;

    this.pitchAngle = THREE.MathUtils.damp(this.pitchAngle, targetPitch, 9, dt);
    this.rollAngle = THREE.MathUtils.damp(this.rollAngle, targetRoll + turnBodyRoll, 9, dt);

    // Second-order spring suspension bounce
    const springForce = -72 * this.chassisBounce - 9.5 * this.chassisBounceVel;
    this.chassisBounceVel += springForce * dt;
    this.chassisBounce += this.chassisBounceVel * dt;
    this.chassisBounce = THREE.MathUtils.clamp(this.chassisBounce, -0.35, 0.42);

    // Apply transform to truck root & chassis
    this.truck.root.position.copy(this.pos);
    this.truck.root.rotation.order = 'YXZ';
    this.truck.root.rotation.set(this.pitchAngle, this.yaw, this.rollAngle);
    this.truck.chassisGroup.position.y = this.chassisBounce;

    // Spin & steer wheels
    this.wheelSpin -= (this.speed / this.truck.wheelRadius) * dt;
    this.truck.wheelPivots.fl.rotation.y = this.steerAngle;
    this.truck.wheelPivots.fr.rotation.y = this.steerAngle;
    this.truck.wheelSpinners.fl.rotation.x = this.wheelSpin;
    this.truck.wheelSpinners.fr.rotation.x = this.wheelSpin;
    this.truck.wheelSpinners.rl.rotation.x = this.wheelSpin;
    this.truck.wheelSpinners.rr.rotation.x = this.wheelSpin;

    // Ground contact shadow gently shrinks/fades when jumping high
    const heightAboveGround = Math.max(0, this.pos.y - avgGroundY);
    const shadowScale = Math.max(0.55, 1 - heightAboveGround * 0.08);
    this.truck.contactShadow.scale.set(shadowScale, 1, shadowScale);
    this.truck.contactShadow.position.y = 0.05 - heightAboveGround * 0.85;

    // 8. Creek splash & dust particles
    const baseTerrainY = groundHeightAt(this.pos.x, this.pos.z);
    const inWater = !this.airborne && baseTerrainY < WATER_LEVEL + 0.05 && this.pos.y < WATER_LEVEL + 0.4;
    if (inWater && !this.wasInWater && Math.abs(this.speed) > 4) {
      this.audio.playSplash();
    }
    this.wasInWater = inWater;

    this.particleEmitTimer += dt;
    if (!this.airborne && Math.abs(this.speed) > 3.5 && this.particleEmitTimer > 0.045) {
      this.particleEmitTimer = 0;
      const rearLx = this.pos.x - fx * 1.8 - rx * 1.5;
      const rearLz = this.pos.z - fz * 1.8 - rz * 1.5;
      const rearRx = this.pos.x - fx * 1.8 + rx * 1.5;
      const rearRz = this.pos.z - fz * 1.8 + rz * 1.5;
      this.emitParticle(rearLx, this.pos.y + 0.15, rearLz, inWater);
      this.emitParticle(rearRx, this.pos.y + 0.15, rearRz, inWater);
    }

    // 9. Collect Golden Pine Stars (generous 4.2m radius)
    const stars = this.worldProps.stars;
    for (let i = 0; i < stars.length; i++) {
      const st = stars[i];
      if (st.collected) continue;
      const dist = Math.hypot(this.pos.x - st.x, this.pos.y + 1.5 - st.y, this.pos.z - st.z);
      if (dist < 4.5) {
        st.collected = true;
        st.group.visible = false;
        this.starsCollected++;
        this.audio.playStarChime();
        this.chassisBounceVel += 1.6;
        this.emitHud();
      }
    }

    // 10. Update audio engine pitch
    this.audio.updateEngine(
      Math.abs(this.speed) / 24,
      this.input.forward || this.input.backward,
      this.input.boost
    );
  }

  private updateCamera(dt: number): void {
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    _forwardVec.set(-sinY, 0, -cosY);

    if (this.cameraMode === 'chase') {
      _camDesired.set(
        this.pos.x - _forwardVec.x * 13.5,
        this.pos.y + 5.8,
        this.pos.z - _forwardVec.z * 13.5
      );
      _camLookTarget.set(
        this.pos.x + _forwardVec.x * 5.0,
        this.pos.y + 2.3,
        this.pos.z + _forwardVec.z * 5.0
      );
    } else if (this.cameraMode === 'wide') {
      _camDesired.set(
        this.pos.x - _forwardVec.x * 21.0,
        this.pos.y + 10.2,
        this.pos.z - _forwardVec.z * 21.0
      );
      _camLookTarget.set(
        this.pos.x + _forwardVec.x * 4.0,
        this.pos.y + 1.8,
        this.pos.z + _forwardVec.z * 4.0
      );
    } else {
      // Hood cam
      _camDesired.set(
        this.pos.x + _forwardVec.x * 0.4,
        this.pos.y + 3.65,
        this.pos.z + _forwardVec.z * 0.4
      );
      _camLookTarget.set(
        this.pos.x + _forwardVec.x * 18.0,
        this.pos.y + 2.5,
        this.pos.z + _forwardVec.z * 18.0
      );
    }

    // Keep camera safely above terrain surface
    const groundAtCam = surfaceHeightAt(_camDesired.x, _camDesired.z);
    if (_camDesired.y < groundAtCam + 1.6) {
      _camDesired.y = groundAtCam + 1.6;
    }

    const dampLambda = this.cameraMode === 'hood' ? 16 : 6.8;
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camDesired.x, dampLambda, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camDesired.y, dampLambda, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camDesired.z, dampLambda, dt);
    this.camera.lookAt(_camLookTarget);

    // Subtle speed FOV widening
    const targetFov = this.input.boost ? 70 : 62 + Math.min(6, Math.abs(this.speed) * 0.22);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
      this.camera.updateProjectionMatrix();
    }

    // Move directional sun shadow frustum with truck so shadows stay crisp across the whole valley
    const p = SKY_PRESETS[this.timeOfDay];
    this.sunLight.position.set(
      this.pos.x + p.sunPos[0],
      this.pos.y + p.sunPos[1],
      this.pos.z + p.sunPos[2]
    );
    this.sunLight.target.position.copy(this.pos);
    this.sunLight.target.updateMatrixWorld();
    void _upVec;
  }

  private emitHud(): void {
    this.onHudUpdate({
      speedKmh: Math.round(Math.abs(this.speed) * 2.8),
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
    if (this.hudTimer >= 0.1) {
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
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);

    this.audio.dispose();
    this.truck.dispose();
    this.worldProps.dispose();
    this.terrainRig.dispose();
    this.textures.dispose();
    this.particleGeo.dispose();
    this.particleMat.dispose();
    this.envRT.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
