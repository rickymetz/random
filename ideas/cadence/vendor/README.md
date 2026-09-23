# Vendored

`three.cadence.min.js` is a subset of [three.js](https://threejs.org) r186
(MIT, see `three.LICENSE`), bundled so Cadence's 3D exercise figure works
offline without a CDN. Only the classes `figure3d.js` uses are included.

To rebuild:

```sh
npm i three@0.186.0 esbuild
cat > entry.js <<'JS'
export {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh, Color,
  MeshStandardMaterial, MeshBasicMaterial, CapsuleGeometry, SphereGeometry, BoxGeometry, CylinderGeometry, PlaneGeometry, CircleGeometry,
  HemisphereLight, DirectionalLight, AmbientLight, Vector3, Quaternion, Euler, Matrix4, SRGBColorSpace
} from 'three';
JS
npx esbuild entry.js --bundle --minify --format=iife --global-name=CadenceThree --legal-comments=none --outfile=three.cadence.min.js
```

(prepend the licence banner line from the current file.)
