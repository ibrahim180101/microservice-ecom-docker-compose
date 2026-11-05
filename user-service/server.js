'use strict';
const express=require('express'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'16kb'}));
const dir=process.env.DATA_DIR||'/app/data';fs.mkdirSync(dir,{recursive:true});
function db(name,seed){const f=path.join(dir,name+'.json');if(!fs.existsSync(f))fs.writeFileSync(f,JSON.stringify(seed));return {get:()=>JSON.parse(fs.readFileSync(f,'utf8')),set:v=>{const tmp=f+'.tmp';fs.writeFileSync(tmp,JSON.stringify(v));fs.renameSync(tmp,f)}}}
const users=db('users',[{id:1,name:'Demo User',email:'demo@example.com'}]),sessions=db('sessions',[]);
const clean=u=>({id:u.id,name:u.name,email:u.email});
const hash=p=>{const salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(p,salt,64).toString('hex')};
function verify(p,h){if(!h)return false;const [salt,digest]=h.split(':');if(!salt||!digest)return false;const a=crypto.scryptSync(p,salt,64),b=Buffer.from(digest,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b)}
const session=q=>{const t=(q.headers.authorization||'').match(/^Bearer ([a-f0-9]{64})$/i)?.[1];if(!t)return null;const h=crypto.createHash('sha256').update(t).digest('hex');const s=sessions.get().find(x=>x.hash===h&&x.expires>Date.now());const u=s&&users.get().find(x=>String(x.id)===String(s.userId)&&x.passwordHash);return u?{user:u,hash:h}:null};
function requireAuth(q,r,next){const s=session(q);if(!s)return r.status(401).json({error:'Login required'});q.user=s.user;q.sessionHash=s.hash;next()}
function issue(u,r){const token=crypto.randomBytes(32).toString('hex');const s=sessions.get().filter(x=>x.expires>Date.now());s.push({hash:crypto.createHash('sha256').update(token).digest('hex'),userId:u.id,expires:Date.now()+24*60*60*1000});sessions.set(s);r.json({token,user:clean(u)})}
app.get('/health',(q,r)=>r.json({status:'ok',service:'user-service'}));
app.post('/api/auth/register',(q,r)=>{const {name,email,password}=q.body||{};if(typeof name!=='string'||name.trim().length<2||name.length>100||typeof email!=='string'||email.length>150||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||typeof password!=='string'||password.length<12||password.length>128)return r.status(400).json({error:'Enter name, valid email, and password of at least 12 characters'});const a=users.get();if(a.some(x=>x.email.toLowerCase()===email.trim().toLowerCase()))return r.status(409).json({error:'Email already registered'});const u={id:crypto.randomUUID(),name:name.trim(),email:email.trim().toLowerCase(),passwordHash:hash(password)};a.push(u);users.set(a);issue(u,r)});
app.post('/api/auth/login',(q,r)=>{const {email,password}=q.body||{};if(typeof email!=='string'||typeof password!=='string')return r.status(401).json({error:'Invalid credentials'});const u=users.get().find(x=>x.email.toLowerCase()===email.trim().toLowerCase());if(!u||!verify(password,u.passwordHash))return r.status(401).json({error:'Invalid credentials'});issue(u,r)});
app.get('/api/auth/me',requireAuth,(q,r)=>r.json(clean(q.user)));
app.post('/api/auth/logout',requireAuth,(q,r)=>{sessions.set(sessions.get().filter(s=>s.hash!==q.sessionHash));r.json({ok:true})});
app.get('/api/users',requireAuth,(q,r)=>r.json([clean(q.user)]));
app.get('/api/users/:id',requireAuth,(q,r)=>String(q.user.id)===q.params.id?r.json(clean(q.user)):r.status(403).json({error:'Forbidden'}));
app.patch('/api/users/:id',requireAuth,(q,r)=>{if(String(q.user.id)!==q.params.id)return r.status(403).json({error:'Forbidden'});const {name}=q.body||{};if(typeof name!=='string'||name.trim().length<2||name.length>100)return r.status(400).json({error:'Valid name required'});const a=users.get(),u=a.find(x=>String(x.id)===q.params.id);u.name=name.trim();users.set(a);r.json(clean(u))});
app.use(express.static(path.join(__dirname,'public')));app.listen(3000,'0.0.0.0');
