// Read-only real-library PDF plus ordinary uploaded-file input. No note writes.
import https from 'node:https';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {CodexClient,defaults,threadOptions} from '../src/codex';
import {resolveReferences,contextPrompt} from '../src/context';
import {pdfReadingGuide} from '../src/prompts';
import {importMedia,attachmentInput} from '../src/media';
import type {Attachment} from '../src/context';
import {inspectWorkspaceMcp,siyuanWorkspacePrompt} from '../src/siyuan-context';
async function main(){
 const root='/Users/fu1fan/Library/Application Support/SiYuan',conf=JSON.parse(readFileSync(join(root,'conf/conf.json'),'utf8'));assert.equal(conf.system.workspaceDir,root);
 const latest=[...readFileSync(join(root,'temp/siyuan.log'),'utf8').matchAll(/http server \[127\.0\.0\.1:(\d+)\]/g)].at(-1);const origin=`https://127.0.0.1:${latest?.[1]}`;
 const post=(path:string,body:unknown)=>new Promise<any>((resolve,reject)=>{const req=https.request(origin+path,{method:'POST',ca:readFileSync(join(root,'conf/ca.crt')),headers:{Authorization:'Token '+conf.api.token,'Content-Type':'application/json'}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{const v=JSON.parse(text);if(v.code!==0)throw Error(v.msg);resolve(v.data);}catch(e){reject(e);}});});req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('Kernel timeout')));req.end(JSON.stringify(body));});
 const info=await post('/api/system/getConf',{});if(info.conf.system.workspaceDir)assert.equal(info.conf.system.workspaceDir,root);
 const priorFetch=globalThis.fetch;globalThis.fetch=(async(path:any,init:any)=>({ok:true,json:async()=>({code:0,data:await post(String(path),JSON.parse(init.body))})} as Response)) as typeof fetch;
 let references:Attachment[];
 try{references=await resolveReferences([{id:'20260928110617-ispywrg',title:'megascale2025zhu'}],[],{workspace:root,origin});}finally{globalThis.fetch=priorFetch;}
 const original=references[0].assets?.items.find(a=>a.localStatus==='available'&&a.path.includes('megascale2025zhu-paper-'));assert.ok(original?.localPath);
 const results:any[]=[];
 const modes=process.argv.slice(2);assert.ok(modes.every(mode=>['note-reference','uploaded-file'].includes(mode)));
 for(const mode of modes.length?modes:['note-reference','uploaded-file']){
  const cwd=mkdtempSync('/private/tmp/siyuan-pdf-original-'),mcpEnabled=mode==='note-reference';
  const settings={...defaults,cwd,sandbox:'workspace-write' as const,permissionMode:'auto' as const,mcpEnabled,mcpUrl:origin+'/mcp'};
  const attachments=mcpEnabled?references:[await importMedia({key:'public-paper-upload',kind:'file',title:'public-paper.pdf',marker:'［附件 1：public-paper.pdf］',file:new File([new Uint8Array(readFileSync(original!.localPath!))],'public-paper.pdf',{type:'application/pdf'})},cwd,origin)];
  const target:string=mcpEnabled?original!.localPath!:attachments[0].media!.path!;
  const calls:any[]=[],approvals:any[]=[];let answer='',complete!:()=>void,fail!:(e:Error)=>void;
  const done=new Promise<void>((resolve,reject)=>{complete=resolve;fail=reject;});void done.catch(()=>{});
  const client=new CodexClient(60000);client.onExit=fail;
  client.onEvent=m=>{const p=m.params||{},item=p.item;
   if(m.id!==undefined){const call=calls.at(-1),a=call?.arguments;
    const read=call?.server==='siyuan_local_agent_workspace'&&((call.tool==='export'&&a?.action==='md'&&a?.id==='20260928110617-ispywrg')||(call.tool==='asset'&&a?.action==='stat'&&a?.path===original!.path));
    const accept=m.method==='mcpServer/elicitation/request'&&p.serverName==='siyuan_local_agent_workspace'&&p.mode==='form'&&p.requestedSchema&&Object.keys(p.requestedSchema.properties||{}).length===0&&read;
    approvals.push({method:m.method,accepted:!!accept});if(accept)client.respond(m.id,{action:'accept',content:{}});else client.reject(m.id);return;
   }
   if(m.method==='item/started'&&item?.type==='mcpToolCall')calls.push({id:item.id,type:item.type,server:item.server,tool:item.tool,arguments:item.arguments,status:item.status});
   if(m.method==='item/completed'&&item?.type==='mcpToolCall'){const call=calls.find(c=>c.id===item.id);if(call)call.status=item.status;}
   if(m.method==='item/completed'&&['commandExecution','imageView'].includes(item?.type))calls.push({type:item.type,command:item.command,path:item.path,status:item.status,completedEvent:true,exitCode:item.exitCode,output:item.type==='commandExecution'?String(item.aggregatedOutput||'').slice(0,1200):undefined});
   if(m.method==='item/completed'&&item?.type==='agentMessage'&&item.phase!=='commentary')answer=item.text||answer;
   if(m.method==='turn/completed'){p.turn?.status==='completed'?complete():fail(Error(p.turn?.error?.message||'Turn failed'));}
  };
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   await client.start(settings,mcpEnabled?conf.api.token:'',mcpEnabled?join(root,'conf/ca.crt'):'');const config=await client.request('config/read',{cwd,includeLayers:false});const opts=threadOptions(settings,config.config?.developer_instructions||'');assert.ok(opts.developerInstructions.includes(pdfReadingGuide));
   const thread=await client.request('thread/start',{...opts,ephemeral:true});
   const metadata=mcpEnabled?siyuanWorkspacePrompt(root,settings.mcpUrl,await inspectWorkspaceMcp(client,thread.thread.id)):'';
   const prompt='请阅读附加论文 PDF，告诉我实际页数、第一页完整标题。渲染并查看第一页，以页面图像核对标题，并说明你实际读取和查看的范围。只读原文件，衍生图像保存到当前工作目录。不要安装依赖或修改环境配置。'+contextPrompt(attachments)+metadata;
   assert.ok(!prompt.includes('Serving Mixture-of-Experts at Scale'));
   console.log(JSON.stringify({stage:'started',mode,pdfBodyAttached:false,mcpEnabled}));timer=setTimeout(()=>fail(Error('PDF inference timeout')),240000);
   await client.request('turn/start',{threadId:thread.thread.id,input:attachmentInput(prompt,attachments)});await done;
   const result={mode,mcpEnabled,target,pdfBodyAttached:false,answer,calls,approvals,usedGetasset:calls.some(c=>c.type==='mcpToolCall'&&c.tool==='search'&&c.arguments?.action==='getasset'),originalRead:calls.some(c=>c.type==='commandExecution'&&c.command?.includes(target)&&c.status==='completed'),pageViewed:calls.some(c=>c.type==='imageView'&&c.completedEvent),modelInference:true,nativeDesktopInteraction:false};results.push(result);
   writeFileSync(modes.length?'artifacts/pdf-original-refined-live.json':'artifacts/pdf-original-live.json',JSON.stringify({results},null,2)+'\n');console.log(JSON.stringify({stage:'completed',mode,usedGetasset:result.usedGetasset,originalRead:result.originalRead,pageViewed:result.pageViewed,answer}));
   assert.equal(result.usedGetasset,false);assert.ok(result.originalRead);assert.ok(result.pageViewed);assert.match(answer,/MegaScale-Infer/);assert.match(answer,/24/);
  }finally{if(timer)clearTimeout(timer);client.dispose();}
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
