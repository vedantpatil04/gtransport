import { addDays } from '@/lib/dates';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { DocRecord } from '@/types';

const d = (iso: string | null) => (iso ? fmtDate(iso, 'en', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function Field({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-2')}>
      <div className="text-[8.5px] uppercase tracking-wide text-[#6b7280]">{k}</div>
      <div className="truncate text-[11px] font-semibold text-[#111827]">{v}</div>
    </div>
  );
}

function Watermark() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="rotate-[-24deg] select-none text-[34px] font-black tracking-[0.2em] text-[#1B2B44]/[0.07]">DEMO COPY</span>
    </div>
  );
}

interface Props {
  doc: DocRecord;
  owner: string;
  holder?: string;
  vehicleModel?: string;
  fuelType?: string;
  className?: string;
}

/** Facsimile of an official document for seeded demo records (clearly marked as a demo copy). */
export function DocArt({ doc, owner, holder, vehicleModel, fuelType, className }: Props) {
  const frame = 'relative w-[330px] max-w-full overflow-hidden rounded-md bg-white text-left shadow-[0_8px_24px_rgba(0,0,0,0.35)]';
  let body: React.ReactNode;
  if (doc.type === 'licence') {
    body = (
      <div className={cn(frame, 'rounded-xl bg-gradient-to-br from-[#f1f6fb] to-[#e3ecf5]')}>
        <div className="flex items-center justify-between bg-[#1f4aa8] px-3 py-1.5 text-white">
          <span className="text-[10px] font-bold">UNION OF INDIA</span>
          <span className="text-[10px] font-semibold">DRIVING LICENCE</span>
        </div>
        <div className="flex gap-3 p-3">
          <div className="flex h-[88px] w-[70px] shrink-0 items-end justify-center overflow-hidden rounded bg-[#cbd5e1]">
            <svg viewBox="0 0 40 50" className="w-[60px] fill-[#94a3b8]"><circle cx="20" cy="17" r="10" /><path d="M2 50c1-12 8-18 18-18s17 6 18 18z" /></svg>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-x-2 gap-y-1.5">
            <Field k="DL No." v={doc.number} wide />
            <Field k="Name" v={holder ?? owner} wide />
            <Field k="Issued" v={d(doc.issuedOn)} />
            <Field k="Valid till" v={d(doc.expiresOn)} />
            <Field k="Class" v="LMV · TRANS" wide />
          </div>
        </div>
        <div className="px-3 pb-2 text-[9px] text-[#475569]">{doc.issuer}</div>
        <Watermark />
      </div>
    );
  } else if (doc.type === 'rc') {
    body = (
      <div className={cn(frame, 'rounded-xl bg-gradient-to-br from-[#f3f8ef] to-[#e4efdc]')}>
        <div className="flex items-center justify-between bg-[#2f6b3a] px-3 py-1.5 text-white">
          <span className="text-[10px] font-bold">GOVT. OF KARNATAKA</span>
          <span className="text-[10px] font-semibold">CERTIFICATE OF REGISTRATION</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-3">
          <Field k="Regn. No." v={owner} />
          <Field k="Regn. date" v={d(doc.issuedOn)} />
          <Field k="Owner" v="GANGAMATA ROADLINES" wide />
          <Field k="Maker / Model" v={vehicleModel ?? '—'} wide />
          <Field k="Fuel" v={(fuelType ?? '').toUpperCase() || '—'} />
          <Field k="Body type" v="GOODS CARRIER" />
        </div>
        <div className="px-3 pb-2 text-[9px] text-[#475569]">Registering authority: {doc.issuer}</div>
        <Watermark />
      </div>
    );
  } else {
    const title =
      doc.type === 'insurance' ? 'Certificate of Insurance cum Policy Schedule' : doc.type === 'puc' ? 'Pollution Under Control Certificate' : doc.type === 'fitness' ? 'Certificate of Fitness' : doc.type === 'permit' ? 'National Permit · Authorisation' : doc.customName ?? 'Document';
    const accent = doc.type === 'insurance' ? '#7a1f2b' : doc.type === 'puc' ? '#0f766e' : '#1B2B44';
    body = (
      <div className={frame}>
        <div className="px-4 py-2 text-white" style={{ background: accent }}>
          <div className="text-[12px] font-extrabold">{doc.type === 'insurance' ? doc.issuer : doc.type === 'puc' ? 'PUC CERTIFICATE' : 'TRANSPORT DEPARTMENT'}</div>
          <div className="text-[9.5px] opacity-85">{title}</div>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-4">
          <Field k={doc.type === 'insurance' ? 'Policy No.' : 'Certificate No.'} v={doc.number} wide />
          <Field k="Vehicle No." v={owner} />
          <Field k="Insured / Owner" v="Gangamata Roadlines" />
          <Field k="Valid from" v={d(doc.issuedOn)} />
          <Field k="Valid up to" v={d(doc.expiresOn)} />
          {doc.type === 'insurance' && <Field k="Cover" v="Package · Goods Carrying" wide />}
          {doc.type === 'puc' && <Field k="Result" v={fuelType === 'diesel' ? 'Smoke density 1.12 m⁻¹ · PASS' : 'CO 0.21 % · HC 96 ppm · PASS'} wide />}
          {doc.type !== 'insurance' && doc.type !== 'puc' && <Field k="Issued by" v={doc.issuer} wide />}
        </div>
        <div className="flex items-center justify-between border-t px-4 py-1.5 text-[9px] text-[#6b7280]">
          <span>Next due {d(doc.expiresOn ? addDays(doc.expiresOn, 1) : null)}</span>
          <span>Authorised signatory</span>
        </div>
        <Watermark />
      </div>
    );
  }
  return <div className={cn('flex h-full w-full items-center justify-center overflow-hidden bg-[#3a3f47] p-4', className)}>{body}</div>;
}
