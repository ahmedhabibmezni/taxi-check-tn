import type { ReactNode } from 'react';
import type { Supplements } from '../domain/fare/types';
import { formatTnd } from '../utils/money';

export function Header({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="header">
      {onBack && (
        <button type="button" className="back" onClick={onBack} aria-label="Back">
          ‹
        </button>
      )}
      <h1>{title}</h1>
    </header>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="row">
      <span className="muted">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

export function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="warnings">
      {items.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );
}

export function Disclaimer() {
  return (
    <p className="disclaimer">
      Independent estimate based on the configured Tunisian taxi tariff. Actual taximeter behaviour, tariff updates, GPS
      accuracy and applicable supplements may affect the final fare.
    </p>
  );
}

export const tnd = (m: number) => `${formatTnd(m)} TND`;
export const range = (lo: number, hi: number) => `${formatTnd(lo)} – ${formatTnd(hi)} TND`;

export function formatDuration(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export const minutes = (s: number) => `${Math.round(s / 60)} min`;
export const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

export function SupplementsInput({ value, onChange }: { value: Supplements; onChange: (s: Supplements) => void }) {
  return (
    <div className="card">
      <label className="check">
        <input
          type="checkbox"
          checked={value.airportDeparture}
          onChange={(e) => onChange({ ...value, airportDeparture: e.target.checked })}
        />
        Departure from the airport
      </label>
      <label className="field">
        Large luggage items
        <div className="stepper">
          <button type="button" onClick={() => onChange({ ...value, luggageItems: Math.max(0, value.luggageItems - 1) })} aria-label="Fewer luggage items">−</button>
          <span className="num">{value.luggageItems}</span>
          <button type="button" onClick={() => onChange({ ...value, luggageItems: Math.min(10, value.luggageItems + 1) })} aria-label="More luggage items">+</button>
        </div>
      </label>
    </div>
  );
}
