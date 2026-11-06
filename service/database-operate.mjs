import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {serviceConfig} from './config.mjs';
import {databasePool,initializeDatabase} from './postgres.mjs';

export async function operateDatabase(command,confirm,env=process.env){
  if(!['init-empty','recover-empty'].includes(command))throw Error('Unknown database operation');
  const config=serviceConfig({...env,CARD_DATABASE_URL:env.CARD_ADMIN_DATABASE_URL});
  if(config.storage!=='postgres')throw Error('Postgres configuration required');
  const pool=databasePool(config);
  try{await initializeDatabase(pool,{namespace:config.namespace,authorityId:config.authorityId,runtimeRole:env.CARD_DATABASE_RUNTIME_ROLE,confirm});}
  finally{await pool.end();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await operateDatabase(process.argv[2],process.argv[3]);console.log('Empty database authority initialized. No records imported.');}
  catch{console.error('Database operation refused. Verify empty dedicated database, new identity and explicit confirmation.');process.exitCode=1;}
}
