import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {PostgresCards,initializeDatabase} from './postgres.mjs';
import {createCardServer} from './server.mjs';
import {startService} from './run.mjs';
import {serviceConfig,WEEK} from './config.mjs';
import {fixture} from './test-fixture.mjs';
import {digest} from './contract.mjs';
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {realpath} from 'node:fs/promises';

const url=process.env.CARD_TEST_DATABASE_URL;
const dbtest=(name,fn)=>test(name,{skip:!url},fn);
const poolFor=value=>{const p=new pg.Pool({connectionString:value,max:2,connectionTimeoutMillis:3000,query_timeout:6000});p.on('error',()=>{});return p;};
async function setup(t,{empty=false,...overrides}={}){
  const base=new URL(url);
  if(base.hostname!=='127.0.0.1'||base.username!=='tc_test_admin'||base.port!=='55439')throw Error('Dedicated local test cluster required');
  const control=poolFor(base.href),name='tc_'+randomUUID().replaceAll('-','');
  if(!(await control.query("SELECT 1 FROM pg_roles WHERE rolname='tc_card_runtime'")).rowCount)await control.query('CREATE ROLE tc_card_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION');
  await control.query(`CREATE DATABASE "${name}"`);base.pathname='/'+name;
  const admin=poolFor(base.href),runtime=new URL(base);runtime.username='tc_card_runtime';
  const config={storage:'postgres',production:false,host:'127.0.0.1',port:0,ttlMs:WEEK,origins:['http://localhost:5173'],databaseUrl:runtime.href,databaseTls:'local',namespace:randomUUID(),authorityId:randomUUID(),maxCards:100,maxStoreBytes:64000000,dailyIssues:20,monthlyBytes:4000000000,issuanceEnabled:true,...overrides};
  if(!empty)await initializeDatabase(admin,{namespace:config.namespace,authorityId:config.authorityId,runtimeRole:'tc_card_runtime',confirm:'INITIALIZE_EMPTY_DATABASE_INVALIDATE_OLD_LINKS'});
  const pools=[],servers=[];
  t.after(async()=>{
    for(const server of servers)await new Promise(resolve=>server.close(resolve));
    await Promise.all(pools.map(p=>p.end()));await admin.end();
    assert.match(name,/^tc_[a-f0-9]{32}$/);await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);await control.end();
  });
  const start=async(override={})=>{
    const pool=poolFor(runtime.href);pools.push(pool);const repository=new PostgresCards(pool,{...config,...override});
    const server=await createCardServer({...config,...override,repository});servers.push(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const origin='http://127.0.0.1:'+server.address().port;
    const post=(route,body)=>fetch(origin+'/v1/cards'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const issue=async(sample=fixture())=>{const r=await post('/issue',{version:2,digest:digest(JSON.stringify({snapshot:sample.snapshot,png:sample.png}))});assert.equal(r.status,200);const grant=await r.json();return {grant,body:{...sample,viewToken:grant.viewToken,creationToken:grant.creationToken}};};
    return {server,repository,pool,post,issue,origin};
  };
  return {config,admin,start,runtime:runtime.href};
}

dbtest('real Postgres preserves exact four-language PNG/text and independent capability contract',async t=>{
  const h=await setup(t),a=await h.start();
  for(const lang of ['aeb','ar','fr','en']){
    const {body,grant}=await a.issue(fixture(lang));assert.equal(new Set([grant.viewToken,grant.revokeToken,grant.creationToken]).size,3);
    assert.equal((await a.post('',body)).status,200);const r=await a.post('/read',{viewToken:grant.viewToken});assert.equal(r.status,200);
    const read=await r.json();assert.equal(read.png,body.png);assert.deepEqual(read.snapshot,body.snapshot);assert.equal(read.expiresAt,grant.expiresAt);
    assert.equal('creationToken' in read,false);assert.equal('revokeToken' in read,false);
  }
});
dbtest('normal unattended application restart keeps issued identity and exact committed content',async t=>{
  const h=await setup(t),a=await h.start(),{body,grant}=await a.issue();await a.post('',body);
  await new Promise(r=>a.server.close(r));const b=await h.start();
  assert.equal((await fetch(b.origin+'/readyz')).status,200);const read=await b.post('/read',{viewToken:grant.viewToken});assert.equal(read.status,200);assert.equal((await read.json()).png,body.png);
  assert.equal((await b.post('',body)).status,200);assert.equal((await(await b.post('/read',{viewToken:grant.viewToken})).json()).expiresAt,grant.expiresAt);
});
dbtest('Postgres run entry starts unattended without filesystem or per-boot approval',async t=>{
  const h=await setup(t),app=await startService(h.config);t.after(()=>app.stop());
  const base='http://127.0.0.1:'+app.server.address().port;assert.equal((await fetch(base+'/readyz')).status,200);
});
dbtest('missing or mismatched external authority fails closed, never initializes or falls back',async t=>{
  const h=await setup(t),wrong=new PostgresCards(poolFor(h.runtime),{...h.config,namespace:randomUUID()});t.after(()=>wrong.close());await assert.rejects(wrong.ready());
  const other=new PostgresCards(poolFor(h.runtime),{...h.config,authorityId:randomUUID()});t.after(()=>other.close());await assert.rejects(other.ready());
  const empty=await setup(t,{empty:true}),r=new PostgresCards(poolFor(empty.runtime),empty.config);t.after(()=>r.close());await assert.rejects(r.ready());
});
dbtest('runtime role cannot perform DDL, reset authority or truncate committed cards',async t=>{
  const h=await setup(t),a=await h.start();
  for(const sql of ['CREATE TABLE public.not_allowed(id int)','CREATE SCHEMA not_allowed','TRUNCATE card_service.cards','DELETE FROM card_service.authority',"UPDATE card_service.authority SET authority_id='00000000-0000-4000-8000-000000000000'"])await assert.rejects(a.pool.query(sql));
  const role=(await a.pool.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];assert.deepEqual(role,{rolsuper:false,rolcreatedb:false,rolcreaterole:false});
});
dbtest('concurrent independent service instances serialize create/revoke and never recreate purged identities',async t=>{
  const h=await setup(t),a=await h.start(),b=await h.start(),{body,grant}=await a.issue();
  const results=await Promise.all([a.post('',body),b.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken}),a.post('',body)]);
  assert.ok(results.every(r=>[200,410].includes(r.status)));assert.equal((await b.post('/read',{viewToken:grant.viewToken})).status,410);
  const row=(await h.admin.query('SELECT png,presentation,status FROM card_service.cards')).rows[0];assert.equal(row.png,null);assert.equal(row.presentation,null);assert.equal(row.status,'revoked');
  await h.admin.query('DELETE FROM card_service.cards WHERE namespace=$1',[h.config.namespace]);
  assert.equal((await b.post('',body)).status,404);assert.equal((await b.post('/read',{viewToken:grant.viewToken})).status,404);
});
dbtest('SQL authority rejects changed retries and view capability cannot activate or revoke',async t=>{
  const h=await setup(t),a=await h.start(),{body,grant}=await a.issue();await a.post('',body);
  const changed={...body,snapshot:{...body.snapshot,blocks:body.snapshot.blocks.map((v,i)=>i===1?{...v,text:'9.999 TND'}:v)}};
  assert.equal((await a.post('',changed)).status,409);assert.equal((await a.post('',{...body,creationToken:grant.viewToken})).status,400);
  assert.equal((await a.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.viewToken})).status,404);
});
dbtest('commit-response loss never sends success early; exact retry reconciles the committed snapshot',async t=>{
  const h=await setup(t),a=await h.start(),{body,grant}=await a.issue();let lose=false;
  const realConnect=a.pool.connect.bind(a.pool);a.pool.connect=async()=>{
    const client=await realConnect(),query=client.query.bind(client);
    client.query=async(...args)=>{const result=await query(...args);if(lose&&args[0]==='COMMIT'){lose=false;throw Error('Synthetic lost COMMIT response');}return result;};return client;
  };
  lose=true;assert.equal((await a.post('',body)).status,503);
  assert.equal((await a.post('',body)).status,200);const read=await(await a.post('/read',{viewToken:grant.viewToken})).json();assert.equal(read.png,body.png);assert.equal(read.expiresAt,grant.expiresAt);
  lose=true;assert.equal((await a.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken})).status,503);
  assert.equal((await a.post('/read',{viewToken:grant.viewToken})).status,410);assert.equal((await a.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken})).status,200);
});
dbtest('transaction rollback leaves no partially activated row or false success',async t=>{
  const h=await setup(t),a=await h.start(),{body,grant}=await a.issue(),real=a.repository.save.bind(a.repository);let fail=true;
  a.repository.save=async(...args)=>{await real(...args);if(fail){fail=false;throw Error('Synthetic interruption before commit');}};
  assert.equal((await a.post('',body)).status,503);assert.equal((await a.post('/read',{viewToken:grant.viewToken})).status,410);
  assert.equal((await a.post('',body)).status,200);
});
dbtest('database lock outage makes reads/readiness unavailable, then fresh authority reconnects safely',async t=>{
  const h=await setup(t),a=await h.start(),{body,grant}=await a.issue();await a.post('',body);
  const blocker=await h.admin.connect();await blocker.query('BEGIN');await blocker.query('SELECT * FROM card_service.authority FOR UPDATE');
  try{assert.equal((await a.post('/read',{viewToken:grant.viewToken})).status,503);}finally{await blocker.query('ROLLBACK');blocker.release();}
  assert.equal((await fetch(a.origin+'/readyz')).status,200);assert.equal((await a.post('/read',{viewToken:grant.viewToken})).status,200);
});
dbtest('database-clock expiry and cleanup erase payload and bound terminal/unused metadata',async t=>{
  const h=await setup(t),a=await h.start(),{body,grant}=await a.issue();await a.post('',body);
  await h.admin.query("UPDATE card_service.cards SET expires_at=floor(extract(epoch FROM clock_timestamp())*1000)-1,create_until=floor(extract(epoch FROM clock_timestamp())*1000)-2");
  assert.equal((await a.post('/read',{viewToken:grant.viewToken})).status,410);assert.equal((await h.admin.query('SELECT png FROM card_service.cards')).rows[0].png,null);
  await h.admin.query('UPDATE card_service.cards SET expires_at=expires_at-86400000,create_until=create_until-86400000');
  assert.equal((await a.post('',body)).status,404);
  const unused=await a.issue();await h.admin.query('UPDATE card_service.cards SET create_until=0 WHERE view_hash=$1',[digest(unused.grant.viewToken)]);
  assert.equal((await a.post('',unused.body)).status,404);
});
dbtest('global quotas and response accounting survive server replacement and preserve revoke allowance',async t=>{
  const h=await setup(t,{dailyIssues:1,monthlyBytes:100}),a=await h.start(),{body,grant}=await a.issue();await a.post('',body);
  const b=await h.start();assert.equal((await b.post('/issue',{version:2,digest:'a'.repeat(64)})).status,429);assert.equal((await b.post('/read',{viewToken:grant.viewToken})).status,429);
  assert.equal((await b.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken})).status,200);
});
dbtest('restored old state cannot initialize or serve under new external identity; empty recovery invalidates old URL',async t=>{
  const old=await setup(t),a=await old.start(),{body,grant}=await a.issue();await a.post('',body);
  const backup=(await old.admin.query('SELECT * FROM card_service.cards')).rows[0];await a.post('/revoke',{viewToken:grant.viewToken,revokeToken:grant.revokeToken});
  // An explicit restored-data simulation retains the old authority identity and active row.
  await old.admin.query("UPDATE card_service.cards SET status='active',png=$1,presentation=$2,width=$3,height=$4",[backup.png,backup.presentation,backup.width,backup.height]);
  await assert.rejects(initializeDatabase(old.admin,{namespace:randomUUID(),authorityId:randomUUID(),runtimeRole:'tc_card_runtime',confirm:'INITIALIZE_EMPTY_DATABASE_INVALIDATE_OLD_LINKS'}));
  const mismatch=new PostgresCards(poolFor(old.runtime),{...old.config,namespace:randomUUID(),authorityId:randomUUID()});t.after(()=>mismatch.close());await assert.rejects(mismatch.ready());
  const clean=await setup(t),b=await clean.start();assert.equal((await b.post('/read',{viewToken:grant.viewToken})).status,404);assert.equal((await b.post('',body)).status,404);
  const next=await b.issue();assert.notEqual(next.grant.viewToken,grant.viewToken);assert.equal((await b.post('',next.body)).status,200);
  const c=await clean.start();assert.equal((await c.post('/read',{viewToken:grant.viewToken})).status,404);
});
test('Postgres mode requires explicit authority/TLS and never inherits filesystem configuration',()=>{
  const env={CARD_STORAGE:'postgres',CARD_MODE:'local',CARD_DATABASE_URL:'postgresql://runtime@127.0.0.1/test',CARD_DATABASE_TLS:'local',CARD_NAMESPACE:randomUUID(),CARD_DATABASE_ID:randomUUID(),CARD_TTL_MS:String(WEEK),CARD_ALLOWED_ORIGINS:'http://localhost:5173'};
  const config=serviceConfig(env);assert.equal(config.directory,undefined);assert.equal(config.storage,'postgres');
  for(const key of ['CARD_DATABASE_URL','CARD_NAMESPACE','CARD_DATABASE_ID']){const bad={...env};delete bad[key];assert.throws(()=>serviceConfig(bad));}
  assert.throws(()=>serviceConfig({...env,CARD_DATABASE_URL:env.CARD_DATABASE_URL+'?sslmode=disable'}));
  assert.throws(()=>serviceConfig({...env,CARD_MODE:'production'}));
});

