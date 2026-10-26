import { Vector3 } from 'three';

/*
 * Real-world sizes in metres. The table top is y = 0 and the cake stands at the origin.
 * Scanned models (ASSETS.md) must use the same units and origin so they drop into place.
 */

export const CAKE = {
  /** 26 cm springform */
  radius: 0.13,
  /** side height without the apples */
  height: 0.048,
  dome: 0.003,
  topBevel: 0.007,
  bottomBevel: 0.003,
  /** the first slice: 1/12 of the cake */
  wedgeAngle: (Math.PI * 2) / 12,
  /** apple slice shape (ring sector) */
  slice: {
    outer: 0.04,
    inner: 0.015,
    span: (105 * Math.PI) / 180,
    thickness: 0.0032,
  },
};

export const PLATE = {
  position: new Vector3(0.31, 0, 0.19),
  radius: 0.106,
  /** height of the flat well the slice rests on */
  wellHeight: 0.0065,
};

export const CUP = {
  /** saucer centre */
  position: new Vector3(0.44, 0, 0.0),
  saucerTop: 0.004,
  coffeeLevel: 0.064,
};

/** Direction from the cake centre in which the first slice is cut (towards the plate). */
export const WEDGE_CENTER_ANGLE = Math.atan2(PLATE.position.z, PLATE.position.x);
