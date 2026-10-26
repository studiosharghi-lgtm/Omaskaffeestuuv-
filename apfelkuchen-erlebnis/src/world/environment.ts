import {
  BackSide,
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';

/*
 * Lighting that matches the reference shot: low, warm window light from the back left,
 * a gentle bounce from the front, a dim brown kitchen around. The environment map gives
 * the glazes and the fork a real window to reflect.
 */

export const KEY_DIRECTION = new Vector3(-0.92, 1.0, -0.62).normalize();

export function buildEnvironment(renderer: WebGLRenderer): Texture {
  const env = new Scene();
  const hdr = (hex: string, k: number) => new Color(hex).multiplyScalar(k);

  const room = new Mesh(new BoxGeometry(8, 5, 8), new MeshBasicMaterial({ color: hdr('#4d4038', 0.4), side: BackSide }));
  room.position.y = 2;
  env.add(room);

  const floor = new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial({ color: hdr('#2b1d14', 0.4) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.4;
  env.add(floor);

  // the window: bright, warm, large
  const window_ = new Mesh(new PlaneGeometry(2.4, 2.0), new MeshBasicMaterial({ color: hdr('#ffeedb', 5.5) }));
  window_.position.copy(KEY_DIRECTION).multiplyScalar(3.2);
  window_.lookAt(0, 0, 0);
  env.add(window_);

  // soft bounce from the front-right
  const bounce = new Mesh(new PlaneGeometry(3, 2), new MeshBasicMaterial({ color: hdr('#ffe6c8', 0.9) }));
  bounce.position.set(2.2, 1.2, 2.6);
  bounce.lookAt(0, 0, 0);
  env.add(bounce);

  // a ceiling lamp far away
  const lamp = new Mesh(new PlaneGeometry(0.6, 0.6), new MeshBasicMaterial({ color: hdr('#ffc98a', 4) }));
  lamp.position.set(0.8, 3.2, -1.5);
  lamp.lookAt(0, 0, 0);
  env.add(lamp);

  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  env.traverse((o) => {
    if ((o as Mesh).isMesh) {
      (o as Mesh).geometry.dispose();
      ((o as Mesh).material as MeshBasicMaterial).dispose();
    }
  });
  return target.texture;
}

export interface Lights {
  key: DirectionalLight;
  fill: DirectionalLight;
  rim: DirectionalLight;
  bounce: HemisphereLight;
}

export function buildLights(shadowMapSize: number): Lights {
  const key = new DirectionalLight(new Color('#ffe6cc'), 3.4);
  key.position.copy(KEY_DIRECTION).multiplyScalar(2.2);
  key.target.position.set(0.12, 0, 0.02);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  const cam = key.shadow.camera;
  cam.left = -0.75;
  cam.right = 0.75;
  cam.top = 0.6;
  cam.bottom = -0.6;
  cam.near = 0.6;
  cam.far = 4.2;
  key.shadow.bias = -0.00035;
  key.shadow.normalBias = 0.008;
  key.shadow.radius = 3;

  const fill = new DirectionalLight(new Color('#fbefe2'), 0.75);
  fill.position.set(0.9, 0.7, 1.4);
  fill.target.position.set(0.1, 0, 0);

  // a soft kicker from behind on the right separates the slice and cup from the dark room
  const rim = new DirectionalLight(new Color('#ffe9d2'), 0.9);
  rim.position.set(1.2, 0.55, -1.3);
  rim.target.position.set(0.3, 0.02, 0.1);

  // bounce from the table and the room, so faces turned away from the window are not muddy
  const bounce = new HemisphereLight(new Color('#f4e6d6'), new Color('#5a3d28'), 0.35);

  return { key, fill, rim, bounce };
}
