// Update only the project's existing isolated workspace, preserving legacy data.
import https from 'node:https';
import {readFileSync,cpSync,mkdtempSync,writeFileSync,realpathSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=realpathSync('.test-workspace');
if(root!=='/private/tmp/siyuan-local-agent-composer/.test-workspace')throw Error('Unexpected isolated workspace');
const conf=JSON.parse(readFileSync(root+'/conf/conf.json','utf8'));
const latest=[...readFileSync(root+'/temp/siyuan.log','utf8').matchAll(/http server \[127\.0\.0\.1:(\d+)\]/g)].at(-1);
const port=Number(process.env.SIYUAN_TEST_PORT||latest?.[1]);if(!port)throw Error('No isolated kernel port recorded');
const post=(path,body)=>new Promise((resolve,reject)=>{
 const req=https.request(`https://127.0.0.1:${port}`+path,{method:'POST',ca:readFileSync(root+'/conf/ca.crt'),headers:{Authorization:'Token '+conf.api.token,'Content-Type':'application/json'}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>{try{const result=JSON.parse(data);if(result.code!==0)throw Error(result.msg);resolve(result.data);}catch(e){reject(e);}});});req.setTimeout(10000,()=>req.destroy(Error('Test kernel timeout')));req.on('error',reject);req.end(JSON.stringify(body));
});
const info=await post('/api/system/getConf',{});
if(conf.system.workspaceDir!==root||(info.conf.system.workspaceDir&&info.conf.system.workspaceDir!==root))throw Error('Kernel workspace mismatch');
const {name,version}=JSON.parse(readFileSync('dist/plugin.json','utf8')),legacy='siyuan-local-agent';
if(name!=='siyuan-codex')throw Error('Unexpected package name');
const hash=v=>createHash('sha256').update(v).digest('hex');
const savedData=[legacy,name].flatMap(pkg=>['settings.json','sessions.json','workspaces.json'].map(f=>`${root}/data/storage/petal/${pkg}/${f}`)).filter(existsSync).map(path=>({path,hash:hash(readFileSync(path))}));
const target=root+'/data/plugins/'+name,backup=mkdtempSync('/private/tmp/siyuan-codex-upgrade-backup-');
for(const pkg of [legacy,name])for(const area of ['plugins','storage/petal']){const path=`${root}/data/${area}/${pkg}`;if(existsSync(path))cpSync(path,`${backup}/${area}/${pkg}`,{recursive:true});}
cpSync('dist',target,{recursive:true});
if(existsSync(root+'/data/plugins/'+legacy))await post('/api/petal/setPetalEnabled',{packageName:legacy,enabled:false});
await post('/api/petal/setPetalEnabled',{packageName:name,enabled:true});
const plugins=await post('/api/petal/loadPetals',{frontend:'desktop'}),installed=plugins.find(p=>p.name===name);if(!installed)throw Error('New plugin not enabled');
if(plugins.some(p=>p.name===legacy))throw Error('Legacy plugin still enabled');
const js=readFileSync('dist/index.js'),css=readFileSync('dist/index.css');
if(hash(installed.js)!==hash(js)||hash(readFileSync(target+'/index.css'))!==hash(css))throw Error('Installed code does not match build');
// The running new plugin may persist restored session state during hot reload.
const legacyDataPreserved=savedData.filter(item=>item.path.includes('/petal/'+legacy+'/')).every(item=>hash(readFileSync(item.path))===item.hash);
if(!legacyDataPreserved)throw Error('Legacy data changed during deployment');
const result={workspace:root,port,name,version,backup,jsHash:hash(js),cssHash:hash(css),kernelLoaded:true,legacyDisabled:true,existingDataBackedUp:true,legacyDataPreserved,modelInference:false,nativeDesktopVerified:false};
if(process.env.SIYUAN_TEST_RELOAD==='1')await post('/api/ui/reloadUI',{});
writeFileSync('artifacts/codex-install.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
