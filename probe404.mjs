import { chromium } from "playwright";
const b=await chromium.launch();const p=await b.newPage({viewport:{width:375,height:812}});
p.on("response",r=>{if(r.status()>=400)console.log(r.status(),r.url())});
await p.goto("http://localhost:4201/login",{waitUntil:"networkidle"});await b.close();
