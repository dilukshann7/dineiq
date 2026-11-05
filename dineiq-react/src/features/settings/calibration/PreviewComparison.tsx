import { useEffect, useState } from "react";
import type { Simulation } from "./useCalibrationPreview";

export function PreviewComparison({ frame, active, draft }: { frame: Blob; active: Simulation; draft: Simulation }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(frame);
    // Object URLs are external resources with effect-scoped allocation and cleanup.
    // oxlint-disable-next-line react/set-state-in-effect
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [frame]);
  return <div className="calibration-comparison">{([["Active settings simulation", active], ["Draft settings simulation", draft]] as const).map(([title, simulation]) => (
    <section key={title} aria-label={title} className="calibration-simulation">
      <h4>{title}</h4>
      <div className="calibration-image">
        {url && <img src={url} alt="Transient camera frame with simulated detection overlays" />}
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          {simulation.layout?.map(table => <g key={table.id}>
            <polygon points={table.polygon.map(p => p.join(",")).join(" ")} className="calibration-table" />
            {table.seats.map(seat => <polygon key={seat.id} points={seat.polygon.map(p => p.join(",")).join(" ")} className="calibration-seat" />)}
          </g>)}
          {simulation.detections.map((item, i) => <rect key={i} x={item.box[0]} y={item.box[1]} width={item.box[2] - item.box[0]} height={item.box[3] - item.box[1]} />)}
        </svg>
      </div>
      <p>Position check: {simulation.matching_status.replaceAll("_", " ")}</p>
      {!simulation.tables.length && <p>Configure tables to test seat assignments and table states.</p>}
      <details><summary>Detections ({simulation.detections.length})</summary>
        <ul>{simulation.detections.map((d, i) => <li key={i}>#{i + 1}: {d.label} · {(d.confidence * 100).toFixed(1)}%</li>)}</ul>
      </details>
      {simulation.tables.map(table => <details key={table.id}>
        <summary>{table.name}: {table.occupancy} · {table.cleanliness.replaceAll("_", " ")}</summary>
        <p>{table.reason || "Evidence confirmed"}</p>
        {Object.entries(table.countdowns).map(([key, seconds]) => seconds !== null && <p key={key}>{key.replaceAll("_", " ")}: {seconds.toFixed(1)} seconds remaining</p>)}
        <dl>{Object.entries(table.diagnostics).filter(([key]) => key !== "assignments").map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{(Number(value) * 100).toFixed(1)}%</dd></div>)}</dl>
        <ul>{table.diagnostics.assignments.map((assignment, i) => <li key={i}>Person {assignment.person_index + 1}, seat {assignment.seat_id}: {assignment.reason} ({(assignment.overlap * 100).toFixed(1)}% overlap)</li>)}</ul>
      </details>)}
    </section>
  ))}</div>;
}
