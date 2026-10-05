// Read installed SiYuan renderer modules and resources without modifying the app.
// Browser integration evidence, not a native desktop/plugin-install acceptance test.
import {build} from 'esbuild';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=process.env.SIYUAN_RESOURCE_DIR||'/Applications/SiYuan.app/Contents/Resources';
const desktop=join(root,'stage/build/desktop');
const files=await readdir(desktop);
const main=await readFile(join(desktop,files.find(file=>/^main\..*\.js$/.test(file))),'utf8');
// These IDs belong to the installed build; fail explicitly if its module structure changes.
function moduleSource(id){
 const start=main.indexOf(`${id}(Bt,Qe,e){`);assert.ok(start>=0,`Host module ${id} not found`);
 const next=main.slice(start).search(/},\d+\(Bt,Qe,e\)/);assert.ok(next>0);
 return main.slice(start,start+next+1);
}
const modules=[moduleSource(8085),moduleSource(7441)].join(',');
const source='class User:\n    def __init__(self, name, age):\n        self.name = name\n        self.age = age\n\n    @classmethod\n    def from_dict(cls, data):\n        return cls(data["name"], data["age"])\n\n# 从字典创建：无需先有一个 User 对象\nu2 = User.from_dict({"name": "小红", "age": 22})\nprint(u2.name)';
await mkdir('artifacts',{recursive:true});
const bundle=await build({stdin:{contents:`import {renderMarkdown,enhanceMarkdown,setMarkdownHighlighter} from './src/render';import {ComposerPopover,effortPanel} from './src/popover';Object.assign(window,{renderMarkdown,enhanceMarkdown,setMarkdownHighlighter,ComposerPopover,effortPanel});`,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false});
const browser=await chromium.launch({headless:true});const results=[];
try{
 const page=await browser.newPage({viewport:{width:940,height:850}});
 await page.route('http://localhost/**',async route=>{
  const path=decodeURIComponent(new URL(route.request().url()).pathname);
  if(path==='/'){await route.fulfill({body:'<!doctype html><html></html>',contentType:'text/html'});return;}
  const file=resolve(root,'.'+path);assert.ok(file.startsWith(root+'/'));
  try{await route.fulfill({body:await readFile(file),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream'});}catch{await route.abort();}
 });
 await page.goto('http://localhost/');
 await page.setContent('<html><head></head><body><div class="la-panel" style="width:460px;margin:24px;padding:16px"><div class="la-body b3-typography"></div><button id="anchor" class="b3-button">思考强度</button></div></body></html>');
 await page.addStyleTag({url:'/stage/build/desktop/'+files.find(file=>/^base\..*\.css$/.test(file))});
 await page.addStyleTag({content:await readFile('src/style.css','utf8')});
 // The desktop initializes these font variables at runtime, outside theme.css.
 await page.addStyleTag({content:':root{--b3-font-family:system-ui;--b3-font-family-emoji-reset:"Apple Color Emoji";--b3-font-family-code:"SFMono-Regular",Consolas,monospace}body{background:var(--b3-theme-background)}'});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.addScriptTag({content:`
 const modules={${modules}}, cache={};
 const constants={PROTYLE_CDN:'/stage/protyle',SIYUAN_CONFIG_APPEARANCE_LIGHT_CODE:['default','github'],SIYUAN_CONFIG_APPEARANCE_DARK_CODE:['github-dark','monokai']};
 const deps={1145:{Constants:constants},8182:{},6674:{},3462:{},2321:{T:(url,id)=>{const link=document.createElement('link');link.id=id;link.rel='stylesheet';link.href=url;document.head.append(link);}},9353:{Z:(url,id)=>{if(document.getElementById(id))return Promise.resolve();return new Promise((resolve,reject)=>{const script=document.createElement('script');script.id=id;script.src=url;script.onload=resolve;script.onerror=reject;document.head.append(script);});}}};
 function require(id){if(deps[id])return deps[id];if(cache[id])return cache[id];const exports={};cache[id]=exports;modules[id]({},exports,require);return exports;}
 require.d=(exports,getters)=>{for(const [name,get] of Object.entries(getters))Object.defineProperty(exports,name,{get});};
 window.hostHighlight=require(8085).$;window.hostCodeTheme=require(7441).h$;
 window.siyuan={config:{appearance:{mode:0,codeBlockThemeLight:'default',codeBlockThemeDark:'github-dark'},editor:{codeLineWrap:false,codeLigatures:false,codeSyntaxHighlightLineNum:false}},languages:{copy:'复制',more:'更多'}};
 window.setMarkdownHighlighter(window.hostHighlight);
 Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text)=>{window.copied=text;}}});
 `});
 await page.evaluate(source=>{
  window.renderMarkdown(document.querySelector('.la-body'),'`@classmethod` 是 Python 的**类方法**。\n\n```python\n'+source+'\n```\n\n```python\nprint("'+'long line '.repeat(30)+'")\n```');
  window.pop=new window.ComposerPopover(document.querySelector('#anchor'),'模型设置');
  window.effortPanel(window.pop,{model:'test',displayName:'主题预览',supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort}))},'medium',async value=>{window.savedEffort=value;},()=>{});
  window.pop.element.style.left='560px';window.pop.element.style.top='80px';
 },source);
 let themeElement;
 for(const [mode,theme,palette] of [['light','daylight','default'],['light','daylight','github'],['dark','midnight','github-dark'],['dark','midnight','monokai']]){
  if(themeElement)await themeElement.evaluate(node=>node.remove());
  themeElement=await page.addStyleTag({url:`/appearance/themes/${theme}/theme.css`});
  await page.evaluate(async({mode,palette})=>{
   document.documentElement.dataset.themeMode=mode;
   const appearance=window.siyuan.config.appearance;appearance.mode=mode==='dark'?1:0;
   appearance[mode==='dark'?'codeBlockThemeDark':'codeBlockThemeLight']=palette;
   await window.enhanceMarkdown(document.querySelector('.la-body'));window.hostCodeTheme();
  },{mode,palette});
  await page.waitForFunction(()=>document.querySelector('.hljs-keyword')&&document.getElementById('protyleHljsStyle')?.sheet);
  const state=await page.evaluate(()=>{
   const body=document.querySelector('.la-body'),code=body.querySelector('pre code'),pre=code.parentElement,keyword=code.querySelector('.hljs-keyword');
   return {codeColor:getComputedStyle(code).color,keywordColor:getComputedStyle(keyword).color,stringColor:getComputedStyle(code.querySelector(".hljs-string")).color,background:getComputedStyle(code).backgroundColor,bodyWidth:body.clientWidth,scrollWidth:body.scrollWidth,overflow:getComputedStyle(pre).overflowX,theme:document.getElementById('protyleHljsStyle').href};
  });
  assert.notEqual(state.codeColor,state.stringColor);assert.equal(state.background,'rgba(0, 0, 0, 0)');assert.ok(state.scrollWidth<=state.bodyWidth+1);assert.equal(state.overflow,'auto');assert.ok(state.theme.includes(palette+'.min.css'));
  await page.locator('.la-code-copy').first().evaluate(button=>button.click());assert.equal(await page.evaluate(()=>window.copied),source);
  await page.screenshot({path:`artifacts/highlight-${mode}-${palette}.png`});results.push({mode,palette,...state});
 }
 assert.notEqual(results[0].keywordColor,results[1].keywordColor);assert.notEqual(results[2].keywordColor,results[3].keywordColor);
 await page.locator('.b3-slider').fill('2');await page.locator('.b3-slider').dispatchEvent('change');assert.equal(await page.evaluate(()=>window.savedEffort),'high');
 // Streaming replaces the source node; the host must tokenize the new content too.
 await page.evaluate(async()=>{window.renderMarkdown(document.querySelector('.la-body'),'```py\ndef streaming(x):\n    return "partial',true);await window.enhanceMarkdown(document.querySelector('.la-body'));});
 await page.waitForFunction(()=>document.querySelector('pre code .hljs-keyword'));
 assert.match(await page.locator('pre code').textContent(),/streaming/);
 await writeFile('artifacts/native-ui-preview.json',JSON.stringify({hostMain:files.find(file=>/^main\..*\.js$/.test(file)),results,copyExact:true,streaming:true,sliderSave:true},null,2));
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
