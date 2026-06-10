import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useGlobalState } from '../context/useGlobalState';
import { cn } from "@/lib/utils";
import { useApiClient } from "../hooks/useApiClient";
import { useMsal } from "@azure/msal-react";
import IngestHistoryPanel from './IngestHistoryPanel';
import CollaborationModal, { type AccessRole } from './CollaborationModal';
import axios from "axios";

interface UploadPanelProps {
  datasets: string[];
  setDatasets: React.Dispatch<React.SetStateAction<string[]>>;
  selectedDataset: string;
  setSelectedDataset: React.Dispatch<React.SetStateAction<string>>;
}

export default function UploadPanel({ datasets, setDatasets, selectedDataset, setSelectedDataset }: UploadPanelProps) {
  const apiClient = useApiClient();
  const { accounts } = useMsal();
  const { ingest, setIngestState } = useGlobalState();

  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // --- Collab State ---
  const [isCollabOpen, setIsCollabOpen] = useState(false);
  const [currentRole, setCurrentRole] = useState<AccessRole | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch Datasets on Mount
  const fetchDatasets = async () => {
    try {
      const res = await apiClient.get('/api/v1/datasets');
      setDatasets(res.data.datasets);
      if (res.data.datasets.length > 0 && !selectedDataset) setSelectedDataset(res.data.datasets[0]);
    } catch (err) {
      console.error("Failed to fetch datasets:", err);
    }
  };

  // Determine current user's role on the selected dataset
  useEffect(() => {
    if (!selectedDataset) return;
    const fetchRole = async () => {
      try {
        const res = await apiClient.get(`/api/v1/datasets/${selectedDataset}/members`);
        const currentUserEmail = accounts[0]?.username?.toLowerCase();
        const me = res.data.members.find((m: { email: string, role: AccessRole }) => m.email.toLowerCase() === currentUserEmail);
        setCurrentRole(me?.role || "viewer");
      } catch (err) {
        console.error("Failed to fetch permissions", err);
        setCurrentRole("viewer");
      }
    };
    fetchRole();
  }, [selectedDataset, apiClient, accounts]);


  // --- Dataset Handlers ---
  const handleCreateDataset = async () => {
    if (!newDatasetName.trim()) return;
    setIsCreating(true);
    try {
      const res = await apiClient.post('/api/v1/datasets', { name: newDatasetName });
      setDatasets([...datasets, res.data.dataset]);
      setSelectedDataset(res.data.dataset);
      setNewDatasetName("");
      fetchDatasets(); // Refresh list to get roles attached
    } catch (err) {
      console.error("Dataset creation failed:", err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteDataset = async () => {
    if (!selectedDataset) return;
    if (!confirm(`Are you sure you want to permanently delete the dataset ${selectedDataset}?`)) return;

    try {
      await apiClient.delete(`/api/v1/datasets/${selectedDataset}`);
      await fetchDatasets();
      if (datasets.length > 0) setSelectedDataset(datasets[0]);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setErrorMsg(err.response?.data?.detail || "Failed to delete dataset.");
      } else {
        setErrorMsg("An unexpected error occurred while deleting.");
      }
    }
  }

  // --- Upload Handlers ---
  const acceptFiles = (incomingFiles: FileList | File[]) => {
    const validFiles = Array.from(incomingFiles).filter(f => f.name.endsWith(".csv"));
    if (validFiles.length === 0) { setErrorMsg("Only .csv files are supported."); return; }
    setFiles(prev => [...prev, ...validFiles]);
    setErrorMsg("");
  };

  const removeFile = (indexToRemove: number) => {
    setFiles(files.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSubmit = async () => {
    if (files.length === 0 || !selectedDataset) return;
    setErrorMsg("");

    try {
      const formData = new FormData();
      formData.append("dataset_name", selectedDataset);
      files.forEach(f => formData.append("files", f));

      const res = await apiClient.post('/api/v1/ingest', formData);

      setIngestState(() => ({
        isActive: true,
        fileIds: res.data.file_ids,
        activeIndex: 0,
        datasetName: selectedDataset,
        status: { step: 'queued', message: 'Ingestion initiated...' }
      }));
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) setErrorMsg(err.response?.data?.detail || err.message || "Upload failed.");
      else setErrorMsg("An unexpected error occurred.");
    }
  };

  // RBAC Checks
  const canUpload = currentRole === "user" || currentRole === "admin" || currentRole === "owner";
  // const canManageAccess = currentRole === "admin" || currentRole === "owner";
  const canDeleteDataset = currentRole === "user" || currentRole === "admin" || currentRole === "owner"; // Based on backend route

  return (
    <div className="flex flex-col xl:flex-row items-start gap-8 w-full">

      <CollaborationModal
        isOpen={isCollabOpen}
        onClose={() => setIsCollabOpen(false)}
        datasetName={selectedDataset}
        currentUserEmail={accounts[0]?.username || ""}
        currentRole={currentRole || "viewer"}
      />

      {/* LEFT COLUMN: Ingestion Controls */}
      <div className="flex flex-col gap-8 w-full xl:w-120 shrink-0">

        {/* 1. Dataset Selection / Creation */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h3 className="text-[14px] font-semibold text-gray-900">Target Dataset</h3>
            {selectedDataset && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setIsCollabOpen(true)}>
                Manage Access
              </Button>
            )}
          </div>

          {datasets.length > 0 ? (
            <div className="flex gap-3 items-end">
              <div className="flex-1 flex flex-col gap-2">
                <Label className="text-xs text-gray-500">Select an existing dataset</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={selectedDataset}
                  onChange={(e) => setSelectedDataset(e.target.value)}
                  disabled={ingest.isActive}
                >
                  {datasets.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              {canDeleteDataset && !ingest.isActive && (
                <Button variant="ghost" size="icon" className="h-9 w-9 text-red-500 hover:bg-red-50" onClick={handleDeleteDataset}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No datasets available. Create one to begin.</p>
          )}

          {/* Dataset Creation Box */}
          <div className="flex gap-2 pt-4 border-t border-gray-100 mt-2">
            <Input placeholder="New dataset name..." value={newDatasetName} onChange={(e) => setNewDatasetName(e.target.value)} disabled={ingest.isActive} />
            <Button onClick={handleCreateDataset} disabled={isCreating || !newDatasetName || ingest.isActive} variant="secondary">Create</Button>
          </div>
        </div>

        {/* 2. File Upload */}
        <div className={cn("bg-white border rounded-xl p-6 flex flex-col gap-5 shadow-sm transition-opacity", !canUpload ? "opacity-60 pointer-events-none border-gray-100" : "border-gray-200")}>
          <div className="flex justify-between items-center">
            <Label className="text-[14px] font-semibold text-gray-900">Upload Data Files</Label>
            {!canUpload && <span className="text-[10px] uppercase font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded">View Only Access</span>}
            {files.length > 0 && !ingest.isActive && canUpload && (
              <Button variant="ghost" size="sm" className="h-6 text-xs text-gray-500" onClick={() => setFiles([])}>Clear All</Button>
            )}
          </div>

          <div
            className={cn("border-[1.5px] border-dashed rounded-lg px-6 py-8 flex flex-col items-center justify-center cursor-pointer transition-colors min-h-30",
              !canUpload ? "bg-gray-100 border-gray-200" : isDragging ? "border-blue-600 bg-blue-50" : "border-gray-200 bg-gray-50 hover:border-blue-500",
              files.length > 0 && "border-solid border-blue-500 bg-blue-50/30 py-4 cursor-default")}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (canUpload) acceptFiles(e.dataTransfer.files); }}
            onClick={() => canUpload && !ingest.isActive && files.length === 0 && fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" multiple accept=".csv" className="hidden" onChange={(e) => e.target.files && acceptFiles(e.target.files)} disabled={ingest.isActive || !canUpload} />

            {files.length > 0 ? (
              <div className="flex flex-col gap-2 w-full">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-blue-800 bg-white border border-blue-100 shadow-sm px-3 py-2 rounded-md">
                    <span className="font-medium text-[13px] truncate flex-1">{f.name}</span>
                    {!ingest.isActive && (
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="h-6 px-2 text-xs text-gray-400 hover:text-red-600">Remove</Button>
                    )}
                  </div>
                ))}
                {!ingest.isActive && (
                  <Button variant="outline" size="sm" className="mt-2 text-xs border-dashed" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                    + Add More Files
                  </Button>
                )}
              </div>
            ) : <span className="text-sm text-gray-500 text-center">Drag & drop multiple CSVs here, or click to browse</span>}
          </div>

          {errorMsg && <Alert variant="destructive"><AlertDescription>{errorMsg}</AlertDescription></Alert>}

          <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSubmit} disabled={files.length === 0 || !selectedDataset || ingest.isActive || !canUpload}>
            {ingest.isActive ? "Processing Batch..." : `Start Ingestion (${files.length} file${files.length > 1 ? 's' : ''})`}
          </Button>
        </div>

        {/* 3. Live Pipeline Checkpoints */}
        {ingest.isActive && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col gap-4">
            <h3 className="text-[14px] font-semibold text-gray-900">Live Pipeline Status</h3>
            <p className="text-xs text-blue-600 font-mono mb-2">
              [File {ingest.activeIndex + 1} of {ingest.fileIds.length}] {ingest.status.message}
            </p>
            {/* Checkpoints omitted for brevity, keep your existing Checkpoint logic here */}
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: History Panel */}
      <div className="flex-1 w-full min-w-0">
        <div className="mb-4">
          <h3 className="text-[16px] font-semibold text-gray-900">Ingestion History</h3>
          <p className="text-sm text-gray-500">Review previous dataset pipeline executions and statuses.</p>
        </div>
        <IngestHistoryPanel activeDataset={selectedDataset} />
      </div>

    </div>
  );
}