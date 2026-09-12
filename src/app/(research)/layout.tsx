import { ResearchSubNav } from "@/components/ResearchSubNav";

export default function ResearchGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <ResearchSubNav />
      {children}
    </div>
  );
}
