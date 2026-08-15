/**
 * Singleton publishing the camera's current travel speed, updated by
 * CameraRig each frame. Other systems (Particles, StreetProps) read this
 * to scale parallax with actual travel speed — the same "shared mutable
 * object read inside useFrame" pattern used for audio/featureFrame.ts, for
 * the same reason: this changes every frame and must never trigger a
 * React re-render to reach its readers.
 */
export const cameraMotionState = { speed: 0 };
