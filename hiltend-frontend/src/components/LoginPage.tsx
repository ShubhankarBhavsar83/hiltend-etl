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
        {/* Swapped max-w-150 for max-w-md */}
        <div className="max-w-md flex flex-col gap-10">
          {/* Logo */}
          <div className="flex items-center gap-2 text-lg font-semibold">
            {/* Swapped w-7.5 h-7.5 for standard w-8 h-8 */}
            <span className="inline-flex items-center justify-center w-8 h-8 bg-blue-600 rounded-sm font-semibold text-[15px] text-white">
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
      {/* Swapped w-110 for w-[28rem] to use arbitrary sizing safely */}
      <div className="w-full md:w-[28rem] shrink-0 flex items-center justify-center p-8 md:p-12 bg-white">
        <Card className="w-full border-0 shadow-none">
          {/* Swapped p-25 for p-6 */}
          <CardHeader className="p-4 space-y-2">
            <h2 className="text-[22px] font-semibold tracking-tight text-gray-900">
              Sign in
            </h2>
            <p className="text-gray-500 text-[13px]">
              Use your organisation Microsoft account to continue.
            </p>
          </CardHeader>

          {/* Swapped p-25 for p-6, and flex-row for flex-col */}
          <CardContent className="p-4 flex flex-col gap-6">
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