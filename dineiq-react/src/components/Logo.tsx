export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <img
      className={`brand-logo${compact ? " brand-logo--compact" : ""}`}
      src="/logo.png"
      alt="DineIQ"
      width={compact ? 96 : 144}
      height={compact ? 27 : 40}
    />
  );
}
