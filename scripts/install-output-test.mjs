// Installs only into this task's disposable SiYuan workspace, using its own CA.
import https from 'node:https';
import {readFileSync,cpSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='/private/tmp/siyuan-local-agent-output/.test-workspace';
if(realpathSync(root)!==root)throw Error('Unexpected isolated workspace');
const conf=JSON.parse(readFileSync(root+'/conf/conf.json','utf8'));
const post=(path,body)=>new Promise((resolve,reject)=>{const req=https.request('https://127.0.0.1:16834'+path,{method:'POST',ca:readFileSync(root+'/conf/ca.crt'),headers:{Authorization:'Token '+conf.api.token,'Content-Type':'application/json'}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>{try{const result=JSON.parse(data);if(result.code!==0)reject(Error(result.msg));else resolve(result.data);}catch(error){reject(error);}});});req.setTimeout(10000,()=>req.destroy(Error('Test kernel timeout')));req.on('error',reject);req.end(JSON.stringify(body));});
// Production HTTP responses hide filesystem paths. The fresh workspace CA
// authenticates this kernel; also check its on-disk configuration and any returned path.
const info=await post('/api/system/getConf',{});if(conf.system.workspaceDir!==root||(info.conf.system.workspaceDir&&info.conf.system.workspaceDir!==root))throw Error('Kernel workspace mismatch');
const cwd='/private/tmp/siyuan-local-agent-output/files';mkdirSync(cwd,{recursive:true});
cpSync('dist',root+'/data/plugins/siyuan-codex',{recursive:true});
const storage=root+'/data/storage/petal/siyuan-codex';mkdirSync(storage,{recursive:true});
writeFileSync(storage+'/settings.json',JSON.stringify({binary:'',cwd,mcpEnabled:false,permissionMode:'ask',sandbox:'read-only'}));
const messages=[{id:'u',role:'user',text:'验证输出与公式渲染（合成消息）。',startedAt:Date.now()-115000,elapsedMs:115000},{id:'p',role:'assistant',phase:'commentary',status:'completed',text:'我会读取合成数据并核对公式。'},{id:'t',role:'tool',status:'completed',text:'echo synthetic\nsynthetic',tool:{type:'commandExecution',title:'运行命令',input:'echo synthetic',output:'synthetic',exitCode:0,cwd}},{id:'a',role:'assistant',phase:'final_answer',status:'completed',text:'**最终结论。**过程默认折叠。\n\n\\[\\text{每个专家的 token 数}\\approx\\frac{BK}{E}\\]\n\n```mermaid\nflowchart TD\n A[输入] --> B[共享专家池]\n B --> C[输出]\n```'}];
writeFileSync(storage+'/sessions.json',JSON.stringify({active:'output-render-test',sessions:[{id:'output-render-test',title:'输出与渲染验证 · 合成消息',cwd,workspaceMode:'manual',workspaceLocked:true,messages,updated:Date.now()}]}));
await post('/api/setting/setBazaar',{...conf.bazaar,trust:true});await post('/api/petal/setPetalEnabled',{packageName:'siyuan-codex',enabled:true});
const plugins=await post('/api/petal/loadPetals',{frontend:'desktop'});const installed=plugins.find(p=>p.name==='siyuan-codex');if(!installed)throw Error('Plugin not loaded by kernel');
const hash=value=>createHash('sha256').update(value).digest('hex');const source=readFileSync('dist/index.js','utf8');if(hash(installed.js)!==hash(source))throw Error('Installed JS differs from build');
const stylesheet=readFileSync('dist/index.css','utf8');const installedCSS=typeof installed.css==='string'?installed.css:readFileSync(root+'/data/plugins/siyuan-codex/index.css','utf8');if(hash(installedCSS)!==hash(stylesheet))throw Error('Installed CSS differs from build');
const evidence={workspace:root,port:16834,version:JSON.parse(readFileSync('dist/plugin.json','utf8')).version,jsHash:hash(source),cssHash:hash(stylesheet),kernelLoaded:true,modelInference:false,nativeDesktopVerified:false};writeFileSync('artifacts/output-install.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
