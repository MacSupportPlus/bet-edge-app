import { CommandCenter } from "@/components/CommandCenter";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--background)" }}>
      <CommandCenter />
    </div>
  );
}
