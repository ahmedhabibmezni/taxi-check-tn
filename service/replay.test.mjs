import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,writeFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createCardServer} from './server.mjs';
import {digest} from './contract.mjs';
import {fixture} from './test-fixture.mjs';
const random=()=>randomBytes(32).toString('base64url');
async function harness(t,options={}){
 const directory=await mkdtemp(join(tmpdir(),'r3d-replay-'));let clock=1000000,server,base;
 const start=async()=>{server=await createCardServer({directory,ttlMs:1000,creationMs:100,now:()=>clock,...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;};
 const stop=()=>new Promise(r=>server.close(r));await start();
 t.after(async()=>{await stop();await rm(directory,{recursive:true,force:true});});
 const post=(route,body)=>fetch(base+'/v1/cards'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const issue=async(b=fixture())=>{
   const response=await post('/issue',{version:2,digest:digest(JSON.stringify({snapshot:b.snapshot,png:b.png}))});assert.equal(response.status,200);
   const grant=await response.json();return {grant,body:{...b,viewToken:grant.viewToken,creationToken:grant.creationToken}};
 };
 return {directory,post,issue,advance:n=>clock+=n,restart:async()=>{await stop();await start();},base:()=>base};
}
for(const terminal of ['revoke','expire'])for(const restart of [false,true])test(`${terminal}, cleanup, ${restart?'restart, ':''}replay never reopens the original viewer/QR identity`,async t=>{
 const h=await harness(t),{body,grant}=await h.issue();assert.equal((await h.post('',body)).status,200);
 assert.equal((await h.post('/read',{viewToken:grant.viewToken})).status,200);
 if(terminal==='revoke')assert.equal((await h.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken})).status,200);else h.advance(1000);
 assert.equal((await h.post('/read',{viewToken:grant.viewToken})).status,410);
 h.advance(86401000);if(restart)await h.restart();
 assert.equal((await h.post('/read',{viewToken:grant.viewToken})).status,404);
 assert.deepEqual(await readdir(h.directory),[]);
 for(let i=0;i<2;i++)assert.equal((await h.post('',body)).status,404);
 assert.equal((await h.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken})).status,200);
 assert.deepEqual(await readdir(h.directory),[]);
 assert.equal((await h.post('',{...body,version:1,revokeToken:grant.revokeToken})).status,410);
 assert.equal((await h.post('/read',{viewToken:grant.viewToken})).status,404);
 const viewer=await fetch(h.base()+'/view#'+grant.viewToken);assert.equal(viewer.status,200);assert.match(await viewer.text(),/viewer.mjs/);
 const next=await h.issue(body);assert.notEqual(next.grant.viewToken,grant.viewToken);assert.equal((await h.post('',next.body)).status,200);
 assert.equal((await h.post('/read',{viewToken:grant.viewToken})).status,404);
});
test('server-only issuance, distinct capabilities, credential separation and changed-payload rejection',async t=>{
 const h=await harness(t),{body,grant}=await h.issue();assert.equal(new Set([grant.viewToken,grant.revokeToken,grant.creationToken]).size,3);
 const issueBody={version:2,digest:'a'.repeat(64)};
 for(const extra of [{viewToken:grant.viewToken},{revokeToken:grant.revokeToken},{creationToken:grant.creationToken},{tripId:'synthetic'}])assert.equal((await h.post('/issue',{...issueBody,...extra})).status,400);
 for(const creationToken of [grant.viewToken,grant.revokeToken,random()])assert.notEqual((await h.post('',{...body,creationToken})).status,200);
 assert.equal((await h.post('',{...body,viewToken:random()})).status,404);
 assert.equal((await h.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.creationToken})).status,404);
 const changed={...body,snapshot:{...body.snapshot,blocks:body.snapshot.blocks.map((b,i)=>i===1?{...b,text:'9.999 TND'}:b)}};
 assert.equal((await h.post('',changed)).status,409);assert.equal((await h.post('/read',{viewToken:grant.viewToken})).status,410);
 assert.equal((await h.post('',body)).status,200);assert.equal((await h.post('',changed)).status,409);
 const read=await(await h.post('/read',{viewToken:grant.viewToken})).json();assert.deepEqual(read.snapshot,body.snapshot);assert.equal(read.png,body.png);
 for(const key of ['revokeToken','creationToken','creationHash','revokeHash'])assert.equal(key in read,false);
});
test('lost upload response retry across restart retains exact content and original issuance expiry',async t=>{
 const h=await harness(t),{body,grant}=await h.issue();h.advance(25);
 const first=await(await h.post('',body)).json();await h.restart();h.advance(25);
 const retry=await(await h.post('',body)).json();assert.deepEqual(retry,first);assert.equal(retry.expiresAt,grant.expiresAt);
 h.advance(50);assert.equal((await h.post('',body)).status,410);
 const read=await(await h.post('/read',{viewToken:grant.viewToken})).json();assert.equal(read.expiresAt,first.expiresAt);assert.equal(read.png,body.png);
});
test('unused issuance metadata is content-free, bounded, cleaned at credential boundary and stays spent after restart',async t=>{
 const h=await harness(t),{body,grant}=await h.issue();
 const stored=JSON.parse(await readFile(join(h.directory,digest(grant.viewToken)+'.json'),'utf8'));
 assert.equal(stored.card,null);assert.equal(stored.createUntil,grant.createUntil);
 for(const secret of [body.png,grant.viewToken,grant.revokeToken,grant.creationToken,'Estimated fare'])assert.ok(!JSON.stringify(stored).includes(secret));
 h.advance(100);assert.equal((await h.post('',body)).status,404);assert.deepEqual(await readdir(h.directory),[]);
 await h.restart();assert.equal((await h.post('',body)).status,404);
});
test('reordered and concurrent activation/revocation/cleanup are serialized, never resurrecting',async t=>{
 const h=await harness(t);
 for(const reverse of [false,true]){
 const {body,grant}=await h.issue();const revoke=()=>h.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken}),create=()=>h.post('',body);
 const results=await Promise.all(reverse?[revoke(),create(),create()]:[create(),revoke(),create()]);
 assert.ok(results.every(r=>[200,410].includes(r.status)));assert.equal((await h.post('/read',{viewToken:grant.viewToken})).status,410);
 assert.equal((await h.post('',body)).status,410);await h.restart();assert.equal((await h.post('',body)).status,410);
 }
 const {body,grant}=await h.issue();h.advance(100);
 const results=await Promise.all([h.post('',body),h.post('/read',{viewToken:grant.viewToken}),h.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken})]);
 assert.deepEqual(results.map(r=>r.status),[404,404,200]);assert.equal((await h.post('',body)).status,404);
});
test('legacy local rows remain readable/revocable but no legacy creation or new authorization is inferred',async t=>{
 const h=await harness(t),old=fixture(),viewToken=random(),revokeToken=random();
 await writeFile(join(h.directory,digest(viewToken)+'.json'),JSON.stringify({card:{version:1,snapshot:old.snapshot,png:old.png,width:1200,height:800},expiresAt:1001000,status:'active',revokeHash:digest(revokeToken),contentHash:'a'.repeat(64)}));
 await h.restart();assert.equal((await h.post('/read',{viewToken})).status,200);
 assert.equal((await h.post('',{...old,version:1,viewToken,revokeToken})).status,410);
 assert.equal((await h.post('',{...old,viewToken})).status,404);
 assert.equal((await h.post('/revoke',{viewToken,revokeToken})).status,200);
 h.advance(86401000);await h.restart();assert.equal((await h.post('/read',{viewToken})).status,404);
 assert.equal((await h.post('',{...old,version:1,viewToken,revokeToken})).status,410);
});
test('failed atomic activation/revocation persistence is not acknowledged or reflected as successful',async t=>{
 const h=await harness(t),{body,grant}=await h.issue();const backup=h.directory+'-held';
 await rename(h.directory,backup);await writeFile(h.directory,'synthetic storage failure');
 try{assert.equal((await h.post('',body)).status,503);assert.equal((await h.post('/read',{viewToken:grant.viewToken})).status,410);}
 finally{await rm(h.directory);await rename(backup,h.directory);}
 assert.equal((await h.post('',body)).status,200);
 await rename(h.directory,backup);await writeFile(h.directory,'synthetic storage failure');
 try{assert.equal((await h.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken})).status,503);assert.equal((await h.post('/read',{viewToken:grant.viewToken})).status,200);}
 finally{await rm(h.directory);await rename(backup,h.directory);}
 assert.equal((await h.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken})).status,200);await h.restart();assert.equal((await h.post('',body)).status,410);
});
test('issuance persistence failure returns unavailable, never grants an unpersisted identity',async t=>{
 const h=await harness(t),backup=h.directory+'-held';await rename(h.directory,backup);await writeFile(h.directory,'synthetic failure');
 try{assert.equal((await h.post('/issue',{version:2,digest:'a'.repeat(64)})).status,503);}
 finally{await rm(h.directory);await rename(backup,h.directory);}
 assert.deepEqual(await readdir(h.directory),[]);await h.restart();const {body}=await h.issue();assert.equal((await h.post('',body)).status,200);
});
test('cleanup races with a valid retry without extending original expiry or retaining spent metadata forever',async t=>{
 const h=await harness(t,{ttlMs:100,creationMs:100,sweepMs:5}),{body,grant}=await h.issue();assert.equal((await h.post('',body)).status,200);
 h.advance(100);
 const results=await Promise.all([h.post('',body),h.post('/read',{viewToken:grant.viewToken}),h.post('',body)]);
 assert.deepEqual(results.map(r=>r.status),[410,410,410]);h.advance(86400000);
 assert.equal((await h.post('',body)).status,404);assert.deepEqual(await readdir(h.directory),[]);
 await h.restart();assert.equal((await h.post('',body)).status,404);
});
