function cocloudGithubStatus(state,error){
 if(error)return {label:'状态不可用',detail:error,status:'offline'};
 if(!state)return {label:'检查中…',detail:'正在读取 GitHub 状态',status:'unknown'};
 if(!state.installed)return {label:'未安装',detail:'服务器未安装 GitHub CLI',status:'offline'};
 if(state.login?.state==='pending')return {label:'待授权',detail:'等待 GitHub 网页授权',status:'unknown'};
 if(!state.authenticated)return {label:'未登录',detail:'请登录 GitHub',status:'offline'};
 if(state.connected===false)return {label:'连接失败',detail:state.message||'请重新检测',status:'offline'};
 if(state.connected===true)return {label:'已连接',detail:state.account?'@'+state.account:'连接正常',status:'online'};
 return {label:'已配置登录',detail:'尚未检测连接',status:'unknown'};
}
function CocloudGithubEntry({connection}){
 const h=X.createElement,[busy,setBusy]=X.useState(false),[error,setError]=X.useState('');
 const state=connection.state,view=cocloudGithubStatus(state,connection.error),login=state?.login;
 const alive=X.useRef(true);
 X.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function action(name){
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/cocloud/proxy/github/'+name,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Cocloud-Proxy':'1'},body:'{}',signal:AbortSignal.timeout(name==='check'?55000:30000)});
   const value=await response.json();if(!response.ok)throw Error(value.error||'GitHub 操作失败');
   if(alive.current){connection.setError('');connection.setState(value);}
  }catch(cause){if(alive.current)setError(cause.name==='TimeoutError'?'操作超时，请重新展开确认状态':cause.message||'GitHub 操作失败');}
  finally{if(alive.current)setBusy(false);}
 }
 const button='min-h-9 rounded-md border border-sidebar-border px-2 text-xs disabled:opacity-50';
 return h('section',{'data-workbench-github':true,className:'min-w-0 text-xs'},
  h('h3',{className:'flex min-h-9 items-center font-medium'},'GitHub'),
  h('p',{role:'status',className:'break-words'},view.label+' · '+view.detail),
  state?.checkedAt?h('p',{className:'text-muted-foreground'},'检测时间：'+new Date(state.checkedAt).toLocaleTimeString()):null,
  state?.temporaryProxy?h('p',{role:'status'},'GitHub 正在临时使用代理，结束后自动恢复'):null,
  h('p',{className:'text-muted-foreground'},'登录和连接检测按需临时启用代理，结束后自动关闭；原先已开启则保持开启。'),
  login?.state==='pending'?h('div',{className:'flex flex-col gap-2'},
   login.code?h('p',null,'验证码：',h('code',{className:'select-all font-mono'},login.code)):null,
   login.verificationUrl==='https://github.com/login/device'?h('a',{href:login.verificationUrl,target:'_blank',rel:'noopener noreferrer',className:button},'打开 GitHub 授权'):null,
   h('p',null,login.message||'正在准备登录…'),
   state.canControl?h('button',{type:'button',className:button,disabled:busy,onClick:()=>action('cancel')},'取消 GitHub 登录'):null):
   h('div',{className:'flex flex-wrap gap-2'},
    h('button',{type:'button',className:button,disabled:busy||!state?.installed||!state?.canControl||state?.busy,onClick:()=>action('login')},state?.authenticated?'重新登录 GitHub':'登录 GitHub'),
    h('button',{type:'button',className:button,disabled:busy||!state?.installed||!state?.canControl||state?.busy,onClick:()=>action('check')},'检测 GitHub 连接')),
  login&&login.state!=='pending'?h('p',{role:'status'},login.message):null,
  state&&!state.canControl?h('p',null,'当前会话只有查看权限'):null,
  busy?h('p',{role:'status'},'正在处理 GitHub 操作…'):null,
  error||connection.error?h('p',{role:'alert'},error||connection.error):null);
}
