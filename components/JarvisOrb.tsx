"use client"

import dynamic from "next/dynamic"

/**
 * JARVIS's core — the squishy cyan orb. Loaded client-only because it needs
 * WebGL, and it renders nothing (no layout shift, no crash) when WebGL is
 * unavailable.
 *
 * `fill` makes it take over its parent completely (welcome screen).
 * While JARVIS is responding (`busy`), the core breathes — a slow zoom pulse.
 */

const SquishCube = dynamic(() => import("./SquishCube"), { ssr: false })

export default function JarvisOrb({
  size = 120,
  busy = false,
  fill = false,
}: {
  size?: number
  busy?: boolean
  fill?: boolean
}) {
  return (
    <div
      className={`relative overflow-hidden ${
        busy ? "animate-breathe" : ""
      } ${fill ? "h-full w-full" : "shrink-0"}`}
      style={fill ? undefined : { width: size, height: size }}
    >
      <SquishCube
        color={busy ? "#38bdf8" : "#0fa3ff"}
        speed={busy ? 14 : 7}
        shine={9}
        round={7}
        sizePercent={150}
        style={fill ? undefined : { minWidth: size, minHeight: size }}
      />
    </div>
  )
}
