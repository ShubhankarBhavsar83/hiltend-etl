import { useState, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import Sidebar, { type NavItem } from "./Sidebar";
import UploadPanel from "./UploadPanel";
import { loginRequest } from "../util/authConfig";

interface DashboardProps {
  onLogout: () => void;
}

export default function Dashboard({ onLogout }: DashboardProps) {
  const { instance, accounts } = useMsal();
  const account = accounts[0];
  const [activeNav, setActiveNav] = useState<NavItem>("ingest");
  
  // Global Dataset State
  const [datasets, setDatasets] = useState<string[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>("");

  useEffect(() => {
    const fetchDatasets = async () => {
      try {
        const token = await instance.acquireTokenSilent({ ...loginRequest, account });
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/datasets`, {
          headers: { Authorization: `Bearer ${token.accessToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setDatasets(data.datasets);
          if (data.datasets.length > 0) setSelectedDataset(data.datasets[0]);
        }
      } catch (err) {
        console.error("Failed to fetch datasets", err);
      }
    };
    fetchDatasets();
  }, [instance, account]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        account={account}
        activeNav={activeNav}
        onNavChange={setActiveNav}
        onLogout={onLogout}
      />

      <main className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
        <div className="px-10 pt-8 pb-6 border-b border-gray-200 bg-white shrink-0 md:px-10 md:pt-8">
          <h1 className="text-lg font-semibold tracking-tight text-gray-900 mb-1">
            {PAGE_TITLES[activeNav]}
          </h1>
          <p className="text-[13px] text-gray-500">{PAGE_SUBTITLES[activeNav]}</p>
        </div>

        <div className="flex-1 md:p-10 p-5">
          {activeNav === "ingest" && (
            <UploadPanel 
              datasets={datasets} 
              setDatasets={setDatasets} 
              selectedDataset={selectedDataset} 
              setSelectedDataset={setSelectedDataset} 
            />
          )}
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