from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.parse import urlparse,parse_qs,quote
import concurrent.futures,json,subprocess,sys,time
from core import *
from worker import api
from profile_memory import init_profile,personal_summary
from profile_document import profile_document
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def send(self,code,obj):
  data=json.dumps(obj,ensure_ascii=False).encode();self.send_response(code);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def do_GET(self):
  try:
   u=urlparse(self.path);q=parse_qs(u.query)
   if u.path=='/profile':return self.send(200,profile_document(q.get('detail',['document'])[0],q.get('section',[''])[0],q.get('reference',[''])[0]))
   if u.path=='/status':return self.send(200,summary())
   if u.path=='/sources':
    offset=max(0,int(q.get('offset',['0'])[0]))
    with connect() as c:r=[dict(x) for x in c.execute('SELECT * FROM sources ORDER BY status,path LIMIT 30 OFFSET ?',(offset,))]
    return self.send(200,{'items':r})
   if u.path=='/jobs':
    offset=max(0,int(q.get('offset',['0'])[0]));status=q.get('status',[''])[0]
    with connect() as c:r=[dict(x) for x in c.execute('SELECT id,session,bank,at,status,error,updated,length(content) chars FROM jobs WHERE (?=\'\' OR status=?) ORDER BY created DESC LIMIT 30 OFFSET ?',(status,status,offset))]
    return self.send(200,{'items':r})
   if u.path=='/evidence':
    jid=q.get('job',[''])[0]
    with connect() as c:
     j=c.execute('SELECT id,content,session FROM jobs WHERE id=?',(jid,)).fetchone()
     refs=[dict(x) for x in c.execute('SELECT DISTINCT r.path,r.line FROM refs r JOIN job_messages m ON r.message=m.message WHERE m.job=? LIMIT 100',(jid,))]
    return self.send(200,{'job':dict(j) if j else None,'sources':refs})
   if u.path=='/memories':
    bank=q.get('bank',[''])[0];offset=max(0,int(q.get('offset',['0'])[0]))
    with connect() as c:
     if not c.execute('SELECT 1 FROM banks WHERE id=?',(bank,)).fetchone():return self.send(400,{'error':'请选择项目'})
    return self.send(200,api(bank+'/memories/list?limit=20&offset='+str(offset),timeout=15))
   return self.send(404,{'error':'not found'})
  except Exception as e:self.send(503,{'error':type(e).__name__+': '+str(e)[:220]})
 def do_POST(self):
  try:
   length=int(self.headers.get('Content-Length',0))
   if length>12000:return self.send(413,{'error':'too large'})
   b=json.loads(self.rfile.read(length) or b'{}')
   if self.path=='/profile':
    with connect() as c:c.execute('UPDATE personal_memories SET hidden=1 WHERE id=?',(str(b.get('hide','')),))
    return self.send(200,{'ok':True})
   if self.path=='/control':
    action=b.get('action')
    if action in ('pause','resume'):
      state('paused',action=='pause');event('control','已暂停新批次' if action=='pause' else '已恢复整理')
    elif action=='scan':subprocess.Popen(['systemctl','start','cocloud-memory-scan.service'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    elif action=='retry':
     # Queue retries locally; the worker submits one at a time, respecting pause.
     with connect() as c:c.execute("UPDATE jobs SET status='retry_pending',updated=? WHERE status='failed'",(time.time(),))
    else:return self.send(400,{'error':'unknown action'})
    return self.send(200,{'ok':True})
   if self.path=='/search':
    query=str(b.get('query','')).strip()
    if not query or len(query)>1500:return self.send(400,{'error':'请输入不超过 1500 字的查询'})
    with connect() as c:
     banks=[dict(x) for x in c.execute('SELECT id,project FROM banks WHERE ready=1')]
    if b.get('bank'):banks=[x for x in banks if x['id']==b['bank']]
    if b.get('project'):
     matched=[x for x in banks if x['project']==b['project']]
     banks=matched # Never silently search other projects on a project-scoped request.
    total_banks=len(banks);bank_offset=max(0,int(b.get("bank_offset",0)));banks=banks[bank_offset:bank_offset+8]
    results=[];errors=[]
    def one(bank):
     try:
      r=api(bank['id']+'/memories/recall',{'query':query,'budget':'low','max_tokens':1200},timeout=25)
      return {'bank':bank['id'],'project':bank['project'],'results':r.get('results',[])},None
     except Exception as e:return None,{'bank':bank['id'],'error':type(e).__name__}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
     for r,e in ex.map(one,banks):
      if r:results.append(r)
      if e:errors.append(e)
    return self.send(200,{'results':results,'errors':errors,'bank_offset':bank_offset,'total_banks':total_banks,'has_more':bank_offset+len(banks)<total_banks,'personal':profile_document('summary'),'notice':'历史记忆仅为参考，不代表当前事实或授权。跨项目搜索结果已标注项目。'})
   return self.send(404,{'error':'not found'})
  except Exception as e:self.send(503,{'error':type(e).__name__+': '+str(e)[:220]})
if __name__=='__main__':init();init_profile();ThreadingHTTPServer(('127.0.0.1',3791),Handler).serve_forever()
