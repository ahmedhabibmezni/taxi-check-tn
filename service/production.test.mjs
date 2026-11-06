import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {durableFiles,syncDirectory} from './durable.mjs';
import {serviceConfig,proxyAddress,WEEK} from './config.mjs';
import {prepareEmpty,inspectStore,newBoot,approveCurrent,consumeApproval} from './store.mjs';
import {startService} from './run.mjs';
import {createCardServer} from './server.mjs';
import {serviceBudget,sourceLimiter} from './budget.mjs';
import {fixture} from './test-fixture.mjs';
import {digest} from './contract.mjs';
import {request} from 'node:http';

// Windows cannot flush directory handles. Only this operation is simulated in HTTP tests.
const directorySync=process.platform==='win32'?async()=>{}:syncDirectory;
const files=()=>durableFiles({strict:true,directorySync});
async function setup(t,overrides={}){
  const parent=resolve(tmpdir()),root=await fs.mkdtemp(join(parent,'taxi-r6-')),mount=join(root,'mount');await fs.mkdir(mount);
  t.after(()=>{assert.equal(dirname(resolve(root)),parent);assert.ok(root.startsWith(join(parent,'taxi-r6-')));return fs.rm(root,{recursive:true,force:true});});
  const config={production:true,mount,directory:join(mount,'cards'),control:join(root,'control'),storeId:randomUUID(),host:'127.0.0.1',port:0,
    ttlMs:WEEK,origins:['https://cards.example.invalid','capacitor://localhost','https://localhost'],origin:'https://cards.example.invalid',maxCards:100,maxStoreBytes:64000000,dailyIssues:20,monthlyBytes:4000000000,proxyHops:1,issuanceEnabled:true,...overrides};
  config.storeId=await prepareEmpty(config,{confirm:'CREATE_EMPTY_STORE_INVALIDATE_OLD_LINKS',files:files()});
  return {root,config};
}
const headers={'Content-Type':'application/json','X-Forwarded-For':'203.0.113.7','X-Forwarded-Proto':'https'};
async function http(t,config,extra={}){
  const server=await createCardServer({...config,production:config,files:files(),...extra});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const post=(route,body,h={})=>fetch(base+'/v1/cards'+route,{method:'POST',headers:{...headers,...h},body:JSON.stringify(body)});
  const issue=async(card=fixture())=>{
    const r=await post('/issue',{version:2,digest:digest(JSON.stringify({snapshot:card.snapshot,png:card.png}))});assert.equal(r.status,200);
    const grant=await r.json();return {grant,body:{...card,viewToken:grant.viewToken,creationToken:grant.creationToken}};
  };
  return {server,base,post,issue};
}
function environment(config){return {CARD_MODE:'production',CARD_TTL_MS:String(WEEK),CARD_TRUST_PROXY:'render',CARD_PROXY_VERIFIED:'yes',CARD_PROXY_HOPS:'1',
  CARD_MOUNT_PATH:config.mount,CARD_DATA_DIR:config.directory,CARD_CONTROL_DIR:config.control,CARD_STORE_ID:config.storeId,PORT:'10000',CARD_SERVICE_ORIGIN:config.origin,CARD_ALLOWED_ORIGINS:config.origins.join(','),CARD_ISSUANCE_ENABLED:'no'};}

