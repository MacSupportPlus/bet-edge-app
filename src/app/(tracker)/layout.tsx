import { TrackerSubNav } from "@/components/TrackerSubNav";

export default function TrackerGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <TrackerSubNav />
      {children}
    </div>
  );
}
