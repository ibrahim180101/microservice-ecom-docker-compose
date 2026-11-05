'use strict';
const express=require('express');const {Pool}=require('pg');
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'16kb'}));
const pool=new Pool({max:5,connectionTimeoutMillis:5000});
const seed=[{id:1,name:'Studio Wireless Headphones',price:3499},{id:2,name:'Minimal Everyday Backpack',price:2199},{id:3,name:'Smart Fitness Watch',price:5299},{id:4,name:'Portable Bluetooth Speaker',price:2799},{id:5,name:'Ceramic Coffee Set',price:1599},{id:6,name:'Desk Ambient Light',price:1899},{id:7,name:'Premium Mechanical Keyboard',price:4599},{id:8,name:'Classic Sunglasses',price:1299}];
async function init(){await pool.query('CREATE TABLE IF NOT EXISTS products (id integer PRIMARY KEY, name text NOT NULL, price integer NOT NULL CHECK (price >= 0))');for(const p of seed)await pool.query('INSERT INTO products(id,name,price) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[p.id,p.name,p.price])}
const wrap=fn=>(q,r)=>Promise.resolve(fn(q,r)).catch(e=>{console.error(e);r.status(503).json({error:'Database unavailable'})});
app.get('/health',wrap(async(q,r)=>{await pool.query('SELECT 1');r.json({status:'ok',service:'product-service'})}));
app.get('/api/products',wrap(async(q,r)=>r.json((await pool.query('SELECT id,name,price FROM products ORDER BY id')).rows)));
app.get('/api/products/:id',wrap(async(q,r)=>{const x=(await pool.query('SELECT id,name,price FROM products WHERE id=$1',[Number(q.params.id)||0])).rows[0];r.status(x?200:404).json(x||{error:'Not found'})}));
app.use(express.static(require('path').join(__dirname,'public')));
init().then(()=>app.listen(3000,'0.0.0.0')).catch(e=>{console.error('Database initialization failed',e);process.exit(1)});
