import { useState, useRef, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import { loginRequest } from "../util/authConfig";
import styles from "./UploadPanel.module.css";

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
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>Ingest Dataset</h2>
        <p className={styles.panelDesc}>
          Upload a CSV to stage it in the bronze layer and trigger the PySpark
          transformation pipeline.
        </p>
      </div>

      {/* Form */}
      <div className={styles.form}>
        {/* Dataset name */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="dataset-name">
            Dataset name
          </label>
          <input
            id="dataset-name"
            className={styles.input}
            type="text"
            placeholder="e.g. sales_q3_2026"
            value={datasetName}
            onChange={(e) => setDatasetName(e.target.value)}
            disabled={status === "uploading"}
            autoComplete="off"
            spellCheck={false}
          />
          <span className={styles.hint}>
            Used to prefix the staged file. Letters, numbers and underscores recommended.
          </span>
        </div>

        {/* File drop zone */}
        <div className={styles.field}>
          <label className={styles.label}>CSV file</label>
          <div
            className={[
              styles.dropZone,
              isDragging ? styles.dragging : "",
              file ? styles.hasFile : "",
            ].join(" ")}
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
              className={styles.hiddenInput}
              onChange={handleFileInput}
            />

            {file ? (
              <div className={styles.fileRow}>
                <FileIcon />
                <div className={styles.fileMeta}>
                  <span className={styles.fileName}>{file.name}</span>
                  <span className={styles.fileSize}>{formatBytes(file.size)}</span>
                </div>
                <button className={styles.clearBtn} onClick={clearFile} aria-label="Remove file">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className={styles.dropHint}>
                <UploadIcon />
                <span>
                  Drag & drop a CSV here, or{" "}
                  <span className={styles.browseLink}>browse</span>
                </span>
                <span className={styles.dropSub}>CSV only · Max 50 MB</span>
              </div>
            )}
          </div>
        </div>

        {/* Feedback */}
        {errorMsg && (
          <div className={styles.alert} data-type="error" role="alert">
            <ErrorIcon />
            {errorMsg}
          </div>
        )}

        {status === "success" && result && (
          <div className={styles.alert} data-type="success" role="status">
            <SuccessIcon />
            <div>
              <strong>{result.message}</strong>
              <span className={styles.resultMeta}>
                File ID: <code>{result.file_id}</code>
                {result.adls_uploaded && " · Uploaded to ADLS"}
              </span>
            </div>
          </div>
        )}

        {/* Submit */}
        <button
          className={styles.submitBtn}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {status === "uploading" ? (
            <>
              <span className={styles.spinner} />
              Uploading…
            </>
          ) : (
            "Ingest Dataset"
          )}
        </button>
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
    <div className={styles.pipeline}>
      {steps.map((s, i) => (
        <>
          <div key={s.n} className={styles.pipelineStep}>
            <span className={styles.stepNum}>{s.n}</span>
            <div>
              <strong>{s.title}</strong>
              <span>{s.desc}</span>
            </div>
          </div>
          {i < steps.length - 1 && (
            <div key={`arrow-${i}`} className={styles.pipelineArrow}>→</div>
          )}
        </>
      ))}
    </div>
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