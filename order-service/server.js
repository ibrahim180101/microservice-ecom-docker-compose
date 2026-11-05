'use strict';
const express=require('express'),path=require('path'),crypto=require('crypto'),{Pool}=require('pg');
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'32kb'}));
const pool=new Pool({max:5,connectionTimeoutMillis:5000});
async function init(){await pool.query('CREATE TABLE IF NOT EXISTS orders(id uuid PRIMARY KEY,user_id uuid NOT NULL,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT NOW())');await pool.query('CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id,created_at DESC)')}
async function read(userId){return (await pool.query('SELECT record FROM orders WHERE user_id=$1 ORDER BY created_at DESC',[userId])).rows.map(x=>x.record)}
async function save(o){await pool.query('INSERT INTO orders(id,user_id,record) VALUES($1,$2,$3)',[o.id,o.userId,JSON.stringify(o)])}
async function update(o){await pool.query('UPDATE orders SET record=$1 WHERE id=$2 AND user_id=$3',[JSON.stringify(o),o.id,o.userId])}
const wrap=fn=>(q,r,n)=>Promise.resolve(fn(q,r,n)).catch(e=>{console.error(e);if(!r.headersSent)r.status(503).json({error:'Service or database unavailable'})});
const publicOrder=o=>({id:o.id,items:o.items,total:o.total,status:o.status,paymentMethod:o.paymentMethod,paymentStatus:o.paymentStatus,createdAt:o.createdAt});
const validCustomer=c=>c&&typeof c.name==='string'&&c.name.trim().length>=2&&c.name.length<=100&&typeof c.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)&&c.email.length<=150&&typeof c.phone==='string'&&/^[0-9]{10}$/.test(c.phone)&&typeof c.address==='string'&&c.address.trim().length>=10&&c.address.length<=400&&typeof c.city==='string'&&c.city.trim().length>=2&&c.city.length<=100&&typeof c.state==='string'&&c.state.trim().length>=2&&c.state.length<=100&&typeof c.pincode==='string'&&/^[1-9][0-9]{5}$/.test(c.pincode);
const key=process.env.RAZORPAY_KEY_ID,secret=process.env.RAZORPAY_KEY_SECRET;
app.get('/health',wrap(async(q,r)=>{await pool.query('SELECT 1');r.json({status:'ok',service:'order-service'})}));
app.get('/api/checkout/config',(q,r)=>r.json({onlinePaymentsEnabled:!!(key&&secret),currency:'INR'}));
async function requireUser(q,r,next){const token=q.headers.authorization;if(!token)return r.status(401).json({error:'Login required'});try{const response=await fetch('http://user-service:3000/api/auth/me',{headers:{authorization:token},signal:AbortSignal.timeout(3000)});if(!response.ok)return r.status(401).json({error:'Session expired; log in again'});q.user=await response.json();next()}catch(e){r.status(503).json({error:'Authentication service unavailable'})}}
app.use('/api/orders',wrap(requireUser));
app.get('/api/orders',wrap(async(q,r)=>r.json((await read(q.user.id)).map(publicOrder))));
app.get('/api/orders/:id',wrap(async(q,r)=>{const o=(await read(q.user.id)).find(x=>x.id===q.params.id);r.status(o?200:404).json(o?publicOrder(o):{error:'Order not found'})}));
app.post('/api/orders',async(q,r)=>{
 const {items,customer,paymentMethod}=q.body||{};
 if(!validCustomer(customer))return r.status(400).json({error:'Enter valid name, email, 10-digit phone, address, city, state and 6-digit PIN'});
 if(!['cod','online'].includes(paymentMethod))return r.status(400).json({error:'Choose COD or online payment'});
 if(paymentMethod==='online'&&!(key&&secret))return r.status(503).json({error:'Online payment gateway is not configured yet. Choose COD.'});
 if(!Array.isArray(items)||!items.length||items.length>30||!items.every(x=>Number.isSafeInteger(x.productId)&&Number.isSafeInteger(x.quantity)&&x.quantity>0&&x.quantity<=20))return r.status(400).json({error:'Invalid cart'});
 try{
  let total=0;const lines=[];
  for(const i of items){const p=await fetch('http://product-service:3000/api/products/'+i.productId,{signal:AbortSignal.timeout(4000)});if(!p.ok)return r.status(400).json({error:'Invalid product'});const v=await p.json();if(!Number.isSafeInteger(v.price)||v.price<0)throw Error('Invalid product price');total+=v.price*i.quantity;lines.push({productId:v.id,name:v.name,quantity:i.quantity,price:v.price})}
  if(!Number.isSafeInteger(total)||total<=0)return r.status(400).json({error:'Invalid order total'});
  const o={id:crypto.randomUUID(),userId:q.user.id,customer:{name:customer.name.trim(),email:customer.email.trim(),phone:customer.phone,address:customer.address.trim(),city:customer.city.trim(),state:customer.state.trim(),pincode:customer.pincode},items:lines,total,paymentMethod,paymentStatus:paymentMethod==='cod'?'pending_cod':'pending_online',status:paymentMethod==='cod'?'placed':'awaiting_payment',createdAt:new Date().toISOString()};
  if(paymentMethod==='online'){
   const auth=Buffer.from(key+':'+secret).toString('base64');
   const p=await fetch('https://api.razorpay.com/v1/orders',{method:'POST',headers:{Authorization:'Basic '+auth,'Content-Type':'application/json'},body:JSON.stringify({amount:total*100,currency:'INR',receipt:o.id.slice(0,40),notes:{internal_order_id:o.id}}),signal:AbortSignal.timeout(10000)});
   const result=await p.json();if(!p.ok||!result.id)return r.status(502).json({error:'Payment gateway could not initialize checkout'});
   o.gatewayOrderId=result.id;
  }
  await save(o);
  r.status(201).json({...publicOrder(o),...(paymentMethod==='online'?{gatewayOrderId:o.gatewayOrderId,razorpayKeyId:key}: {})});
 }catch(e){console.error('Order creation error',e.message);r.status(503).json({error:'Order could not be created. Please retry.'})}
});
app.post('/api/orders/:id/verify-payment',wrap(async(q,r)=>{
 const {razorpay_order_id,razorpay_payment_id,razorpay_signature}=q.body||{};
 if(!key||!secret)return r.status(503).json({error:'Payment gateway unavailable'});
 const o=(await read(q.user.id)).find(x=>x.id===q.params.id);
 if(!o||o.paymentMethod!=='online'||o.gatewayOrderId!==razorpay_order_id)return r.status(404).json({error:'Payment order not found'});
 if(![razorpay_payment_id,razorpay_signature].every(v=>typeof v==='string'&&v.length>0&&v.length<256))return r.status(400).json({error:'Invalid payment verification'});
 const expected=crypto.createHmac('sha256',secret).update(razorpay_order_id+'|'+razorpay_payment_id).digest('hex');
 const a=Buffer.from(expected,'hex'),b=Buffer.from(razorpay_signature,'hex');
 if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return r.status(400).json({error:'Payment signature invalid'});
 if(o.paymentStatus==='paid')return r.json(publicOrder(o));
 o.paymentStatus='paid';o.status='placed';o.gatewayPaymentId=razorpay_payment_id;await update(o);r.json(publicOrder(o));
}));
app.use(express.static(path.join(__dirname,'public')));
init().then(()=>app.listen(3000,'0.0.0.0')).catch(e=>{console.error('Database initialization failed',e);process.exit(1)});
