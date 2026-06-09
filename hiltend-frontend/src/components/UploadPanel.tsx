import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useGlobalState } from '../context/useGlobalState';
import { cn } from "@/lib/utils";
import { useApiClient } from "../hooks/useApiClient";
import IngestHistoryPanel from './IngestHistoryPanel';
import axios from "axios";

interface UploadPanelProps {
  datasets: string[];
  setDatasets: React.Dispatch<React.SetStateAction<string[]>>;
  selectedDataset: string;
  setSelectedDataset: React.Dispatch<React.SetStateAction<string>>;
}

export default function UploadPanel({ datasets, setDatasets, selectedDataset, setSelectedDataset }: UploadPanelProps) {
  const apiClient = useApiClient();
  const { ingest, setIngestState } = useGlobalState();

  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Dataset Handlers ---
  const handleCreateDataset = async () => {
    if (!newDatasetName.trim()) return;
    setIsCreating(true);
    try {
      const res = await apiClient.post('/api/v1/datasets', { name: newDatasetName });
      setDatasets([...datasets, res.data.dataset]);
      setSelectedDataset(res.data.dataset);
      setNewDatasetName("");
    } catch (err) {
      console.error("Dataset creation failed:", err);
    } finally {
      setIsCreating(false);
    }
  };

  const fetchDatasets = async () => {
    try {
      const res = await apiClient.get('/api/v1/datasets');
      setDatasets(res.data.datasets);
      if (res.data.datasets.length > 0 && !selectedDataset) setSelectedDataset(res.data.datasets[0]);
    } catch (err) {
      console.error("Failed to fetch datasets:", err);
    }
  };

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

      // Update Global State - the useIngestPolling hook will now take over
      setIngestState(() => ({
        isActive: true,
        fileIds: res.data.file_ids,
        activeIndex: 0,
        datasetName: selectedDataset,
        status: { step: 'queued', message: 'Ingestion initiated...' }
      }));
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setErrorMsg(err.response?.data?.detail || err.message || "Upload failed.");
      } else {
        setErrorMsg("An unexpected error occurred.");
      }
    }
  };

  return (
    <div className="flex flex-col xl:flex-row items-start gap-8 w-full">
      
      {/* LEFT COLUMN: Ingestion Controls */}
      <div className="flex flex-col gap-8 w-full xl:w-[480px] shrink-0">
        
        {/* 1. Dataset Selection / Creation */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col gap-4">
          <h3 className="text-[14px] font-semibold text-gray-900">Target Dataset</h3>
          {datasets.length > 0 ? (
            <div className="flex gap-3 items-end">
              <div className="flex-1 flex flex-col gap-2">
                <Label className="text-xs text-gray-500">Select an existing dataset</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={selectedDataset}
                  onChange={(e) => setSelectedDataset(e.target.value)}
                  disabled={ingest.isActive}
                >
                  {datasets.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <Button size="sm" onClick={fetchDatasets}>Get Datasets</Button>
              </div>
              <span className="text-sm text-gray-400 mb-2">or</span>
              <div className="flex-1 flex gap-2">
                <Input placeholder="New dataset name..." value={newDatasetName} onChange={(e) => setNewDatasetName(e.target.value)} disabled={ingest.isActive} />
                <Button onClick={handleCreateDataset} disabled={isCreating || !newDatasetName || ingest.isActive} variant="outline">Create</Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input placeholder="Create your first dataset..." value={newDatasetName} onChange={(e) => setNewDatasetName(e.target.value)} />
              <Button onClick={handleCreateDataset} disabled={isCreating || !newDatasetName}>Create</Button>
            </div>
          )}
        </div>

        {/* 2. File Upload */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col gap-5 shadow-sm">
          <div className="flex justify-between items-center">
            <Label className="text-[14px] font-semibold text-gray-900">Upload Data Files</Label>
            {files.length > 0 && !ingest.isActive && (
              <Button variant="ghost" size="sm" className="h-6 text-xs text-gray-500" onClick={() => setFiles([])}>Clear All</Button>
            )}
          </div>

          <div
            className={cn("border-[1.5px] border-dashed rounded-lg px-6 py-8 flex flex-col items-center justify-center cursor-pointer transition-colors bg-gray-50 min-h-[120px]",
              isDragging ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-blue-500",
              files.length > 0 && "border-solid border-blue-500 bg-blue-50/30 py-4 cursor-default")}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); acceptFiles(e.dataTransfer.files); }}
            onClick={() => !ingest.isActive && files.length === 0 && fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" multiple accept=".csv" className="hidden" onChange={(e) => e.target.files && acceptFiles(e.target.files)} disabled={ingest.isActive} />

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

          <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSubmit} disabled={files.length === 0 || !selectedDataset || ingest.isActive}>
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

            <div className="flex flex-col gap-3">
              <Checkpoint label="1. Stage to ADLS Bronze Layer" activeKeys={["staging"]} doneKeys={["extracting", "ai_mapping", "etl_running", "completed"]} current={ingest.status.step} />
              <Checkpoint label="2. Databricks Serverless Header Extract" activeKeys={["extracting"]} doneKeys={["ai_mapping", "etl_running", "completed"]} current={ingest.status.step} />
              <Checkpoint label="3. Azure AI Star Schema Design" activeKeys={["ai_mapping"]} doneKeys={["etl_running", "completed"]} current={ingest.status.step} />
              <Checkpoint label="4. PySpark ETL & Azure SQL Merge" activeKeys={["etl_running"]} doneKeys={["completed"]} current={ingest.status.step} />
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: History Panel */}
      <div className="flex-1 w-full min-w-0">
        <div className="mb-4">
          <h3 className="text-[16px] font-semibold text-gray-900">Ingestion History</h3>
          <p className="text-sm text-gray-500">Review previous dataset pipeline executions and statuses.</p>
        </div>
        <IngestHistoryPanel />
      </div>

    </div>
  );
}

function Checkpoint({ label, activeKeys, doneKeys, current }: { label: string, activeKeys: string[], doneKeys: string[], current: string }) {
  const isDone = doneKeys.includes(current);
  const isActive = activeKeys.includes(current);
  const isError = current === "error";

  return (
    <div className="flex items-center gap-3">
      {isDone ? (
        <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-green-600"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
      ) : isActive ? (
        <div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin shrink-0" />
      ) : isError ? (
        <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0 text-red-600 text-xs">!</div>
      ) : (
        <div className="w-5 h-5 rounded-full border-2 border-gray-200 shrink-0" />
      )}
      <span className={cn("text-sm transition-colors", isDone || isActive ? "text-gray-900 font-medium" : "text-gray-400")}>
        {label}
      </span>
    </div>
  );
}