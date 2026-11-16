import time
import core,worker
import pytest
@pytest.fixture
def queue(tmp_path,monkeypatch):
 monkeypatch.setattr(core,'ROOT',tmp_path);core.init()
 with core.connect() as c:
  c.execute("INSERT INTO banks VALUES('b','project',1)")
  for key,status in [('first','processing'),('second','pending')]:
   c.execute('INSERT INTO jobs(id,bank,content,status,operation,created,updated) VALUES(?,?,?,?,?,?,?)',(key,'b','text',status,key+'-op',time.time(),time.time()))
 return tmp_path

def test_balance_failure_pauses_remaining_queue(queue,monkeypatch):
 calls=[]
 def api(path,*args,**kw):
  calls.append(path);return {'status':'failed','error_message':'Error code: 402 - Insufficient Balance'}
 monkeypatch.setattr(worker,'api',api)
 worker.tick();worker.tick()
 assert core.state('paused') is True
 assert '402' in core.state('modelBlock')['reason']
 assert len(calls)==1
 with core.connect() as c:assert dict(c.execute('select id,status from jobs'))=={'first':'failed','second':'pending'}

def test_retries_keep_identity_and_submit_only_one(queue,monkeypatch):
 with core.connect() as c:c.execute("UPDATE jobs SET status='retry_pending'")
 calls=[]
 def api(path,*args,**kw):
  calls.append(path);return {'status':'processing'}
 monkeypatch.setattr(worker,'api',api)
 worker.tick();worker.tick()
 assert len([p for p in calls if p.endswith('/retry')])==1
 with core.connect() as c:
  rows=list(c.execute('select status,operation,attempts from jobs order by created'))
  assert tuple(rows[0])==('processing','first-op',1)
  assert tuple(rows[1])==('retry_pending','second-op',0)
