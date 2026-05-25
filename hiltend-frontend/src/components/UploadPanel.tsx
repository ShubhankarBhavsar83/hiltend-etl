import { useState, useRef, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import { loginRequest } from "../util/authConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription,  } from "@/components/ui/alert";
// import { Badge } from "@/components/ui/badge";
// import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type PipelineStep = "idle" | "queued" | "staging" | "extracting" | "ai_mapping" | "etl_running" | "completed" | "error";

interface UploadPanelProps {
  datasets: string[];
  setDatasets: React.Dispatch<React.SetStateAction<string[]>>;
  selectedDataset: string;
  setSelectedDataset: React.Dispatch<React.SetStateAction<string>>;
}

export default function UploadPanel({ datasets, setDatasets, selectedDataset, setSelectedDataset }: UploadPanelProps) {
  const { instance, accounts } = useMsal();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Dataset Creation State
  const [newDatasetName, setNewDatasetName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Pipeline State
  const [fileId, setFileId] = useState<string | null>(null);
  const [pipelineStep, setPipelineStep] = useState<PipelineStep>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Dataset Handlers ---
  const handleCreateDataset = async () => {
    if (!newDatasetName.trim()) return;
    setIsCreating(true);
    try {
      const token = await instance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/datasets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.accessToken}` },
        body: JSON.stringify({ name: newDatasetName }),
      });
      if (res.ok) {
        const data = await res.json();
        setDatasets([...datasets, data.dataset]);
        setSelectedDataset(data.dataset);
        setNewDatasetName("");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreating(false);
    }
  };

  // --- Upload Handlers ---
  const acceptFile = (f: File) => {
    if (!f.name.endsWith(".csv")) { setErrorMsg("Only .csv files are supported."); return; }
    setFile(f); setPipelineStep("idle"); setErrorMsg(""); setFileId(null);
  };

  const handleSubmit = async () => {
    if (!file || !selectedDataset) return;
    setPipelineStep("queued");
    setErrorMsg("");

    try {
      const token = await instance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
      const formData = new FormData();
      formData.append("dataset_name", selectedDataset);
      formData.append("file", file);

      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/ingest`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token.accessToken}` },
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed to initiate");
      const data = await res.json();
      setFileId(data.file_id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed.");
      setPipelineStep("error");
    }
  };

  // --- Status Polling ---
  useEffect(() => {
    if (!fileId || pipelineStep === "completed" || pipelineStep === "error") return;

    const interval = setInterval(async () => {
      try {
        const token = await instance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/status/${fileId}`, {
          headers: { Authorization: `Bearer ${token.accessToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setPipelineStep(data.step);
          setStatusMessage(data.message);
          if (data.step === "completed" || data.step === "error") clearInterval(interval);
        }
      } catch (err) {
        console.error("Polling error", err);
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [fileId, pipelineStep, instance, accounts]);

  const isActive = pipelineStep !== "idle" && pipelineStep !== "completed" && pipelineStep !== "error";

  return (
    <div className="flex flex-col gap-8 max-w-160">
      
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
                disabled={isActive}
              >
                {datasets.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <span className="text-sm text-gray-400 mb-2">or</span>
            <div className="flex-1 flex gap-2">
              <Input 
                placeholder="New dataset name..." 
                value={newDatasetName} 
                onChange={(e) => setNewDatasetName(e.target.value)} 
                disabled={isActive}
              />
              <Button onClick={handleCreateDataset} disabled={isCreating || !newDatasetName || isActive} variant="outline">
                Create
              </Button>
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
        <Label className="text-[14px] font-semibold text-gray-900">Upload Data File</Label>
        <div
          className={cn(
            "border-[1.5px] border-dashed rounded-lg px-6 py-8 flex items-center justify-center cursor-pointer transition-colors bg-gray-50",
            isDragging ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-blue-500",
            file && "border-solid border-blue-500 bg-blue-50 py-4"
          )}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); acceptFile(e.dataTransfer.files[0]); }}
          onClick={() => !isActive && fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files && acceptFile(e.target.files[0])} disabled={isActive} />
          {file ? (
            <div className="flex items-center gap-3 w-full text-blue-700">
              <span className="font-medium text-sm truncate flex-1">{file.name}</span>
              {!isActive && <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setFile(null); }}>Clear</Button>}
            </div>
          ) : (
             <span className="text-sm text-gray-500">Drag & drop a CSV here, or click to browse</span>
          )}
        </div>

        {errorMsg && <Alert variant="destructive"><AlertDescription>{errorMsg}</AlertDescription></Alert>}

        <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSubmit} disabled={!file || !selectedDataset || isActive}>
          {isActive ? "Processing Pipeline..." : "Start Ingestion"}
        </Button>
      </div>

      {/* 3. Live Pipeline Checkpoints */}
      {pipelineStep !== "idle" && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col gap-4">
          <h3 className="text-[14px] font-semibold text-gray-900">Live Pipeline Status</h3>
          <p className="text-xs text-blue-600 font-mono mb-2">{statusMessage}</p>
          
          <div className="flex flex-col gap-3">
            <Checkpoint label="1. Stage to ADLS Bronze Layer" activeKeys={["staging"]} doneKeys={["extracting", "ai_mapping", "etl_running", "completed"]} current={pipelineStep} />
            <Checkpoint label="2. Databricks Serverless Header Extract" activeKeys={["extracting"]} doneKeys={["ai_mapping", "etl_running", "completed"]} current={pipelineStep} />
            <Checkpoint label="3. Azure AI Star Schema Design" activeKeys={["ai_mapping"]} doneKeys={["etl_running", "completed"]} current={pipelineStep} />
            <Checkpoint label="4. PySpark ETL & Azure SQL Merge" activeKeys={["etl_running"]} doneKeys={["completed"]} current={pipelineStep} />
          </div>
        </div>
      )}
    </div>
  );
}

// --- Checkpoint UI Helper ---
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