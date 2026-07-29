import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const WAV=readFileSync('/tmp/t.wav')
const META={metadata:{title:'Tone',creator:'T'},files:[{name:'t.mp3',format:'VBR MP3',title:'Tone',length:'30'}]}
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--autoplay-policy=no-user-gesture-required']})
const page=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true})
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
const field=page.locator('input[placeholder="note…"]').first()
const playing=()=>page.evaluate(()=>document.querySelector('.scrub')?.getAttribute('aria-valuenow'))

// Paused first, as a control.
await field.click(); await field.type('paused text', {delay:80})
console.log('paused  : typed ->', JSON.stringify(await field.inputValue()))
await field.fill('')

// Now with the track running.
await page.locator('button[aria-label="Play"]').click().catch(()=>{})
await page.waitForTimeout(900)
const p1=await playing()
await field.click()
await field.type('playing text', {delay:80})
const got=await field.inputValue()
console.log('playing : position moved', p1, '->', await playing())
console.log('playing : typed ->', JSON.stringify(got))
console.log('focus kept:', await page.evaluate(()=>document.activeElement?.tagName))
await b.close()
