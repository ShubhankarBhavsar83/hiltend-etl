import { useState } from "react";
import { useMsal } from "@azure/msal-react";
import Sidebar, { type NavItem } from "./Sidebar";
import UploadPanel from "./UploadPanel";
import styles from "./Dashboard.module.css";

interface DashboardProps {
  onLogout: () => void;
}

export default function Dashboard({ onLogout }: DashboardProps) {
  const { accounts } = useMsal();
  const account = accounts[0];
  const [activeNav, setActiveNav] = useState<NavItem>("ingest");

  return (
    <div className={styles.root}>
      <Sidebar
        account={account}
        activeNav={activeNav}
        onNavChange={setActiveNav}
        onLogout={onLogout}
      />

      <main className={styles.main}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{PAGE_TITLES[activeNav]}</h1>
          <p className={styles.pageSubtitle}>{PAGE_SUBTITLES[activeNav]}</p>
        </div>

        <div className={styles.content}>
          {activeNav === "ingest" && <UploadPanel />}
          {activeNav === "datasets" && <Placeholder label="Datasets" />}
          {activeNav === "analytics" && <Placeholder label="Analytics" />}
        </div>
      </main>
    </div>
  );
}

// ── Placeholder for future pages ──────────────────────────────────────────────
function Placeholder({ label }: { label: string }) {
  return (
    <div className={styles.placeholder}>
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