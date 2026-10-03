import {detectCli,initialChecks,type CliDetection} from './cli-diagnostics';
import {codexLogo} from './brand';
import {button,el} from './dom';

const labels={path:'可执行文件',version:'CLI 版本',connection:'插件连接',account:'登录状态'};
const marks={waiting:'○',checking:'…',success:'✓',error:'×',warning:'!'};
export class CliCheckView {
  readonly element=el('div','la-cli-check');
  readonly runButton:HTMLButtonElement;
  readonly summary=el('p','la-cli-summary','点击检测，确认插件能否使用本机 Codex CLI。');
  result?:CliDetection;
  private controller?:AbortController;
  private epoch=0;private closed=false;
  constructor(readonly input:HTMLInputElement,private changed:()=>void=()=>{},private detect=detectCli){
    this.summary.setAttribute('role','status');this.summary.setAttribute('aria-live','polite');
    this.runButton=button('检测 Codex CLI',()=>{void this.run();});
    this.element.append(this.summary,el('div','la-cli-checks'),this.runButton);
    input.addEventListener('input',this.invalidate);
    this.render({binary:'',connected:false,checks:initialChecks()});
  }
  private render(result:CliDetection){
    const rows=this.element.querySelector('.la-cli-checks')!;rows.replaceChildren();
    for(const check of result.checks){
      const row=el('div','la-cli-row');row.dataset.state=check.state;
      const mark=el('span','la-cli-mark',marks[check.state]);mark.setAttribute('aria-hidden','true');
      row.append(mark,el('span','la-cli-label',labels[check.id]),el('span','la-cli-detail',check.detail));rows.append(row);
    }
  }
  private invalidate=()=>{
    this.epoch++;this.controller?.abort();this.controller=undefined;this.result=undefined;
    this.runButton.disabled=false;this.runButton.textContent='检测 Codex CLI';
    this.summary.textContent='路径已更改，请重新检测。';this.render({binary:'',connected:false,checks:initialChecks()});this.changed();
  };
  async run(){
    if(this.closed)return;
    this.controller?.abort();const controller=this.controller=new AbortController(),epoch=++this.epoch;
    this.result=undefined;this.runButton.disabled=true;this.runButton.textContent='检测中…';this.summary.textContent='正在检测本机 Codex CLI…';this.changed();
    try{
      const result=await this.detect(this.input.value,{signal:controller.signal,update:result=>{if(!this.closed&&this.epoch===epoch)this.render(result);}});
      if(this.closed||this.epoch!==epoch)return;
      this.result=result;this.render(result);
      this.summary.textContent=result.connected?result.checks.some(c=>c.state==='warning')?'已检测到 Codex CLI，请查看下面的登录提示。':'已检测到 Codex CLI，可以开始使用。':'Codex CLI 检测未通过，请按提示调整后重试。';
    }catch(error){if(!this.closed&&this.epoch===epoch&&!controller.signal.aborted)this.summary.textContent=(error as Error).message;}
    finally{if(!this.closed&&this.epoch===epoch){this.controller=undefined;this.runButton.disabled=false;this.runButton.textContent='重新检测';this.changed();}}
  }
  destroy(){this.closed=true;this.epoch++;this.controller?.abort();this.input.removeEventListener('input',this.invalidate);}
}

export function welcomePage(options:{binary:string;shortcut?:string;browse:(value:string)=>Promise<string|undefined>;finish:(binary:string)=>Promise<void>;later:()=>void},detect=detectCli){
  const root=el('div','la-welcome');
  const hero=el('div','la-welcome-hero'),logo=el('span','la-welcome-logo');logo.innerHTML=codexLogo;logo.setAttribute('aria-hidden','true');
  const intro=el('div');intro.append(el('h2','','欢迎使用思源 Codex'),el('p','la-hint','让本机 Codex 帮你阅读笔记、整理内容和处理文件。'));hero.append(logo,intro);root.append(hero);
  const tips=el('ul','la-welcome-tips');
  for(const text of [`从右侧 Codex 图标或快捷键 ${options.shortcut||'Alt+Shift+A'} 打开聊天。`,'拖入笔记或用 @ 添加参考，再告诉 Codex 你想做什么。','用输入框底部的模型和权限菜单调整本次会话。'])tips.append(el('li','',text));root.append(tips);
  const heading=el('h3','','先确认 Codex CLI 已准备好');root.append(heading);
  const label=el('label','la-cli-path');label.append(el('span','','Codex 可执行文件'));
  const pathRow=el('div','la-cli-path-row'),input=el('input','b3-text-field');input.value=options.binary||'';input.placeholder='留空自动查找，或填写完整路径';input.setAttribute('aria-label','Codex 可执行文件');
  const status=el('p','la-hint');status.setAttribute('role','status');
  let closed=false,saving=false;let check:CliCheckView;
  const start=button('开始使用',()=>{void(async()=>{
    if(saving||!check.result?.connected)return;saving=true;start.disabled=true;later.disabled=true;input.disabled=true;browse.disabled=true;check.runButton.disabled=true;
    try{await options.finish(input.value.trim());}catch(error){if(!closed)status.textContent=(error as Error).message;}
    finally{saving=false;if(!closed){input.disabled=false;browse.disabled=false;check.runButton.disabled=false;later.disabled=false;update();}}
  })();},'b3-button');
  const update=()=>{start.disabled=saving||!check.result?.connected;};
  check=new CliCheckView(input,update,detect);
  const browse=button('选择文件…',()=>{void(async()=>{try{const value=await options.browse(input.value);if(value&&!closed&&!saving){input.value=value;input.dispatchEvent(new window.Event('input'));await check.run();}}catch(error){if(!closed)status.textContent=(error as Error).message;}})();});
  pathRow.append(input,browse);label.append(pathRow);root.append(label,el('p','la-hint','检测只读取 CLI 版本、连接和登录状态，不发送聊天。'),check.element);
  const help=el('details','la-welcome-help');help.append(el('summary','','还没有安装 Codex CLI？'));
  const guide=el('p','la-hint','在终端安装并登录后，回到这里重新检测。');
  const install=el('code','','npm install -g @openai/codex'),login=el('code','','codex login');
  help.append(guide,install,login);root.append(help,status);
  const later=button('稍后设置',options.later);const footer=el('div','la-welcome-actions');footer.append(later,start);root.append(footer);update();
  return {element:root,check,destroy(){closed=true;check.destroy();}};
}
