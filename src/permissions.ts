export type PermissionMode='ask'|'auto'|'full';
export const permissionModes=[
  {value:'ask',label:'请求批准',description:'工作目录内可编辑；目录外写入和联网时请求你批准。'},
  {value:'auto',label:'帮我批准',description:'由 Codex 自动审查审批请求；需要你介入时再询问。'},
  {value:'full',label:'完全访问权限',description:'不受文件沙箱和联网限制，执行操作不再请求批准。'},
] as const;
export function permissionOptions(s:{permissionMode?:PermissionMode|'';sandbox:'read-only'|'workspace-write'}){
  switch(s.permissionMode){
    case 'ask':return {sandbox:'workspace-write',approvalPolicy:'on-request',approvalsReviewer:'user'} as const;
    case 'auto':return {sandbox:'workspace-write',approvalPolicy:'on-request',approvalsReviewer:'auto_review'} as const;
    case 'full':return {sandbox:'danger-full-access',approvalPolicy:'never',approvalsReviewer:'user'} as const;
    default:return {sandbox:s.sandbox,approvalPolicy:'on-request',approvalsReviewer:'user'} as const;
  }
}
export function permissionLabel(s:{permissionMode?:PermissionMode|'';sandbox:'read-only'|'workspace-write'}){
  return permissionModes.find(m=>m.value===s.permissionMode)?.label||(s.sandbox==='workspace-write'?'请求批准':'请求批准 · 只读');
}
export function permissionIcon(mode:PermissionMode|''|undefined){
 const paths=mode==='full'?'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="M12 8v5m0 3h.01"/>':mode==='auto'?'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 9 3 3-3 3m5 0h3"/>':'<path d="M8 12V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-3a1.5 1.5 0 0 1 3 0v5c0 5-3 7-7 7-3 0-5-2-7-5l-3-4a1.5 1.5 0 0 1 2-2l3 2Z"/>';
 return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
