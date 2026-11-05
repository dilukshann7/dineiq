import { tableLabels, type TableState } from "./examples";

export function FloorPlan({
  tables,
  compact = false,
}: {
  tables: readonly TableState[];
  compact?: boolean;
}) {
  return (
    <ol
      className={`home-floor${compact ? " home-floor--compact" : ""}`}
      aria-label="Illustrative table layout"
    >
      {tables.map((state, index) => (
        <li className={`home-table home-table--${state}`} key={index}>
          <span className="home-chair home-chair--top" aria-hidden="true" />
          <span className="home-chair home-chair--bottom" aria-hidden="true" />
          <span className="home-chair home-chair--left" aria-hidden="true" />
          <span className="home-chair home-chair--right" aria-hidden="true" />
          <span className="home-table-top" aria-hidden="true">
            0{index + 1}
          </span>
          <span className="home-sr-only">
            Table {String(index + 1).padStart(2, "0")}: {tableLabels[state]}
          </span>
        </li>
      ))}
    </ol>
  );
}
