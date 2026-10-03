// Browser layout fixture. Detection responses are simulated; real CLI evidence is separate.
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import http from 'node:http';
await build({stdin:{contents:`
  import {welcomePage} from './src/welcome';
  const page=welcomePage({binary:'',shortcut:'⌥⇧A',browse:async()=>'/usr/local/bin/codex',finish:async()=>{document.querySelector('#notice').textContent='已点击开始使用（界面预览）';},later:()=>{document.querySelector('#notice').textContent='已点击稍后设置（界面预览）';}});
  document.querySelector('#host').append(page.element);void page.check.run();
`,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',outfile:'artifacts/welcome-preview.js',plugins:[{name:'simulated-detection',setup(b){
  b.onResolve({filter:/\/cli-diagnostics$/},()=>({path:'diagnostics',namespace:'preview'}));
  b.onLoad({filter:/.*/,namespace:'preview'},()=>({contents:`
    export const initialChecks=()=>['path','version','connection','account'].map(id=>({id,state:'waiting',detail:'等待检测'}));
    export async function detectCli(value,options){const fail=value.includes('missing');return {binary:value||'/usr/local/bin/codex',connected:!fail,checks:initialChecks().map((c,i)=>({...c,state:fail?(i===0?'error':'waiting'):'success',detail:fail?(i===0?'未找到 Codex CLI。安装后重新检测，或选择完整路径。':'未检测'):['/usr/local/bin/codex','0.159.0','连接成功','已登录 ChatGPT'][i]}))};}
  `}));
}}]});
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>思源 Codex · 欢迎页布局预览</title><link rel="stylesheet" href="/host.css"><link rel="stylesheet" href="/style.css"><style>:root{--b3-theme-background:#fff;--b3-theme-on-background:#222;--b3-theme-surface:#f5f5f5;--b3-theme-on-surface:#777;--b3-border-color:#e5e5e5;--b3-border-radius:4px;--b3-theme-primary:#32a9d4;--b3-theme-on-primary:#fff;--b3-theme-error:#d33;--b3-font-size:14px;--b3-font-family:system-ui}*{box-sizing:border-box}body{margin:0;background:#eceef1;font-family:system-ui;padding:32px 16px}#host{max-width:600px;margin:auto;background:white;border:1px solid #ddd;border-radius:8px;overflow:hidden}header{display:flex;align-items:center;padding:14px 24px;font-size:16px;font-weight:600;border-bottom:1px solid var(--b3-border-color)}#notice{max-width:600px;margin:12px auto;font-size:12px;color:#666}.la-welcome{max-height:none}@media(prefers-color-scheme:dark){:root{--b3-theme-background:#1e1e1e;--b3-theme-on-background:#ddd;--b3-theme-surface:#282828;--b3-theme-on-surface:#aaa;--b3-border-color:#444}body{background:#151515}#host{background:var(--b3-theme-background);border-color:#444}}</style><div id="host"><header>思源 Codex · 欢迎</header></div><p id="notice">布局与交互预览 · 检测结果为模拟数据</p><script src="/preview.js"></script></html>`;
await writeFile('artifacts/welcome-preview.html',html);
const files={'/':'artifacts/welcome-preview.html','/preview.js':'artifacts/welcome-preview.js','/style.css':'src/style.css','/host.css':'/Applications/SiYuan.app/Contents/Resources/stage/build/desktop/base.6ebf9935cf77dd602cbe.css'};
http.createServer(async(req,res)=>{const file=files[req.url];if(!file){res.writeHead(404).end();return;}try{res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));}catch{res.writeHead(500).end();}}).listen(16829,'127.0.0.1',()=>console.log('Welcome layout preview http://127.0.0.1:16829'));
