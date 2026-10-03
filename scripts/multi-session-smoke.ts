// Two real local CLI app-server processes and ephemeral threads; never starts model turns.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {CodexClient,defaults,threadOptions} from '../src/codex';
const clients=[new CodexClient(30000),new CodexClient(30000)];
async function main(){
 try{
  const threads=await Promise.all(clients.map(async client=>{
   const settings={...defaults,cwd:process.cwd()};client.onEvent=m=>{if(m.id!==undefined)client.reject(m.id);};
   await client.start(settings);const config=await client.request('config/read',{cwd:settings.cwd,includeLayers:false});
   const response=await client.request('thread/start',{...threadOptions(settings,config.config?.developer_instructions||''),ephemeral:true});
   return response.thread.id;
  }));
  assert.equal(clients.every(c=>c.alive),true);assert.notEqual(threads[0],threads[1]);
  clients[0].dispose();assert.equal(clients[1].alive,true);const models=await clients[1].request('model/list',{});assert.ok(models.data.length);
  const result={twoLiveProcesses:true,independentThreads:true,disposingOneLeavesOtherUsable:true,modelCount:models.data.length,ephemeral:true,modelInference:false};writeFileSync('artifacts/multi-session-cli.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{for(const client of clients)client.dispose();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
