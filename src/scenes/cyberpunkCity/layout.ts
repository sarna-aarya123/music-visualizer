/**
 * Shared world-space geometry constants. The camera path, buildings,
 * ground, street props, and background skyline all need to agree on the
 * same corridor so props line up and the camera's travel range makes
 * sense — defined once here instead of duplicated magic numbers.
 */
export const STREET_HALF_WIDTH = 7;
export const ROW_SPACING = 12;
export const ROWS = 11;

/** Camera travels back and forth along Z between these two extremes. */
export const CORRIDOR_Z_START = 14;
export const CORRIDOR_Z_END = -(ROWS * ROW_SPACING) - 10;

export const FOG_COLOR = '#05030c';
