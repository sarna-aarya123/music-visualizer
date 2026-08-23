/**
 * Per-world character looks. A flat black silhouette read as a placeholder
 * in every environment; the reference panels each show a differently
 * dressed protagonist (spiky-haired kid in a jacket in the city, red-cloaked
 * traveller in the desert, witch-hatted figure in the forest, a suited
 * astronaut in space), so the character is now built from coloured parts
 * and reskinned per environment.
 *
 * Deliberately data only — Character.tsx reads this and builds its
 * materials from it, so adding a world's look never means touching the
 * animation code.
 */
export type HeadGear = 'none' | 'spikyHair' | 'witchHat' | 'helmet' | 'hood' | 'cap';

export interface CharacterAppearance {
  skin: string;
  hair: string;
  /** Upper body: jacket/shirt, and the sleeves of the arms. */
  shirt: string;
  /** Lower body: hips and legs. */
  pants: string;
  shoes: string;
  /** Trailing scarf/cape colour; null disables the cape entirely. */
  cape: string | null;
  headGear: HeadGear;
  gearColor: string;
  /** Emissive accent used for trim details — visor, glowing seams, etc.
   *  Set to null for worlds where the character shouldn't glow. */
  accent: string | null;
}

export const DEFAULT_APPEARANCE: CharacterAppearance = {
  skin: '#f0c8a0',
  hair: '#2a1a2e',
  shirt: '#3a4a8a',
  pants: '#2a2a3a',
  shoes: '#1a1a24',
  cape: null,
  headGear: 'spikyHair',
  gearColor: '#2a1a2e',
  accent: null,
};

export const CHARACTER_APPEARANCES: Record<string, CharacterAppearance> = {
  // Pink/white travelling robes to sit against the sakura and pink sky,
  // with a trailing scarf so movement reads at a distance.
  floatingIslandsWorld: {
    skin: '#f6d2b0',
    hair: '#3a2340',
    shirt: '#fff2f7',
    pants: '#b8477e',
    shoes: '#5a2a48',
    cape: '#ff87bd',
    headGear: 'spikyHair',
    gearColor: '#3a2340',
    accent: '#ffd3e8',
  },
  cyberpunkNightWorld: {
    skin: '#e8b894',
    hair: '#141420',
    shirt: '#1e1e34',
    pants: '#101018',
    shoes: '#0a0a10',
    cape: null,
    headGear: 'spikyHair',
    gearColor: '#141420',
    accent: '#28e0ff',
  },
  desertDreamWorld: {
    skin: '#e0a878',
    hair: '#2a1a14',
    shirt: '#f0e2c0',
    pants: '#8a5a34',
    shoes: '#4a2e1c',
    cape: '#d43a2a',
    headGear: 'hood',
    gearColor: '#d43a2a',
    accent: null,
  },
  fantasyForestWorld: {
    skin: '#f0c8a0',
    hair: '#4a2a20',
    shirt: '#4a7a4a',
    pants: '#2e4a34',
    shoes: '#28321f',
    cape: '#2a5a3a',
    headGear: 'witchHat',
    gearColor: '#2a2038',
    accent: '#8affc0',
  },
  outerDimensionWorld: {
    skin: '#f0c8a0',
    hair: '#2a2a34',
    shirt: '#e8e8f0',
    pants: '#c8c8d8',
    shoes: '#5a5a6a',
    cape: null,
    headGear: 'helmet',
    gearColor: '#f0f0f8',
    accent: '#7ad4ff',
  },
  underwaterAbyssWorld: {
    skin: '#e0c0a0',
    hair: '#1a2a3a',
    shirt: '#1e5a7a',
    pants: '#143a54',
    shoes: '#0e2434',
    cape: null,
    headGear: 'helmet',
    gearColor: '#8fd8ff',
    accent: '#7ef2ff',
  },
  ps2NightWorld: {
    skin: '#eec49c',
    hair: '#241a2e',
    shirt: '#4a5aa8',
    pants: '#2a2a44',
    shoes: '#1a1a28',
    cape: null,
    headGear: 'cap',
    gearColor: '#c04a5a',
    accent: null,
  },
  abstractVoidWorld: {
    skin: '#1a1a24',
    hair: '#1a1a24',
    shirt: '#12121a',
    pants: '#12121a',
    shoes: '#0a0a10',
    cape: null,
    headGear: 'none',
    gearColor: '#12121a',
    accent: '#ff3fc8',
  },
  chaoticCarnivalWorld: {
    skin: '#f0c090',
    hair: '#2a1420',
    shirt: '#e83a4a',
    pants: '#2a1a28',
    shoes: '#1a0e14',
    cape: '#ffb43a',
    headGear: 'spikyHair',
    gearColor: '#2a1420',
    accent: '#ffd84a',
  },
};

export function getAppearance(environmentId: string): CharacterAppearance {
  return CHARACTER_APPEARANCES[environmentId] ?? DEFAULT_APPEARANCE;
}
