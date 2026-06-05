// Dashboard.tsx
import { useState, useEffect, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import Sidebar, { type NavItem } from "./Sidebar";
import UploadPanel from "./UploadPanel";
import { Button } from "@/components/ui/button";
import { useApiClient } from "@/hooks/useApiClient";
import type { AxiosError } from "axios";
import DatasetsPage from "./DatasetsPage";
import DataExplorer from "./DataExplorer";

interface DashboardProps {
  onLogout: () => void;
}

export default function Dashboard({ onLogout }: DashboardProps) {
  const { accounts } = useMsal();
  const account = accounts[0];
  const apiClient = useApiClient();

  const [activeNav, setActiveNav] = useState<NavItem>("ingest");

  const [datasets, setDatasets] = useState<string[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>("");

  const [pingStatus, setPingStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // 1. Wrap the function in useCallback
  const fetchDatasets = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/v1/datasets');

      setDatasets(res.data.datasets);
      if (res.data.datasets.length > 0) setSelectedDataset(res.data.datasets[0]);
      setFetchError(null);

    } catch (err) {
      const axiosError = err as AxiosError;
      console.error("Failed to fetch datasets:", err);
      if (axiosError.response?.status === 503) {
        setFetchError("Database is asleep. Please wake services.");
      } else {
        setFetchError("Connection error.");
      }
    }
  }, [apiClient]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDatasets();
  }, [fetchDatasets]);


  const handlePing = async () => {
    setPingStatus("loading");
    try {
      await apiClient.post('/api/v1/ping');
      setPingStatus("success");
      // await fetchDatasets();
      setTimeout(() => setPingStatus("idle"), 4000);
    } catch (err) {
      console.error("Ping request failed:", err);
      setPingStatus("error");
      setTimeout(() => setPingStatus("idle"), 4000);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 md:hidden transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <Sidebar
        account={account}
        activeNav={activeNav}
        onNavChange={setActiveNav}
        onLogout={onLogout}
        isOpen={isSidebarOpen}
      />

<main className="flex-1 overflow-y-auto bg-gray-50 flex flex-col min-w-0">
        <div className="flex justify-between items-start px-6 md:px-10 pt-8 pb-6 border-b border-gray-200 bg-white shrink-0">
          
          <div className="flex items-start gap-4">
            {/* 4. The Hamburger Toggle Button */}
            <Button
              variant="ghost"
              size="icon"
              className="mt-0.5 shrink-0 text-gray-500 hover:text-gray-900 hover:bg-gray-100 hidden md:flex"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </Button>
            
            {/* Mobile Hamburger (Only visible on small screens) */}
            <Button
              variant="ghost"
              size="icon"
              className="mt-0.5 shrink-0 text-gray-500 hover:text-gray-900 hover:bg-gray-100 md:hidden"
              onClick={() => setIsSidebarOpen(true)}
            >
               <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </Button>

            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-lg font-semibold tracking-tight text-gray-900">
                  {PAGE_TITLES[activeNav]}
                </h1>
                {selectedDataset && (
                  <span className="bg-gray-100 text-gray-600 border border-gray-200 text-xs px-2 py-0.5 rounded-full font-mono flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block"></span>
                    Active: {selectedDataset}
                  </span>
                )}
              </div>
              <p className="text-[13px] text-gray-500">{PAGE_SUBTITLES[activeNav]}</p>
              {fetchError && (
                 <p className="text-[12px] text-amber-600 mt-2 font-medium bg-amber-50 px-2 py-1 rounded inline-block">
                   ⚠️ {fetchError}
                 </p>
              )}
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handlePing}
            disabled={pingStatus === "loading"}
            className="flex gap-2 items-center text-[13px] h-8 shadow-sm transition-all"
          >
            {pingStatus === "idle" && <><span className="text-blue-500">⚡</span> Wake Services</>}
            {pingStatus === "loading" && (
              <>
                <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                Waking...
              </>
            )}
            {pingStatus === "success" && <><span className="text-green-500 font-bold">✓</span> Services Awake</>}
            {pingStatus === "error" && <><span className="text-red-500 font-bold">!</span> Ping Failed</>}
          </Button>

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
          {activeNav === "datasets" && (
            <DatasetsPage
              datasets={datasets}
              setDatasets={setDatasets}
              selectedDataset={selectedDataset}
              setSelectedDataset={setSelectedDataset}
            />
          )}          
          {activeNav === "analytics" && (
             <DataExplorer selectedDataset={selectedDataset} />
          )}
        </div>
      </main>
    </div>
  );
}

// function Placeholder({ label }: { label: string }) {
//   return (
//     <div className="flex items-center justify-center h-50 border-[1.5px] border-dashed border-gray-200 rounded-xl text-gray-400 text-[13.5px] font-mono bg-white">
//       <span>{label} — coming soon</span>
//     </div>
//   );
// }

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