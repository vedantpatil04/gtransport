import { fmtDate, fmtTime, inr, num } from '@/lib/format';
import type { Expense, FuelEntry } from '@/types';

/**
 * Printed-receipt renderings for seeded demo records (no photo exists for them).
 * Receipts are printed in English at Indian pumps and toll plazas, so the artwork is too.
 */
const BRAND_STYLE: Record<string, { color: string; short: string }> = {
  IndianOil: { color: '#f37021', short: 'IndianOil' },
  'Bharat Petroleum': { color: '#0b5aa6', short: 'BHARAT PETROLEUM' },
  'HP Petrol Pump': { color: '#1d3f91', short: 'HINDUSTAN PETROLEUM' },
  'Nayara Energy': { color: '#d7262d', short: 'NAYARA ENERGY' },
};

function Paper({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-auto w-full max-w-[290px] bg-[#fdfdfb] px-5 pb-7 pt-5 font-mono text-[11.5px] leading-[1.55] text-[#222] shadow-[0_2px_10px_rgba(0,0,0,0.12)]"
      style={{
        WebkitMaskImage: 'linear-gradient(-45deg, transparent 6px, #000 6px), linear-gradient(45deg, transparent 6px, #000 6px)',
        WebkitMaskSize: '12px 100%',
        WebkitMaskPosition: 'bottom left',
        WebkitMaskRepeat: 'repeat-x',
        maskImage: 'linear-gradient(-45deg, transparent 6px, #000 6px), linear-gradient(45deg, transparent 6px, #000 6px)',
        maskSize: '12px 100%',
        maskPosition: 'bottom left',
        maskRepeat: 'repeat-x',
        transform: 'rotate(-0.6deg)',
      }}
    >
      {children}
    </div>
  );
}

const Row = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => (
  <div className={`flex justify-between gap-3 ${bold ? 'text-[13px] font-bold' : ''}`}>
    <span>{k}</span>
    <span className="text-right">{v}</span>
  </div>
);
const Rule = () => <div className="my-1.5 border-t border-dashed border-[#999]" />;

const serial = (id: string) => {
  let h = 7;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 999_983;
  return String(h).padStart(6, '0');
};

export function FuelReceiptArt({ entry, reg }: { entry: FuelEntry; reg: string }) {
  const brandKey = Object.keys(BRAND_STYLE).find((b) => entry.station.startsWith(b)) ?? 'IndianOil';
  const brand = BRAND_STYLE[brandKey];
  const place = entry.station.split('–')[1]?.trim() ?? '';
  const rate = entry.litres ? entry.amount / entry.litres : 0;
  return (
    <Paper>
      <div className="text-center">
        <div className="mx-auto mb-1 inline-block rounded px-2 py-0.5 text-[12px] font-bold tracking-wide text-white" style={{ background: brand.color }}>
          {brand.short}
        </div>
        <div className="font-bold">{place.toUpperCase()} FILLING STN</div>
        <div className="text-[10px] text-[#666]">GSTIN 29AA••••••1Z{serial(entry.id).slice(-1)}</div>
      </div>
      <Rule />
      <Row k="RCPT NO" v={serial(entry.id)} />
      <Row k="DATE" v={fmtDate(entry.date, 'en', { day: '2-digit', month: '2-digit', year: 'numeric' })} />
      <Row k="TIME" v={fmtTime(entry.createdAt, 'en')} />
      <Row k="NOZZLE" v={String((Number(serial(entry.id)) % 6) + 1).padStart(2, '0')} />
      <Row k="PRODUCT" v={entry.fuelType === 'petrol' ? 'PETROL' : 'HSD (DIESEL)'} />
      <Rule />
      <Row k="RATE Rs/L" v={num(rate, 2)} />
      <Row k="VOLUME L" v={num(entry.litres, 2)} />
      <Row k="AMOUNT" v={inr(entry.amount).replace('₹', 'Rs ')} bold />
      <Rule />
      <Row k="VEH NO" v={reg} />
      <Row k="MODE" v={Number(serial(entry.id)) % 3 === 0 ? 'CASH' : 'UPI'} />
      <div className="mt-2 text-center text-[10px] text-[#666]">THANK YOU · VISIT AGAIN</div>
    </Paper>
  );
}

const TOLL_OPERATOR = 'NHAI · FASTag LANE';

export function ExpenseBillArt({ expense, reg }: { expense: Expense; reg: string }) {
  const isToll = expense.category === 'toll';
  return (
    <Paper>
      <div className="text-center">
        <div className="font-bold">{isToll ? expense.note.toUpperCase() : expense.category === 'maintenance' || expense.category === 'tyre' ? 'SRI BASAVESHWAR AUTO WORKS' : 'CASH BILL'}</div>
        <div className="text-[10px] text-[#666]">{isToll ? TOLL_OPERATOR : 'Old P.B. Road, Belagavi'}</div>
      </div>
      <Rule />
      <Row k="BILL NO" v={serial(expense.id)} />
      <Row k="DATE" v={fmtDate(expense.date, 'en', { day: '2-digit', month: '2-digit', year: 'numeric' })} />
      <Row k="TIME" v={fmtTime(expense.createdAt, 'en')} />
      <Row k="VEH NO" v={reg} />
      <Rule />
      {isToll ? <Row k="JOURNEY" v="SINGLE" /> : <Row k="PARTICULARS" v={expense.note.slice(0, 22).toUpperCase()} />}
      <Row k="TOTAL" v={inr(expense.amount).replace('₹', 'Rs ')} bold />
      <Rule />
      <div className="mt-2 text-center text-[10px] text-[#666]">{isToll ? 'HAPPY JOURNEY' : 'THANK YOU'}</div>
    </Paper>
  );
}
