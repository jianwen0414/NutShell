"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { ShaderBackground } from "@/components/ui/shader-background";

/**
 * The landing backdrop.
 *
 * This used to be a hand-ported three.js horizon — starfield, nebula plane,
 * bloom pass, four alpine ridges. It is now the 21st.dev "Mesh drift" shader,
 * kept verbatim in `components/ui/shader-background.tsx` so it stays
 * upgradable: same uniforms, same palette, same timing the builder emitted.
 * Its greens already are the product's greens, which is why it landed here.
 *
 * Everything this file adds is integration, not art direction:
 *
 *   · It is a fixed backdrop, not a scroll-hijacker. The page in front of it
 *     carries a paste box that is a graded deliverable, so the canvas may
 *     never own the scroll or swallow a click. It renders behind everything
 *     with pointer-events off.
 *   · The shader is opaque and bright by design. Two scrims sit over it, and
 *     both earn their place: the vertical one darkens the header strip and
 *     lands the page on its own ground at the fold, the left-weighted one
 *     darkens only the column the hero text occupies. Both are pitched so the
 *     worst case — white type over the palette's pale lime — still clears
 *     4.5:1, and no darker, because the whole point was to see the shader.
 *   · The shader is lit by the page, not by a scroll distance. Any section
 *     that wants it carries `data-backdrop="lit"`, and the opacity tracks how
 *     much of the viewport those sections currently fill. The two sections a
 *     visitor actually operates — the paste box and the agreement slider —
 *     opt out, so the shader fades away for the length of the demo and comes
 *     back for the prose underneath it. A scroll-distance ramp cannot do that
 *     without hard-coding offsets that break the moment a section is added.
 *   · Reduced motion gets the gradient alone, and so does any machine with no
 *     WebGL context — the shader component returns early and leaves a
 *     transparent canvas. The page must read correctly with nothing here.
 */

/**
 * Sections that want the shader behind them mark themselves with this.
 *
 * `lit` is the hero: the scrims are cut for its exact column, so it gets the
 * shader at full strength. `lit-soft` is the prose below the demo, whose copy
 * is smaller, dimmer and set wider than the hero's — far enough right to run
 * past where the wash has fallen away. Measured over the palette's brightest
 * green, the 10px cyan eyebrow there lands at 2.8:1 with the shader at full
 * strength, so that run gets a ceiling instead.
 */
const LIT = '[data-backdrop^="lit"]';
const SOFT = 0.6;

/**
 * How much of the viewport lit sections have to fill for the shader to be at
 * full strength, and how little before it is gone. The hero is one viewport
 * tall, so 0.65 puts its fade-out a third of the way down it and 0.1 finishes
 * as its last line leaves — the same curve this had when it was a ramp on
 * `scrollY`, now derived rather than dialled in.
 */
const LIT_FULL = 0.65;
const LIT_FLOOR = 0.1;

/**
 * The OS motion preference, read as an external store rather than mirrored
 * into state from an effect. `matchMedia` has no server answer, and a viewer
 * who changes the setting with the tab open gets the shader taken away or
 * given back without a reload.
 */
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readMotion() {
  return !window.matchMedia(REDUCED_MOTION).matches;
}

/** Nothing animates before hydration; the gradient alone is a whole design. */
function readMotionOnServer() {
  return false;
}

export function HeroCanvas() {
  const animated = useSyncExternalStore(
    subscribeToMotion,
    readMotion,
    readMotionOnServer,
  );
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!animated || !layer) return;

    let frame = 0;

    const paint = () => {
      frame = 0;
      const height = Math.max(window.innerHeight, 1);

      // Re-queried each pass rather than cached: sections arrive with the
      // dynamic import and the console below grows as it fills, and a stale
      // node list would light the wrong stretch of the page.
      const spans: Array<[number, number, number]> = [];
      for (const section of document.querySelectorAll<HTMLElement>(LIT)) {
        const rect = section.getBoundingClientRect();
        const top = Math.max(rect.top, 0);
        const bottom = Math.min(rect.bottom, height);
        const ceiling = section.dataset.backdrop === "lit" ? 1 : SOFT;
        if (bottom > top) spans.push([top, bottom, ceiling]);
      }
      spans.sort((a, b) => a[0] - b[0]);

      // Union, not sum. The footer begins where the section above it ends, and
      // counting a shared edge twice would report more lit viewport than there
      // is — enough, at the bottom of the page, to pin the shader at full
      // strength on a screen that is mostly something else.
      let covered = 0;
      let reached = 0;
      let ceiling = 0;
      for (const [top, bottom, cap] of spans) {
        const from = Math.max(top, reached);
        if (bottom > from) {
          covered += bottom - from;
          reached = bottom;
          ceiling = Math.max(ceiling, cap);
        }
      }

      const coverage = covered / height;
      const opacity =
        Math.min(
          Math.max((coverage - LIT_FLOOR) / (LIT_FULL - LIT_FLOOR), 0),
          1,
        ) * ceiling;

      layer.style.opacity = opacity.toFixed(3);
      // `display: none` rather than opacity alone, and only once no lit
      // section is on screen at all. The shader watches its own canvas with an
      // IntersectionObserver and parks its render loop the moment that canvas
      // has no box — so this is what actually stops a full-screen fragment
      // shader running at 60fps behind the demo.
      layer.style.display = covered === 0 ? "none" : "";
    };

    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(paint);
    };

    // Scrolling is not the only thing that moves a section past the viewport.
    // A verdict arriving in the console, or the agreement slider redrawing the
    // panel beside it, shifts everything below without a scroll event.
    const reflow = new ResizeObserver(onScroll);
    reflow.observe(document.body);

    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      cancelAnimationFrame(frame);
      reflow.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [animated]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden="true">
      {/* Painted regardless, so the page has a ground even with no GPU. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,#072320_0%,#050f18_40%,#04060a_74%,#04060a_100%)]" />

      {animated ? (
        <div ref={layerRef} className="absolute inset-0">
          <ShaderBackground className="h-full w-full" />
        </div>
      ) : null}

      {/* Vertical: the header strip, then the fold. */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,6,10,0.62)_0%,rgba(4,6,10,0.18)_22%,rgba(4,6,10,0.20)_58%,rgba(4,6,10,0.72)_88%,#04060a_100%)]" />
      {/*
        Horizontal, and it has to come in two sizes. Past `xl` the hero text
        stops around 63% of the frame and the wash can fall away to nothing,
        which is where the shader gets to be itself. Below `xl` the same copy
        runs to both edges — there is no clear column left to darken, so the
        wash goes near-flat and the art gives way to the reading.
      */}
      <div className="absolute inset-0 bg-[linear-gradient(102deg,rgba(4,6,10,0.76)_0%,rgba(4,6,10,0.72)_45%,rgba(4,6,10,0.66)_100%)] xl:hidden" />
      <div className="absolute inset-0 hidden bg-[linear-gradient(102deg,rgba(4,6,10,0.68)_0%,rgba(4,6,10,0.66)_40%,rgba(4,6,10,0.26)_64%,rgba(4,6,10,0.06)_82%,transparent_94%)] xl:block" />
    </div>
  );
}
