// Accounting must never take down the authenticated UI when SQLite is busy.
export function createUsageWriter(db,getStats){
 let timer=null;
 const write=()=>{
  try{db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run('usage',JSON.stringify({...getStats(),at:Date.now()/1000}));return true}
  catch{if(!timer){timer=setTimeout(()=>{timer=null;write()},1000);timer.unref?.()}return false}
 };
 return write;
}