dbtest('real local PostgreSQL engine restart preserves authoritative snapshot and allows unattended reconnect',async t=>{
 const h=await setup(t),a=await h.start(),{body,grant}=await a.issue();await a.post('',body);
 const ctl=process.env.CARD_TEST_PG_CTL,data=process.env.CARD_TEST_PG_DATA,lib=process.env.CARD_TEST_PG_LIB??process.env.LD_LIBRARY_PATH??'';
 assert.ok(ctl&&data);assert.ok((await realpath(data)).startsWith(homedir()+'/.local/share/taxi-check-pg-tests/run.'));assert.ok(data.endsWith('/data'));
 const status=await new Promise((resolve,reject)=>{const child=spawn(ctl,['-D',data,'-l',data+'/../postgres-restart.log','-m','fast','-w','restart'],{env:{...process.env,LD_LIBRARY_PATH:lib},timeout:15000,stdio:'ignore'});child.once('error',reject);child.once('exit',resolve);});assert.equal(status,0);
 const read=await a.post('/read',{viewToken:grant.viewToken});assert.equal(read.status,200);const saved=await read.json();assert.equal(saved.png,body.png);assert.equal(saved.expiresAt,grant.expiresAt);assert.equal((await fetch(a.origin+'/readyz')).status,200);
});

