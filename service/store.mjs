import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {durableFiles} from './durable.mjs';

const row=/^[a-f0-9]{64}\.json$/;
const temporary=/^[a-f0-9]{64}\.json\.[a-f0-9-]{36}\.tmp$/;
export async function checkedDirectory(directory){
  if(!path.isAbsolute(directory)||await fs.realpath(directory)!==path.resolve(directory)||(await fs.lstat(directory)).isSymbolicLink())throw Error('Unsafe storage directory');
}
export async function inspectStore(config){
  await checkedDirectory(config.mount);await checkedDirectory(config.directory);
  if(path.dirname(config.directory)!==config.mount)throw Error('Invalid store boundary');
  const marker=path.join(config.directory,'.store.json');
  await fs.access(path.join(config.directory,'.budget.json'));
  if(!(await fs.lstat(marker)).isFile()||(await fs.lstat(marker)).isSymbolicLink())throw Error('Invalid store marker');
  const meta=JSON.parse(await fs.readFile(marker,'utf8'));
  if(meta.version!==1||meta.id!==config.storeId)throw Error('Store identity mismatch');
  const hash=createHash('sha256');let bytes=0,count=0;
  for(const name of (await fs.readdir(config.directory)).sort()){
    if(name!=='.store.json'&&name!=='.budget.json'&&!row.test(name)&&!temporary.test(name))throw Error('Unexpected store entry');
    const target=path.join(config.directory,name),stat=await fs.lstat(target);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>3000000)throw Error('Unsafe store entry');
    bytes+=stat.size;if(row.test(name))count++;
    if(bytes>config.maxStoreBytes||count>config.maxCards)throw Error('Store exceeds configured bounds');
    hash.update(name);hash.update(await fs.readFile(target));
  }
  return hash.digest('hex');
}
export async function prepareEmpty(config,{confirm,files=durableFiles({strict:true})}={}){
  if(confirm!=='CREATE_EMPTY_STORE_INVALIDATE_OLD_LINKS')throw Error('Explicit empty-store confirmation required');
  await checkedDirectory(config.mount);
  if(path.dirname(config.directory)!==config.mount)throw Error('Invalid store boundary');
  // Exclusive mkdir refuses both existing stores and arbitrary occupied destinations.
  await fs.mkdir(config.directory,{mode:0o700});await files.flush(config.mount);
  const id=randomUUID();await files.save(path.join(config.directory,'.store.json'),{version:1,id});
  await files.save(path.join(config.directory,'.budget.json'),{version:1,day:0,month:0,issues:0,bytes:0});return id;
}
export async function newBoot(config){
  await fs.mkdir(config.control,{recursive:true,mode:0o700});await checkedDirectory(config.control);
  const boot={version:1,nonce:randomUUID(),storeId:config.storeId};
  await durableFiles().save(path.join(config.control,'boot.json'),boot);
  return boot;
}
export async function approveCurrent(config,{confirm}={}){
  if(confirm!=='CURRENT_AUTHORITATIVE_STORE_NOT_A_RESTORED_BACKUP')throw Error('Current authoritative store confirmation required');
  const boot=JSON.parse(await fs.readFile(path.join(config.control,'boot.json'),'utf8'));
  if(boot.storeId!==config.storeId||!/^[a-f0-9-]{36}$/.test(boot.nonce))throw Error('Invalid boot challenge');
  const fingerprint=await inspectStore(config);
  await durableFiles().save(path.join(config.control,'approval.json'),{...boot,fingerprint});
}
export async function consumeApproval(config,boot){
  let approval;try{approval=JSON.parse(await fs.readFile(path.join(config.control,'approval.json'),'utf8'));}catch{return false;}
  if(approval.nonce!==boot.nonce||approval.storeId!==boot.storeId)return false;
  if(approval.fingerprint!==await inspectStore(config))throw Error('Store changed after approval');
  await fs.unlink(path.join(config.control,'approval.json'));await fs.unlink(path.join(config.control,'boot.json'));return true;
}
