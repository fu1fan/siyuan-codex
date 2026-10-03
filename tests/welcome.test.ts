import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import {JSDOM} from 'jsdom';
import {CliCheckView,welcomePage} from '../src/welcome';
import {initialChecks,type CliDetection} from '../src/cli-diagnostics';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const detected=(connected=true):CliDetection=>({binary:'/test/codex',connected,checks:initialChecks().map(check=>({...check,state:connected?'success':'error',detail:connected?'检测成功':'检测失败'}))});
function setup(){const dom=new JSDOM('<main></main>');Object.assign(globalThis,{window:dom.window,document:dom.window.document});return dom;}
test('welcome starts disabled, lets users select and test a path, and saves only on start',async()=>{
  const dom=setup();let saved='',calls:string[]=[];
  const page=welcomePage({binary:'',browse:async()=>'/test/codex',finish:async binary=>{saved=binary;},later:()=>{}},async value=>{calls.push(value);return detected();});
  try{
    document.body.append(page.element);const buttons=()=>[...page.element.querySelectorAll('button')];const start=buttons().find(b=>b.textContent==='开始使用')!;
    assert.equal(start.disabled,true);buttons().find(b=>b.textContent==='选择文件…')!.click();await tick();
    assert.deepEqual(calls,['/test/codex']);assert.equal(start.disabled,false);assert.equal(saved,'');start.click();await tick();assert.equal(saved,'/test/codex');
    const input=page.element.querySelector('input')!;input.value='/other/codex';input.dispatchEvent(new window.Event('input'));assert.equal(start.disabled,true);assert.match(page.check.summary.textContent!,/重新检测/);
  }finally{page.destroy();dom.window.close();}
});
test('failed checks stay retryable and later does not save a CLI path',async()=>{
  const dom=setup();let saved=false,later=false,pass=false;
  const page=welcomePage({binary:'',browse:async()=>undefined,finish:async()=>{saved=true;},later:()=>{later=true;}},async()=>detected(pass));
  try{
    document.body.append(page.element);await page.check.run();const start=[...page.element.querySelectorAll('button')].find(b=>b.textContent==='开始使用')!;assert.equal(start.disabled,true);
    pass=true;await page.check.run();assert.equal(start.disabled,false);[...page.element.querySelectorAll('button')].find(b=>b.textContent==='稍后设置')!.click();assert.equal(later,true);assert.equal(saved,false);
  }finally{page.destroy();dom.window.close();}
});
test('editing a path or closing the view aborts detection and ignores stale results',async()=>{
  const dom=setup();const input=document.createElement('input');let resolve!:(r:CliDetection)=>void,signal:AbortSignal|undefined;
  const check=new CliCheckView(input,()=>{},async(_value,options)=>{signal=options?.signal;return new Promise(r=>resolve=r);});
  try{
    const pending=check.run();input.value='/new';input.dispatchEvent(new window.Event('input'));assert.equal(signal!.aborted,true);resolve(detected());await pending;assert.equal(check.result,undefined);assert.match(check.summary.textContent!,/重新检测/);
    const closed=check.run();check.destroy();assert.equal(signal!.aborted,true);resolve(detected());await closed;assert.equal(check.result,undefined);
  }finally{check.destroy();dom.window.close();}
});
