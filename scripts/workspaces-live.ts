// Validate document ancestry against the project's isolated SiYuan kernel only.
import https from 'node:https';
import {readFileSync,realpathSync,writeFileSync,mkdirSync} from 'node:fs';
import {readWorkspaceDocument,matchingBinding} from '../src/workspaces';
import {searchNoteTitles,api} from '../src/context';
const root=realpathSync(process.cwd()+'/.test-workspace');
if(!root.startsWith('/private/tmp/siyuan-local-agent-'))throw Error('Expected the isolated test workspace');
const conf=JSON.parse(readFileSync(root+'/conf/conf.json','utf8'));
const port=Number(process.env.SIYUAN_TEST_PORT||60662);
globalThis.fetch=(async(path:string,options:any)=>new Promise<Response>((resolve,reject)=>{
 const req=https.request(`https://127.0.0.1:${port}`+path,{method:'POST',ca:readFileSync(root+'/conf/ca.crt'),headers:{Authorization:'Token '+conf.api.token,'Content-Type':'application/json'}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve(new Response(text,{status:res.statusCode})));});req.setTimeout(10000,()=>req.destroy(Error('Test kernel timeout')));req.on('error',reject);req.end(options.body);
})) as typeof fetch;
async function main(){
 const notes=await searchNoteTitles('');const original=await readWorkspaceDocument(notes[0].id);
 const notebooks=await api('/api/notebook/lsNotebooks',{});const notebook=notebooks.notebooks.find((n:any)=>!n.closed)?.id;if(!notebook)throw Error('No test notebook');
 const name='目录绑定测试_'+Date.now();
 const parent=await api('/api/filetree/createDocWithMd',{notebook,path:'/'+name,markdown:'WORKSPACE_BINDING_PARENT'});
 const child=await api('/api/filetree/createDocWithMd',{notebook,path:'/'+name+'/子文档',markdown:'WORKSPACE_BINDING_CHILD'});
 const unrelated=await api('/api/filetree/createDocWithMd',{notebook,path:'/'+name+'_未绑定',markdown:'WORKSPACE_BINDING_UNBOUND'});
 const doc=await readWorkspaceDocument(child);const binding={docID:parent,title:name,cwd:'/private/tmp/siyuan-local-agent-directory-check'};
 if(matchingBinding(doc,[binding])?.docID!==parent)throw Error('Live child ancestry did not match parent');
 mkdirSync(binding.cwd,{recursive:true});
 const fixture={name,parent,child,unrelated,original:original.id,cwd:binding.cwd};writeFileSync('artifacts/workspaces-live.json',JSON.stringify(fixture,null,2));
 console.log(JSON.stringify({liveAncestry:true,parentIncluded:doc.ancestors.includes(parent),childIncluded:doc.ancestors.includes(child),fixture,noInference:true}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
