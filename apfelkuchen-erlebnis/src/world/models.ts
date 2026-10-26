import { Box3, Group, Mesh, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { hasModel, modelUrl, type ModelId } from '../content/media';

/*
 * Photogrammetry scans replace the procedural stand-ins as soon as the files exist
 * (see ASSETS.md for units, origin and naming). Only files reported by the build are requested.
 */

export interface ScannedModels {
  cakeBody: Object3D | null;
  cakeSlice: Object3D | null;
  plate: Object3D | null;
  cup: Object3D | null;
}

let loader: GLTFLoader | null = null;

async function load(id: ModelId): Promise<Object3D | null> {
  if (!hasModel(id)) return null;
  loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  try {
    const gltf = await loader.loadAsync(modelUrl(id));
    const root = new Group();
    root.name = `scan:${id}`;
    root.add(gltf.scene);
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return root;
  } catch (error) {
    console.warn(`Omas Apfelkuchen: could not load ${id}; using the procedural stand-in.`, error);
    return null;
  }
}

export async function loadScannedModels(): Promise<ScannedModels> {
  const [cakeBody, cakeSlice, plate, cup] = await Promise.all([
    load('cake-body'),
    load('cake-slice'),
    load('plate'),
    load('cup'),
  ]);
  // The cake only switches to scans when both halves exist, so they always match.
  const cakePair = cakeBody && cakeSlice;
  return {
    cakeBody: cakePair ? cakeBody : null,
    cakeSlice: cakePair ? cakeSlice : null,
    plate,
    cup,
  };
}

/** Centre of the scanned slice in cake coordinates (the pivot it is lifted by). */
export function sliceCentroid(slice: Object3D): Vector3 {
  return new Box3().setFromObject(slice).getCenter(new Vector3());
}
