import {chromium} from 'playwright';
try { const browser=await chromium.launch({headless:true}); try { const page=await browser.newPage(); await page.setContent('<h1>Local browser smoke test</h1>'); if(await page.locator('h1').count()!==1) throw Error(); console.log('HEADLESS_CHROMIUM_OK'); } finally {await browser.close();} } catch {console.log('HEADLESS_CHROMIUM_FAILED');process.exitCode=1;}
