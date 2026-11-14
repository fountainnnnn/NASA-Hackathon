/** Distance fog, in metres measured from the camera-to-target distance outwards (see CameraRig). */
export const HAZE_NEAR_M = 9_000;   // clear this far beyond the orbit target
export const HAZE_SPAN_M = 80_000;  // then fully hazed over this distance

/**
 * Scene sun: from the west-south-west, 35 degrees up. A visual choice matching the mid-afternoon light the CTX images were
 * taken in (so baked shading and relief agree); it is not a Mars24 sun. Shared by the light and the crew's contact shadows.
 */
export const SUN_AZIMUTH_DEG = 247.5;
export const SUN_ELEVATION_DEG = 35;
