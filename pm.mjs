import { chromium } from 'playwright';
const S=process.env.S;
const b=await chromium.launchPersistentContext('/tmp/pm',{headless:false,viewport:{width:375,height:844},permissions:[]});
const p=await b.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:5199/browse',{waitUntil:'networkidle',timeout:60000});
await p.waitForTimeout(1800);
await p.getByRole('button',{name:'Filters'}).click(); await p.waitForTimeout(900);
await p.getByRole('button',{name:'Map',exact:true}).click(); await p.waitForTimeout(4000);
const m=await p.evaluate(()=>({body:document.body.innerText.replace(/\s+/g,' ').slice(0,160),
  mapkit: !!document.querySelector('.mk-map-view, [class*=mapkit], canvas'),
  divs: document.querySelectorAll('[class*=map]').length}));
console.log('MAP VIEW:', JSON.stringify(m));
console.log('errors:', errs.slice(0,2));
await p.screenshot({path:`${S}/shots/B1-mapview.png`});
await b.close();
