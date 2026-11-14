import puppeteer from "puppeteer-core";
const [url, out, w=1920, h=1080] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args:["--allow-file-access-from-files"] });
const p = await b.newPage(); await p.setViewport({ width:+w, height:+h, deviceScaleFactor:1 });
await p.goto(url, { waitUntil: "networkidle0", timeout: 30000 }).catch(e=>console.log("goto",e.message));
await new Promise(r=>setTimeout(r,800));
await p.screenshot({ path: out }); await b.close(); console.log("ok", out);
