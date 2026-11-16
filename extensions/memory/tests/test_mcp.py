import pathlib,sys,json,subprocess
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from mcp_server import handle
def test_tools_read_only():
 result=handle({'method':'tools/list'})
 assert [x['name'] for x in result['tools']]==['memory_search','memory_profile','memory_status','memory_evidence']
def test_stdio_handshake():
 p=subprocess.run([sys.executable,str(pathlib.Path(__file__).resolve().parents[1]/'mcp_server.py')],input=json.dumps({'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05'}})+'\n',text=True,capture_output=True,check=True)
 assert json.loads(p.stdout)['result']['capabilities']=={'tools':{}}
