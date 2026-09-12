import type { APIRequestContext, BrowserContext } from 'playwright';

export interface HttpTextResponse {status:number;ok:boolean;url:string;text:string}

async function read(request:APIRequestContext,url:string):Promise<HttpTextResponse>{
  const response=await request.get(url,{timeout:30000});
  try{return {status:response.status(),ok:response.ok(),url:response.url(),text:await response.text()};}
  finally{await response.dispose();}
}

export async function getText(context:BrowserContext,url:string):Promise<HttpTextResponse>{
  try{return await read(context.request,url);}
  catch{
    const browser=context.browser();
    if(!browser)throw new Error('REQUEST_CONTEXT_UNAVAILABLE');
    const fallback=await browser.newContext({storageState:await context.storageState()});
    try{return await read(fallback.request,url);}
    finally{await fallback.close();}
  }
}
