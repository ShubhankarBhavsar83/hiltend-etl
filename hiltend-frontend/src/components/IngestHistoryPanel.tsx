import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useApiClient } from "../hooks/useApiClient";
import { useMsal } from "@azure/msal-react";

// --- Types ---
type StepStatus = "completed" | "error" | "pending" | "in_progress";

interface JobStep {
  name: string;
  key: string;
  status: StepStatus;
}

interface IngestJob {
  id: string;
  adlsFileId: string;
  overallStatus: "success" | "failed" | "in_progress";
  steps: JobStep[];
}

interface IngestBatch {
  batchId: string;
  timestamp: string;
  user: string;
  datasetName: string;
  overallStatus: "success" | "failed" | "in_progress";
  jobs: IngestJob[];
}

interface IngestHistoryPanelProps {
  activeDataset?: string;
}

export default function IngestHistoryPanel({ activeDataset }: IngestHistoryPanelProps) {
  const apiClient = useApiClient();
  const { accounts } = useMsal();
  const currentUser = accounts[0]?.username || "Unknown User";

  const [batches, setBatches] = useState<IngestBatch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<IngestBatch | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // --- Filter & Sort State ---
  const [viewMode, setViewMode] = useState<"active" | "all">("active");
  const [sortBy, setSortBy] = useState<"time" | "dataset" | "user">("time");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (viewMode === "active" && sortBy === "dataset") setSortBy("time");
    if (!activeDataset) setViewMode("all");
  }, [viewMode, sortBy, activeDataset]);

  // Fetch History
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setIsLoading(true);
        const res = await apiClient.get('/api/v1/ingest/history');
        setBatches(res.data.batches);

        if (res.data.batches.length > 0) {
          setSelectedBatch(res.data.batches[0]);
        }
      } catch (err) {
        console.error("Failed to fetch job history:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
    const interval = setInterval(fetchHistory, 5000);
    return () => clearInterval(interval);
  }, [apiClient, currentUser]);

  useEffect(() => {
    if (selectedBatch && selectedBatch.jobs.length > 0) {
      if (!selectedBatch.jobs.find(j => j.id === selectedJobId)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedJobId(selectedBatch.jobs[0].id);
      }
    }
  }, [selectedBatch, selectedJobId]);


  // --- Processed Batches Logic ---
  const processedBatches = useMemo(() => {
    let result = [...batches];

    if (viewMode === "active" && activeDataset) {
      result = result.filter(b => b.datasetName === activeDataset);
    }

    result.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "time") {
        comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      } else if (sortBy === "dataset") {
        comparison = a.datasetName.localeCompare(b.datasetName);
      } else if (sortBy === "user") {
        comparison = a.user.localeCompare(b.user);
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    return result;
  }, [batches, viewMode, activeDataset, sortBy, sortOrder]);

  useEffect(() => {
    if (processedBatches.length > 0) {
      if (!selectedBatch || !processedBatches.find(b => b.batchId === selectedBatch.batchId)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedBatch(processedBatches[0]);
      }
    } else {
      setSelectedBatch(null);
    }
  }, [processedBatches, selectedBatch]);

  if (isLoading && batches.length === 0) {
    return <div className="p-8 text-center text-gray-500 text-sm">Loading history...</div>;
  }


  if (isLoading && batches.length === 0) {
    return <div className="p-8 text-center text-gray-500 text-sm">Loading history...</div>;
  }

  const activeJob = selectedBatch?.jobs.find(j => j.id === selectedJobId);

  return (
    <div className="flex flex-col md:flex-row h-150 border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm">

      {/* Pane A: Batch List */}
      <div className="w-full md:w-1/3 border-r border-gray-200 bg-gray-50 flex flex-col h-full shrink-0">

        {/* NEW: Filter & Sort Header */}
        <div className="p-4 border-b border-gray-200 bg-white flex flex-col gap-3 shrink-0">
          <div>
            <h3 className="text-[14px] font-semibold text-gray-900">Ingestion Batches</h3>
          </div>

          <div className="flex flex-col gap-2">
            {activeDataset && (
              <div className="flex bg-gray-100 p-1 rounded-md">
                <button
                  onClick={() => setViewMode("active")}
                  className={cn("flex-1 text-[11px] py-1 rounded font-medium transition-colors", viewMode === "active" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700")}
                >
                  This Dataset
                </button>
                <button
                  onClick={() => setViewMode("all")}
                  className={cn("flex-1 text-[11px] py-1 rounded font-medium transition-colors", viewMode === "all" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700")}
                >
                  All Datasets
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <select
                className="flex-1 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-700 font-medium"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "time" | "dataset" | "user")}              >
                <option value="time">Sort by Time</option>
                <option value="user">Sort by User</option>
                {viewMode === "all" && <option value="dataset">Sort by Dataset</option>}
              </select>
              <button
                onClick={() => setSortOrder(prev => prev === "desc" ? "asc" : "desc")}
                className="px-2.5 border border-gray-200 bg-gray-50 rounded text-xs text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold"
                title={sortOrder === "desc" ? "Descending" : "Ascending"}
              >
                {sortOrder === "desc" ? "↓" : "↑"}
              </button>
            </div>
          </div>
        </div>

        {/* Map using processedBatches instead of batches */}
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {processedBatches.map((batch) => (
            <button
              key={batch.batchId}
              onClick={() => setSelectedBatch(batch)}
              className={cn(
                "flex flex-col text-left p-3 rounded-lg transition-colors border",
                selectedBatch?.batchId === batch.batchId
                  ? "bg-blue-50 border-blue-200 shadow-sm"
                  : "bg-transparent border-transparent hover:bg-gray-100 hover:border-gray-200"
              )}
            >
              <div className="flex justify-between items-start w-full mb-1">
                <div className="flex flex-col w-[70%]">
                  <span className="text-[13px] font-semibold text-gray-900 font-mono truncate">{batch.batchId}</span>
                  <span className="text-[11px] text-gray-500 truncate w-full">{batch.datasetName} • {batch.jobs.length} file{batch.jobs.length !== 1 && 's'}</span>
                </div>
                <StatusBadge status={batch.overallStatus} />
              </div>
              <div className="flex justify-between items-center mt-1">
                <span className="text-[10px] text-gray-400">{batch.timestamp}</span>
                <span className="text-[10px] text-gray-400 truncate max-w-22.5">{batch.user}</span>
              </div>
            </button>
          ))}
          {processedBatches.length === 0 && !isLoading && (
            <div className="text-center p-4 text-sm text-gray-400">No ingestion history found.</div>
          )}
        </div>
      </div>

      {/* Pane B: Batch & Job Details */}
      <div className="w-full md:w-2/3 flex flex-col h-full bg-white overflow-y-auto">
        {selectedBatch ? (
          <div className="p-6 flex flex-col gap-6">

            {/* Batch Header */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-xl font-semibold text-gray-900 font-mono">{selectedBatch.batchId}</h2>
                <StatusBadge status={selectedBatch.overallStatus} />
              </div>
              <p className="text-sm text-gray-500">Pipeline execution details for this batch.</p>
            </div>

            {/* Batch Metadata Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
              <DetailRow label="Target Dataset" value={selectedBatch.datasetName} />
              <DetailRow label="Executed By" value={selectedBatch.user} />
              <DetailRow label="Timestamp" value={selectedBatch.timestamp} />
              <DetailRow label="Total Files" value={selectedBatch.jobs.length.toString()} />
            </div>

            {/* File Level Selector */}
            {selectedBatch.jobs.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="text-[14px] font-semibold text-gray-900 border-b pb-2">Files in Batch</h3>
                <div className="flex flex-wrap gap-2">
                  {selectedBatch.jobs.map((job, idx) => (
                    <button
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-xs font-medium border flex items-center gap-2 transition-colors",
                        selectedJobId === job.id
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                      )}
                    >
                      {job.overallStatus === "success" && <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>}
                      {job.overallStatus === "failed" && <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>}
                      {job.overallStatus === "in_progress" && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>}
                      File {idx + 1} ({job.id})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Pipeline Steps Validation for Active Job */}
            {activeJob && (
              <div className="bg-white rounded-lg border border-gray-100 p-5 mt-2">
                <DetailRow label="ADLS Identifier" value={activeJob.adlsFileId} isCode className="mb-6" />

                <h4 className="text-[13px] font-semibold text-gray-900 mb-4">Pipeline Checkpoints</h4>
                <div className="flex flex-col gap-3">
                  {activeJob.steps.map((step, index) => (
                    <StepIndicator key={step.key} index={index + 1} step={step} />
                  ))}
                </div>
              </div>
            )}

          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            Select a batch to view details
          </div>
        )}
      </div>

    </div>
  );
}

// --- Sub-components ---

function DetailRow({ label, value, isCode, className }: { label: string; value: string; isCode?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
      <span className={cn("text-[13px] text-gray-900 break-all", isCode && "font-mono text-[12px] bg-gray-50 border border-gray-200 px-2 py-1.5 rounded")}>
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: IngestBatch['overallStatus'] }) {
  const styles = {
    success: "bg-green-100 text-green-700 border-green-200",
    failed: "bg-red-100 text-red-700 border-red-200",
    in_progress: "bg-blue-100 text-blue-700 border-blue-200 animate-pulse",
  };
  return (
    <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize", styles[status])}>
      {status.replace("_", " ")}
    </span>
  );
}

function StepIndicator({ index, step }: { index: number; step: JobStep }) {
  return (
    <div className="flex items-center gap-3">
      {step.status === "completed" ? (
        <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-green-600"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
      ) : step.status === "error" ? (
        <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0 text-red-600 font-bold text-[10px]">
          X
        </div>
      ) : step.status === "in_progress" ? (
        <div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin shrink-0" />
      ) : (
        <div className="w-5 h-5 rounded-full border-2 border-dashed border-gray-300 shrink-0" />
      )}

      <span className={cn(
        "text-sm font-medium",
        step.status === "completed" ? "text-gray-900"
          : step.status === "error" ? "text-red-600"
            : step.status === "in_progress" ? "text-blue-700"
              : "text-gray-400"
      )}>
        {index}. {step.name}
      </span>
    </div>
  );
}