import { useEffect, useId, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { languages, useLanguage, useMessages } from '../localization';
import type { TripRecord } from '../domain/trip/types';
import { renderTripCard, snapshotTripCard, type CardOptions, type CardSnapshot, type RenderedCard } from '../utils/tripCard';
import { canShareCard, downloadCard, shareCard, type CardShareOutcome } from '../utils/shareCard';
import { HostedCard } from './HostedCard';

export function TripCardExport({ trip, disabled = false }: { trip: TripRecord; disabled?: boolean }) {
  const copy = useMessages();
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<CardOptions>({ comparison: false, details: false });
  const [snapshot, setSnapshot] = useState<CardSnapshot | null>(null);
  const [preview, setPreview] = useState<{ card: RenderedCard; url: string } | null>(null);
  const [state, setState] = useState<'idle' | 'rendering' | 'ready' | 'render-error' | 'sharing' | 'share-error' | CardShareOutcome>('idle');
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const generation = useRef(0);
  const rendering = useRef(false);
  const sharing = useRef(false);
  const wasOpen = useRef(false);
  const id = useId();
  useEffect(() => {
    if (open) heading.current?.focus();
    else if (wasOpen.current) {
      if (trigger.current?.disabled) trigger.current.closest('main')?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      else trigger.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const close = () => {
    generation.current++; rendering.current = false;
    setOpen(false); setPreview(null); setSnapshot(null); setState('idle');
  };
  const changeOptions = (next: CardOptions) => {
    setOptions(next); setPreview(null); setSnapshot(null); setState('idle');
  };
  const prepare = async () => {
    if (rendering.current || sharing.current || disabled) return;
    rendering.current = true;
    const attempt = ++generation.current;
    const frozen = snapshotTripCard(trip, language, options);
    setSnapshot(frozen); setPreview(null); setState('rendering');
    try {
      const card = await renderTripCard(frozen);
      if (attempt !== generation.current) return;
      setPreview({ card, url: URL.createObjectURL(card.blob) }); setState('ready');
    } catch {
      if (attempt === generation.current) { setPreview(null); setState('render-error'); }
    } finally { if (attempt === generation.current) rendering.current = false; }
  };
  const send = async (download = false) => {
    if (!preview || sharing.current || rendering.current || disabled) return;
    const frozen = preview.card;
    sharing.current = true; setState('sharing');
    try { setState(download ? downloadCard(frozen.blob) : await shareCard(frozen.blob)); }
    catch { setState('share-error'); }
    finally { sharing.current = false; }
  };
  const busy = state === 'rendering' || state === 'sharing';
  const fileSharing = preview && (Capacitor.isNativePlatform() || canShareCard(preview.card.blob));
  return <div className="menu">
    <button type="button" className="btn primary" ref={trigger} disabled={disabled || busy} aria-expanded={open}
      aria-controls={open ? id : undefined} onClick={() => {
        setOptions({ comparison: false, details: false }); setPreview(null); setSnapshot(null); setState('idle'); setOpen(true);
      }}>{copy.card.open}</button>
    {open && <section className="card" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>{copy.card.title}</h2>
      <p>{copy.card.privacy}</p>
      <label className="check"><input type="checkbox" checked={options.comparison} disabled={busy || trip.meter === null}
        onChange={event => changeOptions({ ...options, comparison: event.target.checked })} />{copy.card.includeMeter}</label>
      <label className="check"><input type="checkbox" checked={options.details} disabled={busy}
        onChange={event => changeOptions({ ...options, details: event.target.checked })} />{copy.card.includeDetails}</label>
      <button type="button" className="btn secondary" disabled={busy || disabled} onClick={() => { void prepare(); }}>
        {state === 'render-error' ? copy.card.retryPreview : copy.card.prepare}</button>
      <p role={state === 'render-error' || state === 'share-error' ? 'alert' : 'status'} aria-atomic="true"
        className={state === 'render-error' || state === 'share-error' ? 'error' : 'small muted'}>
        {state === 'rendering' ? copy.card.rendering : state === 'render-error' ? copy.card.renderError
          : state === 'sharing' ? copy.card.sharing : state === 'share-error' ? copy.card.shareError
          : state === 'share-returned' ? copy.export.theShareActionReturnedDeliveryTo
          : state === 'download-requested' ? copy.export.downloadRequestedCheckYourBrowserDownloads
          : state === 'cancelled' ? copy.card.cancelled : state === 'ready' ? copy.card.ready : ''}
      </p>
      {snapshot && <p className="small">{copy.card.previewLanguage(languages[snapshot.language].label)}</p>}
      {preview && <>
        <p className="small">{copy.card.frozen}</p>
        <HostedCard key={preview.url} card={preview.card}>
        <img className="trip-card-preview" src={preview.url} width={preview.card.width} height={preview.card.height} alt={copy.card.imageAlt} />
        <details className="card-text">
          <summary>{copy.card.textVersion}</summary>
          <div lang={languages[preview.card.snapshot.language].lang} dir={preview.card.snapshot.direction}>
            <p>Taxi Check TN</p>
            {preview.card.snapshot.blocks.map((block, index) => <p key={index}
              dir={block.kind === 'fare' || block.kind === 'range' || block.kind === 'difference' ? 'ltr' : preview.card.snapshot.direction}>{block.text}</p>)}
          </div>
        </details>
        </HostedCard>
        <button type="button" className="btn primary" disabled={busy || disabled} onClick={() => { void send(); }}>
          {state === 'share-error' || state === 'cancelled' ? copy.card.retryShare : fileSharing ? copy.card.share : copy.card.download}</button>
        {!Capacitor.isNativePlatform() && fileSharing && <button type="button" className="btn secondary" disabled={busy || disabled}
          onClick={() => { void send(true); }}>{copy.card.download}</button>}
      </>}
      <p className="small">{copy.card.staticImage}</p>
      <p className="small">{copy.privacy.recipientCopies}</p>
      <details className="small"><summary>{copy.privacy.cacheTitle}</summary><p>{copy.privacy.exportCache}</p></details>
      <button type="button" className="btn secondary" disabled={state === 'sharing'} onClick={close}>{copy.card.close}</button>
    </section>}
  </div>;
}
