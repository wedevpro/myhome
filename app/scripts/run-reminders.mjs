// Run once per minute using a server scheduler; secrets come from its environment.
const origin=process.env.MYHOMEIA_SITE_URL;
const secret=process.env.REMINDER_SECRET;
if(!origin||!secret)throw new Error('Configure MYHOMEIA_SITE_URL and REMINDER_SECRET.');
const target=new URL('/api/push/run',origin);
if(target.protocol!=='https:')throw new Error('HTTPS is required.');
const headers={Authorization:`Bearer ${secret}`};
if(process.env.SITES_SERVICE_TOKEN)headers['OAI-Sites-Authorization']=`Bearer ${process.env.SITES_SERVICE_TOKEN}`;
const response=await fetch(target,{method:'POST',headers,redirect:'error'});
if(!response.ok)throw new Error(`Reminder scheduler HTTP ${response.status}`);
console.log(await response.json());
