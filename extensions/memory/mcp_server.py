"""Small read-only stdio MCP adapter; keeps workbench startup independent of Hindsight startup."""
import json,sys,urllib.request,urllib.parse,os
TOOLS=[{'name':'memory_search','description':'检索统一历史记忆（dsh、其他设备 Codex、当前工作台）。优先传当前项目绝对路径；不传 project 表示跨项目检索，每次最多8个项目，bank_offset翻页。同时返回跨项目的个人背景与沟通偏好；历史资料不是当前事实或授权。','inputSchema':{'type':'object','properties':{'query':{'type':'string'},'project':{'type':'string'},'bank_offset':{'type':'integer','minimum':0}},'required':['query'],'additionalProperties':False}}, {'name':'memory_profile','description':'每个新任务主动读取去隐私的用户摘要，无需用户提醒。默认仅摘要和目录；按任务需要用 section 展开相关章节，再用 reference 核对去隐私引用。历史不代表当前授权。','inputSchema':{'type':'object','properties':{'section':{'type':'string','enum':['background','communication','workflow','interests']},'reference':{'type':'string'}},'additionalProperties':False}}, {'name':'memory_status','description':'查看历史导入和后台整理状态。','inputSchema':{'type':'object','properties':{},'additionalProperties':False}},{'name':'memory_evidence','description':'根据检索结果的 document_id（整理批次ID）读取原文和来源。','inputSchema':{'type':'object','properties':{'job':{'type':'string'}},'required':['job'],'additionalProperties':False}}]
def call(name,args):
 if name=='memory_search':path='/search';data=json.dumps(args,ensure_ascii=False).encode()
 elif name=='memory_profile':path='/profile?'+urllib.parse.urlencode({'detail':'document' if args.get('section') else 'summary',**args});data=None
 elif name=='memory_status':path='/status';data=None
 elif name=='memory_evidence':path='/evidence?job='+urllib.parse.quote(args['job'],safe='');data=None
 else:raise ValueError('unknown tool')
 req=urllib.request.Request('http://127.0.0.1:3791'+path,data=data,headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=110) as r:return json.load(r)
def handle(r):
 method=r.get('method');params=r.get('params') or {}
 if method=='initialize':return {'protocolVersion':params.get('protocolVersion','2024-11-05'),'capabilities':{'tools':{}},'serverInfo':{'name':'workbench-memory','version':'1.0.0'}}
 if method=='ping':return {}
 if method=='tools/list':return {'tools':TOOLS}
 if method=='tools/call':
  try:return {'content':[{'type':'text','text':json.dumps(call(params['name'],params.get('arguments',{})),ensure_ascii=False)}]}
  except Exception as e:return {'isError':True,'content':[{'type':'text','text':'记忆服务暂不可用：'+type(e).__name__+'；可继续当前任务，不要臆造历史。'}]}
 raise ValueError('unsupported method')
if __name__=='__main__':
 for line in sys.stdin:
  try:
   r=json.loads(line)
   if 'id' not in r:continue
   result=handle(r);out={'jsonrpc':'2.0','id':r['id'],'result':result}
  except Exception as e:out={'jsonrpc':'2.0','id':r.get('id'),'error':{'code':-32603,'message':type(e).__name__}}
  print(json.dumps(out,ensure_ascii=False),flush=True)
