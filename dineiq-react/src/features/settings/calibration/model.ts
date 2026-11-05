export type Values = Record<string, number>;
export type Draft = Record<string, string>;
export type Control = {
  minimum: number;
  maximum: number;
  group: string;
  label: string;
  description: string;
  unit: "ratio" | "seconds" | "multiple";
};
export type Controls = Record<string, Control>;
export type Configuration = { revision: number; settings: Values; defaults: Values; controls: Controls };
export type Revision = { revision: number; settings: Values; actor_username: string | null; created_at: number };
export type History = { revisions: Revision[]; next_before: number | null };

export function toDraft(settings: Values, controls: Controls): Draft {
  return Object.fromEntries(Object.entries(settings).map(([key, value]) => [
    key, String(Number((value * (controls[key].unit === "ratio" ? 100 : 1)).toFixed(6))),
  ]));
}

export function changeDraft(draft: Draft, key: string, value: string): Draft {
  return { ...draft, [key]: value };
}

export function parseDraft(draft: Draft, controls: Controls): { settings?: Values; error?: string } {
  const settings: Values = {};
  for (const [key, control] of Object.entries(controls)) {
    const raw = draft[key];
    const value = Number(raw) / (control.unit === "ratio" ? 100 : 1);
    if (raw === undefined || raw.trim() === "" || !Number.isFinite(value) || value < control.minimum || value > control.maximum)
      return { error: `Check ${control.label || key}: enter a value within the displayed range.` };
    settings[key] = value;
  }
  if (settings.clear_table_coverage < settings.minimum_table_coverage)
    return { error: "Clear-view coverage must be at least minimum table coverage." };
  return { settings };
}