dbtest('delayed read rechecks database time instead of serving a snapshot authorized earlier in the transaction',async t=>{
 const h=await setup(t),a=await h.start(),{body,grant}=await a.issue();await a.post('',body);
 await h.admin.query("UPDATE card_service.cards SET expires_at=floor(extract(epoch FROM clock_timestamp())*1000)+100,create_until=floor(extract(epoch FROM clock_timestamp())*1000)");
 const get=a.repository.get.bind(a.repository);a.repository.get=async id=>{await new Promise(r=>setTimeout(r,200));return get(id);};
 const read=await a.post('/read',{viewToken:grant.viewToken});assert.equal(read.status,410);assert.equal((await read.json()).error,'expired');
});

dbtest('readiness refuses database-owner credentials instead of accepting an overprivileged runtime',async t=>{
 const h=await setup(t),repository=new PostgresCards(h.admin,h.config);await assert.rejects(repository.ready());
});

dbtest('SQL row/content capacity and shared HTTP format limits reject without fabricating or evicting cards',async t=>{
 const h=await setup(t,{maxCards:1}),a=await h.start();await a.issue();
 assert.equal((await a.post('/issue',{version:2,digest:'d'.repeat(64)})).status,429);assert.equal(Number((await h.admin.query('SELECT count(*) AS n FROM card_service.cards')).rows[0].n),1);
 const small=await setup(t,{maxStoreBytes:66000}),b=await small.start(),{body,grant}=await b.issue();
 assert.equal((await b.post('',body)).status,429);assert.equal((await b.post('/read',{viewToken:grant.viewToken})).status,410);
 assert.equal((await b.post('',{...body,png:'not-an-image'})).status,400);
 assert.equal((await b.post('',{padding:'x'.repeat(3000001)})).status,413);
 assert.equal((await fetch(b.origin+'/v1/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
 assert.equal((await fetch(b.origin+'/readyz')).status,200);
});
