import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {detectCli} from '../src/cli-diagnostics';

const dir=mkdtempSync(join(tmpdir(),'codex-detection-'));after(()=>rmSync(dir,{recursive:true,force:true}));
let seq=0;
function fixture(options:{version?:string;versionHang?:boolean;handshakeHang?:boolean;account?:unknown;accountError?:boolean}={}){
  const file=join(dir,`检测 codex ${++seq}.cjs`),log=file+'.log';
  writeFileSync(file,`#!/usr/bin/env node
    const fs=require('node:fs'),readline=require('node:readline');
    if(process.argv.includes('--version')){${options.versionHang?'setInterval(()=>{},1000);':`console.log(${JSON.stringify(options.version??'codex-cli 0.159.0')});`} }
    else readline.createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},m.method+'\\n');if(m.id===undefined)return;
      if(m.method==='initialize'&&${!!options.handshakeHang})return;
      const account=${JSON.stringify(options.account??{account:{type:'chatgpt'},requiresOpenaiAuth:true})};
      process.stdout.write(JSON.stringify({id:m.id,...(m.method==='account/read'&&${!!options.accountError}?{error:{code:-32601,message:'Unsupported method'}}:{result:m.method==='account/read'?account:{ok:true}})})+'\\n');
    });`,{mode:0o755});
  return{file,log};
}
test('detection confirms the actual Codex version and handshake without opening a thread',async()=>{
  const {file,log}=fixture(),updates:string[]=[];
  const result=await detectCli(file,{update:r=>updates.push(r.checks.find(c=>c.state==='checking')?.id||'')});
  assert.equal(result.connected,true);assert.equal(result.binary,file);assert.equal(result.checks[1].detail,'0.159.0');assert.ok(result.checks.every(c=>c.state==='success'));
  assert.deepEqual(readFileSync(log,'utf8').trim().split('\n'),['initialize','initialized','account/read']);assert.ok(updates.includes('connection'));
});
test('missing paths and directories fail before any connection check',async()=>{
  for(const path of [join(dir,'missing'),dir]){const result=await detectCli(path);assert.equal(result.connected,false);assert.equal(result.checks[0].state,'error');assert.equal(result.checks[2].detail,'未检测');}
});
test('another executable cannot be mistaken for Codex merely because it exists',async()=>{
  const {file,log}=fixture({version:'node v24.0.0'}),result=await detectCli(file);
  assert.equal(result.connected,false);assert.equal(result.checks[1].state,'error');assert.equal(existsSync(log),false);
});
test('version and handshake timeouts show the failed stage',async()=>{
  for(const options of [{versionHang:true},{handshakeHang:true}]){
    const {file}=fixture(options),result=await detectCli(file,{timeout:300});assert.equal(result.connected,false);
    const error=result.checks.find(c=>c.state==='error')!;assert.equal(error.id,options.versionHang?'version':'connection');assert.match(error.detail,/超时/);
  }
});
test('login warnings are distinct from successful CLI discovery and custom provider auth',async()=>{
  const {file}=fixture({account:{account:null,requiresOpenaiAuth:true}}),result=await detectCli(file);
  assert.equal(result.connected,true);assert.equal(result.checks[3].state,'warning');assert.match(result.checks[3].detail,/codex login/);
  const custom=await detectCli(fixture({account:{account:null,requiresOpenaiAuth:false}}).file);assert.equal(custom.checks[3].state,'success');
  const unsupported=await detectCli(fixture({accountError:true}).file);assert.equal(unsupported.connected,true);assert.equal(unsupported.checks[3].state,'warning');assert.match(unsupported.checks[3].detail,/未确认/);
});
test('cancelling an active check stops it without publishing a late success',async()=>{
  const {file}=fixture({handshakeHang:true}),controller=new AbortController();let cancel=false;
  await assert.rejects(detectCli(file,{signal:controller.signal,update:r=>{if(r.checks[2].state==='checking'){cancel=true;controller.abort();}}}),/取消/);assert.equal(cancel,true);
});
