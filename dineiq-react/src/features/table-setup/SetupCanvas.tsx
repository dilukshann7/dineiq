import type { KeyboardEvent, MouseEvent } from "react";
import type {
  ConfiguredTable,
  FrozenFrame,
  Point,
} from "@/lib/monitoring/types";

export function SetupCanvas({
  frame,
  tables,
  selected,
  points,
  cursor,
  busy,
  clickFrame,
  keyFrame,
}: {
  frame: FrozenFrame;
  tables: ConfiguredTable[];
  selected: string;
  points: Point[];
  cursor: Point;
  busy: boolean;
  clickFrame: (event: MouseEvent<SVGSVGElement>) => void;
  keyFrame: (event: KeyboardEvent<SVGSVGElement>) => void;
}) {
  return (
    <div
      className="relative mt-4 w-full overflow-hidden rounded-lg bg-neutral-950 [&_polygon]:stroke-2 [&_polygon]:[vector-effect:non-scaling-stroke] [&_text]:pointer-events-none [&_text]:fill-white [&_text]:stroke-neutral-950 [&_text]:[paint-order:stroke] [&_text]:[stroke-width:0.002]"
      style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
    >
      <img
        className="absolute inset-0 size-full object-contain"
        src={frame.url}
        alt="Frozen camera frame for table configuration"
      />
      <svg
        className="absolute inset-0 size-full cursor-crosshair touch-manipulation focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-primary"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        onClick={clickFrame}
        onKeyDown={keyFrame}
        role="application"
        aria-label="Draw tabletop or seated-person regions"
        aria-describedby="draw-instructions"
        tabIndex={busy ? -1 : 0}
      >
        {tables.map((table) => (
          <g key={table.id}>
            <polygon
              points={table.polygon.map((point) => point.join(",")).join(" ")}
              className={
                table.id === selected
                  ? "fill-emerald-400/25 stroke-emerald-400"
                  : "fill-emerald-400/10 stroke-emerald-400"
              }
            />
            <text
              x={table.polygon[0][0]}
              y={Math.max(0.03, table.polygon[0][1] - 0.015)}
              fontSize="0.025"
            >
              {table.name}
            </text>
            {table.seats.map((seat, index) => (
              <g key={seat.id}>
                <polygon
                  points={seat.polygon
                    .map((point) => point.join(","))
                    .join(" ")}
                  className="fill-blue-400/20 stroke-blue-400"
                />
                <text
                  x={seat.polygon[0][0]}
                  y={seat.polygon[0][1] + 0.025}
                  fontSize="0.02"
                >
                  Seat {index + 1}
                </text>
              </g>
            ))}
          </g>
        ))}
        <polyline
          points={points.map((point) => point.join(",")).join(" ")}
          className="fill-amber-400/15 stroke-amber-400 stroke-2 [vector-effect:non-scaling-stroke]"
        />
        {points.map(([x, y], index) => (
          <circle
            key={index}
            cx={x}
            cy={y}
            r="0.004"
            className="fill-amber-400"
          />
        ))}
        <circle
          cx={cursor[0]}
          cy={cursor[1]}
          r="0.007"
          className="fill-transparent stroke-white stroke-1 [vector-effect:non-scaling-stroke]"
        />
      </svg>
    </div>
  );
}
