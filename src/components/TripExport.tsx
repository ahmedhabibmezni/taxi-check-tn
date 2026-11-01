import { useMessages } from '../localization';
import { useEffect, useId, useRef, useState } from 'react';
import type { TripRecord } from '../domain/trip/types';
import { downloadFile, tripToJson, tripsToCsv, type ExportOutcome } from '../utils/export';

export function TripExport({ label, name, format, trips, disabled = false }: {
  label: string; name: string; format: 'json' | 'csv'; trips: TripRecord[]; disabled?: boolean;
}) {
  const en = useMessages();
  const [open, setOpen] = useState(false);
  const [includeCoordinates, setIncludeCoordinates] = useState(false);
  const [state, setState] = useState<'idle' | 'pending' | 'error' | ExportOutcome>('idle');
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const id = useId();
  useEffect(() => { if (open) heading.current?.focus(); }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const submit = async () => {
    if (pending.current || disabled) return;
    pending.current = true;
    setState('pending');
    try {
      const content = format === 'json' ? tripToJson(trips[0], includeCoordinates) : tripsToCsv(trips, includeCoordinates);
      const outcome = await downloadFile(name, content, format === 'json' ? 'application/json' : 'text/csv');
      setState(outcome);
      if (outcome !== 'cancelled' && (heading.current?.parentElement?.contains(document.activeElement)
        || document.activeElement === document.body)) heading.current?.focus();
    } catch { setState('error'); }
    finally { pending.current = false; }
  };
  const finished = state === 'download-requested' || state === 'share-returned';
  return <div className="menu">
    <button type="button" className="btn secondary" ref={trigger} disabled={disabled || state === 'pending'}
      aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { setIncludeCoordinates(false); setState('idle'); setOpen(true); heading.current?.focus(); }}>{label}</button>
    {open && <section className="card" id={id} aria-labelledby={`${id}-title`}>
      <h2 ref={heading} tabIndex={-1} id={`${id}-title`}>{en.export.optionsTitle(label)}</h2>
      <p id={`${id}-privacy`}>{en.export.coordinatesCanRevealWhereAJourney}</p>
      <p className="small">{en.privacy.recipientCopies}</p>
      <details className="small">
        <summary>{en.privacy.cacheTitle}</summary>
        <p>{en.privacy.exportCache}</p>
      </details>
      <label className="check">
        <input type="checkbox" checked={includeCoordinates} aria-describedby={`${id}-privacy`}
          disabled={state === 'pending' || finished} onChange={e => setIncludeCoordinates(e.target.checked)} />
        {en.export.includePreciseStartEndCoordinatesFor}</label>
      <p className={state === 'error' ? 'error' : 'small muted'} role={state === 'error' ? 'alert' : 'status'} aria-atomic="true">
        {state === 'pending' ? en.export.requestingExport : state === 'error' ? en.export.exportCouldNotBeCompletedDelivery
          : state === 'cancelled' ? en.export.androidReportedThatSharingWasCancelled
          : state === 'download-requested' ? en.export.downloadRequestedCheckYourBrowserDownloads
          : state === 'share-returned' ? en.export.theShareActionReturnedDeliveryTo : ''}
      </p>
      {!finished && <button type="button" className="btn primary" disabled={disabled || state === 'pending'} onClick={() => { void submit(); }}>
        {state === 'error' || state === 'cancelled' ? en.export.retryExport : en.export.continueExport}
      </button>}
      <button type="button" className="btn secondary" disabled={state === 'pending'} onClick={close}>{en.export.closeExportOptions}</button>
    </section>}
  </div>;
}
