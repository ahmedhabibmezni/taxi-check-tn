// @vitest-environment jsdom
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {createElement,StrictMode} from 'react';
import {render,fireEvent,screen,waitFor,cleanup,act} from '@testing-library/react';
import {CreationUnavailableError,createLink,LINK_KEY,readLinks,revokeLink,serviceBase,viewUrl} from '../src/utils/hostedCard';
import {HostedCard,SharedLinkManager} from '../src/components/HostedCard';
import {hostedCopy} from '../src/localization/hostedCopy';
import {selectLanguage,type Language} from '../src/localization';
import {snapshotTripCard,type RenderedCard} from '../src/utils/tripCard';
import {cardFixture} from './fixtures/card';
import {renderQr} from '../src/utils/qrCard';
import {shareCard} from '../src/utils/shareCard';

vi.mock('../src/utils/qrCard',()=>({renderQr:vi.fn(async()=>new Blob(['qr'],{type:'image/png'}))}));
vi.mock('../src/utils/shareCard',()=>({shareCard:vi.fn(async()=> 'share-returned')}));
const base='http://localhost:5190';
const card=():RenderedCard=>({snapshot:snapshotTripCard(cardFixture(),'en',{comparison:true,details:false}),blob:new Blob(['frozen-png'],{type:'image/png'}),width:1200,height:1600});
let expiry:number;
const uploads=()=>vi.mocked(fetch).mock.calls.filter(([url])=>String(url)===base+'/v1/cards');
const token=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const grant=()=>({version:2,viewToken:token(),revokeToken:token(),creationToken:token(),createUntil:expiry-40000,expiresAt:expiry});
function mockUploadOnce(implementation:typeof fetch){
 const fallback=vi.mocked(fetch).getMockImplementation()!;let used=false;
 vi.mocked(fetch).mockImplementation((url,options)=>{if(!used&&String(url)===base+'/v1/cards'){used=true;return implementation(url,options);}return fallback(url,options);});
}
beforeEach(async()=>{
  const {webcrypto}=await import('node:'+'crypto');
  vi.stubGlobal('crypto',webcrypto);selectLanguage('en');localStorage.clear();vi.stubEnv('VITE_CARD_SERVICE_URL',base);
  URL.createObjectURL=vi.fn((blob:Blob|MediaSource)=>blob===oldQr?'blob:old-qr':'blob:qr');URL.revokeObjectURL=vi.fn();
  expiry=Date.now()+100000;vi.stubGlobal('fetch',vi.fn(async(url)=>({ok:true,json:async()=>String(url).endsWith('/issue')?grant():String(url).endsWith('/revoke')?{revoked:true}:{version:2,expiresAt:expiry}})));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();vi.clearAllMocks();});
