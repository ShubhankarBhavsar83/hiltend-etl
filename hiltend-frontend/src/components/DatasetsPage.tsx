import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApiClient } from "../hooks/useApiClient";
import { useMsal } from "@azure/msal-react";
import { cn } from "@/lib/utils";
import CollaborationModal, { type AccessRole } from './CollaborationModal';
import type { AxiosError } from "axios";
import axios from "axios";

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
  const { accounts } = useMsal();

  const [activeViewDataset, setActiveViewDataset] = useState<string | null>(datasets[0] || null);
  const [tables, setTables] = useState<TableDetail[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const [newDatasetName, setNewDatasetName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // --- Collab State ---
  const [isCollabOpen, setIsCollabOpen] = useState(false);
  const [currentRole, setCurrentRole] = useState<AccessRole | null>(null);

      const [error, setError] = useState("");


  const fetchDatasets = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/v1/datasets');
      setDatasets(res.data.datasets);
      if (res.data.datasets.length > 0 && !selectedDataset) setSelectedDataset(res.data.datasets[0]);
    } catch (err) {
      const axiosError = err as AxiosError;
      console.error("Failed to fetch datasets:", axiosError);
    }
  }, [apiClient, setDatasets, selectedDataset, setSelectedDataset]);

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

  // Fetch the role for the actively viewed dataset
  const fetchRole = useCallback(async (datasetName: string) => {
    try {
      const res = await apiClient.get(`/api/v1/datasets/${datasetName}/members`);
      const currentUserEmail = accounts[0]?.username?.toLowerCase();
      const me = res.data.members.find((m: { email: string, role: AccessRole }) => m.email.toLowerCase() === currentUserEmail);
      setCurrentRole(me?.role || "viewer");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail || "Failed to invite user.");
        setTimeout(() => setError(""), 4000);
      } else {
        throw error;
      }
      console.error("Failed to fetch permissions for dataset:", datasetName);
      setCurrentRole("viewer");
    }
  }, [apiClient, accounts, error]);

  useEffect(() => {
    if (activeViewDataset) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchDatasetDetails(activeViewDataset);
      fetchRole(activeViewDataset);
    } else {
      setCurrentRole(null);
    }
  }, [activeViewDataset, fetchDatasetDetails, fetchRole]);


  const handleCreateDataset = async () => {
    if (!newDatasetName.trim()) return;
    setIsCreating(true);
    try {
      const res = await apiClient.post('/api/v1/datasets', { name: newDatasetName });
      const updatedDatasets = [...datasets, res.data.dataset];
      setDatasets(updatedDatasets);
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

  const canDeleteDataset = currentRole === "user" || currentRole === "admin" || currentRole === "owner";

  return (
    <div className="flex flex-col md:flex-row gap-6 h-full min-h-125">

      {/* Collaboration Modal */}
      {activeViewDataset && (
        <CollaborationModal
          isOpen={isCollabOpen}
          onClose={() => setIsCollabOpen(false)}
          datasetName={activeViewDataset}
          currentUserEmail={accounts[0]?.username || ""}
          currentRole={currentRole || "viewer"}
        />
      )}

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
          <div className="flex gap-2">
            <Button size="sm" onClick={fetchDatasets}>
              Refresh Datasets
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
                  <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded tracking-wide font-mono shrink-0">
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
            <div className="p-6 border-b border-gray-200 flex flex-col xl:flex-row xl:justify-between items-start xl:items-center gap-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-3">
                  {activeViewDataset}
                  {currentRole && (
                    <span className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize",
                      currentRole === "owner" ? "bg-purple-50 text-purple-700 border-purple-200" :
                        currentRole === "admin" ? "bg-orange-50 text-orange-700 border-orange-200" :
                          currentRole === "user" ? "bg-green-50 text-green-700 border-green-200" :
                            "bg-gray-50 text-gray-600 border-gray-200"
                    )}>
                      {currentRole} Access
                    </span>
                  )}
                </h2>
                <p className="text-sm text-gray-500 mt-1">Schema Details & Tables</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCollabOpen(true)}
                >
                  Manage Access
                </Button>
                <Button
                  variant={selectedDataset === activeViewDataset ? "secondary" : "default"}
                  size="sm"
                  onClick={() => setSelectedDataset(activeViewDataset)}
                  disabled={selectedDataset === activeViewDataset}
                >
                  {selectedDataset === activeViewDataset ? "Currently Active" : "Set as Active Dataset"}
                </Button>

                {canDeleteDataset && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteDataset(activeViewDataset)}
                    disabled={isDeleting}
                  >
                    Delete
                  </Button>
                )}
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