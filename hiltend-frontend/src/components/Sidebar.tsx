import type { AccountInfo } from "@azure/msal-browser";
import styles from "./Sidebar.module.css";

export type NavItem = "ingest" | "datasets" | "analytics";

interface SidebarProps {
  account: AccountInfo;
  activeNav: NavItem;
  onNavChange: (item: NavItem) => void;
  onLogout: () => void;
}

const NAV_ITEMS: { id: NavItem; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
  {
    id: "ingest",
    label: "Ingest",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 16 12 12 8 16" />
        <line x1="12" y1="12" x2="12" y2="21" />
        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
      </svg>
    ),
  },
  {
    id: "datasets",
    label: "Datasets",
    disabled: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
  {
    id: "analytics",
    label: "Analytics",
    disabled: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
];

export default function Sidebar({ account, activeNav, onNavChange, onLogout }: SidebarProps) {
  const initials = (account.name ?? account.username)?.[0]?.toUpperCase() ?? "U";

  return (
    <aside className={styles.sidebar}>
      {/* Logo */}
      <div className={styles.logo}>
        <span className={styles.logoMark}>H</span>
        <span className={styles.logoName}>iltend</span>
      </div>

      {/* Nav */}
      <nav className={styles.nav} aria-label="Main navigation">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={[
              styles.navItem,
              activeNav === item.id ? styles.navItemActive : "",
              item.disabled ? styles.navItemDisabled : "",
            ].join(" ")}
            onClick={() => !item.disabled && onNavChange(item.id)}
            disabled={item.disabled}
            title={item.disabled ? "Coming soon" : item.label}
            aria-current={activeNav === item.id ? "page" : undefined}
          >
            {item.icon}
            {item.label}
            {item.disabled && <span className={styles.comingSoon}>Soon</span>}
          </button>
        ))}
      </nav>

      {/* User */}
      <div className={styles.user}>
        <div className={styles.avatar}>{initials}</div>
        <div className={styles.userInfo}>
          <span className={styles.userName}>{account.name ?? "User"}</span>
          <span className={styles.userEmail}>{account.username}</span>
        </div>
        <button
          className={styles.logoutBtn}
          onClick={onLogout}
          title="Sign out"
          aria-label="Sign out"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </aside>
  );
}