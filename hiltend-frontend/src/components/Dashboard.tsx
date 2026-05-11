import { useState } from "react";
import { useMsal } from "@azure/msal-react";
import Sidebar, { type NavItem } from "./Sidebar";
import UploadPanel from "./UploadPanel";

interface DashboardProps {
  onLogout: () => void;
}

export default function Dashboard({ onLogout }: DashboardProps) {
  const { accounts } = useMsal();
  const account = accounts[0];
  const [activeNav, setActiveNav] = useState<NavItem>("ingest");

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        account={account}
        activeNav={activeNav}
        onNavChange={setActiveNav}
        onLogout={onLogout}
      />

      <main className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
        {/* Page header */}
        <div className="px-10 pt-8 pb-6 border-b border-gray-200 bg-white shrink-0 md:px-10 md:pt-8">
          <h1 className="text-lg font-semibold tracking-tight text-gray-900 mb-1">
            {PAGE_TITLES[activeNav]}
          </h1>
          <p className="text-[13px] text-gray-500">{PAGE_SUBTITLES[activeNav]}</p>
        </div>

        {/* Content */}
        <div className="flex-1 md:p-10 p-5">
          {activeNav === "ingest" && <UploadPanel />}
          {activeNav === "datasets" && <Placeholder label="Datasets" />}
          {activeNav === "analytics" && <Placeholder label="Analytics" />}
        </div>
      </main>
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-50 border-[1.5px] border-dashed border-gray-200 rounded-xl text-gray-400 text-[13.5px] font-mono bg-white">
      <span>{label} — coming soon</span>
    </div>
  );
}

const PAGE_TITLES: Record<NavItem, string> = {
  ingest: "Data Ingestion",
  datasets: "Datasets",
  analytics: "Analytics",
};

const PAGE_SUBTITLES: Record<NavItem, string> = {
  ingest: "Upload a CSV and trigger the transformation pipeline.",
  datasets: "Browse and manage ingested datasets.",
  analytics: "Query and visualise your data.",
};