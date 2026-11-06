import pg from 'pg';
import {AsyncLocalStorage} from 'node:async_hooks';
import {readFile} from 'node:fs/promises';

export const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function databasePool(config){
  const pool=new pg.Pool({connectionString:config.databaseUrl,max:2,connectionTimeoutMillis:3000,query_timeout:6000,idleTimeoutMillis:30000,
    ssl:config.databaseTls==='verify'?{rejectUnauthorized:true}:false});
  pool.on('error',()=>{});return pool;
}

export async function initializeDatabase(pool,{namespace,authorityId,runtimeRole,confirm}){
  if(confirm!=='INITIALIZE_EMPTY_DATABASE_INVALIDATE_OLD_LINKS'||!uuidPattern.test(namespace)||!uuidPattern.test(authorityId)||!/^[a-z][a-z0-9_]{0,62}$/.test(runtimeRole))throw Error('Explicit empty authority initialization required');
  const client=await pool.connect();let error;
  try{
    await client.query('BEGIN');await client.query("SET LOCAL synchronous_commit = 'on'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('taxi-check-empty-init'))");
    const occupied=await client.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1");
    if(occupied.rowCount)throw Error('Database is not empty');
    await client.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
    await client.query('INSERT INTO card_service.authority(namespace,authority_id,schema_version) VALUES($1,$2,1)',[namespace,authorityId]);
    await client.query(`GRANT USAGE ON SCHEMA card_service TO "${runtimeRole}"`);
    await client.query(`GRANT SELECT ON card_service.authority TO "${runtimeRole}"`);
    await client.query(`GRANT UPDATE(day,month,issues,bytes) ON card_service.authority TO "${runtimeRole}"`);
    await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON card_service.cards TO "${runtimeRole}"`);
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query('COMMIT');
  }catch(e){error=e;await client.query('ROLLBACK').catch(()=>{});throw Error('Empty database initialization refused');}
  finally{client.release(error);}
}

export class PostgresCards {
  context=new AsyncLocalStorage();
  constructor(pool,config){this.pool=pool;this.config=config;}
  now(){return this.context.getStore()?.now??Date.now();}
  client(){const state=this.context.getStore();if(!state)throw Error('Transaction required');return state.client;}
  async transaction(operation){
    const client=await this.pool.connect();let error;
    try{
      await client.query('BEGIN');await client.query("SET LOCAL synchronous_commit = 'on'");
      await client.query("SET LOCAL lock_timeout = '3s'");await client.query("SET LOCAL statement_timeout = '5s'");
      const durable=await client.query("SELECT current_setting('fsync') AS fsync, current_setting('full_page_writes') AS full_page_writes, (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication FROM pg_roles WHERE rolname=current_user) AS privileged, has_schema_privilege(current_user,'card_service','CREATE') AS schema_create");
      if(durable.rows[0].fsync!=='on'||durable.rows[0].full_page_writes!=='on'||durable.rows[0].privileged||durable.rows[0].schema_create)throw Error('Durable database settings required');
      const ns=await client.query('SELECT * FROM card_service.authority WHERE namespace=$1 AND authority_id=$2 AND schema_version=1 FOR UPDATE',[this.config.namespace,this.config.authorityId]);
      if(ns.rowCount!==1)throw Error('Authority unavailable');
      const clock=await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now');
      const result=await this.context.run({client,now:Number(clock.rows[0].now),budget:ns.rows[0]},operation);
      await client.query('COMMIT');return result;
    }catch(e){error=e;await client.query('ROLLBACK').catch(()=>{});throw e;}
    finally{client.release(error);}
  }
  async ready(){return this.transaction(async()=>true);}
  async get(id){
    const {rows}=await this.client().query('SELECT *,floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS checked_now FROM card_service.cards WHERE namespace=$1 AND view_hash=$2',[this.config.namespace,id]);
    const r=rows[0];if(!r)return undefined;this.context.getStore().now=Number(r.checked_now);
    return {protocol:r.protocol,status:r.status,expiresAt:Number(r.expires_at),createUntil:Number(r.create_until),revokeHash:r.revoke_hash,creationHash:r.creation_hash,contentHash:r.content_hash,
      card:r.png?{version:1,snapshot:JSON.parse(r.presentation),png:r.png.toString('base64'),width:r.width,height:r.height}:null};
  }
  async count(){return Number((await this.client().query('SELECT count(*) AS count FROM card_service.cards WHERE namespace=$1',[this.config.namespace])).rows[0].count);}
  async save(id,r,insert=false){
    const size=await this.client().query('SELECT coalesce(sum(coalesce(octet_length(png),0)*4/3+coalesce(octet_length(presentation),0)+512),0)::bigint AS bytes FROM card_service.cards WHERE namespace=$1 AND view_hash<>$2',[this.config.namespace,id]);
    if(Number(size.rows[0].bytes)+Buffer.byteLength(JSON.stringify(r))+65536>this.config.maxStoreBytes)throw Object.assign(Error('Store capacity'),{capacity:true});
    const values=[this.config.namespace,id,r.protocol,r.status,r.expiresAt,r.createUntil,r.revokeHash,r.creationHash,r.contentHash,
      r.card?Buffer.from(r.card.png,'base64'):null,r.card?JSON.stringify(r.card.snapshot):null,r.card?.width??null,r.card?.height??null];
    const query=insert?'INSERT INTO card_service.cards(namespace,view_hash,protocol,status,expires_at,create_until,revoke_hash,creation_hash,content_hash,png,presentation,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)':
      'UPDATE card_service.cards SET protocol=$3,status=$4,expires_at=$5,create_until=$6,revoke_hash=$7,creation_hash=$8,content_hash=$9,png=$10,presentation=$11,width=$12,height=$13 WHERE namespace=$1 AND view_hash=$2';
    const result=await this.client().query(query,values);if(result.rowCount!==1)throw Error('Card is unavailable');
  }
  async sweep(){
    const c=this.client(),values=[this.config.namespace,this.now()];
    await c.query("DELETE FROM card_service.cards WHERE namespace=$1 AND status='issued' AND create_until<=$2",values);
    await c.query("UPDATE card_service.cards SET status='expired',png=NULL,presentation=NULL,width=NULL,height=NULL WHERE namespace=$1 AND expires_at<=$2 AND status='active'",values);
    await c.query('DELETE FROM card_service.cards WHERE namespace=$1 AND png IS NULL AND expires_at+86400000<=$2',values);
  }
  async reserve(_now,{issue=false,bytes=0}={}){
    const state=this.context.getStore(),old=state.budget,date=new Date(state.now),day=Math.floor(state.now/86400000),month=date.getUTCFullYear()*12+date.getUTCMonth();
    if(day<Number(old.day)||month<old.month)throw Error('Clock precedes committed budget');
    const issues=Number(old.day)===day?old.issues:0,used=old.month===month?Number(old.bytes):0;
    if(issue&&issues>=this.config.dailyIssues||used+bytes>this.config.monthlyBytes)return false;
    await state.client.query('UPDATE card_service.authority SET day=$2,month=$3,issues=$4,bytes=$5 WHERE namespace=$1',[this.config.namespace,day,month,issues+(issue?1:0),used+bytes]);
    state.budget={day,month,issues:issues+(issue?1:0),bytes:used+bytes};return true;
  }
  async close(){await this.pool.end();}
}
