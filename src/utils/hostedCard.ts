import type { RenderedCard } from './tripCard';

export const LINK_KEY = 'taxi-check.shared-card-management.v1';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const confirmedRevocations = new Set<string>();
export const isConfirmedRevoked = (token: string): boolean => confirmedRevocations.has(token);
export class CreationUnavailableError extends Error {}
export class PendingCreationError extends Error {}
export class RevocationStorageError extends Error {}
export type ManagedLink = { base: string; viewToken: string; revokeToken: string; digest: string; expiresAt: number | null; revoked: boolean; creationToken?: string; createUntil?: number; issuedExpiresAt?: number };
export function serviceBase(raw: string | undefined = import.meta.env.VITE_CARD_SERVICE_URL): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}
export function readLinks(): ManagedLink[] {
  const raw = localStorage.getItem(LINK_KEY);
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 100 || value.some(v => !v || typeof v !== 'object'
    || ![['base','viewToken','revokeToken','digest','expiresAt','revoked'],['base','viewToken','revokeToken','digest','expiresAt','revoked','creationToken','createUntil','issuedExpiresAt']].some(keys=>Object.keys(v).sort().join()===keys.sort().join())
    || ('creationToken' in v && (typeof v.creationToken!=='string' || !TOKEN.test(v.creationToken) || v.creationToken===v.viewToken || v.creationToken===v.revokeToken
      || !Number.isSafeInteger(v.createUntil) || v.createUntil<=0 || !Number.isSafeInteger(v.issuedExpiresAt) || v.issuedExpiresAt<v.createUntil))
    || serviceBase(v.base) !== v.base || typeof v.viewToken !== 'string' || typeof v.revokeToken !== 'string'
    || !TOKEN.test(v.viewToken) || !TOKEN.test(v.revokeToken) || v.viewToken === v.revokeToken
    || typeof v.digest !== 'string' || !/^[a-f0-9]{64}$/.test(v.digest) || typeof v.revoked !== 'boolean'
    || !(v.expiresAt === null || (Number.isSafeInteger(v.expiresAt) && v.expiresAt > 0)))) throw Error('Link storage unavailable');
  return value.map(link=>confirmedRevocations.has(link.viewToken)?{...link,revoked:true}:link);
}
function store(link: ManagedLink): void {
  const links = readLinks();
  const next = [...links.filter(v => v.viewToken !== link.viewToken), link];
  if (next.length > 100) throw Error('Link storage full');
  const bytes = JSON.stringify(next); localStorage.setItem(LINK_KEY, bytes);
  if (localStorage.getItem(LINK_KEY) !== bytes) throw Error('Link storage not verified');
  window.dispatchEvent(new Event('taxi-check-links'));
}
export function viewUrl(link: ManagedLink): string { return `${link.base}/view#${link.viewToken}`; }
class RequestError extends Error { constructor(readonly status:number){super('Shared-card request failed');} }
async function request(base: string, route: string, body: unknown): Promise<Record<string, unknown>> {
  const result = await fetch(`${base}/v1/cards${route}`, { method:'POST', credentials:'omit', cache:'no-store',
    referrerPolicy:'no-referrer', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(15000) });
  if (!result.ok) throw new RequestError(result.status);
  return await result.json() as Record<string, unknown>;
}
async function encode(blob: Blob): Promise<string> {
  return new Promise((resolve,reject)=>{
    const reader = new FileReader(); reader.onerror=()=>reject(Error('Image unavailable'));
    reader.onload=()=>typeof reader.result==='string' && reader.result.startsWith('data:image/png;base64,')
      ? resolve(reader.result.slice(reader.result.indexOf(',')+1)) : reject(Error('Image unavailable'));
    reader.readAsDataURL(blob);
  });
}
let creationQueue:Promise<unknown>=Promise.resolve();
export function createLink(card:RenderedCard,base:string):Promise<ManagedLink>{
  const frozen={...card,snapshot:JSON.parse(JSON.stringify(card.snapshot)) as RenderedCard['snapshot']};
  const result=creationQueue.then(()=>createReservedLink(frozen,base));
  creationQueue=result.catch(()=>{});return result;
}
async function createReservedLink(card: RenderedCard, base: string): Promise<ManagedLink> {
  if (serviceBase(base) !== base || card.blob.type !== 'image/png') throw Error('Service unavailable');
  // Copy both presentation and image before any network operation. No TripRecord enters this boundary.
  const snapshot = JSON.parse(JSON.stringify(card.snapshot)) as RenderedCard['snapshot'];
  const png = await encode(card.blob);
  const bytes = new TextEncoder().encode(JSON.stringify({snapshot,png}));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const links = readLinks();
  const pending = links.find(v=>!v.revoked && v.expiresAt===null);
  if(pending && !pending.creationToken)throw new CreationUnavailableError('Legacy pending creation must be retired');
  if (pending && (pending.digest!==hash || pending.base!==base)) throw new PendingCreationError('Resolve pending creation first');
  let link: ManagedLink;
  if(pending){
    link=pending;
  }else{
    const grant=await request(base,'/issue',{version:2,digest:hash});
    const tokens=[grant.viewToken,grant.revokeToken,grant.creationToken];
    if(grant.version!==2 || tokens.some(v=>typeof v!=='string' || !TOKEN.test(v)) || new Set(tokens).size!==3
      || !Number.isSafeInteger(grant.createUntil) || !Number.isSafeInteger(grant.expiresAt)
      || (grant.createUntil as number)<=0 || (grant.expiresAt as number)<(grant.createUntil as number))throw Error('Invalid issuance response');
    link={base,viewToken:grant.viewToken as string,revokeToken:grant.revokeToken as string,creationToken:grant.creationToken as string,
      createUntil:grant.createUntil as number,issuedExpiresAt:grant.expiresAt as number,digest:hash,expiresAt:null,revoked:false};
  }
  store(link); // Verify management credentials before uploading card content.
  let result:Record<string,unknown>;
  if((link.createUntil??0)<=Date.now()){
    // A lost successful upload can still be reconciled, without creating or refreshing it.
    try{
      const existing=await request(base,'/read',{viewToken:link.viewToken});
      if(existing.png!==png || JSON.stringify(existing.snapshot)!==JSON.stringify(snapshot) || existing.expiresAt!==link.issuedExpiresAt)throw Error('Snapshot mismatch');
      result={version:2,expiresAt:existing.expiresAt};
    }catch{throw new CreationUnavailableError('Creation authorization expired; retire this attempt');}
  }else{
    try{result=await request(base,'',{version:2,snapshot,png,viewToken:link.viewToken,creationToken:link.creationToken});}
    catch(error){if(error instanceof RequestError && [404,410].includes(error.status))throw new CreationUnavailableError('Creation unavailable; retire this attempt');throw error;}
  }
  if (!Number.isSafeInteger(result.expiresAt) || result.expiresAt!==link.issuedExpiresAt || result.version!==2) throw Error('Invalid service response');
  const latest=readLinks().find(value=>value.viewToken===link.viewToken);
  link={...link,expiresAt:result.expiresAt as number,revoked:latest?.revoked??confirmedRevocations.has(link.viewToken)};
  store(link); return link;
}
export async function revokeLink(link: ManagedLink): Promise<void> {
  const result = await request(link.base,'/revoke',{viewToken:link.viewToken,revokeToken:link.revokeToken});
  if(result.revoked!==true)throw Error('Revocation unconfirmed');
  confirmedRevocations.add(link.viewToken);
  window.dispatchEvent(new Event('taxi-check-links'));
  try{store({...link,revoked:true});}
  catch{throw new RevocationStorageError('Revoked remotely; local status could not be saved');}
}
