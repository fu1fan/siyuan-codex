// Read-only protocol verification: no thread resume, archive changes or inference.
import {CodexClient,defaults} from '../src/codex';
import {searchCodexHistory} from '../src/codex-history';
import {homedir} from 'node:os';
import {writeFileSync} from 'node:fs';
async function main(){
 const client=new CodexClient();client.onEvent=m=>{if(m.id!==undefined)client.reject(m.id);};
 try{
  await client.start({...defaults,cwd:homedir(),mcpEnabled:false});
  const page=await searchCodexHistory(client,'');const selected=page.data.find(t=>!t.archived);
  if(!selected)throw Error('No stored local threads found');
  const metadata=await client.request('thread/read',{threadId:selected.threadId,includeTurns:false});
  const turns=await client.request('thread/turns/list',{threadId:selected.threadId,limit:1,sortDirection:'asc',itemsView:'full'});
  if(metadata.thread?.id!==selected.threadId||!Array.isArray(turns.data))throw Error('History protocol verification failed');
  const evidence={search:true,allSources:true,providerFilter:false,storedThreadsOnFirstPage:page.data.length,metadataRead:true,paginatedTurns:true,turnsOnTestPage:turns.data.length,noResume:true,noModelInference:true};
  writeFileSync('artifacts/codex-history-live.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
 }finally{client.dispose();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
