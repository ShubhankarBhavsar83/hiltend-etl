import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { AccountInfo } from "@azure/msal-browser";

export type NavItem = "ingest" | "datasets" | "analytics";

interface SidebarProps {
  account: AccountInfo;
  activeNav: NavItem;
  onNavChange: (item: NavItem) => void;
  onLogout: () => void;
}

const NAV_ITEMS: {
  id: NavItem;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}[] = [
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
    <TooltipProvider delayDuration={300}>
      <aside className="hidden md:flex w-55 shrink-0 bg-gray-900 flex-col p-5 h-screen sticky top-0">
        {/* Logo */}
        <div className="flex items-center gap-2 text-base font-semibold px-2 pb-6">
          <span className="inline-flex items-center justify-center w-6.5 h-6.5 bg-blue-600 rounded-sm font-semibold text-[13px] text-white">
            H
          </span>
          <span className="text-white/90">iltend</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col gap-0.5" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-start gap-3 px-3 h-9 text-[13.5px] font-normal text-gray-400 hover:text-white/80 hover:bg-white/6 rounded-sm",
                    activeNav === item.id &&
                      "bg-white/10 text-white font-medium hover:bg-white/10 hover:text-white",
                    item.disabled && "opacity-40 cursor-not-allowed pointer-events-none"
                  )}
                  onClick={() => !item.disabled && onNavChange(item.id)}
                  disabled={item.disabled}
                  aria-current={activeNav === item.id ? "page" : undefined}
                >
                  {item.icon}
                  {item.label}
                  {item.disabled && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-[3px] bg-white/8 text-gray-400 font-mono tracking-wide">
                      Soon
                    </span>
                  )}
                </Button>
              </TooltipTrigger>
              {item.disabled && (
                <TooltipContent side="right">
                  <p>Coming soon</p>
                </TooltipContent>
              )}
            </Tooltip>
          ))}
        </nav>

        {/* User */}
        <div className="flex items-center gap-3 pt-4 border-t border-white/8">
          <Avatar className="w-7.5 h-7.5 shrink-0">
            <AvatarFallback className="bg-blue-600 text-white text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <span className="block text-[12.5px] font-medium text-white/85 truncate">
              {account.name ?? "User"}
            </span>
            <span className="block text-[11px] text-gray-600 font-mono truncate">
              {account.username}
            </span>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-7 w-7 text-gray-600 hover:text-white/70 hover:bg-transparent rounded-sm"
                onClick={onLogout}
                aria-label="Sign out"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Sign out</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}