import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {join,normalize} from 'node:path';
import http from 'node:http';
await build({entryPoints:['scripts/output-preview.ts'],bundle:true,platform:'browser',format:'iife',outfile:'artifacts/output-preview.js'});
const assets='/Applications/SiYuan.app/Contents/Resources';
const html=`<!doctype html><html lang="zh"><meta charset="utf-8"><title>输出与渲染测试 · 合成消息</title><link rel="stylesheet" href="/host.css"><link rel="stylesheet" href="/style.css"><style>:root{--b3-theme-background:#fff;--b3-theme-on-background:#222;--b3-theme-surface:#f5f5f5;--b3-theme-on-surface:#777;--b3-theme-on-surface-light:#999;--b3-border-color:#e5e5e5;--b3-border-radius:4px;--b3-border-radius-b:8px;--b3-theme-primary:#3578e5;--b3-theme-on-primary:#fff;--b3-theme-error:#d33;--b3-font-size:14px;--b3-font-family:system-ui;--b3-list-hover:#eee}*{box-sizing:border-box}body{margin:0;font-family:system-ui;background:#eceef1;display:flex;gap:24px;height:100vh;padding:24px}#app{flex-shrink:0;width:400px;height:calc(100vh - 48px);border:1px solid #ddd;border-radius:8px;overflow:hidden}#fixtures{flex-shrink:0;width:120px}#fixtures button{display:block;margin:8px 0;padding:6px;width:100%}</style><aside id="fixtures">合成消息测试</aside><div id="app"></div><script src="/icons.js"></script><script src="/preview.js"></script></html>`;
await writeFile('artifacts/output-preview.html',html);
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');let file={'/':'artifacts/output-preview.html','/preview.js':'artifacts/output-preview.js','/style.css':'src/style.css','/host.css':assets+'/stage/build/desktop/base.6ebf9935cf77dd602cbe.css','/icons.js':assets+'/appearance/icons/litheness/icon.js'}[url.pathname];
 if(url.pathname.startsWith('/stage/protyle/js/')&&!url.pathname.includes('..'))file=join(assets,normalize(url.pathname));
 if(!file){res.writeHead(404).end();return;}try{const ext=file.split('.').at(-1);res.setHeader('Content-Type',({js:'text/javascript',css:'text/css',woff2:'font/woff2',woff:'font/woff',ttf:'font/ttf',html:'text/html'})[ext]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
}).listen(16832,'127.0.0.1',()=>console.log('Output preview http://127.0.0.1:16832'));
