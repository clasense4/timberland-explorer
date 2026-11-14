# Timberland Monster Truck Explorer

An open-world 3D mountain forest monster truck exploration game for children, built for Google Chrome using **Three.js**, **WebGL**, **React**, and **TypeScript**. There are no timers, fail states, or rigid barriers—kids can freely drive, jump, splash through creeks, look around, and discover Golden Pine Stars across a sprawling alpine valley.

![Timberland Monster Truck Explorer](docs/screenshot.png)

## What the Game Can Do in This Version

### Open-World Mountain Forest (`800m × 800m` Drivable Valley)
- **Expansive Procedural Terrain**: Rolling sunlit meadows, winding dirt exploration loops, Lookout Peak, Whispering Pines, Cedar Summit, Sunny Knoll, and snow-dusted mountain ridges around the perimeter.
- **Crystal Creek & Alpine Ponds**: Shallow mountain river and pond basins where the monster truck splashes through water with dynamic water-spray particles and procedural splash audio.
- **3 Arched Wooden Log Bridges & 10 Stunt Ramps**: Smoothly integrated into the drivable heightfield so the truck climbs, crosses, and launches off ramps into mid-air jumps.
- **Rich Instanced Forest Ecosystem**: Over 820 multi-tier pine trees, 160 meadow birch/aspen trees, 260 mossy granite boulders, a scenic Ranger Lookout Cabin, and 260 floating fireflies/sunbeam motes.
- **12 Randomized Golden Pine Stars**: Each time the game starts or resets, 12 glowing stars spawn at fresh random locations across the mountain forest to encourage exploration.

### 3D Monster Truck & Driving Physics
- **Detailed Multi-Part 3D Truck**: Sculpted beveled pickup body with clearcoat metallic paint, ladder frame, coil suspension struts, front bull-bar bumper, roll bar with overhead spotlights, twin exhaust stacks, and four steerable oversized treaded tires.
- **Kid-Friendly 4-Wheel Suspension Physics**: Samples terrain height under all four wheels for natural hill pitch/roll, bouncy spring suspension on jump landings, tire dust trails, and gentle deflection around trees and boulders so kids never get stuck.
- **Customizable Paint & Lighting**: Switch between 5 truck colors (*Trail Red*, *Timber Orange*, *Pine Green*, *Alpine Blue*, *Sunburst Gold*) and 3 sky/lighting modes (*Morning*, *Sunset*, *Starlight*).

### Camera, HUD & Procedural Audio
- **360° Mouse Look-Around & Zoom**: Click and drag anywhere to orbit the camera around the truck, scroll the mouse wheel to zoom in/out, and double-click (or click **Center View**) to recenter behind the truck.
- **3 Camera Presets**: Switch between **Chase**, **Wide**, and **Hood** views.
- **Live Tachometer & Telemetry HUD**: Analog-style SVG RPM dial with sweeping needle, digital `km/h` speedometer, simulated 4-speed automatic gear indicator (`R`, `1`–`4`), current forest zone name, and star counter.
- **Random Reset**: Teleport the monster truck to a clean random spot in the valley and shuffle all 12 star locations at any time.
- **Optional On-Screen Drive Pad**: Built-in touch/mouse steer, brake, and drive pedals alongside full keyboard controls.
- **100% Procedural Web Audio**: Synthesized engine rumble (tracking speed, throttle, and turbo), two-tone air horn, water splashes, landing thumps, and star collection chimes with a one-click mute toggle.

## Controls

| Action | Input |
| --- | --- |
| Drive / Reverse | `W` / `S` or `Arrow Up` / `Arrow Down` |
| Steer Left / Right | `A` / `D` or `Arrow Left` / `Arrow Right` |
| Look Around (360°) | Click and drag mouse |
| Zoom In / Out | Mouse scroll wheel |
| Center Camera | Double-click canvas or click **Center View** |
| Turbo Boost | Hold `Space` |
| Monster Horn | `H` |
| Random Reset (Truck & Stars) | `R` |

## Tech Stack

- **3D Engine**: Three.js (`WebGLRenderer`, `RoomEnvironment` PBR reflections, `InstancedMesh`, procedural `CanvasTexture` maps)
- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite
- **Audio**: Web Audio API procedural synthesizer (zero external audio or asset files)

## Project Structure

```text
src/
├── App.tsx                     # Canvas mount, keyboard bindings, and state wiring
├── components/
│   └── HudOverlay.tsx          # Tachometer gauge, zone/star HUD, drive pad, collapsible dock
└── game/
    ├── audio.ts                # Procedural Web Audio engine, horn, splash, and chime synth
    ├── engine.ts               # Three.js renderer, physics loop, particles, mouse-look camera
    ├── terrain.ts              # Analytical heightfield, creek, trails, bridges, and ramps
    ├── textures.ts             # Procedural canvas textures (tread, wood, bark, terrain)
    ├── truck.ts                # Multi-part 3D Monster Truck rig and paint material controller
    ├── types.ts                # Shared TypeScript types and color presets
    └── worldProps.ts           # Instanced forest trees, rocks, cabin, stars, and fireflies
```

## Running Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in Google Chrome.
