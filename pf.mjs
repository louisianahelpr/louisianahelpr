import { chromium } from 'playwright';
const S=process.env.S;
const b=await chromium.launchPersistentContext('/tmp/pf',{headless:false,permissions:[]});
for (const [w,scheme] of [[375,'light'],[375,'dark'],[1440,'light'],[1440,'dark']]) {
  const p=await b.newPage(); await p.emulateMedia({colorScheme:scheme});
  await p.setViewportSize({width:w,height:900});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:5199/browse',{waitUntil:'networkidle',timeout:60000});
  await p.waitForTimeout(2200);
  const m=await p.evaluate(()=>{const de=document.documentElement;
    const wide=[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().width>de.clientWidth+1).length;
    const frame=document.querySelector('.app-shell-frame');
    return {ov:de.scrollWidth>de.clientWidth,sw:de.scrollWidth,cw:de.clientWidth,wide,
      btns:[...document.querySelectorAll('button,[role=button]')].filter(e=>e.offsetParent).map(e=>(e.innerText||e.getAttribute('aria-label')||'?').trim().slice(0,20)),
      frameRect: frame?JSON.stringify(frame.getBoundingClientRect()):'none'};});
  console.log(`${w} ${scheme}: overflow=${m.ov} sw/cw=${m.sw}/${m.cw} wideEls=${m.wide} errs=${errs.length}`);
  console.log(`   btns=${JSON.stringify(m.btns)}`);
  await p.screenshot({path:`${S}/shots/FINAL-browse-${w}-${scheme}.png`});
  await p.close();
}
await b.close();
