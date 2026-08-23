/**
 * The environment shown on first load.
 *
 * Deliberately isolated in its own dependency-free module: it's needed by
 * both `scenes/registry.tsx` and `state/environmentStore.ts`, and now that
 * Character.tsx reads the active environment (to pick its per-world
 * appearance), having the store import the registry created a cycle —
 * registry -> scene components -> Character -> environmentStore ->
 * registry — which fails at runtime with a temporal-dead-zone error.
 * Keeping the constant here means neither module has to import the other.
 */
export const DEFAULT_ENVIRONMENT_ID = 'floatingIslandsWorld';
