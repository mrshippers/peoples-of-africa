// Heritage layer: polity extents as tinted washes, visible only when the
// scrubbed year falls inside their date range. Meshes are created once and
// toggled by visibility, never re-created per year - the scene-graph audit
// counts a visible heritage mesh under the peoples layer as an orphan.

import { useMemo } from "react";
import * as THREE from "three";
import { useApp } from "../state";
import { buildExtentGeometry, latLonToVec3 } from "./build";
import { registerTestApi } from "./testApi";
import { useEffect } from "react";
import { politiesForYear } from "../state";

// Historical washes: a restrained rotation, not the family key.
const WASHES = ["#8A6A3B", "#7A4A3A", "#5C6B4E", "#6B5A7A", "#4E6B70", "#8A5A4E"];

export function HeritageLayer() {
  const heritage = useApp(s => s.heritage);
  const layer = useApp(s => s.layer);
  const year = useApp(s => s.year);

  const items = useMemo(() => {
    if (!heritage) return [];
    return heritage.polities.map((p, i) => ({
      polity: p,
      geometry: buildExtentGeometry(p.extent, 1.006),
      color: WASHES[i % WASHES.length],
      capitalPos: latLonToVec3(p.capital.lat, p.capital.lon, 1.008),
    }));
  }, [heritage]);

  useEffect(() => {
    registerTestApi({
      visiblePolities: () => {
        const s = useApp.getState();
        const active = s.layer === "heritage" || s.layer === "overlay";
        return active ? politiesForYear(s.heritage, s.year) : [];
      },
      politiesForYear: (y: number) => politiesForYear(useApp.getState().heritage, y),
    });
  }, [heritage]);

  const active = layer === "heritage" || layer === "overlay";

  return (
    <group>
      {items.map(({ polity, geometry, color, capitalPos }) => {
        const inYear = year >= polity.start && year <= polity.end;
        const visible = active && inYear;
        return (
          <group key={polity.id}>
            <mesh geometry={geometry} visible={visible} userData={{ layer: "heritage", polity: polity.id }}>
              <meshBasicMaterial color={color} transparent opacity={0.38} depthWrite={false} side={THREE.FrontSide} />
            </mesh>
            <mesh position={capitalPos} visible={visible} userData={{ layer: "heritage" }}>
              <sphereGeometry args={[0.0035, 8, 8]} />
              <meshBasicMaterial color="#EDE3D0" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
