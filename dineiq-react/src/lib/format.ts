export const dateLabel = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "—";
