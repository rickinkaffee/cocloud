"""Explicit model configuration; no account or service-file discovery."""
import os

def connection():
 base=os.environ.get('MEMORY_MODEL_BASE_URL','').rstrip('/')
 key=os.environ.get('MEMORY_MODEL_API_KEY','')
 if not base or not key:raise ValueError('Set MEMORY_MODEL_BASE_URL and MEMORY_MODEL_API_KEY')
 return {'baseUrl':base,'apiKey':key}

def catalogue():
 model=os.environ.get('MEMORY_MODEL_ID','')
 if not model:raise ValueError('Set MEMORY_MODEL_ID')
 return {'models':[{'id':model,'label':model,'provider':'configured'}],'provider':'configured','providerLabel':'Configured model'}

if __name__=='__main__':
 import sys,json
 print(json.dumps(connection() if '--connection' in sys.argv else catalogue()))
