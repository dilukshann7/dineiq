import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import type { ConfiguredTable } from "@/lib/monitoring/types";
import type { DrawingMode } from "./useTableSetup";

export function SetupTableList({
  tables,
  selected,
  busy,
  setTables,
  setSelected,
  onChooseMode,
}: {
  tables: ConfiguredTable[];
  selected: string;
  busy: boolean;
  setTables: Dispatch<SetStateAction<ConfiguredTable[]>>;
  setSelected: Dispatch<SetStateAction<string>>;
  onChooseMode: (mode: DrawingMode) => void;
}) {
  return (
    <div className="my-5 grid gap-2.5">
      {tables.map((table) => (
        <div
          className={`flex flex-wrap items-center gap-3 rounded-lg border bg-card p-5 [&_label]:flex [&_label]:flex-col [&_label]:items-start [&_label]:gap-2 [&_label]:text-xs sm:[&_label]:flex-row sm:[&_label]:items-center [&_input]:max-w-[200px] [&_input]:rounded [&_input]:border [&_input]:border-border [&_input]:bg-background [&_input]:px-2.5 [&_input]:py-2 [&_input]:text-foreground ${selected === table.id ? "border-primary" : "border-border"}`}
          key={table.id}
        >
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setSelected(table.id);
              onChooseMode("seat");
            }}
          >
            Select
          </Button>
          <label>
            Table name
            <input
              value={table.name}
              maxLength={80}
              disabled={busy}
              onChange={(event) =>
                setTables((previous) =>
                  previous.map((item) =>
                    item.id === table.id
                      ? { ...item, name: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
          <span>
            {table.seats.length} {table.seats.length === 1 ? "seat" : "seats"}
          </span>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setTables((previous) =>
                previous.filter((item) => item.id !== table.id),
              );
              if (selected === table.id) {
                setSelected("");
                onChooseMode("table");
              }
            }}
          >
            Remove table
          </Button>
          {selected === table.id && table.seats.length > 0 && (
            <div className="flex w-full flex-wrap gap-2">
              {table.seats.map((seat, index) => (
                <Button
                  size="sm"
                  variant="outline"
                  key={seat.id}
                  disabled={busy}
                  onClick={() =>
                    setTables((previous) =>
                      previous.map((item) =>
                        item.id === table.id
                          ? {
                              ...item,
                              seats: item.seats.filter(
                                (entry) => entry.id !== seat.id,
                              ),
                            }
                          : item,
                      ),
                    )
                  }
                >
                  Remove seat {index + 1}
                </Button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