it('has no implicit destination and permits only explicit HTTPS or loopback HTTP origins',()=>{
  expect(serviceBase('')).toBeNull();expect(serviceBase('http://public.invalid')).toBeNull();
  for(const raw of ['https://x.invalid/path','https://u:p@x.invalid','https://x.invalid/#secret','https://x.invalid/?x=1'])expect(serviceBase(raw)).toBeNull();
  expect(serviceBase('https://x.invalid/')).toBe('https://x.invalid');expect(serviceBase(base)).toBe(base);
});
it('persists separate strong capabilities before exact frozen upload, with no TripRecord fields',async()=>{
  const c=card();let storedBeforeUpload=false;
  mockUploadOnce(async(_url,options)=>{
    storedBeforeUpload=!!localStorage.getItem(LINK_KEY);const b=JSON.parse(String(options?.body));
    expect(b.snapshot).toEqual(c.snapshot);expect(atob(b.png)).toBe('frozen-png');expect(b.viewToken).toHaveLength(43);expect(b.creationToken).not.toBe(b.viewToken);expect(b.revokeToken).toBeUndefined();
    expect(Object.keys(b).sort()).toEqual(['creationToken','png','snapshot','version','viewToken']);
    return {ok:true,json:async()=>({version:2,expiresAt:expiry})} as Response;
  });
  const link=await createLink(c,base);expect(storedBeforeUpload).toBe(true);expect(readLinks()).toEqual([link]);
  expect(viewUrl(link)).not.toContain(link.revokeToken);expect(JSON.stringify(readLinks())).not.toContain('frozen-png');
  expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
});
it('response loss retries the same immutable capability pair; different preview is blocked',async()=>{
  const c=card();mockUploadOnce(async()=>{throw Error('response lost');});
  await expect(createLink(c,base)).rejects.toThrow();const first=JSON.parse(String(uploads()[0][1]?.body));
  await expect(createLink({...c,blob:new Blob(['changed'],{type:'image/png'})},base)).rejects.toThrow('pending');
  expect(uploads()).toHaveLength(1);await createLink(c,base);
  const second=JSON.parse(String(uploads()[1][1]?.body));expect(second).toEqual(first);expect(readLinks()).toHaveLength(1);
});
it('silent/throwing storage failures block upload and preserve malformed management data',async()=>{
  localStorage.setItem(LINK_KEY,'malformed');await expect(createLink(card(),base)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();expect(localStorage.getItem(LINK_KEY)).toBe('malformed');
  localStorage.setItem(LINK_KEY,JSON.stringify([{base,viewToken:['A'.repeat(43)],revokeToken:'B'.repeat(43),digest:'a'.repeat(64),expiresAt:null,revoked:false}]));
  expect(()=>readLinks()).toThrow();
  localStorage.clear();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{});
  await expect(createLink(card(),base)).rejects.toThrow('verified');expect(uploads()).toHaveLength(0);
});
it('failed revoke never changes local status; success records separately and never touches History',async()=>{
  const link=await createLink(card(),base);localStorage.setItem('unrelated-history-marker','preserve');
  vi.mocked(fetch).mockRejectedValueOnce(Error('offline'));await expect(revokeLink(link)).rejects.toThrow();expect(readLinks()[0].revoked).toBe(false);
  vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({revoked:true})} as Response);
  await revokeLink(link);expect(readLinks()[0].revoked).toBe(true);expect(localStorage.getItem('unrelated-history-marker')).toBe('preserve');
});
it.each(['aeb','ar','fr','en'] as Language[])('offers explicit %s upload, exact front/back, QR and separate management',async lang=>{
  selectLanguage(lang);const copy=hostedCopy[lang];
  render(createElement('main',null,createElement(SharedLinkManager),createElement(HostedCard,{card:card(),children:createElement('p',null,'frozen front')})));
  expect(fetch).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:copy.create}));
  await screen.findByRole('button',{name:copy.back});await waitFor(()=>expect(renderQr).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button',{name:copy.back}));expect(screen.queryByText('frozen front')).toBeNull();expect(screen.getByRole('img',{name:copy.qr})).toBeTruthy();
  expect(screen.getByRole('button',{name:copy.front}).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button',{name:copy.shareQr}));await waitFor(()=>expect(shareCard).toHaveBeenCalledWith(expect.any(Blob),'taxi-check-trip-qr.png'));
  fireEvent.click(screen.getByRole('button',{name:copy.front}));expect(screen.getByText('frozen front')).toBeTruthy();
});
it('keeps offline front/image access when no service is configured and does not fetch',()=>{
  vi.stubEnv('VITE_CARD_SERVICE_URL','');render(createElement(HostedCard,{card:card(),children:createElement('p',null,'offline front')}));
  expect(screen.getByText(hostedCopy.en.unavailable)).toBeTruthy();expect(screen.getByText('offline front')).toBeTruthy();expect(screen.queryByRole('button',{name:hostedCopy.en.create})).toBeNull();expect(fetch).not.toHaveBeenCalled();
});
it('all four catalogs cover the same contract with no empty messages or management capability copy',()=>{
  for(const lang of ['aeb','ar','fr','en'] as Language[]){expect(Object.keys(hostedCopy[lang]).sort()).toEqual(Object.keys(hostedCopy.en).sort());expect(Object.values(hostedCopy[lang]).every(v=>v.length>0&&!v.includes('—'))).toBe(true);}
});
it('completes explicit creation under the application StrictMode effect replay',async()=>{
  render(createElement(StrictMode,null,createElement(HostedCard,{card:card(),children:createElement('p',null,'front')})));
  fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));
  await screen.findByRole('button',{name:hostedCopy.en.back});await waitFor(()=>expect(renderQr).toHaveBeenCalled());
});
it('preserves upload snapshot while the source changes during image encoding',async()=>{
  const c=card(),expected=JSON.stringify(c.snapshot);const creation=createLink(c,base);
  (c as unknown as {snapshot:unknown}).snapshot={language:'fr',direction:'ltr',blocks:[]};
  await creation;const sent=JSON.parse(String(uploads()[0][1]?.body));expect(JSON.stringify(sent.snapshot)).toBe(expected);
});
it('management retries a failed revocation without discarding credentials',async()=>{
  const link=await createLink(card(),base);render(createElement(SharedLinkManager));
  fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.manage}));
  vi.mocked(fetch).mockRejectedValueOnce(Error('unavailable'));fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.revoke}));
  await screen.findByText(hostedCopy.en.revokeError);expect(readLinks()[0]).toEqual(link);
  vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({revoked:true})} as Response);
  fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.revoke}));await waitFor(()=>expect(readLinks()[0].revoked).toBe(true));
});
it('a known local revocation removes QR actions and restores the offline front',async()=>{
  render(createElement(HostedCard,{card:card(),children:createElement('p',null,'offline front')}));
  fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await screen.findByRole('button',{name:hostedCopy.en.back});
  fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.back}));expect(screen.queryByText('offline front')).toBeNull();
  vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({revoked:true})} as Response);await revokeLink(readLinks()[0]);
  await screen.findByText('offline front');expect(screen.queryByRole('button',{name:hostedCopy.en.shareQr})).toBeNull();expect(screen.getByRole('button',{name:hostedCopy.en.create})).toBeTruthy();
});
it('does not resurrect a revoked pending attempt when the old creation response arrives late',async()=>{
  let complete!:(v:Response)=>void;mockUploadOnce(()=>new Promise(r=>{complete=r;}));
  const creation=createLink(card(),base);await waitFor(()=>expect(readLinks()).toHaveLength(1));
  const pending=readLinks()[0];vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({revoked:true})} as Response);
  await revokeLink(pending);complete({ok:true,json:async()=>({version:2,expiresAt:expiry})} as Response);
  expect((await creation).revoked).toBe(true);expect(readLinks()[0].revoked).toBe(true);
});
it('removes an open QR when another tab persists revocation',async()=>{
  render(createElement(HostedCard,{card:card(),children:createElement('p',null,'offline front')}));
  fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await screen.findByRole('button',{name:hostedCopy.en.back});
  const links=readLinks();links[0].revoked=true;localStorage.setItem(LINK_KEY,JSON.stringify(links));
  window.dispatchEvent(new StorageEvent('storage',{key:LINK_KEY}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:hostedCopy.en.shareQr})).toBeNull());expect(screen.getByText('offline front')).toBeTruthy();
});
it.each(['setItem','getItem'] as const)('stops offering a working QR after confirmed revoke even if %s fails',async operation=>{
  render(createElement(HostedCard,{card:card(),children:createElement('p',null,'offline front')}));
  fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await screen.findByRole('button',{name:hostedCopy.en.back});
  const link=readLinks()[0];vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({revoked:true})} as Response);
  vi.spyOn(Storage.prototype,operation).mockImplementation(()=>{throw Error('storage failed');});
  await expect(revokeLink(link)).rejects.toThrow();
  await waitFor(()=>expect(screen.queryByRole('button',{name:hostedCopy.en.shareQr})).toBeNull());
});
it('checks expiry at the action even if a background timer has not run yet',async()=>{
  const writeText=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
  render(createElement(HostedCard,{card:card(),children:createElement('p',null,'offline front')}));
  fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await screen.findByRole('button',{name:hostedCopy.en.back});
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+200000);
  fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.copy}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:hostedCopy.en.shareQr})).toBeNull());expect(writeText).not.toHaveBeenCalled();
});
it('does not report link creation failure when only QR encoding failed',async()=>{
  vi.mocked(renderQr).mockRejectedValueOnce(Error('Synthetic QR failure'));
  render(createElement(HostedCard,{card:card(),children:createElement('p',null,'offline front')}));
  fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await screen.findByRole('button',{name:hostedCopy.en.back});
  await waitFor(()=>expect(screen.queryByText(hostedCopy.en.creating)).toBeNull());
  expect(screen.queryByText(hostedCopy.en.failure)).toBeNull();expect(readLinks()[0].expiresAt).not.toBeNull();
});
it('preserves legacy management records but never retries their insecure creation protocol',async()=>{
 const legacy={base,viewToken:token(),revokeToken:token(),digest:'a'.repeat(64),expiresAt:null,revoked:false};
 localStorage.setItem(LINK_KEY,JSON.stringify([legacy]));const original=localStorage.getItem(LINK_KEY);
 expect(readLinks()).toEqual([legacy]);await expect(createLink(card(),base)).rejects.toBeInstanceOf(CreationUnavailableError);expect(fetch).not.toHaveBeenCalled();expect(localStorage.getItem(LINK_KEY)).toBe(original);
 // Use the matching digest from a genuine pending record, then remove only new credential fields.
 localStorage.clear();mockUploadOnce(async()=>{throw Error('lost');});await expect(createLink(card(),base)).rejects.toThrow();
 const {creationToken,createUntil,issuedExpiresAt,...pending}=readLinks()[0];expect(creationToken).toBeTruthy();expect(createUntil).toBeTruthy();expect(issuedExpiresAt).toBeTruthy();
 localStorage.setItem(LINK_KEY,JSON.stringify([pending]));vi.mocked(fetch).mockClear();
 await expect(createLink(card(),base)).rejects.toBeInstanceOf(CreationUnavailableError);expect(fetch).not.toHaveBeenCalled();expect(readLinks()).toEqual([pending]);
 localStorage.setItem(LINK_KEY,original!);vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({revoked:true})} as Response);
 await revokeLink(legacy);expect(readLinks()[0].revoked).toBe(true);
});
it('reconciles a lost upload after creation deadline by reading exact bytes without resetting expiry',async()=>{
 mockUploadOnce(async()=>{throw Error('lost response');});const c=card();await expect(createLink(c,base)).rejects.toThrow();
 const pending=readLinks()[0],expiryOriginal=pending.issuedExpiresAt!;
 const exactUpload=JSON.parse(String(uploads()[0][1]?.body));
 vi.spyOn(Date,'now').mockReturnValue(pending.createUntil!+1);
 vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({version:1,snapshot:exactUpload.snapshot,png:exactUpload.png,expiresAt:expiryOriginal})} as Response);
 const restored=await createLink(c,base);expect(restored.expiresAt).toBe(expiryOriginal);expect(uploads()).toHaveLength(1);
 expect(String(vi.mocked(fetch).mock.calls[vi.mocked(fetch).mock.calls.length-1]?.[0])).toBe(base+'/v1/cards/read');
});
it('expired or missing authorization cannot silently issue another identity, change bytes or erase pending credentials',async()=>{
 mockUploadOnce(async()=>{throw Error('lost response');});await expect(createLink(card(),base)).rejects.toThrow();
 const original=localStorage.getItem(LINK_KEY),pending=readLinks()[0];
 vi.spyOn(Date,'now').mockReturnValue(pending.createUntil!+1);
 vi.mocked(fetch).mockResolvedValueOnce({ok:false,status:404} as Response);
 await expect(createLink(card(),base)).rejects.toBeInstanceOf(CreationUnavailableError);
 expect(localStorage.getItem(LINK_KEY)).toBe(original);expect(uploads()).toHaveLength(1);
 vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({version:1,png:'different',snapshot:card().snapshot,expiresAt:pending.issuedExpiresAt})} as Response);
 await expect(createLink(card(),base)).rejects.toBeInstanceOf(CreationUnavailableError);expect(localStorage.getItem(LINK_KEY)).toBe(original);
});
it('lost issuance response leaves no uploaded card; explicit retry obtains a fresh server identity',async()=>{
 vi.mocked(fetch).mockRejectedValueOnce(Error('issuance response lost'));
 await expect(createLink(card(),base)).rejects.toThrow();expect(readLinks()).toEqual([]);expect(uploads()).toHaveLength(0);
 const link=await createLink(card(),base);expect(link.creationToken).toBeTruthy();expect(uploads()).toHaveLength(1);
});
it('rejects malformed or overlapping issuance capabilities before card upload',async()=>{
 const same=token();vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({...grant(),viewToken:same,creationToken:same})} as Response);
 await expect(createLink(card(),base)).rejects.toThrow('issuance');expect(uploads()).toHaveLength(0);expect(readLinks()).toEqual([]);
});
it('serializes simultaneous deliberate attempts with distinct server-issued URLs and frozen snapshots',async()=>{
 const one=card(),source=card(),two={...source,snapshot:{...source.snapshot,blocks:source.snapshot.blocks.map((b,i)=>i===1?{...b,text:'99.000 TND'}:b)}};
 const [a,b]=await Promise.all([createLink(one,base),createLink(two,base)]);
 expect(a.viewToken).not.toBe(b.viewToken);expect(readLinks()).toHaveLength(2);expect(uploads()).toHaveLength(2);
 expect(JSON.parse(String(uploads()[0][1]?.body)).snapshot).toEqual(one.snapshot);
 expect(JSON.parse(String(uploads()[1][1]?.body)).snapshot).toEqual(two.snapshot);
});
it.each(['aeb','ar','fr','en'] as Language[])('explains retired creation in %s while keeping offline content and management available',async lang=>{
 selectLanguage(lang);const c=card();mockUploadOnce(async()=>{throw Error('lost');});await expect(createLink(c,base)).rejects.toThrow();
 const pending=readLinks()[0];vi.spyOn(Date,'now').mockReturnValue(pending.createUntil!+1);
 vi.mocked(fetch).mockResolvedValueOnce({ok:false,status:404} as Response);
 render(createElement(HostedCard,{card:c,children:createElement('p',null,'offline front')}));
 fireEvent.click(screen.getByRole('button',{name:hostedCopy[lang].create}));await screen.findByText(hostedCopy[lang].creationUnavailable);
 expect(screen.getByText('offline front')).toBeTruthy();expect(uploads()).toHaveLength(1);
});

