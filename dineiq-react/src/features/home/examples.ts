export type TableState = "occupied" | "available" | "service" | "cleaning";
export type ExampleId = "occupancy" | "service" | "cleaning";

export const tableLabels: Record<TableState, string> = {
  occupied: "Occupied",
  available: "Available",
  service: "Needs service",
  cleaning: "Needs cleaning",
};

type ProductExample = {
  id: ExampleId;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  metric: string;
  metricLabel: string;
  note: string;
  notification: string;
  notificationDetail: string;
  tables: readonly TableState[];
};

// Deliberately local, illustrative snapshots. No live monitoring or staff actions.
export const examples: readonly ProductExample[] = [
  {
    id: "occupancy",
    label: "Occupancy",
    eyebrow: "A little more perspective",
    title: "Know where there's room.",
    description:
      "A clear view of occupied and available tables. Less walking the floor to find out what you already need to know.",
    metric: "4 of 6",
    metricLabel: "tables occupied",
    note: "Two tables ready for the next arrival.",
    notification: "Room for the next hello.",
    notificationDetail: "Tables 02 and 05 are available.",
    tables: [
      "occupied",
      "available",
      "occupied",
      "occupied",
      "available",
      "occupied",
    ],
  },
  {
    id: "service",
    label: "Service",
    eyebrow: "The right nudge, at the right time",
    title: "Notice the wait. Make their day.",
    description:
      "Waiting timers and service reminders help your team see who needs attention. Staff confirm when service is done.",
    metric: "06:12",
    metricLabel: "Table 04 · waiting for service",
    note: "A reminder after five minutes. A human takes it from here.",
    notification: "Table 04 could use a hand.",
    notificationDetail: "Service reminder · awaiting staff confirmation",
    tables: [
      "occupied",
      "available",
      "occupied",
      "service",
      "available",
      "occupied",
    ],
  },
  {
    id: "cleaning",
    label: "Cleaning",
    eyebrow: "Ready for a fresh start",
    title: "A clean table. A warm welcome.",
    description:
      "See tables that need cleaning and keep the handoff clear. Your team reviews the table and confirms when it's ready again.",
    metric: "Table 02",
    metricLabel: "Needs cleaning",
    note: "One small task before the next guest sits down.",
    notification: "A fresh start for Table 02.",
    notificationDetail: "Cleaning needed · awaiting staff confirmation",
    tables: [
      "occupied",
      "cleaning",
      "occupied",
      "occupied",
      "available",
      "occupied",
    ],
  },
];
