import { BankrollTracker } from "@/components/BankrollTracker";

export default function TrackerPage() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <BankrollTracker />
    </div>
  );
}
