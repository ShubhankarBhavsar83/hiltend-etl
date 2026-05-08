import styles from "./LoginPage.module.css";

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  return (
    <div className={styles.root}>
      {/* Left panel — branding */}
      <div className={styles.left}>
        <div className={styles.leftInner}>
          <div className={styles.logo}>
            <span className={styles.logoMark}>H</span>
            <span className={styles.logoName}>iltend</span>
          </div>

          <div className={styles.headline}>
            <h1>Data pipeline,<br />simplified.</h1>
            <p>
              Upload CSVs, trigger PySpark transformations, and land clean data
              into Azure SQL — all from one place.
            </p>
          </div>

          <div className={styles.features}>
            <Feature icon="" label="Zero-trust auth via Microsoft Entra ID" />
            <Feature icon="" label="Native ADLS Gen2 bronze layer staging" />
            <Feature icon="" label="Async PySpark transformation pipeline" />
          </div>
        </div>
      </div>

      {/* Right panel — sign in */}
      <div className={styles.right}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>Sign in</h2>
            <p>Use your organisation Microsoft account to continue.</p>
          </div>

          <button className={styles.msBtn} onClick={onLogin}>
            <MicrosoftLogo />
            Continue with Microsoft
          </button>

          <p className={styles.cardFooter}>
            Access is restricted to authorised users only.
            <br />
            Protected by Microsoft Entra ID.
          </p>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, label }: { icon: string; label: string }) {
  return (
    <div className={styles.feature}>
      <span className={styles.featureIcon}>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none" aria-hidden="true">
      <rect x="1"  y="1"  width="9" height="9" fill="#F25022" />
      <rect x="11" y="1"  width="9" height="9" fill="#7FBA00" />
      <rect x="1"  y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}