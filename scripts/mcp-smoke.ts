import {readFileSync} from 'node:fs';
import {CodexClient,defaults,threadOptions} from '../src/codex';
async function main(){
 const conf=JSON.parse(readFileSync('.test-workspace/conf/conf.json','utf8'));

 const client=new CodexClient(60000);
 const s={...defaults,cwd:process.cwd(),mcpEnabled:true,mcpUrl:'https://127.0.0.1:16819/mcp'};
 client.onEvent=m=>{if(m.id!==undefined)client.reject(m.id);};
 try {await client.start(s,conf.api.token,process.cwd()+'/.test-workspace/conf/ca.crt'); const r=await client.request('thread/start',{...threadOptions(s),ephemeral:true});console.log('thread started',!!r.thread.id);const servers=await client.request('mcpServerStatus/list',{threadId:r.thread.id,serverName:'siyuan_local_agent_workspace'});const target=servers.data.find((v:any)=>v.name==='siyuan_local_agent_workspace');const tools=Object.keys(target?.tools||{});if(!tools.length)throw new Error('No SiYuan tools found');console.log(JSON.stringify({server:target.name,tools:tools.length,authStatus:target.authStatus,toolsError:target.toolsError}));} finally{client.dispose();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
