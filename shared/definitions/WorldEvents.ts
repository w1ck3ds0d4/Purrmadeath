// ---------------------------------------------------------------------------
// World Events - dramatic occurrences that roll at the start of each day
// ---------------------------------------------------------------------------

export type WorldEventId =
  | 'meteor_shower'
  | 'earthquake'
  | 'resource_boom'
  | 'surprise_attack'
  | 'solar_eclipse';

export interface WorldEventDef {
  id: WorldEventId;
  name: string;
  description: string;
  /** Duration in seconds (0 = instant effect). */
  duration: number;
  /** Earliest wave this event can appear. */
  minWave: number;
  /** Selection weight (higher = more likely). */
  weight: number;
  /** Banner announcement text shown to players. */
  banner: string;
}

export const WORLD_EVENTS: Record<WorldEventId, WorldEventDef> = {
  meteor_shower: {
    id: 'meteor_shower', name: 'Meteor Shower', description: 'Random AOE damage zones',
    duration: 150, minWave: 5, weight: 1.0,
    banner: 'METEOR SHOWER INCOMING',
  },
  earthquake: {
    id: 'earthquake', name: 'Earthquake', description: 'Quakes every 30s, damages buildings',
    duration: 150, minWave: 7, weight: 0.7,
    banner: 'EARTHQUAKE!',
  },
  resource_boom: {
    id: 'resource_boom', name: 'Resource Boom', description: '3x production all day',
    duration: 0, minWave: 2, weight: 1.0, // duration 0 = lasts the whole day
    banner: 'RESOURCE BOOM!',
  },
  surprise_attack: {
    id: 'surprise_attack', name: 'Surprise Attack', description: 'Enemy portals spawn during the day',
    duration: 150, minWave: 5, weight: 0.6,
    banner: 'SURPRISE ATTACK!',
  },
  solar_eclipse: {
    id: 'solar_eclipse', name: 'Solar Eclipse', description: 'Darkness falls, the undead rise',
    duration: 150, minWave: 4, weight: 0.5,
    banner: 'THE UNDEAD RISE',
  },
};

const ALL_EVENTS: WorldEventId[] = Object.keys(WORLD_EVENTS) as WorldEventId[];

/** Pick a random event eligible for the given wave. */
export function pickWorldEvent(wave: number): WorldEventId | null {
  const pool = ALL_EVENTS.filter(id => WORLD_EVENTS[id].minWave <= wave);
  if (pool.length === 0) return null;

  const totalWeight = pool.reduce((sum, id) => sum + WORLD_EVENTS[id].weight, 0);
  let roll = Math.random() * totalWeight;
  for (const id of pool) {
    roll -= WORLD_EVENTS[id].weight;
    if (roll <= 0) return id;
  }
  return pool[pool.length - 1];
}
