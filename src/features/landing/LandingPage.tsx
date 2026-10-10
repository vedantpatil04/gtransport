import { Banknote, Download, FileCheck2, Fuel, LogIn, MapPinned, Smartphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { DRIVER_APP, formatMegabytes } from './driverApp';

/**
 * The public home page: who this is, a way into the office console, and the Driver app download.
 *
 * Deliberately small — no images beyond the logo, no animation, no extra dependencies — so it loads
 * at once on a phone. It states only what the system actually does. There is no contact section
 * because the project holds no verified company contact details (the only address, e-mail and phone
 * in the code are sample data for the demo); add one here when the office supplies them.
 */

const COVERS = [
  { icon: MapPinned, title: 'Live fleet map', text: 'See where each driver and vehicle is, as it happens.' },
  { icon: Fuel, title: 'Fuel & daily expenses', text: 'Drivers record them with receipt photos, even without signal.' },
  { icon: FileCheck2, title: 'Documents', text: 'RC, insurance, PUC and licence expiry, tracked per vehicle and driver.' },
  { icon: Banknote, title: 'Payments & reports', text: 'Salaries, advances and payments, with PDF and Excel reports.' },
] as const;

const INSTALL_STEPS = [
  'Tap the download button. When the file has finished, open it from your notifications or the Downloads app.',
  'Android may say that your browser (or Files app) is not allowed to install apps. Choose Settings and allow it for this one app only; then go back and tap Install.',
  'Open Gangamata Transport and sign in with the mobile number and password the office gave you.',
  'Afterwards you can switch "Install unknown apps" off again for that browser or Files app.',
] as const;

export function LandingPage() {
  const size = formatMegabytes(DRIVER_APP.sizeBytes);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="container flex h-16 items-center">
        <Logo size="default" markSrc="/branding/gangamata-mark-sm.png" />
      </header>

      <main className="container flex-1 pb-8">
        <section className="mx-auto max-w-2xl pt-2 text-center sm:pt-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Fleet management for Gangamata Transport</h1>
          <p className="mt-3 text-base text-muted-foreground sm:text-lg">
            The office manages vehicles, drivers, fuel, documents and payments in one console. Drivers use the Android app to record fuel and
            expenses, upload documents and share their location while on duty.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="h-auto min-h-12 whitespace-normal py-3 text-center sm:min-w-56">
              <Link to="/admin" data-testid="landing-office-login">
                <LogIn aria-hidden /> Office / Admin Login
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              className="h-auto min-h-12 whitespace-normal bg-plate py-3 text-center text-[#0B2545] hover:bg-plate/90 sm:min-w-56"
            >
              <a href={DRIVER_APP.downloadPath} download={DRIVER_APP.fileName} data-testid="landing-download">
                <Download aria-hidden /> Driver? Download Android App
              </a>
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground" data-testid="landing-app-facts">
            Android app · version {DRIVER_APP.versionName} · {size} · Android {DRIVER_APP.minAndroid} or newer
          </p>
        </section>

        <section aria-label="What it covers" className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-3 md:grid-cols-4">
          {COVERS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="panel p-3.5">
              <Icon className="size-5 text-primary" aria-hidden />
              <h2 className="mt-2 text-sm font-semibold leading-tight">{title}</h2>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{text}</p>
            </div>
          ))}
        </section>

        <section id="driver-app" aria-labelledby="driver-app-title" className="panel mx-auto mt-8 max-w-2xl p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Smartphone className="size-5 text-primary" aria-hidden />
            <h2 id="driver-app-title" className="text-base font-semibold">
              Driver app for Android
            </h2>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Version {DRIVER_APP.versionName} · {size}. In English, हिन्दी, ಕನ್ನಡ, मराठी, தமிழ் and తెలుగు. Your driver account is created by the office.
          </p>

          <details className="mt-3 rounded-md border bg-background px-3 py-2 text-sm" data-testid="landing-install">
            <summary className="cursor-pointer font-medium">How to install</summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
              {INSTALL_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">
              Only install it from this page. If Android says the app cannot be installed over an older copy, first check the old app has nothing
              waiting to sync, then remove it and install this one.
            </p>
          </details>

          <details className="mt-2 rounded-md border bg-background px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">Check the file (optional)</summary>
            <p className="mt-2 text-xs text-muted-foreground">SHA-256 of {DRIVER_APP.fileName}:</p>
            <code className="mt-1 block break-all font-mono text-[11px]" data-testid="landing-sha256">
              {DRIVER_APP.sha256}
            </code>
          </details>
        </section>
      </main>

      <footer className="container py-4 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} Gangamata Transport</footer>
    </div>
  );
}
