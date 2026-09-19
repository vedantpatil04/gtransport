import { fmtDate } from '@/lib/format';
import type { DocRecord } from '@/types';

/**
 * High-quality rendering of seeded official documents (RC, insurance schedule, PUC, licence…).
 * Content is shown as printed on the certificate — in English, as issued.
 */
const THEME: Record<DocRecord['type'], { band: string; title: string; sub: string }> = {
  rc: { band: '#1d4e89', title: 'CERTIFICATE OF REGISTRATION', sub: 'Form 23 · Transport Department, Govt. of Karnataka' },
  insurance: { band: '#7a1f3d', title: 'POLICY SCHEDULE — COMMERCIAL VEHICLE', sub: 'Package Policy · Goods Carrying Vehicle' },
  puc: { band: '#2f6b3a', title: 'POLLUTION UNDER CONTROL CERTIFICATE', sub: 'Rule 115(7), Central Motor Vehicles Rules' },
  licence: { band: '#233a6b', title: 'DRIVING LICENCE', sub: 'Union of India · Transport Vehicle (TR)' },
  fitness: { band: '#5b4a1e', title: 'CERTIFICATE OF FITNESS', sub: 'Form 38 · Transport Department' },
  permit: { band: '#4a3470', title: 'NATIONAL PERMIT', sub: 'Authorisation for Goods Carriage' },
  other: { band: '#39424e', title: 'DOCUMENT', sub: '' },
};

export function DocumentArt({ doc, ownerLabel, ownerName, model }: { doc: DocRecord; ownerLabel: string; ownerName: string; model?: string }) {
  const th = THEME[doc.type];
  const fields: [string, string][] = [
    [doc.type === 'insurance' ? 'Policy No.' : doc.type === 'licence' ? 'DL No.' : 'Certificate No.', doc.number],
    [doc.ownerType === 'vehicle' ? 'Registration No.' : 'Name', ownerLabel],
  ];
  if (doc.ownerType === 'vehicle') {
    fields.push(['Registered Owner', 'GANGAMATA ROADLINES']);
    if (model) fields.push(['Maker / Model', model]);
  } else {
    fields.push(['S/W/D of', '— as per records —']);
  }
  if (doc.issuedOn) fields.push(['Date of Issue', fmtDate(doc.issuedOn, 'en', { day: '2-digit', month: '2-digit', year: 'numeric' })]);
  fields.push(['Valid Till', doc.expiresOn ? fmtDate(doc.expiresOn, 'en', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Life of vehicle']);
  fields.push([doc.type === 'insurance' ? 'Insurer' : 'Issuing Authority', doc.issuer]);
  if (doc.customName) fields.unshift(['Document', doc.customName]);

  return (
    <div className="mx-auto w-full max-w-[460px] overflow-hidden rounded-md border border-[#c9ccd1] bg-[#fbfaf6] text-[#1f2328] shadow-[0_2px_12px_rgba(0,0,0,0.12)]">
      <div className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: th.band }}>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-white/70 text-[9px] font-bold leading-none">
          {doc.type === 'insurance' ? doc.issuer.split(' ').map((w) => w[0]).join('').slice(0, 3) : 'IND'}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-bold tracking-wide">{th.title}</div>
          {th.sub && <div className="truncate text-[10.5px] opacity-80">{th.sub}</div>}
        </div>
      </div>
      <div className="relative grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-4 text-[12.5px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{ backgroundImage: `repeating-linear-gradient(45deg, ${th.band} 0 1px, transparent 1px 9px)` }}
        />
        {fields.map(([k, v]) => (
          <div key={k} className="contents">
            <span className="text-[#5b6470]">{k}</span>
            <span className="font-semibold">{v}</span>
          </div>
        ))}
        {doc.ownerType === 'driver' && (
          <div className="col-span-2 mt-2 flex items-end justify-between">
            <div className="flex h-16 w-14 items-center justify-center rounded border border-[#c9ccd1] bg-[#e8e6df] text-lg font-bold text-[#8a8f98]">
              {ownerName
                .split(' ')
                .map((p) => p[0])
                .join('')
                .slice(0, 2)}
            </div>
            <div className="text-right text-[10px] text-[#5b6470]">
              <div className="font-[cursive] text-[15px] text-[#1f2328]">{ownerName}</div>
              Signature of holder
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-dashed border-[#c9ccd1] px-4 py-2 text-[10px] text-[#5b6470]">
        <span>Digitally verifiable · mParivahan / DigiLocker</span>
        <span className="font-mono">{doc.id.toUpperCase().replace('_', '-')}</span>
      </div>
    </div>
  );
}
