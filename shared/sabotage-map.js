// Map for Spaceship Sabotage, used by the server (movement, tasks) and the
// browser (drawing). Walkable space is the union of rooms and corridors.

export const MAP_W = 1800;
export const MAP_H = 1120;
export const PLAYER_R = 18;

export const ROOMS = [
  { id: 'hydro', name: 'Hydroponics', x: 80, y: 80, w: 340, h: 260, color: '#2d6a4f' },
  { id: 'bridge', name: 'Bridge', x: 700, y: 80, w: 400, h: 280, color: '#1d3557' },
  { id: 'medbay', name: 'Med Bay', x: 1360, y: 80, w: 360, h: 300, color: '#3a506b' },
  { id: 'engine', name: 'Engine Room', x: 80, y: 420, w: 340, h: 330, color: '#5f0f40' },
  { id: 'hub', name: 'Galley Hub', x: 640, y: 450, w: 520, h: 300, color: '#264653' },
  { id: 'reactor', name: 'Reactor', x: 80, y: 840, w: 380, h: 220, color: '#6a040f' },
  { id: 'cargo', name: 'Cargo Bay', x: 700, y: 850, w: 400, h: 210, color: '#463f3a' },
  { id: 'comms', name: 'Comms', x: 1360, y: 760, w: 360, h: 300, color: '#3c096c' },
];

export const CORRIDORS = [
  // Corridors overlap the rooms they join so players can pass through.
  { x: 360, y: 160, w: 400, h: 100 }, // hydro <-> bridge
  { x: 200, y: 280, w: 100, h: 200 }, // hydro <-> engine
  { x: 850, y: 300, w: 100, h: 210 }, // bridge <-> hub
  { x: 360, y: 550, w: 340, h: 100 }, // engine <-> hub
  { x: 200, y: 690, w: 100, h: 210 }, // engine <-> reactor
  { x: 850, y: 690, w: 100, h: 220 }, // hub <-> cargo
  { x: 400, y: 920, w: 360, h: 100 }, // reactor <-> cargo
  { x: 1100, y: 550, w: 480, h: 100 }, // hub <-> east corridor
  { x: 1480, y: 320, w: 100, h: 500 }, // med bay <-> comms
];

export const WALKABLE = [...ROOMS, ...CORRIDORS];

export const TASK_STATIONS = [
  { id: 'water', room: 'hydro', name: 'Water the plants', x: 160, y: 160 },
  { id: 'seeds', room: 'hydro', name: 'Sort seed pods', x: 340, y: 280 },
  { id: 'nav', room: 'bridge', name: 'Chart a course', x: 900, y: 130 },
  { id: 'shields', room: 'bridge', name: 'Tune the shields', x: 760, y: 300 },
  { id: 'scan', room: 'medbay', name: 'Run a body scan', x: 1440, y: 160 },
  { id: 'meds', room: 'medbay', name: 'Restock the med kit', x: 1660, y: 320 },
  { id: 'fuel', room: 'engine', name: 'Refuel the engine', x: 140, y: 480 },
  { id: 'gears', room: 'engine', name: 'Align the gears', x: 360, y: 700 },
  { id: 'snacks', room: 'hub', name: 'Fix the snack machine', x: 1100, y: 500 },
  { id: 'crates', room: 'cargo', name: 'Stack the crates', x: 760, y: 1000 },
  { id: 'labels', room: 'cargo', name: 'Scan crate labels', x: 1040, y: 900 },
  { id: 'antenna', room: 'comms', name: 'Point the antenna', x: 1660, y: 820 },
  { id: 'wires', room: 'comms', name: 'Connect the wires', x: 1420, y: 1000 },
];

export const REACTOR_PANELS = [
  { id: 'r1', x: 130, y: 900 },
  { id: 'r2', x: 410, y: 1010 },
];

export const EMERGENCY_BUTTON = { x: 900, y: 600 };
export const SPAWN = { x: 900, y: 660 };

export function isWalkable(x, y, r = PLAYER_R) {
  for (const a of WALKABLE) {
    if (x >= a.x + r && x <= a.x + a.w - r && y >= a.y + r && y <= a.y + a.h - r) return true;
  }
  return false;
}
