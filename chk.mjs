import { chromium } from 'playwright'
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'})
const page=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:3})
page.on('pageerror',e=>console.log('PAGE ERROR:',e.message))
await page.route('**archive.org/**',r=>r.fulfill({status:200,contentType:'application/json',
  body:JSON.stringify({response:{numFound:0,docs:[]}})}))
await page.goto('http://localhost:4180/RecordStoreVibes/#/browse',{waitUntil:'networkidle'})
await page.waitForTimeout(700)
console.log('build   :', await page.locator('h1 button').innerText())
await page.locator('h1 button').click(); await page.waitForTimeout(300)
console.log('readout :', (await page.innerText('body')).match(/win \d+[^\n]*/)?.[0])
console.log('meta    :', await page.evaluate(()=>document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')))
await b.close()
