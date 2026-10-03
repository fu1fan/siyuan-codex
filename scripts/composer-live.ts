// Uses only a dedicated temporary SiYuan kernel; no inference and no daily workspace.
import https from 'node:https';
import {readFileSync,writeFileSync,realpathSync,copyFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {api,referenceTitle,searchNoteTitles,resolveReferences,contextPrompt} from '../src/context';
import {mediaSource} from '../src/composer-media';
import {importMedia,attachmentInput} from '../src/media';
const root=realpathSync(process.env.SIYUAN_COMPOSER_TEST_ROOT||'/private/tmp/siyuan-local-agent-composer/.test-workspace');
if(!root.startsWith('/private/tmp/siyuan-local-agent-'))throw Error('Expected a dedicated temporary test workspace.');
const port=Number(process.env.SIYUAN_COMPOSER_TEST_PORT||60662);
const conf=JSON.parse(readFileSync(join(root,'conf/conf.json'),'utf8'));
const originalFetch=globalThis.fetch;
globalThis.fetch=(async(path:string,options:any)=>new Promise<Response>((resolve,reject)=>{
 const req=https.request(`https://127.0.0.1:${port}`+path,{method:options?.method||'GET',ca:readFileSync(join(root,'conf/ca.crt')),headers:{Authorization:'Token '+conf.api.token,'Content-Type':'application/json'}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve(new Response(body,{status:res.statusCode})));});req.setTimeout(10000,()=>req.destroy(Error('Test kernel timeout')));req.on('error',reject);req.end(options?.body);
})) as typeof fetch;
async function main(){try{
 const version=await api('/api/system/version',{});assert.equal(version,'3.8.6');
 let docs=await searchNoteTitles('输入模式测试');
 if(!docs.length){const book=await api('/api/notebook/createNotebook',{name:'插件输入测试'});await api('/api/filetree/createDocWithMd',{notebook:book.notebook.id,path:'/输入模式测试',markdown:'COMPOSER_FIXTURE_20261001'});for(let i=0;i<10&&!docs.length;i++){await new Promise(r=>setTimeout(r,200));docs=await searchNoteTitles('输入模式测试');}}
 assert.ok(docs.length);const ref=await referenceTitle(docs[0].id);assert.equal(ref.title,'输入模式测试');const references=await resolveReferences([ref],[]);assert.match(contextPrompt(references),/<note_reference/);assert.doesNotMatch(contextPrompt(references),/COMPOSER_FIXTURE_20261001/);
 const asset=join(root,'data/assets/composer-fixture.png');if(!existsSync(asset))copyFileSync('artifacts/composer-preview-image.png',asset);
 const source=mediaSource({url:'assets/composer-fixture.png',kind:'image',title:'示意图.png'},1),image=await importMedia(source,root,`https://127.0.0.1:${port}`);
 assert.deepEqual(readFileSync(asset),readFileSync(image.media!.path!));const pdf=await importMedia(mediaSource({file:new File(['%PDF-1.4\nfixture'],'fixture.pdf',{type:'application/pdf'})},2),root,`https://127.0.0.1:${port}`);assert.ok(existsSync(pdf.media!.path!));assert.equal(attachmentInput('检查附件',[image,pdf])[1].type,'localImage');
 const result={version,workspace:root,noteTitle:ref.title,liveTitleAndReferenceMetadata:true,mediaSnapshots:true,sourceImageUnchanged:true,imageInputGenerated:true,pdfPathReadable:true,noModelInference:true,nativeDesktopInteraction:false};writeFileSync('artifacts/composer-live.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{globalThis.fetch=originalFetch;}}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
