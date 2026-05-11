import { useState, useRef, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import { loginRequest } from "../util/authConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
type UploadStatus = "idle" | "uploading" | "success" | "error";

interface UploadResult {
  status: string;
  message: string;
  file_id: string;
  path: string;
  adls_uploaded: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function UploadPanel() {
  const { instance, accounts } = useMsal();

  const [file, setFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptFile = (f: File) => {
    if (!f.name.endsWith(".csv")) {
      setErrorMsg("Only .csv files are supported.");
      return;
    }
    setFile(f);
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) acceptFile(dropped);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) acceptFile(selected);
  };

  const clearFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFile(null);
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!file) { setErrorMsg("Please select a CSV file."); return; }
    if (!datasetName.trim()) { setErrorMsg("Please enter a dataset name."); return; }

    setStatus("uploading");
    setErrorMsg("");

    try {
      const token = await instance.acquireTokenSilent({
        ...loginRequest,
        account: accounts[0],
      });

      const formData = new FormData();
      formData.append("dataset_name", datasetName.trim());
      formData.append("file", file);

      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/v1/ingest`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token.accessToken}` },
          body: formData,
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }

      const data: UploadResult = await res.json();
      setResult(data);
      setStatus("success");
      setFile(null);
      setDatasetName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setStatus("error");
    }
  };

  const canSubmit = !!file && !!datasetName.trim() && status !== "uploading";

  return (
    <div className="flex flex-col gap-8 max-w-160">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-gray-900">
          Ingest Dataset
        </h2>
        <p className="text-[13.5px] text-gray-500 leading-relaxed">
          Upload a CSV to stage it in the bronze layer and trigger the PySpark
          transformation pipeline.
        </p>
      </div>

      {/* Form */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col gap-5 shadow-sm">
        {/* Dataset name */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="dataset-name" className="text-[12.5px] font-semibold text-gray-700 tracking-[0.01em]">
            Dataset name
          </Label>
          <Input
            id="dataset-name"
            className="font-mono text-[13.5px] h-9"
            type="text"
            placeholder="e.g. sales_q3_2026"
            value={datasetName}
            onChange={(e) => setDatasetName(e.target.value)}
            disabled={status === "uploading"}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="text-xs text-gray-400 font-mono">
            Used to prefix the staged file. Letters, numbers and underscores recommended.
          </span>
        </div>

        {/* File drop zone */}
        <div className="flex flex-col gap-2">
          <Label className="text-[12.5px] font-semibold text-gray-700 tracking-[0.01em]">
            CSV file
          </Label>
          <div
            className={cn(
              "border-[1.5px] border-dashed border-gray-200 rounded-lg px-6 py-8 flex items-center justify-center cursor-pointer transition-colors bg-gray-50",
              "hover:border-blue-500 hover:bg-blue-50",
              isDragging && "border-blue-600 bg-blue-50",
              file && "border-solid border-blue-500 bg-blue-50 cursor-default py-4 px-5"
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => !file && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="File drop zone"
            onKeyDown={(e) => e.key === "Enter" && !file && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileInput}
            />

            {file ? (
              <div className="flex items-center gap-3 w-full text-blue-700">
                <FileIcon />
                <div className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-medium text-gray-900 truncate">
                    {file.name}
                  </span>
                  <span className="text-xs text-gray-400 font-mono">{formatBytes(file.size)}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-7 w-7 text-gray-400 hover:text-red-500 hover:bg-transparent"
                  onClick={clearFile}
                  aria-label="Remove file"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-gray-400 text-center">
                <UploadIcon />
                <span className="text-[13.5px] text-gray-600">
                  Drag & drop a CSV here, or{" "}
                  <span className="text-blue-600 font-medium underline underline-offset-2">
                    browse
                  </span>
                </span>
                <span className="text-xs text-gray-400 font-mono">CSV only · Max 50 MB</span>
              </div>
            )}
          </div>
        </div>

        {/* Error alert */}
        {errorMsg && (
          <Alert variant="destructive" role="alert">
            <ErrorIcon />
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}

        {/* Success alert */}
        {status === "success" && result && (
          <Alert className="border-green-200 bg-green-50 text-green-800" role="status">
            <SuccessIcon />
            <AlertTitle className="font-semibold mb-0.5">{result.message}</AlertTitle>
            <AlertDescription className="text-xs opacity-80 font-mono">
              File ID: <code>{result.file_id}</code>
              {result.adls_uploaded && " · Uploaded to ADLS"}
            </AlertDescription>
          </Alert>
        )}

        {/* Submit */}
        <Button
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm h-10 gap-2"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {status === "uploading" ? (
            <>
              <Spinner />
              Uploading…
            </>
          ) : (
            "Ingest Dataset"
          )}
        </Button>
      </div>

      {/* Pipeline steps */}
      <PipelineSteps />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function PipelineSteps() {
  const steps = [
    { n: "01", title: "Stage", desc: "CSV saved to ADLS Gen2 bronze container" },
    { n: "02", title: "Transform", desc: "PySpark job runs asynchronously" },
    { n: "03", title: "Load", desc: "Clean data written to Azure SQL" },
  ];
  return (
    <div className="flex items-stretch gap-2 flex-col sm:flex-row">
      {steps.map((s, i) => (
        <>
          <div key={s.n} className="flex-1 bg-white border border-gray-200 rounded-lg p-4 flex gap-3 items-start shadow-sm">
            <Badge variant="outline" className="font-mono text-[11px] font-medium text-blue-600 border-blue-200 bg-blue-50 px-1.5 py-0 mt-0.5 shrink-0">
              {s.n}
            </Badge>
            <div>
              <strong className="block text-[13px] font-semibold text-gray-900 mb-0.5">
                {s.title}
              </strong>
              <span className="text-xs text-gray-500 leading-relaxed">{s.desc}</span>
            </div>
          </div>
          {i < steps.length - 1 && (
            <div key={`arrow-${i}`} className="text-gray-300 text-base flex items-center justify-center shrink-0 sm:rotate-0 rotate-90">
              →
            </div>
          )}
        </>
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <div className="w-3.5 h-3.5 border-2 border-white/35 border-t-white rounded-full animate-spin" />
  );
}

function FileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}