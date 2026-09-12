export const ORIGIN='https://ys.learnus.org';
export const cleanText=(value:string)=>value.replace(/\s+/g,' ').trim();

export function learnUsUrl(value:string):URL|undefined {
  try{
    const url=new URL(value,ORIGIN);if(url.origin!==ORIGIN||url.username||url.password)return;
    url.hash='';for(const key of [...url.searchParams.keys()])if(/^(?:utm_.+|fbclid|gclid|sesskey|token)$/i.test(key))url.searchParams.delete(key);
    url.searchParams.sort();return url;
  }catch{return;}
}
function id(value:string|number|null|undefined):string|undefined {const text=String(value??'');return /^[1-9]\d*$/.test(text)&&Number.isSafeInteger(Number(text))?text:undefined;}
export const courseIdentity=(value:string|number|null|undefined)=>{const key=id(value);return key&&`course:${key}`;};
export const activityIdentity=(value:string|number|null|undefined)=>{const key=id(value);return key&&`activity:${key}`;};
export const assignmentIdentity=activityIdentity;
export const calendarEventIdentity=(value:string|number|null|undefined)=>{const key=id(value);return key&&`event:${key}`;};
export const announcementIdentity=(moduleId:string|number|null|undefined,articleId:string|number|null|undefined)=>{const module=id(moduleId),article=id(articleId);return module&&article&&`announcement:${module}:${article}`;};
export function notificationIdentity(value:{id?:string;url?:string;createdAt?:string;title?:string;text?:string}):string {
  if(value.id)return `notification:${value.id}`;
  const url=value.url?learnUsUrl(value.url)?.href:'',date=normalizeDate(value.createdAt)||cleanText(value.createdAt||'');
  return `notification-composite:${JSON.stringify([url,date,cleanText(value.title||''),cleanText(value.text||'')])}`;
}
export function dedupeBy<T>(items:T[],identity:(item:T)=>string|undefined):T[]{
  const seen=new Set<string>();return items.filter(item=>{const key=identity(item);if(!key||!seen.has(key)){if(key)seen.add(key);return true;}return false;});
}

const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
export function normalizeDate(value:string|undefined,end=false):string|undefined {
  if(!value)return;const text=cleanText(value);
  if(/^\d{10}$/.test(text))return new Date(Number(text)*1000).toISOString();
  if(/^\d{13}$/.test(text))return new Date(Number(text)).toISOString();
  if(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text))return Number.isFinite(Date.parse(text))?text.replace(/([+-]\d{2})(\d{2})$/,'$1:$2'):undefined;
  let match=text.match(/(20\d{2})[년./-]\s*(\d{1,2})[월./-]\s*(\d{1,2})일?(?:[T,\s]+(?:(오전|오후)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i);
  let year:number,month:number,day:number,hour:number|undefined,minute:number|undefined,second:number|undefined,period:string|undefined;
  if(match){year=Number(match[1]);month=Number(match[2]);day=Number(match[3]);period=match[4];hour=match[5]===undefined?undefined:Number(match[5]);minute=match[6]===undefined?undefined:Number(match[6]);second=match[7]===undefined?undefined:Number(match[7]);}
  else{
    match=text.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if(!match)return;day=Number(match[1]);month=months.indexOf(match[2].toLowerCase())+1;year=Number(match[3]);hour=Number(match[4]);minute=Number(match[5]);second=match[6]===undefined?undefined:Number(match[6]);period=match[7];
  }
  if(period&&/^(?:오후|PM)$/i.test(period)&&hour!==undefined&&hour<12)hour+=12;if(period&&/^(?:오전|AM)$/i.test(period)&&hour===12)hour=0;
  const iso=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour??(end?23:0)).padStart(2,'0')}:${String(minute??(end?59:0)).padStart(2,'0')}:${String(second??(hour===undefined&&end?59:0)).padStart(2,'0')}+09:00`;
  const time=Date.parse(iso),local=Number.isFinite(time)?new Date(time+9*3600000).toISOString().slice(0,19):'';
  return local===iso.slice(0,19)?iso:undefined;
}
export const dateTimestamp=(value:string|undefined,end=false)=>{const normalized=normalizeDate(value,end);return normalized===undefined?undefined:Date.parse(normalized);};
