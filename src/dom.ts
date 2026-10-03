export function el<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text=''){const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;}
export function setButtonHint(b:HTMLButtonElement,label:string){b.setAttribute('aria-label',label);if(b.dataset.hintHidden==='true')b.dataset.savedHint=label;else b.title=label;}
export function button(text:string,fn:()=>void,cls='b3-button b3-button--outline'){
  const b=el('button',cls,text);b.type='button';
  const hide=()=>{
    const hint=b.title||b.getAttribute('aria-label')||'';
    if(b.dataset.hintHidden!=='true'){b.dataset.savedHint=b.title;b.dataset.hadAriaLabel=String(b.classList.contains('ariaLabel'));}
    b.dataset.hintHidden='true';b.removeAttribute('title');b.classList.remove('ariaLabel');
    const tooltip=document.getElementById('tooltip');if(hint&&tooltip?.textContent?.trim()===hint)tooltip.classList.add('fn__none');
  };
  const restore=()=>{if(b.matches('[aria-expanded="true"]')||b.closest('.la-model-group')?.querySelector('[aria-expanded="true"]'))return;if(b.dataset.hintHidden==='true'){b.title=b.dataset.savedHint||'';if(b.dataset.hadAriaLabel==='true')b.classList.add('ariaLabel');delete b.dataset.hintHidden;}};
  const hideGroup=()=>{const group=b.closest('.la-model-group');if(group)group.querySelectorAll('button').forEach(item=>item.dispatchEvent(new window.Event('la-hide-hint')));else hide();};
  b.addEventListener('la-hide-hint',hide);b.addEventListener('pointerdown',hideGroup);b.addEventListener('pointerleave',restore);b.addEventListener('pointerenter',restore);
  b.onclick=()=>{hideGroup();fn();};return b;
}
export function iconButton(label:string,icon:string,fn:()=>void,cls='block__icon'){const b=button('',fn,cls+' ariaLabel');setButtonHint(b,label);b.innerHTML=`<svg aria-hidden="true"><use href="#${icon}"></use></svg>`;return b;}
