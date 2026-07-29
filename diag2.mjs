import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const WAV=readFileSync('/tmp/t.wav')
const META={metadata:{title:'Tone',creator:'T'},files:[{name:'t.mp3',format:'VBR MP3',title:'Tone',length:'30'}]}
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'})
const page=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2})
page.on('pageerror',e=>console.log('PAGE ERROR:',e.message))
await page.addInitScript(()=>{
  const rec={id:'t',title:'Tone',creator:'T',collection:'',year:null,artworkUrl:null,tracks:[],sourceUrl:'x'}
  localStorage.setItem('crate.library.v1',JSON.stringify({version:1,records:{t:rec},
    markers:[{id:'m1',recordId:'t',trackName:'t.mp3',timestampSec:5,createdAt:1}],
    starred:{},unplayable:[],pads:{},trims:{}}))
})
await page.route('**archive.org/**',r=>{const u=new URL(r.request().url())
  if(u.pathname.includes('/metadata/'))return r.fulfill({contentType:'application/json',body:JSON.stringify(META)})
  if(u.pathname.includes('advancedsearch'))return r.fulfill({contentType:'application/json',body:JSON.stringify({response:{numFound:0,docs:[]}})})
  return r.fulfill({status:200,contentType:'audio/wav',body:WAV,headers:{'content-length':String(WAV.length)}})})
await page.goto('http://localhost:4180/RecordStoreVibes/#/r/t',{waitUntil:'networkidle'})
await page.waitForTimeout(2000)
await page.locator('button',{hasText:/Flagged · 1/i}).click(); await page.waitForTimeout(300)
// Tag the element so we can tell patching from re-creation.
await page.evaluate(()=>{document.querySelector('input[placeholder="note…"]').__tag = 'orig'})
const state=()=>page.evaluate(()=>{const el=document.querySelector('input[placeholder="note…"]')
  return {value:el.value, sameElement: el.__tag==='orig', focused: document.activeElement===el}})
// Start playback so the position ticks while we type.
await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Play'); b&&b.click()})
await page.waitForTimeout(1000)
const pos=()=>page.evaluate(()=>document.querySelector('.scrub')?.getAttribute('aria-valuenow'))
console.log('playing, position:', await pos())
await page.locator('input[placeholder="note…"]').first().focus()
for (const ch of ['a','b','c','d','e','f']) {
  await page.keyboard.press(`Key${ch.toUpperCase()}`)
  await page.waitForTimeout(400)
  console.log(`after '${ch}' @${await pos()}s :`, JSON.stringify(await state()))
}
// Blur should commit it to storage, and it should survive a reload.
await page.keyboard.press('Tab'); await page.waitForTimeout(400)
console.log('stored on blur :', await page.evaluate(()=>
  JSON.parse(localStorage.getItem('crate.library.v1')).markers[0].note))
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(2000)
await page.locator('button',{hasText:/Flagged · 1/i}).click(); await page.waitForTimeout(300)
console.log('after reload   :', JSON.stringify(await page.evaluate(()=>
  document.querySelector('input[placeholder="note…"]').value)))
await b.close()
