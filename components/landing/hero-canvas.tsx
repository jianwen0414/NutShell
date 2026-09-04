"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/**
 * The landing backdrop.
 *
 * Adapted from a 21st.dev horizon hero. Kept: the layered starfield, the
 * nebula plane and the scroll-driven camera. Changed, and the reasons matter
 * more than the diff:
 *
 *   · It is a fixed backdrop, not a scroll-hijacker. The page in front of it
 *     carries a paste box that is a graded deliverable, so the canvas may
 *     never own the scroll or swallow a click. It renders behind everything
 *     with pointer-events off.
 *   · The original dereferenced `refs.nebula` and `refs.mountains[3]` inside
 *     the scroll handler with no guard. Both are populated asynchronously
 *     during init, and a scroll event arriving first throws — which on this
 *     page would take the hero down on the one machine that scrolls early.
 *   · Palette moved onto the product's own tokens.
 *   · The animation loop stops when the tab is hidden. A hackathon laptop
 *     running a demo does not need a 60fps bloom pass on a background tab.
 *
 * It degrades to a still gradient, painted by the parent, whenever WebGL is
 * unavailable or the viewer has asked for reduced motion. The page must read
 * correctly with nothing here at all.
 */

interface SceneRefs {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  composer: EffectComposer | null;
  stars: THREE.Points[];
  nebula: THREE.Mesh | null;
  ridges: THREE.Mesh[];
  atmosphere: THREE.Mesh | null;
  frame: number | null;
  target: { x: number; y: number; z: number };
}

const STAR_COLORS = {
  white: new THREE.Color(0xf1f5f9),
  emerald: new THREE.Color(0x10b981),
  cyan: new THREE.Color(0x06b6d4),
};