const oldQr=new Blob(['old-qr'],{type:'image/png'});
it('never shows or shares a revoked late QR after a replacement QR fails',async()=>{
 let complete!:(blob:Blob)=>void;vi.mocked(renderQr).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;})).mockRejectedValueOnce(Error('new QR failed'));
 render(createElement(HostedCard,{card:card(),children:createElement('p',null,'offline front')}));
 fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await waitFor(()=>expect(renderQr).toHaveBeenCalledTimes(1));
 await act(async()=>{await revokeLink(readLinks()[0]);});await act(async()=>{complete(oldQr);});
 await waitFor(()=>expect(screen.getByRole('button',{name:hostedCopy.en.create}).hasAttribute('disabled')).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await screen.findByText(hostedCopy.en.qrFailure);
 const records=readLinks();expect(records).toHaveLength(2);expect(records[0].revoked).toBe(true);expect(records[1].revoked).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.back}));
 const qr=screen.queryByRole('img',{name:hostedCopy.en.qr});
 const observation={oldQrVisible:qr?.getAttribute('src')==='blob:old-qr',shareButtonEnabled:!screen.getByRole('button',{name:hostedCopy.en.shareQr}).hasAttribute('disabled')};
 
 expect(observation.oldQrVisible).toBe(false);expect(observation.shareButtonEnabled).toBe(false);expect(shareCard).not.toHaveBeenCalled();
});
it('localizes creation failure in the current interface language without another request',async()=>{
 let fail!:(error:Error)=>void;vi.mocked(fetch).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{fail=reject;}));
 render(createElement(HostedCard,{card:card(),children:createElement('p',null,'offline front')}));fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
 act(()=>selectLanguage('fr'));await act(async()=>{fail(Error('synthetic offline'));});
 const observation={frenchCreateVisible:!!screen.queryByRole('button',{name:hostedCopy.fr.create}),englishFailureVisible:!!screen.queryByText(hostedCopy.en.failure),frenchFailureVisible:!!screen.queryByText(hostedCopy.fr.failure)};
 expect(observation.englishFailureVisible).toBe(false);expect(observation.frenchFailureVisible).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:hostedCopy.fr.retry})).toBeTruthy();
});