test('production config is explicit, seven days, safe origins/paths/limits; local mode remains loopback',async t=>{
  const {config}=await setup(t),env=environment(config),parsed=serviceConfig(env);assert.equal(parsed.ttlMs,WEEK);assert.equal(parsed.host,'0.0.0.0');assert.equal(parsed.issuanceEnabled,false);
  assert.equal(serviceConfig({}).host,'127.0.0.1');assert.equal(serviceConfig({CARD_TTL_MS:String(WEEK*2)}).ttlMs,WEEK*2);
  for(const key of ['PORT','CARD_TTL_MS','CARD_PROXY_VERIFIED','CARD_PROXY_HOPS','CARD_SERVICE_ORIGIN','CARD_ALLOWED_ORIGINS','CARD_STORE_ID','CARD_MOUNT_PATH','CARD_DATA_DIR','CARD_CONTROL_DIR']){
    const bad={...env};delete bad[key];assert.throws(()=>serviceConfig(bad),undefined,key);
  }
  for(const bad of [{CARD_TTL_MS:'1000'},{CARD_MAX_CARDS:'101'},{CARD_MONTHLY_BYTES:'5000000001'},{CARD_SERVICE_ORIGIN:'http://public.example'},{CARD_ALLOWED_ORIGINS:'*'},{CARD_SERVICE_ORIGIN:'https://localhost'},{CARD_SERVICE_ORIGIN:'https://u:p@cards.example.invalid'},{CARD_DATA_DIR:config.mount},{CARD_CONTROL_DIR:join(config.mount,'control')}])assert.throws(()=>serviceConfig({...env,...bad}));
});
test('trusted end of verified forwarding chain ignores spoofed prefix; invalid chains fail closed',()=>{
  assert.equal(proxyAddress({headers:{'x-forwarded-for':'198.51.100.99, 203.0.113.7'}}),'203.0.113.7');
  assert.equal(proxyAddress({headers:{'x-forwarded-for':'198.51.100.99, 203.0.113.7, 10.0.0.2'}},2),'203.0.113.7');
  for(const value of [undefined,'bad','1.2.3.4:9000','1.2.3.4,','a'.repeat(600)])assert.equal(proxyAddress({headers:{'x-forwarded-for':value}}),null);
});
test('durable save flushes file and closes before atomic rename and directory flush',async t=>{
  const {root}=await setup(t),events=[],target=join(root,'ordered.json');
  const io={...fs,open:async(...args)=>{const h=await fs.open(...args);events.push('open');return {writeFile:async value=>{events.push('write');await h.writeFile(value);},sync:async()=>{events.push('file-sync');await h.sync();},close:async()=>{events.push('close');await h.close();}};},rename:async(...args)=>{events.push('rename');await fs.rename(...args);}};
  await durableFiles({strict:true,io,directorySync:async()=>events.push('directory-sync')}).save(target,{synthetic:true});
  assert.deepEqual(events,['open','write','file-sync','close','rename','directory-sync']);assert.equal(JSON.parse(await fs.readFile(target,'utf8')).synthetic,true);
});
for(const phase of ['open','writeFile','sync','close','rename','directory-sync'])test(`durability failure at ${phase} never resolves successfully or publishes a partial JSON file`,async t=>{
  const {root}=await setup(t),target=join(root,'failure.json');let failed=false;
  const fail=()=>{if(!failed){failed=true;throw Object.assign(Error('Synthetic IO failure'),{code:'ENOSPC'});}};
  const io={...fs,open:async(...args)=>{if(phase==='open')fail();const h=await fs.open(...args);return {
    writeFile:async value=>{if(phase==='writeFile')fail();await h.writeFile(value);},sync:async()=>{if(phase==='sync')fail();await h.sync();},close:async()=>{if(phase==='close')fail();await h.close();}};},rename:async(...args)=>{if(phase==='rename')fail();await fs.rename(...args);}};
  await assert.rejects(durableFiles({strict:true,io,directorySync:async()=>{if(phase==='directory-sync')fail();}}).save(target,{complete:true}));
  if(phase==='directory-sync')assert.equal(JSON.parse(await fs.readFile(target,'utf8')).complete,true);else await assert.rejects(fs.access(target));
  assert.ok(!(await fs.readdir(root)).some(v=>v.endsWith('.tmp')));
});
test('durable delete observes unlink and parent flush failures, not success',async t=>{
  const {root}=await setup(t),target=join(root,'delete.json');await fs.writeFile(target,'{}');
  await assert.rejects(durableFiles({strict:true,io:{...fs,unlink:async()=>{throw Error('Synthetic deletion failure');}}}).remove(target));await fs.access(target);
  await assert.rejects(durableFiles({strict:true,directorySync:async()=>{throw Error('Synthetic directory flush failure');}}).remove(target));await assert.rejects(fs.access(target));
});
test('new empty-store preparation refuses occupied/mismatched stores without changing any bytes',async t=>{
  const {config}=await setup(t),before=await inspectStore(config);
  await assert.rejects(prepareEmpty(config,{confirm:'wrong',files:files()}));await assert.rejects(prepareEmpty(config,{confirm:'CREATE_EMPTY_STORE_INVALIDATE_OLD_LINKS',files:files()}));
  assert.equal(await inspectStore(config),before);await assert.rejects(inspectStore({...config,storeId:randomUUID()}));
  await fs.writeFile(join(config.directory,'unrelated.txt'),'preserve');await assert.rejects(inspectStore(config));assert.equal(await fs.readFile(join(config.directory,'unrelated.txt'),'utf8'),'preserve');
});
test('boot approval is one-use and bound to current identity, contents and fresh process challenge',async t=>{
  const {config}=await setup(t),a=await newBoot(config);await approveCurrent(config,{confirm:'CURRENT_AUTHORITATIVE_STORE_NOT_A_RESTORED_BACKUP'});
  const old=await fs.readFile(join(config.control,'approval.json'));
  const b=await newBoot(config);assert.notEqual(a.nonce,b.nonce);assert.equal(await consumeApproval(config,b),false);
  await approveCurrent(config,{confirm:'CURRENT_AUTHORITATIVE_STORE_NOT_A_RESTORED_BACKUP'});assert.equal(await consumeApproval(config,b),true);assert.equal(await consumeApproval(config,b),false);
  await fs.writeFile(join(config.control,'approval.json'),old);assert.equal(await consumeApproval(config,b),false);
  const c=await newBoot(config);await approveCurrent(config,{confirm:'CURRENT_AUTHORITATIVE_STORE_NOT_A_RESTORED_BACKUP'});await fs.writeFile(join(config.directory,'.budget.json'),'{}');await assert.rejects(consumeApproval(config,c));
});
test('production bootstrap serves no card until explicit per-boot approval, including after restart',async t=>{
  const {config}=await setup(t),app=await startService(config,{files:files(),pollMs:5});t.after(()=>app.stop());
  const port=app.server.address().port;config.port=port;const base=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/livez')).status,200);assert.equal((await fetch(base+'/readyz')).status,503);assert.equal((await fetch(base+'/view')).status,503);
  await approveCurrent(config,{confirm:'CURRENT_AUTHORITATIVE_STORE_NOT_A_RESTORED_BACKUP'});
  for(let n=0;n<100;n++){const r=await fetch(base+'/readyz').catch(()=>null);if(r?.status===200)break;await new Promise(r=>setTimeout(r,5));}
  assert.equal((await fetch(base+'/readyz')).status,200);
  const post=(route,body)=>fetch(base+'/v1/cards'+route,{method:'POST',headers,body:JSON.stringify(body)});
  const sample=fixture(),issued=await post('/issue',{version:2,digest:digest(JSON.stringify({snapshot:sample.snapshot,png:sample.png}))});
  assert.equal(issued.status,200);const grant=await issued.json();
  const body={...sample,viewToken:grant.viewToken,creationToken:grant.creationToken};
  assert.equal((await post('',body)).status,200);assert.equal((await post('/read',{viewToken:grant.viewToken})).status,200);
  const fingerprint=await inspectStore(config);
  await app.stop();const restarted=await startService(config,{files:files(),pollMs:5});t.after(()=>restarted.stop());
  assert.equal(await inspectStore(config),fingerprint);
  assert.equal((await fetch(base+'/livez')).status,200);
  assert.equal((await fetch(base+'/readyz')).status,503);assert.equal((await fetch(base+'/view')).status,503);
  assert.equal((await post('/read',{viewToken:grant.viewToken})).status,503);
  await approveCurrent(config,{confirm:'CURRENT_AUTHORITATIVE_STORE_NOT_A_RESTORED_BACKUP'});
  for(let n=0;n<100;n++){const r=await fetch(base+'/readyz').catch(()=>null);if(r?.status===200)break;await new Promise(r=>setTimeout(r,5));}
  const read=await post('/read',{viewToken:grant.viewToken});assert.equal(read.status,200);assert.equal((await read.json()).png,sample.png);
});
test('actual production API enforces origins/proxy and native no-Origin with no sensitive logging',async t=>{
  const {config}=await setup(t),{post,base}=await http(t,config);
  assert.equal((await post('/issue',{version:2,digest:'a'.repeat(64)},{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await post('/issue',{version:2,digest:'a'.repeat(64)},{'X-Forwarded-For':'fake'})).status,403);
  assert.equal((await post('/issue',{version:2,digest:'a'.repeat(64)},{'X-Forwarded-Proto':'http'})).status,403);
  for(const Origin of [undefined,config.origin,'capacitor://localhost','https://localhost']){
    const r=await post('/issue',{version:2,digest:'a'.repeat(64)},Origin?{Origin}:{});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
  }
  assert.equal((await fetch(base+'/readyz')).status,200);
});
test('durable issuance budgets survive restart and enforce capacity without creating another identity',async t=>{
  const {config}=await setup(t,{dailyIssues:1}),a=await http(t,config);await a.issue();
  assert.equal((await a.post('/issue',{version:2,digest:'b'.repeat(64)})).status,429);
  await new Promise(r=>a.server.close(r));const b=await http(t,config);assert.equal((await b.post('/issue',{version:2,digest:'c'.repeat(64)})).status,429);
  const counter=JSON.parse(await fs.readFile(join(config.directory,'.budget.json'),'utf8'));assert.equal(counter.issues,1);
  assert.ok(!JSON.stringify(counter).includes('Token'));assert.deepEqual(Object.keys(counter).sort(),['bytes','day','issues','month','version']);
});
test('response byte budget persists, denies further card content, and keeps revocation available',async t=>{
  const {config}=await setup(t,{monthlyBytes:100}),{issue,post}=await http(t,config),{body,grant}=await issue();assert.equal((await post('',body)).status,200);
  assert.equal((await post('/read',{viewToken:grant.viewToken})).status,429);assert.equal((await post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken})).status,200);
});
test('source table saturation cannot reset existing limits and management has separate allowance',()=>{
  const limit=sourceLimiter({maxSources:2});for(let n=0;n<10;n++)assert.equal(limit('a','issue',1),true);
  assert.equal(limit('a','issue',1),false);assert.equal(limit('a','revoke',1),true);assert.equal(limit('b','issue',1),true);assert.equal(limit('c','issue',1),false);assert.equal(limit('c','revoke',1),true);assert.equal(limit('a','issue',1),false);assert.equal(limit('b','issue',3600001),true);
});
test('storage byte/row limits and issuance shutoff refuse new allocation without evicting content',async t=>{
  const {config}=await setup(t,{maxCards:1}),a=await http(t,config);const first=await a.issue();assert.equal((await a.post('/issue',{version:2,digest:'c'.repeat(64)})).status,429);
  config.issuanceEnabled=false;assert.equal((await a.post('',first.body)).status,200);assert.equal((await a.post('/issue',{version:2,digest:'d'.repeat(64)})).status,503);assert.equal((await a.post('/read',{viewToken:first.grant.viewToken})).status,200);
  const other=await setup(t,{maxStoreBytes:66000}),b=await http(t,other.config),next=await b.issue();assert.equal((await b.post('',next.body)).status,429);assert.equal((await b.post('/read',{viewToken:next.grant.viewToken})).status,410);
});
test('uncertain acknowledged-file flush failure poisons production readiness and never serves stale in-memory content',async t=>{
  const {config}=await setup(t);let fail=false;
  const injected=durableFiles({strict:true,directorySync:async()=>{if(fail)throw Error('Synthetic directory flush failure');}});
  const {issue,post,base}=await http(t,config,{files:injected}),{body,grant}=await issue();assert.equal((await post('',body)).status,200);fail=true;
  assert.equal((await post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken})).status,503);
  assert.equal((await post('/read',{viewToken:grant.viewToken})).status,503);assert.equal((await fetch(base+'/readyz')).status,503);
  const disk=JSON.parse(await fs.readFile(join(config.directory,digest(grant.viewToken)+'.json'),'utf8'));assert.equal(disk.status,'revoked');assert.equal(disk.card,null);
});
test('missing/unavailable production store never becomes a successful empty store or read',async t=>{
  const {config}=await setup(t),{issue,post,base}=await http(t,config),{body,grant}=await issue();await post('',body);
  await fs.rename(config.directory,config.directory+'-offline');assert.equal((await post('/read',{viewToken:grant.viewToken})).status,503);assert.equal((await fetch(base+'/readyz')).status,503);await assert.rejects(fs.access(config.directory));
});
test('seven-day expiry denies at exact boundary with slow sweep; cleanup deadlines stay bounded',async t=>{
  const {config}=await setup(t);let clock=Date.now();const {issue,post}=await http(t,config,{now:()=>clock,sweepMs:3600000}),{body,grant}=await issue();await post('',body);
  clock=grant.expiresAt-1;assert.equal((await post('/read',{viewToken:grant.viewToken})).status,200);clock++;assert.equal((await post('/read',{viewToken:grant.viewToken})).status,410);
  const name=join(config.directory,digest(grant.viewToken)+'.json');assert.equal(JSON.parse(await fs.readFile(name,'utf8')).card,null);
  clock+=86400000;assert.equal((await post('',body)).status,404);await assert.rejects(fs.access(name));
});
test('restored revoked-card snapshot stays non-serving; empty recovery leaves original URLs inaccessible across restart',async t=>{
  const {config,root}=await setup(t),a=await http(t,config),{body,grant}=await a.issue();await a.post('',body);
  const backup=join(root,'snapshot');await fs.cp(config.directory,backup,{recursive:true});await a.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken});await new Promise(r=>a.server.close(r));
  const restored={...config,directory:join(config.mount,'restored'),control:join(root,'restore-control')};await fs.cp(backup,restored.directory,{recursive:true});
  const boot=await startService(restored,{files:files(),pollMs:5});
  assert.equal((await fetch(`http://127.0.0.1:${boot.server.address().port}/v1/cards/read`,{method:'POST',headers,body:JSON.stringify({viewToken:grant.viewToken})})).status,503);await boot.stop();
  const recovered={...config,directory:join(config.mount,'recovered')};recovered.storeId=await prepareEmpty(recovered,{confirm:'CREATE_EMPTY_STORE_INVALIDATE_OLD_LINKS',files:files()});
  for(let restart=0;restart<2;restart++){
    const clean=await http(t,recovered);assert.equal((await clean.post('/read',{viewToken:grant.viewToken})).status,404);assert.equal((await clean.post('',body)).status,404);
    assert.equal((await clean.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken})).status,200);assert.equal((await clean.post('',body)).status,404);
    const next=await clean.issue();assert.notEqual(next.grant.viewToken,grant.viewToken);assert.equal((await clean.post('',next.body)).status,200);await new Promise(r=>clean.server.close(r));
  }
  const restoredRow=JSON.parse(await fs.readFile(join(restored.directory,digest(grant.viewToken)+'.json'),'utf8'));assert.equal(restoredRow.status,'active');
});
test('persisted budgets reject clock rollback and uncertain budget persistence without quota reset',async t=>{
  const {config}=await setup(t),budget=await serviceBudget(config.directory,files(),{dailyIssues:1,monthlyBytes:20});const now=Date.now();
  assert.equal(await budget.reserve(now,{issue:true,bytes:10}),true);assert.equal(await budget.reserve(now,{issue:true}),false);assert.equal(await budget.reserve(now,{bytes:11}),false);
  await assert.rejects(budget.reserve(now-86400000,{issue:true}));const reloaded=await serviceBudget(config.directory,files(),{dailyIssues:1,monthlyBytes:20});assert.equal(await reloaded.reserve(now,{issue:true}),false);
});
test('eight incomplete request bodies bound admission; oversized and aborted requests allocate no cards',async t=>{
  const {config}=await setup(t),{base,post}=await http(t,config),pending=[];
  t.after(()=>pending.forEach(req=>req.destroy()));
  for(let n=0;n<8;n++){
    const req=request(base+'/v1/cards',{method:'POST',headers:{...headers,'X-Forwarded-For':`203.0.113.${n+1}`,'Content-Length':'100'}});
    req.on('error',()=>{});req.write('{');pending.push(req);
  }
  for(let n=0;n<100;n++){if((await fetch(base+'/readyz')).status===503)break;await new Promise(r=>setTimeout(r,5));}
  assert.equal((await post('/issue',{version:2,digest:'b'.repeat(64)})).status,429);
  pending.forEach(req=>req.destroy());
  for(let n=0;n<100;n++){if((await fetch(base+'/readyz')).status===200)break;await new Promise(r=>setTimeout(r,5));}
  assert.equal((await post('',{padding:'a'.repeat(3000001)})).status,413);
  assert.equal((await fs.readdir(config.directory)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).length,0);
});
test('global PNG work allowance cannot be bypassed by rotating source identities',async t=>{
  const {config}=await setup(t),{post}=await http(t,config);
  for(let n=0;n<6;n++)assert.equal((await post('',{}, {'X-Forwarded-For':`203.0.113.${n+1}`})).status,400);
  assert.equal((await post('',{}, {'X-Forwarded-For':'203.0.113.99'})).status,429);
  assert.equal((await post('/issue',{version:2,digest:'b'.repeat(64)})).status,200);
});
test('missing persisted budget is an error, never a fresh allowance on restart',async t=>{
  const {config}=await setup(t);await fs.unlink(join(config.directory,'.budget.json'));
  await assert.rejects(inspectStore(config));await assert.rejects(serviceBudget(config.directory,files()));
});
test('shutdown drains queued durable work and rejects subsequent mutation admission',async t=>{
  const {config}=await setup(t),{server,post}=await http(t,config);await server.drain();
  assert.equal((await post('/issue',{version:2,digest:'b'.repeat(64)})).status,503);
});
test('owned interrupted-write artifact is removed before serving; unrelated entries are never deleted',async t=>{
  const {config}=await setup(t),orphan=join(config.directory,'a'.repeat(64)+'.json.'+randomUUID()+'.tmp');
  await fs.writeFile(orphan,'synthetic partial JSON');const {base}=await http(t,config);
  assert.equal((await fetch(base+'/readyz')).status,200);await assert.rejects(fs.access(orphan));
  await fs.writeFile(join(config.directory,'preserve.txt'),'unrelated');await assert.rejects(createCardServer({...config,production:config,files:files()}));
  assert.equal(await fs.readFile(join(config.directory,'preserve.txt'),'utf8'),'unrelated');
});
for(const state of ['unused','terminal'])test(`${state} cleanup deletion failure is unavailable, preserves bytes and never extends access`,async t=>{
  const {config}=await setup(t);let clock=Date.now(),fail=false;const actual=files();
  const injected={...actual,remove:async target=>{if(fail)throw Error('Synthetic unlink failure');await actual.remove(target);}};
  const {issue,post,base}=await http(t,config,{now:()=>clock,files:injected}),{body,grant}=await issue();
  if(state==='terminal'){await post('',body);await post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken});}
  const name=join(config.directory,digest(grant.viewToken)+'.json'),before=await fs.readFile(name,'utf8');
  fail=true;clock=state==='unused'?grant.createUntil:grant.expiresAt+86400000;
  assert.equal((await post('/read',{viewToken:grant.viewToken})).status,503);assert.equal((await fetch(base+'/readyz')).status,503);
  assert.equal(await fs.readFile(name,'utf8'),before);assert.equal((await post('',body)).status,503);
});
