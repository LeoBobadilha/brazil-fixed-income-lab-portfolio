// Optional WebGL view of the scenario grid. Lazy-loaded; renders on demand only
// (no idle animation loop), caps DPR, pauses when hidden, handles context loss
// and disposes every GPU resource on unmount. The 2D heatmap and table show the
// same numbers and remain the primary, accessible views.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ScenarioGrid } from "../engine/grid";
import { surfaceHeights } from "../engine/grid";

interface Props { grid: ScenarioGrid; clip: number; colors: { neg: string; mid: string; pos: string; grid: string; bg: string }; label: string; reducedMotion: boolean }

function lerpColor(a: THREE.Color, b: THREE.Color, t: number) { return a.clone().lerp(b, Math.max(0, Math.min(1, t))); }

export default function Surface3D({ grid, clip, colors, label, reducedMotion }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    } catch {
      setLost(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(new THREE.Color(colors.bg));
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(2.3, 1.7, 2.5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !reducedMotion;
    controls.target.set(0, 0, 0);

    const nx = grid.shocks.length, ny = grid.horizons.length;
    const heights = surfaceHeights(grid);
    // Same clipped diverging scale as the 2D heatmap (values beyond ±clip are drawn at the limit).
    const maxAbs = Math.max(1e-9, clip);
    const geo = new THREE.PlaneGeometry(2, 2, nx - 1, ny - 1);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const cNeg = new THREE.Color(colors.neg), cMid = new THREE.Color(colors.mid), cPos = new THREE.Color(colors.pos);
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const k = iy * nx + ix;
        const v = Number.isFinite(heights[k]) ? Math.max(-maxAbs, Math.min(maxAbs, heights[k])) : 0;
        pos.setXYZ(k, (ix / (nx - 1)) * 2 - 1, (v / maxAbs) * 0.45, (iy / (ny - 1)) * 2 - 1);
        const c = v >= 0 ? lerpColor(cMid, cPos, v / maxAbs) : lerpColor(cMid, cNeg, -v / maxAbs);
        col.set([c.r, c.g, c.b], k * 3);
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: colors.grid, transparent: true, opacity: 0.25 }));
    scene.add(wire);
    const zeroPlane = new THREE.GridHelper(2, 8, colors.grid, colors.grid);
    (zeroPlane.material as THREE.Material).transparent = true;
    (zeroPlane.material as THREE.Material).opacity = 0.35;
    scene.add(zeroPlane);
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.2);
    dl.position.set(2, 3, 1);
    scene.add(dl);

    let visible = true;
    let raf = 0;
    const render = () => { raf = 0; if (visible) renderer.render(scene, camera); };
    const request = () => { if (!raf) raf = requestAnimationFrame(() => { if (controls.update()) request(); render(); }); };
    controls.addEventListener("change", request);
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      request();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) request(); });
    io.observe(el);
    const onVis = () => { visible = document.visibilityState === "visible"; if (visible) request(); };
    document.addEventListener("visibilitychange", onVis);
    const onLost = (e: Event) => { e.preventDefault(); setLost(true); };
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    resize();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      controls.dispose();
      geo.dispose();
      mat.dispose();
      wire.geometry.dispose();
      (wire.material as THREE.Material).dispose();
      zeroPlane.geometry.dispose();
      (zeroPlane.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [grid, clip, colors, reducedMotion]);

  if (lost) return <p className="p-6 text-center text-[13px] text-muted">WebGL unavailable or context lost: use the heatmap and table views.</p>;
  return <div ref={host} role="img" aria-label={label} style={{ width: "100%", height: 380, cursor: "grab", touchAction: "none" }} />;
}
