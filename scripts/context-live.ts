import https from 'node:https';
import {readFileSync,realpathSync} from 'node:fs';
import {resolveReferences,droppedIDs,searchNoteTitles,contextPrompt} from '../src/context';
const root=realpathSync(process.cwd()+'/.test-workspace');
if(!root.startsWith('/private/tmp/siyuan-local-agent-'))throw Error('Expected an isolated test workspace');
const conf=JSON.parse(readFileSync(root+'/conf/conf.json','utf8'));
const latest=[...readFileSync(root+'/temp/siyuan.log','utf8').matchAll(/http server \[127\.0\.0\.1:(\d+)\]/g)].at(-1);
const port=Number(process.env.SIYUAN_TEST_PORT||latest?.[1]);if(!port)throw Error('No isolated kernel port recorded');
const calls:string[]=[];
globalThis.fetch=(async(path:string,options:any)=>new Promise<Response>((resolve,reject)=>{
 calls.push(path);const req=https.request(`https://127.0.0.1:${port}`+path,{method:'POST',ca:readFileSync(root+'/conf/ca.crt'),headers:{Authorization:'Token '+conf.api.token,'Content-Type':'application/json'}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve(new Response(text,{status:res.statusCode})));});req.setTimeout(10000,()=>req.destroy(Error('Test kernel timeout')));req.on('error',reject);req.end(options.body);
})) as typeof fetch;
async function main(){
const notes=await searchNoteTitles('输入模式测试');if(!notes.length)throw Error('No fixture document found');
const ids=droppedIDs({types:['application/siyuan-file'],getData:t=>t==='application/siyuan-file'?notes[0].id:''},root);
const before=calls.length,result=await resolveReferences(ids.map(id=>({id,title:notes[0].title})),[]);
if(calls.length!==before||!contextPrompt(result).includes('<note_reference'))throw Error('References must contain metadata only');
console.log(JSON.stringify({references:result.length,title:result[0]?.title,referenceMetadataOnly:true,bodyFetches:0}));

}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
