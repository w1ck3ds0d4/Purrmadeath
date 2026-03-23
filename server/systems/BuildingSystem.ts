/**
 * BuildingSystem - re-exports from the split building/ sub-modules.
 *
 * All logic has been extracted to:
 *   - building/BuildingContext.ts  - shared context & deps interfaces
 *   - building/BuildingTicks.ts    - per-tick building logic
 *   - building/BuildingPlacement.ts - placement, demolition, upgrade, repair
 *   - building/index.ts           - factory that wires everything together
 */
export { createBuildingSystem } from './building';
export type { BuildingSystem, BuildingSystemDeps } from './building';
