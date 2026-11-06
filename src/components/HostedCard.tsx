import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLanguage } from '../localization';
import { hostedCopy } from '../localization/hostedCopy';
import { CreationUnavailableError, PendingCreationError, createLink, isConfirmedRevoked, readLinks, revokeLink, RevocationStorageError, serviceBase, viewUrl, type ManagedLink } from '../utils/hostedCard';
import { renderQr } from '../utils/qrCard';
import { shareCard } from '../utils/shareCard';
import type { RenderedCard } from '../utils/tripCard';

type Feedback = keyof typeof hostedCopy.en | '';
type PreparedQr = { identity: string; attempt: number; card: RenderedCard; blob: Blob; url: string };

export function HostedCard({card,children}:{card:RenderedCard;children:ReactNode}) {
  const copy=hostedCopy[useLanguage()], base=serviceBase();
  const [link,setLink]=useState<ManagedLink|null>(null),[back,setBack]=useState(false);
  const [qr,setQr]=useState<PreparedQr|null>(null),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState<Feedback>('');
  const current=useRef(card);current.current=card;
  const previousCard=useRef(card), linkCard=useRef(card), currentLink=useRef<ManagedLink|null>(null);
  const operation=useRef(0), qrAttempt=useRef(0), lock=useRef<number|null>(null), mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;operation.current++;qrAttempt.current++;currentLink.current=null;};},[]);
  useEffect(()=>()=>{if(qr)URL.revokeObjectURL(qr.url);},[qr]);

  const retire=(reason:Feedback)=>{
    operation.current++;qrAttempt.current++;lock.current=null;currentLink.current=null;
    setLink(null);setQr(null);setBack(false);setBusy(false);setFeedback(reason);
  };
  const reasonFor=(candidate:ManagedLink):Feedback=>{
    if(candidate.revoked || isConfirmedRevoked(candidate.viewToken))return 'revoked';
    if((candidate.expiresAt??0)<=Date.now())return 'expired';
    try{
      const latest=readLinks().find(value=>viewUrl(value)===viewUrl(candidate));
      return !latest?'storageError':latest.revoked?'revoked':'';
    }catch{return 'storageError';}
  };
  const checkLink=(candidate:ManagedLink):boolean=>{
    if(currentLink.current!==candidate || linkCard.current!==current.current)return false;
    const reason=reasonFor(candidate);
    if(reason){retire(reason);return false;}
    return true;
  };
  useEffect(()=>{
    const update=()=>{const candidate=currentLink.current;if(candidate)checkLink(candidate);};
    window.addEventListener('taxi-check-links',update);window.addEventListener('storage',update);
    return()=>{window.removeEventListener('taxi-check-links',update);window.removeEventListener('storage',update);};
  },[]);
  useEffect(()=>{
    if(previousCard.current!==card){previousCard.current=card;retire('');}
  },[card]);
  useEffect(()=>{
    if(!link)return;
    let timer:ReturnType<typeof setTimeout>;
    const expire=()=>{
      if(currentLink.current!==link)return;
      const remaining=(link.expiresAt??0)-Date.now();
      if(remaining<=0)retire('expired');
      else timer=setTimeout(expire,Math.min(2147483647,remaining));
    };
    expire();return()=>clearTimeout(timer);
  },[link]);
  const begin=()=>{const id=++operation.current;lock.current=id;setBusy(true);return id;};
  const owns=(id:number)=>mounted.current && operation.current===id;
  const finish=(id:number)=>{if(owns(id)){lock.current=null;setBusy(false);}};
  const prepareQr=async(candidate:ManagedLink,frozen:RenderedCard,id:number)=>{
    const attempt=++qrAttempt.current;setQr(null);
    const belongs=()=>owns(id) && attempt===qrAttempt.current && current.current===frozen && checkLink(candidate);
    try{
      const blob=await renderQr(viewUrl(candidate));
      if(belongs())setQr({identity:viewUrl(candidate),attempt,card:frozen,blob,url:URL.createObjectURL(blob)});
    }catch{if(belongs())setFeedback('qrFailure');}
  };
  const create=async()=>{
    if(!base || lock.current!==null)return;
    const id=begin(),frozen=card;qrAttempt.current++;currentLink.current=null;
    setLink(null);setQr(null);setBack(false);setFeedback('creating');
    try{
      const result=await createLink(frozen,base);
      if(!owns(id) || current.current!==frozen)return;
      const reason=reasonFor(result);if(reason){retire(reason);return;}
      currentLink.current=result;linkCard.current=frozen;setLink(result);setFeedback('');
      await prepareQr(result,frozen,id);
    }catch(error){if(owns(id))setFeedback(error instanceof CreationUnavailableError?'creationUnavailable':error instanceof PendingCreationError?'pending':'failure');}
    finally{finish(id);}
  };
  const usable=link && currentLink.current===link && linkCard.current===card && !link.revoked && (link.expiresAt??0)>Date.now();
  const matchingQr=usable && qr && qr.identity===viewUrl(link) && qr.attempt===qrAttempt.current && qr.card===card ? qr:null;
  const copyLink=async()=>{
    if(!link || !checkLink(link))return;const id=operation.current;
    try{await navigator.clipboard.writeText(viewUrl(link));if(owns(id)&&checkLink(link))setFeedback('copied');}
    catch{if(owns(id)&&checkLink(link))setFeedback('copyFailed');}
  };
  return <section className="hosted-card" aria-label={copy.title}>
    {!back && children}
    <h3>{copy.title}</h3><p>{base?copy.disclosure:copy.unavailable}</p>
    {base && <><p className="small">{['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)?copy.local:copy.retention}</p>
      {!usable && <button className="btn secondary" type="button" disabled={busy} onClick={()=>void create()}>{feedback==='failure'?copy.retry:copy.create}</button>}
    </>}
    {usable && <>
      {!matchingQr && !busy && <button type="button" className="btn secondary" onClick={async()=>{
        if(lock.current!==null || !checkLink(link))return;const id=begin();setFeedback('');
        try{await prepareQr(link,card,id);}finally{finish(id);}
      }}>{copy.retryQr}</button>}
      <button className="btn secondary" type="button" aria-pressed={back} onClick={()=>{if(back || checkLink(link))setBack(!back);}}>{back?copy.front:copy.back}</button>
      {back ? <div className="ticket-back">
        {matchingQr ? <img className="qr-preview" src={matchingQr.url} alt={copy.qr}/> : <p role="alert">{copy.qrFailure}</p>}
        <p>{copy.expiry}: <bdi>{new Date(link.expiresAt!).toISOString()}</bdi></p>
        <p className="capability-link" dir="ltr"><a href={viewUrl(link)} target="_blank" rel="noreferrer">{viewUrl(link)}</a></p>
      </div> : null}
      <div className="menu"><button type="button" className="btn secondary" onClick={()=>void copyLink()}>{copy.copy}</button>
      <button type="button" className="btn secondary" disabled={!matchingQr || busy} onClick={async()=>{
        if(!matchingQr || matchingQr.identity!==viewUrl(link) || matchingQr.attempt!==qrAttempt.current || lock.current!==null || !checkLink(link))return;
        const id=begin();
        try{const outcome=await shareCard(matchingQr.blob,'taxi-check-trip-qr.png');if(owns(id)&&checkLink(link))setFeedback(outcome==='share-returned'?'returned':outcome==='cancelled'?'cancelled':'download');}
        catch{if(owns(id)&&checkLink(link))setFeedback('shareError');}finally{finish(id);}
      }}>{copy.shareQr}</button></div>
    </>}
    <p role="status" aria-atomic="true">{feedback?copy[feedback]:''}</p>
    <p className="small">{copy.managePrivacy}</p>
  </section>;
}

export function SharedLinkManager() {
  const copy=hostedCopy[useLanguage()];
  const [open,setOpen]=useState(false),[links,setLinks]=useState<ManagedLink[]>([]),[feedback,setFeedback]=useState<Feedback>(''),[busy,setBusy]=useState(false);
  const trigger=useRef<HTMLButtonElement>(null),heading=useRef<HTMLHeadingElement>(null);
  const load=()=>{try{setLinks(readLinks());setFeedback('');}catch{setFeedback('storageError');}};
  useEffect(()=>{if(open){load();heading.current?.focus();}const update=()=>{if(open)load();};window.addEventListener('taxi-check-links',update);window.addEventListener('storage',update);return()=>{window.removeEventListener('taxi-check-links',update);window.removeEventListener('storage',update);};},[open]);
  return <div className="link-management">
    <button ref={trigger} className="btn quiet" type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>{copy.manage}</button>
    {open && <section className="card" aria-label={copy.manage}>
      <h2 ref={heading} tabIndex={-1}>{copy.manage}</h2><p>{copy.managePrivacy}</p><p>{copy.credentialLost}</p>
      {!links.length && !feedback && <p>{copy.empty}</p>}
      {links.map((link,index)=><div className="ticket-back" key={link.viewToken}>
        <p>{index+1}. {link.revoked?copy.revoked:link.expiresAt?`${copy.expiry}: ${new Date(link.expiresAt).toISOString()}`:copy.pending}</p>
        {!link.revoked && <button className="btn danger" type="button" disabled={busy} onClick={async()=>{
          setBusy(true);try{await revokeLink(link);load();setFeedback('revoked');}catch(error){setFeedback(error instanceof RevocationStorageError?'revokedStorage':'revokeError');}finally{setBusy(false);}
        }}>{copy.revoke}</button>}
      </div>)}
      <p role="status" aria-atomic="true">{feedback?copy[feedback]:''}</p><button className="btn secondary" type="button" disabled={busy} onClick={()=>{setOpen(false);trigger.current?.focus();}}>{copy.close}</button>
    </section>}
  </div>;
}