it.each(['resolve','reject'] as const)('keeps replacement B visible and shareable after obsolete A %s',async outcome=>{
 let complete!:(blob:Blob)=>void,fail!:(error:Error)=>void;
 const replacement=new Blob(['replacement-qr'],{type:'image/png'});
 vi.mocked(renderQr).mockImplementationOnce(()=>new Promise<Blob>((resolve,reject)=>{complete=resolve;fail=reject;})).mockResolvedValueOnce(replacement);
 render(createElement(HostedCard,{card:card(),children:createElement('p',null,'offline front')}));
 fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await waitFor(()=>expect(renderQr).toHaveBeenCalledTimes(1));
 await act(async()=>{await revokeLink(readLinks()[0]);});
 expect(screen.getByRole('button',{name:hostedCopy.en.create}).hasAttribute('disabled')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await waitFor(()=>expect(renderQr).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.getByRole('button',{name:hostedCopy.en.shareQr}).hasAttribute('disabled')).toBe(false));
 await act(async()=>{if(outcome==='resolve')complete(oldQr);else fail(Error('obsolete encoder rejected'));});
 expect(screen.queryByText(hostedCopy.en.qrFailure)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.back}));expect(screen.getByRole('img',{name:hostedCopy.en.qr}).getAttribute('src')).toBe('blob:qr');
 fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.shareQr}));await waitFor(()=>expect(shareCard).toHaveBeenCalledWith(replacement,'taxi-check-trip-qr.png'));
 expect(vi.mocked(shareCard).mock.calls[0][0]).toBe(replacement);expect(vi.mocked(shareCard).mock.calls[0][0]).not.toBe(oldQr);
});
it('keeps copy-link and offline front available when replacement QR fails, with fresh QR retry only',async()=>{
 const writeText=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 vi.mocked(renderQr).mockRejectedValueOnce(Error('encoder failed'));
 render(createElement(HostedCard,{card:card(),children:createElement('p',null,'offline front')}));fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));
 await screen.findByText(hostedCopy.en.qrFailure);const requests=vi.mocked(fetch).mock.calls.length;
 fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.copy}));await waitFor(()=>expect(writeText).toHaveBeenCalledWith(viewUrl(readLinks()[0])));
 expect(screen.getByText('offline front')).toBeTruthy();expect(screen.getByRole('button',{name:hostedCopy.en.shareQr}).hasAttribute('disabled')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.retryQr}));await waitFor(()=>expect(screen.getByRole('button',{name:hostedCopy.en.shareQr}).hasAttribute('disabled')).toBe(false));expect(fetch).toHaveBeenCalledTimes(requests);
});
it.each(['expiry','management removal'] as const)('retires pending QR on %s and ignores its late completion',async retirement=>{
 let complete!:(blob:Blob)=>void;vi.mocked(renderQr).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
 render(createElement(HostedCard,{card:card(),children:createElement('p',null,'offline front')}));fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await waitFor(()=>expect(renderQr).toHaveBeenCalledTimes(1));
 await act(async()=>{
  if(retirement==='expiry')vi.spyOn(Date,'now').mockReturnValue(expiry+1);
  else{localStorage.removeItem(LINK_KEY);window.dispatchEvent(new StorageEvent('storage',{key:LINK_KEY}));}
  complete(oldQr);
 });
 await screen.findByText(retirement==='expiry'?hostedCopy.en.expired:hostedCopy.en.storageError);
 expect(screen.queryByRole('img',{name:hostedCopy.en.qr})).toBeNull();expect(screen.queryByRole('button',{name:hostedCopy.en.shareQr})).toBeNull();expect(screen.queryByRole('button',{name:hostedCopy.en.copy})).toBeNull();
 expect(screen.getByText('offline front')).toBeTruthy();expect(shareCard).not.toHaveBeenCalled();
});
it('does not publish or share QR work after unmount',async()=>{
 let complete!:(blob:Blob)=>void;vi.mocked(renderQr).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
 const view=render(createElement(HostedCard,{card:card(),children:createElement('p',null,'front')}));fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await waitFor(()=>expect(renderQr).toHaveBeenCalledTimes(1));
 view.unmount();await act(async()=>complete(oldQr));expect(screen.queryByRole('img')).toBeNull();expect(shareCard).not.toHaveBeenCalled();expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('retires an old card render when the selected card is replaced',async()=>{
 let complete!:(blob:Blob)=>void;vi.mocked(renderQr).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
 const view=render(createElement(HostedCard,{card:card(),children:createElement('p',null,'old front')}));fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await waitFor(()=>expect(renderQr).toHaveBeenCalledTimes(1));
 view.rerender(createElement(HostedCard,{card:card(),children:createElement('p',null,'replacement front')}));await act(async()=>complete(oldQr));
 expect(screen.getByText('replacement front')).toBeTruthy();expect(screen.queryByRole('button',{name:hostedCopy.en.shareQr})).toBeNull();expect(shareCard).not.toHaveBeenCalled();
});
it.each(['failure','success'] as const)('freezes the English upload while switching to French during pending upload (%s)',async outcome=>{
 let complete!:(response:Response)=>void,fail!:(error:Error)=>void;let sent:Record<string,unknown>|undefined;
 mockUploadOnce(async(_url,options)=>{sent=JSON.parse(String(options?.body));return new Promise<Response>((resolve,reject)=>{complete=resolve;fail=reject;});});
 const c=card(),expected=JSON.stringify(c.snapshot);render(createElement(HostedCard,{card:c,children:createElement('p',null,'frozen English front')}));
 fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.create}));await waitFor(()=>expect(uploads()).toHaveLength(1));
 act(()=>selectLanguage('fr'));expect(fetch).toHaveBeenCalledTimes(2);expect(JSON.stringify(sent?.snapshot)).toBe(expected);
 await act(async()=>{if(outcome==='failure')fail(Error('synthetic pending upload failure'));else complete({ok:true,json:async()=>({version:2,expiresAt:expiry})} as Response);});
 if(outcome==='failure'){await screen.findByText(hostedCopy.fr.failure);expect(screen.queryByText(hostedCopy.en.failure)).toBeNull();expect(screen.getByRole('button',{name:hostedCopy.fr.retry})).toBeTruthy();}
 else await screen.findByRole('button',{name:hostedCopy.fr.back});
 expect(JSON.stringify(sent?.snapshot)).toBe(expected);expect(c.snapshot.language).toBe('en');expect(screen.getByText('frozen English front')).toBeTruthy();expect(fetch).toHaveBeenCalledTimes(2);
});

