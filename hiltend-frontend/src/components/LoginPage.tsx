import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left panel — branding */}
      <div className="flex-1 bg-gray-900 text-white hidden md:flex items-center justify-center p-12">
        <div className="max-w-150 flex flex-col gap-10">
          {/* Logo */}
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span className="inline-flex items-center justify-center w-7.5 h-7.5 bg-blue-600 rounded-sm font-semibold text-[15px] text-white">
              H
            </span>
            <span className="text-white/90 tracking-tight">iltend</span>
          </div>

          {/* Headline */}
          <div className="flex flex-col gap-4">
            <h1 className="text-[32px] font-semibold leading-[1.15] tracking-tight text-white">
              Data pipeline,
              <br />
              simplified.
            </h1>
            <p className="text-gray-400 text-sm leading-[1.7]">
              Upload CSVs, trigger PySpark transformations, and land clean data
              into Azure SQL — all from one place.
            </p>
          </div>

          {/* Features */}
          <div className="flex flex-col gap-3 pt-2 border-t border-gray-800">
            <Feature icon="🔐" label="Zero-trust auth via Microsoft Entra ID" />
            <Feature icon="☁️" label="Native ADLS Gen2 bronze layer staging" />
            <Feature icon="⚡" label="Async PySpark transformation pipeline" />
          </div>
        </div>
      </div>

      {/* Right panel — sign in */}
      <div className="w-full md:w-110 shrink-0 flex items-center justify-center p-8 md:p-12 bg-white">
        <Card className="w-full border-0 shadow-none">
          <CardHeader className="p-0 pb-6 space-y-2">
            <h2 className="text-[22px] font-semibold tracking-tight text-gray-900">
              Sign in
            </h2>
            <p className="text-gray-500 text-[13px]">
              Use your organisation Microsoft account to continue.
            </p>
          </CardHeader>

          <CardContent className="p-0 flex flex-col gap-6">
            <Button
              className="w-full bg-gray-900 hover:bg-gray-800 active:bg-gray-700 text-white font-medium text-sm h-10 gap-3"
              onClick={onLogin}
            >
              <MicrosoftLogo />
              Continue with Microsoft
            </Button>

            <Separator />

            <p className="text-[12px] text-gray-400 leading-relaxed text-center">
              Access is restricted to authorised users only.
              <br />
              Protected by Microsoft Entra ID.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Feature({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-3 text-[13px] text-gray-300">
      <span className="text-[15px] shrink-0">{icon}</span>
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