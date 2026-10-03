import {execFile,type ChildProcess} from 'node:child_process';
import {win32} from 'node:path';
import {environmentValue} from './platform';

/** Windows signals stop only the launcher. taskkill /T also stops its CLI/tools. */
export function stopProcessTree(child:ChildProcess,platform:NodeJS.Platform=process.platform,env=process.env,execute=execFile,signalProcess=process.kill){
  const kill=(signal:NodeJS.Signals)=>{
    try{if(platform!=='win32'&&child.pid)signalProcess(-child.pid,signal);else child.kill(signal);}catch{try{child.kill(signal);}catch{}}
  };
  if(platform==='win32'&&child.pid){
    const root=environmentValue(env,'SystemRoot',platform),command=root?win32.join(root,'System32','taskkill.exe'):'taskkill.exe';
    try{execute(command,['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:5000},error=>{if(error)kill('SIGKILL');});}catch{kill('SIGKILL');}
    return;
  }
  kill('SIGTERM');
  // Also reap a surviving descendant when the group leader has already exited.
  const timer=setTimeout(()=>kill('SIGKILL'),1500);
  if(typeof timer==='object'&&typeof timer.unref==='function')timer.unref();
}
