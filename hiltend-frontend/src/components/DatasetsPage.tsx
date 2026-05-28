import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApiClient } from "../hooks/useApiClient";
import { cn } from "@/lib/utils";

interface DatasetsPageProps {
  datasets: string[];
  setDatasets: React.Dispatch<React.SetStateAction<string[]>>;
  selectedDataset: string;
  setSelectedDataset: React.Dispatch<React.SetStateAction<string>>;
}

interface TableDetail {
  name: string;
  created_at: string;
}

export default function DatasetsPage({ datasets, setDatasets, selectedDataset, setSelectedDataset }: DatasetsPageProps) {
  const apiClient = useApiClient();
  
  const [activeViewDataset, setActiveViewDataset] = useState<string | null>(datasets[0] || null);
  const [tables, setTables] = useState<TableDetail[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  
  const [newDatasetName, setNewDatasetName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchDatasetDetails = useCallback(async (datasetName: string) => {
    setIsLoadingDetails(true);
    try {
      const res = await apiClient.get(`/api/v1/datasets/${datasetName}`);
      setTables(res.data.tables);
    } catch (err) {
      console.error("Failed to fetch dataset details:", err);
      setTables([]);
    } finally {
      setIsLoadingDetails(false);
    }
  }, [apiClient]);

  // Load details when a dataset is clicked in the list
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeViewDataset) fetchDatasetDetails(activeViewDataset);
  }, [activeViewDataset, fetchDatasetDetails]);

  const handleCreateDataset = async () => {
    if (!newDatasetName.trim()) return;
    setIsCreating(true);
    try {
      const res = await apiClient.post('/api/v1/datasets', { name: newDatasetName });
      setDatasets([...datasets, res.data.dataset]);
      setActiveViewDataset(res.data.dataset);
      setNewDatasetName("");
    } catch (err) {
      console.error("Dataset creation failed:", err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteDataset = async (datasetName: string) => {
    if (!confirm(`Are you sure you want to permanently delete '${datasetName}' and all its tables?`)) return;
    setIsDeleting(true);
    try {
      await apiClient.delete(`/api/v1/datasets/${datasetName}`);
      const updatedDatasets = datasets.filter(d => d !== datasetName);
      setDatasets(updatedDatasets);
      
      if (selectedDataset === datasetName) setSelectedDataset(updatedDatasets[0] || "");
      if (activeViewDataset === datasetName) setActiveViewDataset(updatedDatasets[0] || null);
    } catch (err) {
      console.error("Failed to delete dataset:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 h-full min-h-[500px]">
      {/* Left Pane: Dataset List & Creation */}
      <div className="w-full md:w-80 flex flex-col gap-4 bg-white border border-gray-200 rounded-xl p-4 shadow-sm shrink-0">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-gray-900">Create Dataset</span>
          <div className="flex gap-2">
            <Input 
              placeholder="Dataset name..." 
              value={newDatasetName} 
              onChange={(e) => setNewDatasetName(e.target.value)} 
              className="h-8 text-sm"
            />
            <Button size="sm" onClick={handleCreateDataset} disabled={isCreating || !newDatasetName}>
              Create
            </Button>
          </div>
        </div>

        <hr className="border-gray-100" />

        <div className="flex flex-col flex-1 overflow-y-auto pr-1">
          <span className="text-sm font-semibold text-gray-900 mb-2">All Datasets</span>
          {datasets.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No datasets found.</p>
          ) : (
            datasets.map((ds) => (
              <button
                key={ds}
                onClick={() => setActiveViewDataset(ds)}
                className={cn(
                  "flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors text-left w-full",
                  activeViewDataset === ds ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50"
                )}
              >
                <span className="truncate">{ds}</span>
                {selectedDataset === ds && (
                  <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded tracking-wide font-mono">
                    ACTIVE
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right Pane: Dataset Details */}
      <div className="flex-1 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
        {!activeViewDataset ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm font-mono bg-gray-50">
            Select a dataset to view details
          </div>
        ) : (
          <>
            <div className="p-6 border-b border-gray-200 flex justify-between items-start">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{activeViewDataset}</h2>
                <p className="text-sm text-gray-500 mt-1">Schema Details & Tables</p>
              </div>
              <div className="flex gap-3">
                <Button 
                  variant={selectedDataset === activeViewDataset ? "secondary" : "default"} 
                  size="sm"
                  onClick={() => setSelectedDataset(activeViewDataset)}
                  disabled={selectedDataset === activeViewDataset}
                >
                  {selectedDataset === activeViewDataset ? "Currently Active" : "Set as Active Dataset"}
                </Button>
                <Button 
                  variant="destructive" 
                  size="sm"
                  onClick={() => handleDeleteDataset(activeViewDataset)}
                  disabled={isDeleting}
                >
                  Delete
                </Button>
              </div>
            </div>

            <div className="p-6 flex-1 overflow-y-auto">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Provisioned Tables</h3>
              {isLoadingDetails ? (
                <div className="text-sm text-gray-400">Loading tables...</div>
              ) : tables.length === 0 ? (
                <div className="text-sm text-gray-400 border-[1.5px] border-dashed border-gray-200 p-8 text-center rounded-lg">
                  No tables provisioned in this dataset yet. Head to ingestion to map a CSV.
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-gray-600 text-xs uppercase font-medium">
                      <tr>
                        <th className="px-4 py-3 border-b border-gray-200">Table Name</th>
                        <th className="px-4 py-3 border-b border-gray-200">Created At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {tables.map((t) => (
                        <tr key={t.name} className="hover:bg-gray-50/50">
                          <td className="px-4 py-3 font-medium text-gray-800">{t.name}</td>
                          <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                            {new Date(t.created_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}