// Synthetic PDF fixture and one real Codex turn, confined to the isolated library.
import https from 'node:https';
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,mkdtempSync,writeFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {CodexClient,defaults,threadOptions} from '../src/codex';
import {resolveReferences,contextPrompt} from '../src/context';
import {inspectWorkspaceMcp,siyuanWorkspacePrompt} from '../src/siyuan-context';

function fixturePdf(marker:string){
 const stream=deflateSync(Buffer.from(`BT /F1 16 Tf 40 740 Td (${marker}) Tj ET`));
 const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'),Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),stream,Buffer.from('\nendstream')])];
 const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0];let offset=chunks[0].length;
 objects.forEach((obj,i)=>{offsets.push(offset);const value=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),obj,Buffer.from('\nendobj\n')]);chunks.push(value);offset+=value.length;});
 chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));return Buffer.concat(chunks);
}
async function main(){
 const root=realpathSync('.test-workspace');assert.equal(root,'/private/tmp/siyuan-local-agent-composer/.test-workspace');
 const conf=JSON.parse(readFileSync(join(root,'conf/conf.json'),'utf8'));
 const latest=[...readFileSync(join(root,'temp/siyuan.log'),'utf8').matchAll(/http server \[127\.0\.0\.1:(\d+)\]/g)].at(-1);
 const port=Number(process.env.SIYUAN_TEST_PORT||latest?.[1]);if(!port)throw Error('No isolated kernel port');
 const origin=`https://127.0.0.1:${port}`,ca=readFileSync(join(root,'conf/ca.crt'));
 const request=(path:string,body:Buffer,type='application/json')=>new Promise<any>((resolve,reject)=>{
  const req=https.request(origin+path,{method:'POST',ca,headers:{Authorization:'Token '+conf.api.token,'Content-Type':type,'Content-Length':body.length}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>{try{const value=JSON.parse(data);if(value.code!==0)throw Error(value.msg||'API failed');resolve(value.data);}catch(e){reject(e);}});});
  req.setTimeout(10000,()=>req.destroy(Error('Isolated kernel timeout')));req.on('error',reject);req.end(body);
 });
 const post=(path:string,body:unknown)=>request(path,Buffer.from(JSON.stringify(body)));
 const info=await post('/api/system/getConf',{});assert.equal(conf.system.workspaceDir,root);if(info.conf.system.workspaceDir)assert.equal(info.conf.system.workspaceDir,root);
 const books=await post('/api/query/sql',{stmt:"SELECT box FROM blocks WHERE type='d' AND content='输入模式测试' LIMIT 1"});if(!books.length)throw Error('Existing fixture notebook missing');
 const marker='PDF_ATTACHMENT_READ_MARKER_20261002',pdf=fixturePdf(marker);assert.ok(!pdf.includes(Buffer.from(marker)));
 writeFileSync('artifacts/attachment-context-fixture.pdf',pdf);
 const boundary='SiYuanCodexFixture'+Date.now(),multipart=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="assetsDirPath"\r\n\r\n/assets/\r\n--${boundary}\r\nContent-Disposition: form-data; name="file[]"; filename="attachment-context-fixture.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),pdf,Buffer.from(`\r\n--${boundary}--\r\n`)]);
 const uploaded=await request('/api/asset/upload',multipart,`multipart/form-data; boundary=${boundary}`);
 const asset=Object.values(uploaded.succMap||{})[0];if(typeof asset!=='string'||!asset.startsWith('assets/'))throw Error('PDF fixture upload failed');
 const title='附件上下文测试 '+Date.now();const id=await post('/api/filetree/createDocWithMd',{notebook:books[0].box,path:'/'+title,markdown:`[PDF 测试附件](${asset})`});assert.match(id,/^\d{14}-[a-z0-9]{7}$/);
 // Wait for the normal write queue; no arbitrary storage edits.
 await post('/api/sqlite/flushTransaction',{});
 const metadataCalls:string[]=[];const previousFetch=globalThis.fetch;
 globalThis.fetch=(async(path:any,init:any)=>{metadataCalls.push(String(path));const value=await post(String(path),JSON.parse(init.body));return {ok:true,json:async()=>({code:0,data:value})} as Response;}) as typeof fetch;
 let attachments:Awaited<ReturnType<typeof resolveReferences>>;
 try{attachments=await resolveReferences([{id,title}],[],{workspace:root,origin});}finally{globalThis.fetch=previousFetch;}
 assert.deepEqual(metadataCalls,['/api/asset/getDocAssets']);
 const manifest=attachments[0].assets!;assert.equal(manifest.status,'available');const file=manifest.items.find(item=>item.path===asset);assert.equal(file?.localStatus,'available');assert.equal(file?.mimeType,'application/pdf');assert.equal(file?.size,pdf.length);assert.equal(statSync(file!.localPath!).size,pdf.length);
 const client=new CodexClient(60000),calls:any[]=[],approvals:any[]=[];let answer='',completed!:()=>void,failed!:(e:Error)=>void;
 const done=new Promise<void>((resolve,reject)=>{completed=resolve;failed=reject;});void done.catch(()=>{});client.onExit=failed;
 client.onEvent=m=>{const p=m.params||{},item=p.item;
  if(m.id!==undefined){const call=calls.at(-1),read=call?.server==='siyuan_local_agent_workspace'&&((call.tool==='export'&&call.arguments?.action==='md'&&call.arguments?.id===id)||(call.tool==='search'&&call.arguments?.action==='getasset'&&call.arguments?.path===asset)||(call.tool==='asset'&&call.arguments?.action==='stat'&&call.arguments?.path===asset));const accept=m.method==='mcpServer/elicitation/request'&&p.serverName==='siyuan_local_agent_workspace'&&p.mode==='form'&&p.requestedSchema&&Object.keys(p.requestedSchema.properties||{}).length===0&&read;approvals.push({method:m.method,accepted:!!accept});if(accept)client.respond(m.id,{action:'accept',content:{}});else client.reject(m.id);return;}
  if(m.method==='item/started'&&item?.type==='mcpToolCall')calls.push({type:item.type,server:item.server,tool:item.tool,arguments:item.arguments,status:item.status});
  if(m.method==='item/completed'&&item?.type==='mcpToolCall'){const call=[...calls].reverse().find(c=>c.server===item.server&&c.tool===item.tool);if(call){call.status=item.status;call.error=item.error;}}
  if(m.method==='item/completed'&&item?.type==='commandExecution')calls.push({type:item.type,command:item.command,status:item.status,exitCode:item.exitCode,outputContainsMarker:String(item.aggregatedOutput||'').includes(marker)});
  if(m.method==='item/completed'&&item?.type==='agentMessage'&&item.phase!=='commentary')answer=item.text||answer;
  if(m.method==='turn/completed'){if(p.turn?.status!=='completed')failed(Error(p.turn?.error?.message||'Turn failed'));else completed();}
 };
 const settings={...defaults,cwd:mkdtempSync('/private/tmp/siyuan-codex-attachment-cli-'),mcpEnabled:true,mcpUrl:origin+'/mcp'};let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await client.start(settings,conf.api.token,join(root,'conf/ca.crt'));const config=await client.request('config/read',{cwd:settings.cwd,includeLayers:false});
  const thread=await client.request('thread/start',{...threadOptions(settings,config.config?.developer_instructions||''),ephemeral:true});const state=await inspectWorkspaceMcp(client,thread.thread.id);assert.equal(state.status,'connected');
  const input=`((${id} '${title}')) 请读取所附 PDF 原文件的第一页，报告该页以 PDF_ATTACHMENT_READ_MARKER_ 开头的完整标记和实际页数。`+contextPrompt(attachments)+siyuanWorkspacePrompt(root,settings.mcpUrl,state);assert.ok(!input.includes(marker));
  console.log(JSON.stringify({stage:'connected',metadataCalls,attachmentCount:manifest.items.length,localFileVerified:true,bodyAttached:false,mcpTools:state.tools?.length}));
  timer=setTimeout(()=>failed(Error('Attachment inference timed out')),180000);await client.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:input}]});await done;
  const result={workspace:root,port,documentId:id,assetPath:asset,metadataCalls,manifest,mcpState:state,bodyAttached:false,markerAbsentFromInput:true,modelRecoveredMarker:answer.includes(marker),originalReadByCommand:calls.some(c=>c.type==='commandExecution'&&c.command?.includes(file!.localPath!)&&c.outputContainsMarker),answer,calls,approvals,nativeDesktopVerified:false};
  writeFileSync('artifacts/attachment-context-live.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));assert.ok(result.modelRecoveredMarker,'Model must recover the marker absent from the request');assert.ok(result.originalReadByCommand,'Original PDF must be read through a normal local file tool');
 }finally{if(timer)clearTimeout(timer);client.dispose();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