it('localizes a delayed management failure without changing revocation status',async()=>{
 await createLink(card(),base);let fail!:(error:Error)=>void;
 render(createElement(SharedLinkManager));fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.manage}));
 vi.mocked(fetch).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{fail=reject;}));fireEvent.click(screen.getByRole('button',{name:hostedCopy.en.revoke}));
 act(()=>selectLanguage('fr'));await act(async()=>fail(Error('synthetic revoke failure')));
 await screen.findByText(hostedCopy.fr.revokeError);expect(screen.queryByText(hostedCopy.en.revokeError)).toBeNull();expect(readLinks()[0].revoked).toBe(false);expect(fetch).toHaveBeenCalledTimes(3);
});

it.each(['aeb','ar','fr','en'] as Language[])('shows approved public retention before deliberate upload in %s without contacting a service',lang=>{
 vi.stubEnv('VITE_CARD_SERVICE_URL','https://cards.example.invalid');selectLanguage(lang);
 render(createElement(HostedCard,{card:card(),children:createElement('p',null,'offline image')}));
 expect(screen.getByText(hostedCopy[lang].retention)).toBeTruthy();expect(screen.queryByText(hostedCopy[lang].local)).toBeNull();
 expect(screen.getByRole('button',{name:hostedCopy[lang].create})).toBeTruthy();expect(screen.getByText('offline image')).toBeTruthy();expect(fetch).not.toHaveBeenCalled();
});