export function HeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const refs = useRef<SceneRefs>({
    scene: null,
    camera: null,
    renderer: null,
    composer: null,
    stars: [],
    nebula: null,
    ridges: [],
    atmosphere: null,
    frame: null,
    target: { x: 0, y: 24, z: 300 },
  });
  const smoothed = useRef({ x: 0, y: 24, z: 300 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Respect the OS setting before spending anything on a GPU context. The
    // canvas element stays mounted and simply never gets drawn to — it is
    // transparent over the gradient below, so bailing here needs no state and
    // no re-render.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const r = refs.current;
    // A phone rendering 15,000 shader-driven points through a bloom pass is a
    // dropped-frame slideshow, so the small screen gets a lighter scene.
    const compact = window.innerWidth < 768;
    const starCount = compact ? 1400 : 4200;
    const layers = compact ? 2 : 3;

    try {
      r.renderer = new THREE.WebGLRenderer({ canvas, antialias: !compact, alpha: true });
    } catch {
      // No WebGL context. The gradient underneath is the whole design in that
      // case, and the page above it never depended on this running.
      return;
    }

    r.scene = new THREE.Scene();
    r.scene.fog = new THREE.FogExp2(0x05070b, 0.00025);

    r.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      2000,
    );
    r.camera.position.set(0, 24, 300);

    r.renderer.setSize(window.innerWidth, window.innerHeight);
    r.renderer.setPixelRatio(Math.min(window.devicePixelRatio, compact ? 1.5 : 2));
    r.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    r.renderer.toneMappingExposure = 0.62;

    r.composer = new EffectComposer(r.renderer);
    r.composer.addPass(new RenderPass(r.scene, r.camera));
    if (!compact) {
      r.composer.addPass(
        new UnrealBloomPass(
          new THREE.Vector2(window.innerWidth, window.innerHeight),
          0.7,
          0.42,
          0.86,
        ),
      );
    }

    // ── Starfield ───────────────────────────────────────────────────────────
    for (let layer = 0; layer < layers; layer++) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(starCount * 3);
      const colors = new Float32Array(starCount * 3);
      const sizes = new Float32Array(starCount);

      for (let i = 0; i < starCount; i++) {
        const radius = 220 + Math.random() * 780;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);

        positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = radius * Math.cos(phi);

        const roll = Math.random();
        const color =
          roll < 0.78 ? STAR_COLORS.white : roll < 0.92 ? STAR_COLORS.emerald : STAR_COLORS.cyan;
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;

        sizes[i] = Math.random() * 2 + 0.4;
      }

      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

      const material = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, depth: { value: layer } },
        vertexShader: `
          attribute float size;
          attribute vec3 color;
          varying vec3 vColor;
          uniform float time;
          uniform float depth;

          void main() {
            vColor = color;
            vec3 pos = position;
            float angle = time * 0.04 * (1.0 - depth * 0.3);
            mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
            pos.xy = rot * pos.xy;
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = size * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          void main() {
            float dist = length(gl_PointCoord - vec2(0.5));
            if (dist > 0.5) discard;
            float opacity = 1.0 - smoothstep(0.0, 0.5, dist);
            gl_FragColor = vec4(vColor, opacity);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const points = new THREE.Points(geometry, material);
      r.scene.add(points);
      r.stars.push(points);
    }

    // ── Nebula ──────────────────────────────────────────────────────────────
    {
      const geometry = new THREE.PlaneGeometry(8000, 4000, 64, 64);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          colorA: { value: new THREE.Color(0x065f46) },
          colorB: { value: new THREE.Color(0x0e7490) },
          opacity: { value: 0.26 },
        },
        vertexShader: `
          varying vec2 vUv;
          varying float vElevation;
          uniform float time;

          void main() {
            vUv = uv;
            vec3 pos = position;
            float elevation = sin(pos.x * 0.01 + time) * cos(pos.y * 0.01 + time) * 20.0;
            pos.z += elevation;
            vElevation = elevation;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 colorA;
          uniform vec3 colorB;
          uniform float opacity;
          uniform float time;
          varying vec2 vUv;
          varying float vElevation;

          void main() {
            float mixFactor = sin(vUv.x * 8.0 + time) * cos(vUv.y * 8.0 + time);
            vec3 color = mix(colorA, colorB, mixFactor * 0.5 + 0.5);
            float alpha = opacity * (1.0 - length(vUv - 0.5) * 2.0);
            alpha *= 1.0 + vElevation * 0.01;
            gl_FragColor = vec4(color, max(alpha, 0.0));
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const nebula = new THREE.Mesh(geometry, material);
      nebula.position.z = -1050;
      r.scene.add(nebula);
      r.nebula = nebula;
    }

    // ── Horizon ridges ──────────────────────────────────────────────────────
    //
    // The original shipped four alpine silhouettes. Same geometry, recoloured
    // into the product's own dark teals so the hero reads as a horizon being
    // watched rather than a landing page for a ski resort.
    {
      const ridgeLayers = [
        { distance: -50, height: 60, color: 0x0b1220, opacity: 1 },
        { distance: -100, height: 80, color: 0x0a1a24, opacity: 0.82 },
        { distance: -150, height: 100, color: 0x08262f, opacity: 0.6 },
        { distance: -200, height: 120, color: 0x073640, opacity: 0.42 },
      ];

      ridgeLayers.forEach((layer, index) => {
        const points: THREE.Vector2[] = [];
        const segments = 50;
        for (let i = 0; i <= segments; i++) {
          const x = (i / segments - 0.5) * 1000;
          const y =
            Math.sin(i * 0.1) * layer.height +
            Math.sin(i * 0.05) * layer.height * 0.5 +
            Math.random() * layer.height * 0.2 -
            100;
          points.push(new THREE.Vector2(x, y));
        }
        points.push(new THREE.Vector2(5000, -300));
        points.push(new THREE.Vector2(-5000, -300));

        const geometry = new THREE.ShapeGeometry(new THREE.Shape(points));
        const material = new THREE.MeshBasicMaterial({
          color: layer.color,
          transparent: true,
          opacity: layer.opacity,
          side: THREE.DoubleSide,
        });

        const ridge = new THREE.Mesh(geometry, material);
        ridge.position.z = layer.distance;
        ridge.position.y = layer.distance;
        ridge.userData = { baseZ: layer.distance, index };
        r.scene!.add(ridge);
        r.ridges.push(ridge);
      });
    }

    // ── Atmosphere ──────────────────────────────────────────────────────────
    {
      const geometry = new THREE.SphereGeometry(600, 32, 32);
      const material = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          uniform float time;
          void main() {
            float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
            vec3 glow = vec3(0.06, 0.72, 0.51) * intensity;
            float pulse = sin(time * 1.6) * 0.1 + 0.9;
            gl_FragColor = vec4(glow * pulse, intensity * 0.22);
          }
        `,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
      });
      const atmosphere = new THREE.Mesh(geometry, material);
      r.scene.add(atmosphere);
      r.atmosphere = atmosphere;
    }

    // ── Loop ────────────────────────────────────────────────────────────────
    let running = true;

    const animate = () => {
      if (!running) return;
      r.frame = requestAnimationFrame(animate);

      const time = Date.now() * 0.001;

      for (const field of r.stars) {
        const mat = field.material as THREE.ShaderMaterial;
        if (mat.uniforms?.time) mat.uniforms.time.value = time;
      }
      if (r.nebula) {
        const mat = r.nebula.material as THREE.ShaderMaterial;
        if (mat.uniforms?.time) mat.uniforms.time.value = time * 0.5;
      }
      if (r.atmosphere) {
        const mat = r.atmosphere.material as THREE.ShaderMaterial;
        if (mat.uniforms?.time) mat.uniforms.time.value = time;
      }

      if (r.camera) {
        const ease = 0.05;
        smoothed.current.x += (r.target.x - smoothed.current.x) * ease;
        smoothed.current.y += (r.target.y - smoothed.current.y) * ease;
        smoothed.current.z += (r.target.z - smoothed.current.z) * ease;

        r.camera.position.x = smoothed.current.x + Math.sin(time * 0.1) * 2;
        r.camera.position.y = smoothed.current.y + Math.cos(time * 0.15) * 1;
        r.camera.position.z = smoothed.current.z;
        r.camera.lookAt(0, 10, -600);
      }

      r.ridges.forEach((ridge, i) => {
        const parallax = 1 + i * 0.5;
        ridge.position.x = Math.sin(time * 0.1) * 2 * parallax;
        ridge.position.y = (ridge.userData.baseZ as number) + Math.cos(time * 0.15) * parallax;
      });

      r.composer?.render();
    };

    animate();

    // ── Scroll ──────────────────────────────────────────────────────────────
    //
    // The camera answers to the first two viewport heights and then holds. Past
    // that the visitor is reading the verification report, and a camera still
    // drifting behind it is a distraction, not an effect.
    const onScroll = () => {
      const span = window.innerHeight * 2;
      const progress = Math.min(window.scrollY / span, 1);

      r.target.x = 0;
      r.target.y = 24 + progress * 26;
      r.target.z = 300 - progress * 350;

      // Guarded. Both of these are populated during init and a scroll event
      // can land first; the original dereferenced them unconditionally.
      if (r.nebula && r.ridges.length > 0) {
        const deepest = r.ridges[r.ridges.length - 1];
        r.nebula.position.z = (deepest.userData.baseZ as number) - 900 + progress * 300;
      }
    };

    const onResize = () => {
      if (!r.camera || !r.renderer || !r.composer) return;
      r.camera.aspect = window.innerWidth / window.innerHeight;
      r.camera.updateProjectionMatrix();
      r.renderer.setSize(window.innerWidth, window.innerHeight);
      r.composer.setSize(window.innerWidth, window.innerHeight);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        if (r.frame) cancelAnimationFrame(r.frame);
        r.frame = null;
      } else if (!running) {
        running = true;
        animate();
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    onScroll();

    return () => {
      running = false;
      if (r.frame) cancelAnimationFrame(r.frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);

      for (const field of r.stars) {
        field.geometry.dispose();
        (field.material as THREE.Material).dispose();
      }
      for (const ridge of r.ridges) {
        ridge.geometry.dispose();
        (ridge.material as THREE.Material).dispose();
      }
      r.nebula?.geometry.dispose();
      if (r.nebula) (r.nebula.material as THREE.Material).dispose();
      r.atmosphere?.geometry.dispose();
      if (r.atmosphere) (r.atmosphere.material as THREE.Material).dispose();
      r.composer?.dispose();
      r.renderer?.dispose();

      r.stars = [];
      r.ridges = [];
      r.nebula = null;
      r.atmosphere = null;
      r.composer = null;
      r.renderer = null;
      r.scene = null;
      r.camera = null;
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden="true">
      {/* Painted regardless, so the page has a ground even with no GPU. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,#0b2b2a_0%,#07131c_38%,#05070b_72%,#05070b_100%)]" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {/* Keeps text legible over whichever of the two is showing. */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#05070b]/35 to-[#05070b]" />
    </div>
  );
}
