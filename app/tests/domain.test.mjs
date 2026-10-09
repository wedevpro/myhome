import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../lib/model.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {getElectricity,upcomingWaste,audit}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
test('Heures creuses : plage traversant minuit et jour de début',()=>{
 const rules=[audit('e','electricity',{start:'22:00',end:'06:00',days:[1]})];
 assert.equal(getElectricity(rules,new Date('2026-10-05T21:00:00Z')).offPeak,true);
 assert.equal(getElectricity(rules,new Date('2026-10-06T03:59:00Z')).offPeak,true);
 assert.equal(getElectricity(rules,new Date('2026-10-06T04:00:00Z')).offPeak,false);
 assert.equal(getElectricity(rules,new Date('2026-10-04T21:00:00Z')).offPeak,false);
});
test('Heures creuses : heure locale lors du changement hiver',()=>{
 const rules=[audit('e','electricity',{start:'01:00',end:'04:00',days:[0]})];
 assert.equal(getElectricity(rules,new Date('2026-10-25T00:30:00Z')).offPeak,true);
 assert.equal(getElectricity(rules,new Date('2026-10-25T01:30:00Z')).offPeak,true);
});
test('Poubelles : aujourd’hui, quinzaine et fuseau Paris',()=>{
 const rule=audit('w','waste',{weekday:5,frequency:2,anchorDate:'2026-10-02',reminder:'19:00'});
 assert.equal(upcomingWaste([rule],new Date('2026-10-09T10:00:00Z'))[0].days,7);
 assert.equal(upcomingWaste([rule],new Date('2026-10-16T10:00:00Z'))[0].days,0);
 const daily=audit('w2','waste',{weekday:6,frequency:1,reminder:'19:00'});
 assert.equal(upcomingWaste([daily],new Date('2026-10-09T22:30:00Z'))[0].days,0);
});
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const file of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const a=['admin','now','admin','now'];
 db.prepare('INSERT INTO users(id,name,email,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)').run('admin','Admin','a@example.fr',...a);
 db.prepare('INSERT INTO users(id,name,email,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)').run('member','Member','m@example.fr',...a);
 for(const h of ['h1','h2']){db.prepare('INSERT INTO households(id,name,code,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)').run(h,h,h,...a);db.prepare('INSERT INTO memberships(household_id,user_id,role,status,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(h,'admin','admin','active',...a);}
 db.prepare('INSERT INTO memberships(household_id,user_id,role,status,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('h1','member','member','active',...a);
 const add=(id,kind,data,h='h1',actor='admin')=>db.prepare('INSERT INTO records(id,household_id,kind,data,revision,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,h,kind,JSON.stringify(data),'r0',actor,'now',actor,'now');
 return {db,add};
}
test('Migrations : isolation foyer et refus des références orphelines',()=>{
 const {db,add}=fixture();add('list','shopping',{name:'Courses'});
 assert.throws(()=>add('bad','item',{name:'A',listId:'list'},'h2'),/MYHOME_REFERENCE/);
 assert.throws(()=>add('bad2','item',{name:'A',listId:'deleted'}),/MYHOME_REFERENCE/);
 add('good','item',{name:'B',listId:'list'});
 assert.throws(()=>db.prepare('DELETE FROM records WHERE id=?').run('list'),/MYHOME_REFERENCE/);
 db.close();
});
test('Catégories : protection atomique contre les cycles',()=>{
 const {db,add}=fixture();add('a','category',{name:'A'});add('b','category',{name:'B',parentId:'a'});
 assert.throws(()=>db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({name:'A',parentId:'b'}),'a'),/MYHOME_CYCLE/);
 assert.equal(JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get('a').data).parentId,undefined);db.close();
});
test('Administration : un membre ne peut pas modifier les horaires ni promouvoir un utilisateur',()=>{
 const {db,add}=fixture();assert.throws(()=>add('e','electricity',{name:'Nuit',start:'22:00',end:'06:00'},'h1','member'),/MYHOME_REFERENCE/);
 assert.throws(()=>db.prepare("UPDATE memberships SET role='admin',updated_by='member' WHERE household_id='h1' AND user_id='member'").run(),/MYHOME_REFERENCE/);db.close();
});
test('Codes-barres : unicité par foyer et plusieurs codes sur un produit',()=>{
 const {db,add}=fixture();add('p1','product',{name:'Lait'});add('p2','product',{name:'Pain'});
 const insert=db.prepare('INSERT INTO barcodes(household_id,code,product_id,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)');
 insert.run('h1','001234','p1','admin','now','admin','now');insert.run('h1','009999','p1','admin','now','admin','now');
 assert.throws(()=>insert.run('h1','001234','p2','admin','now','admin','now'),/UNIQUE/);
 assert.equal(db.prepare('SELECT COUNT(*) AS count FROM barcodes WHERE product_id=?').get('p1').count,2);db.close();
});
