// One real Codex turn against the existing isolated fixture; note operations are read-only.
import https from 'node:https';
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CodexClient,defaults,threadOptions} from '../src/codex';
import {contextPrompt,resolveReferences} from '../src/context';
import {siyuanToolGuide} from '../src/prompts';

async function main(){
 const root=realpathSync('.test-workspace');
 if(root!=='/private/tmp/siyuan-local-agent-composer/.test-workspace')throw Error('Unexpected isolated workspace');
 const conf=JSON.parse(readFileSync(join(root,'conf/conf.json'),'utf8'));
 const latest=[...readFileSync(join(root,'temp/siyuan.log'),'utf8').matchAll(/http server \[127\.0\.0\.1:(\d+)\]/g)].at(-1);
 const port=Number(process.env.SIYUAN_TEST_PORT||latest?.[1]);if(!port)throw Error('No isolated kernel port recorded');
 const post=(path:string,body:unknown)=>new Promise<any>((resolve,reject)=>{
  const req=https.request(`https://127.0.0.1:${port}`+path,{method:'POST',ca:readFileSync(join(root,'conf/ca.crt')),headers:{Authorization:'Token '+conf.api.token,'Content-Type':'application/json'}},res=>{
   let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{const value=JSON.parse(text);if(value.code!==0)throw Error(value.msg||'SiYuan API failed');resolve(value.data);}catch(e){reject(e);}});
  });req.setTimeout(10000,()=>req.destroy(Error('Test kernel timeout')));req.on('error',reject);req.end(JSON.stringify(body));
 });
 const info=await post('/api/system/getConf',{});assert.equal(conf.system.workspaceDir,root);
 if(info.conf.system.workspaceDir)assert.equal(info.conf.system.workspaceDir,root);
 const rows=await post('/api/query/sql',{stmt:"SELECT id, content FROM blocks WHERE type = 'd' AND content = '输入模式测试' LIMIT 1"});
 if(!rows.length)throw Error('Existing composer fixture is missing');
 const ref={id:rows[0].id,title:rows[0].content};
 const baseline=await post('/api/export/exportMdContent',{id:ref.id});
 const marker=baseline.content.match(/COMPOSER_FIXTURE_[A-Z0-9_]+/)?.[0];if(!marker)throw Error('Fixture marker is missing');
 const attachments=await resolveReferences([ref],[]);
 const input=`((${ref.id} '${ref.title}')) 请阅读引用的文档，只回复正文中以 COMPOSER_FIXTURE_ 开头的那一行。`+contextPrompt(attachments);
 assert.ok(!input.includes(marker));assert.ok(!siyuanToolGuide.includes(marker));
 const client=new CodexClient(60000),calls:{server:string;tool:string;arguments:any;status?:string;error?:unknown;containsFixture?:boolean}[]=[];
 const messages:{phase?:string;text:string}[]=[],approvals:{method?:string;accepted:boolean;server?:string}[]=[];
 let completed!:()=>void,failed!:(error:Error)=>void;
 const done=new Promise<void>((resolve,reject)=>{completed=resolve;failed=reject;});
 // Attach a handler before starting so transport failures cannot be unhandled.
 void done.catch(()=>{});
 let answer='',turnError='';
 client.onExit=error=>failed(error);
 client.onEvent=m=>{
  const p=m.params||{},item=p.item;
  if(m.id!==undefined){
   const call=calls.at(-1);
   // This harness may approve only an already observed, read-only call on the
   // exact synthetic fixture. Keep the plugin's production approval UI intact.
   const read=call?.server==='siyuan_local_agent_workspace'&&call.arguments?.id===ref.id&&
    ((call.tool==='export'&&call.arguments?.action==='md')||(call.tool==='block'&&['get_kramdown','get','get_children'].includes(call.arguments?.action)));
   const accept=m.method==='mcpServer/elicitation/request'&&p.serverName==='siyuan_local_agent_workspace'&&p.mode==='form'&&p.requestedSchema&&Object.keys(p.requestedSchema.properties||{}).length===0&&read;
   approvals.push({method:m.method,accepted:!!accept,server:p.serverName});
   if(accept)client.respond(m.id,{action:'accept',content:{}});else client.reject(m.id);
   return;
  }
  if(m.method==='item/started'&&item?.type==='mcpToolCall')calls.push({server:item.server,tool:item.tool,arguments:item.arguments,status:item.status});
  if(m.method==='item/completed'&&item?.type==='mcpToolCall'){
   const call=[...calls].reverse().find(c=>c.server===item.server&&c.tool===item.tool);if(call){call.status=item.status;call.error=item.error;call.containsFixture=JSON.stringify(item.result||'').includes(marker);}
  }
  if(m.method==='item/completed'&&item?.type==='agentMessage'){messages.push({phase:item.phase,text:item.text||''});if(item.phase!=='commentary')answer=item.text||answer;}
  if(m.method==='error')turnError=p.error?.message||'Codex turn error';
  if(m.method==='turn/completed'){if(p.turn?.status!=='completed')failed(Error(p.turn?.error?.message||turnError||'Turn failed'));else completed();}
 };
 const s={...defaults,cwd:mkdtempSync('/private/tmp/local-agent-reference-cli-'),mcpEnabled:true,mcpUrl:`https://127.0.0.1:${port}/mcp`};
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await client.start(s,conf.api.token,join(root,'conf/ca.crt'));
  const config=await client.request('config/read',{cwd:s.cwd,includeLayers:false});
  const inherited=typeof config.config?.developer_instructions==='string'?config.config.developer_instructions:'';
  const options=threadOptions(s,inherited);assert.ok(options.developerInstructions.includes(siyuanToolGuide));
  const thread=await client.request('thread/start',{...options,ephemeral:true});
  const servers=await client.request('mcpServerStatus/list',{threadId:thread.thread.id});
  const server=servers.data.find((v:any)=>v.name==='siyuan_local_agent_workspace');
  if(!server||!Object.keys(server.tools||{}).length)throw Error('Current-workspace MCP tools unavailable');
  console.log(JSON.stringify({stage:'connected',tools:Object.keys(server.tools).length,referenceBodyAttached:false,guideChars:siyuanToolGuide.length}));
  timer=setTimeout(()=>failed(Error('Reference inference timed out')),180000);
  await client.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:input}]});
  await done;
  const result={workspace:root,port,guideChars:siyuanToolGuide.length,referenceBodyAttached:false,fixtureMarkerRecovered:answer.includes(marker),modelInference:true,answer,messages,calls,approvals,nativeDesktopInteraction:false};
  writeFileSync('artifacts/mcp-reference-live.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  assert.ok(calls.some(c=>c.server==='siyuan_local_agent_workspace'&&((c.tool==='export'&&c.arguments?.action==='md')||(c.tool==='block'&&['get_kramdown','get','get_children'].includes(c.arguments?.action)))),'Model must read the note through workspace MCP');
  assert.ok(answer.includes(marker),'Answer must contain the fixture marker that was absent from the request');
 }finally{if(timer)clearTimeout(timer);client.dispose();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
