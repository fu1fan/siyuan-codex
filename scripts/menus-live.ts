// Read-only validation against this project's isolated SiYuan workspace.
import https from 'node:https';
import {readFileSync,realpathSync} from 'node:fs';
import {searchNoteTitles,referenceAttachment,contextPrompt} from '../src/context';
import {ChatSession,newSession} from '../src/session';
import {defaults} from '../src/codex';
const root=realpathSync(process.cwd()+'/.test-workspace');
if(!root.startsWith('/private/tmp/siyuan-local-agent-'))throw Error('Expected the project isolated test workspace');
const conf=JSON.parse(readFileSync(root+'/conf/conf.json','utf8'));
const port=Number(process.env.SIYUAN_TEST_PORT||60662);
async function main(){
const original=globalThis.fetch;
globalThis.fetch=(async(path:string,options:any)=>new Promise<Response>((resolve,reject)=>{
 const req=https.request(`https://127.0.0.1:${port}`+path,{method:'POST',ca:readFileSync(root+'/conf/ca.crt'),headers:{Authorization:'Token '+conf.api.token,'Content-Type':'application/json'}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve(new Response(text,{status:res.statusCode})));});req.setTimeout(10000,()=>req.destroy(Error('Test kernel timeout')));req.on('error',reject);req.end(options.body);
})) as typeof fetch;
try{
 const notes=await searchNoteTitles('');if(!notes.length)throw Error('No fixture document returned');
 const filtered=await searchNoteTitles(notes[0].title);if(!filtered.some(n=>n.id===notes[0].id))throw Error('Title search did not return the same document');
 const attachment=referenceAttachment(notes[0]);
 console.log(JSON.stringify({noteSearch:true,matchedTitle:filtered[0].title,referenceMetadataOnly:contextPrompt([attachment]).includes('<note_reference')}));
}finally{globalThis.fetch=original;}
const chat=new ChatSession(newSession(process.cwd()),{...defaults,cwd:process.cwd()},()=> '');
try{await chat.refreshRateLimits();console.log(JSON.stringify({rateLimitsRead:true,buckets:Object.keys(chat.rateLimits||{}),noInference:true}));}finally{chat.disconnect();}

}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
