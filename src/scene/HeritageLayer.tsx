// Heritage layer: polity extents as tinted washes conforming to the terrain,
// visible only when the scrubbed year falls inside their range. Meshes are
// created once and toggled by visibility - a visible heritage mesh under the
// peoples layer counts as an orphan in the scene audit.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useApp, politiesForYear } from "../state";
import { buildExtentGeometry } from "./build";
import { mapToWorld } from "./terrain";
import { registerTestApi } from "./testApi";

// Historical washes: a restrained rotation, not the family key.
const WASHES = ["#8A6A3B", "#7A4A3A", "#5C6B4E", "#6B5A7A", "#4E6B70", "#8A5A4E"];

export function HeritageLayer() {
  const heritage = useApp(s => s.heritage);
  const heightField = useApp(s => s.heightField);
  const layer = useApp(s => s.layer);
  const year = useApp(s => s.year);

  const items = useMemo(() => {
    if (!heritage || !heightField) return [];
    const project = (lon: number, lat: number) =>
      mapToWorld(lon, lat, Math.max(0, heightField.worldY(lon, lat)) + 0.014);
    return heritage.polities.map((p, i) => ({
      polity: p,
      geometry: buildExtentGeometry(p.extent, project),
      color: WASHES[i % WASHES.length],
      capitalPos: project(p.capital.lon, p.capital.lat).add(new THREE.Vector3(0, 0.004, 0)),
    }));
  }, [heritage, heightField]);

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
            <mesh
              geometry={geometry}
              visible={visible}
              userData={{ layer: "heritage", polity: polity.id }}
              renderOrder={5}
              onClick={(e) => {
                // Clicks select polities only on the pure heritage layer; in
                // overlay mode the peoples picker owns the pointer.
                const s = useApp.getState();
                if (s.layer !== "heritage" || e.delta > 4) return;
                e.stopPropagation();
                s.select(s.selectedId === polity.id ? null : polity.id);
              }}
            >
              <meshBasicMaterial color={color} transparent opacity={0.42} depthWrite={false} />
            </mesh>
            <mesh position={capitalPos} visible={visible} userData={{ layer: "heritage" }} renderOrder={6}>
              <sphereGeometry args={[0.012, 10, 10]} />
              <meshBasicMaterial color="#F3E9D2" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
