// Shared UI helper components used by both Relauncher and Creator

export function StatusBadge({
  status,
}: {
  status?:
    | "valid"
    | "invalid"
    | "risky"
    | "catch-all"
    | "unknown"
    | "pending";
}) {
  if (!status || status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[#808080]">
        <span className="w-2 h-2 rounded-full bg-[#02E481] animate-pulse" />
        Pending
      </span>
    );
  }

  const config = {
    valid: { color: "bg-green-400", text: "text-green-400", label: "Valid" },
    invalid: { color: "bg-red-400", text: "text-red-400", label: "Invalid" },
    risky: { color: "bg-amber-400", text: "text-amber-400", label: "Risky" },
    "catch-all": { color: "bg-blue-400", text: "text-blue-400", label: "Catch-all" },
    unknown: { color: "bg-[#808080]", text: "text-[#B3B3B3]", label: "Unknown" },
  }[status];

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${config.text}`}>
      <span className={`w-2 h-2 rounded-full ${config.color}`} />
      {config.label}
    </span>
  );
}

export function Stat({
  label,
  value,
  color = "text-white",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="text-center">
      <p className={`text-2xl font-semibold ${color}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-[#808080] text-xs mt-1">{label}</p>
    </div>
  );
}

export function Row({
  label,
  value,
  highlight = false,
  error = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  error?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-[#B3B3B3]">{label}</span>
      <span
        className={
          error
            ? "text-red-400 font-medium"
            : highlight
              ? "text-amber-400 font-medium"
              : "text-white"
        }
      >
        {value}
      </span>
    </div>
  );
}

export function Spinner({ text }: { text: string }) {
  return (
    <div className="text-center py-12">
      <div className="inline-block w-6 h-6 border-2 border-[#262626] border-t-[#02E481] rounded-full animate-spin" />
      <p className="text-[#B3B3B3] text-sm mt-4">{text}</p>
    </div>
  );
}

export function StepIndicator({
  labels,
  currentIndex,
}: {
  labels: string[];
  currentIndex: number;
}) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition ${
              i === currentIndex
                ? "bg-[#02E481] text-[#071018]"
                : i < currentIndex
                  ? "bg-[#262626] text-[#B3B3B3]"
                  : "bg-[#0A0A0A] text-[#808080]"
            }`}
          >
            <span>{i + 1}</span>
            <span>{label}</span>
          </div>
          {i < labels.length - 1 && (
            <div
              className={`w-6 h-px ${i < currentIndex ? "bg-[#808080]" : "bg-[#111111]"}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
