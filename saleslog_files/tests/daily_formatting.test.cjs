const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const clone=x=>JSON.parse(JSON.stringify(x));
const rows=Array.from({length:7},(_,i)=>{const r=Array(14).fill('');r[0]=i+1;return r;});
rows[0][2]='A';rows[0][6]='AL';rows[0][4]=1234567;
rows[1][2]='PENDING';rows[1][6]='AL';rows[1][9]='B';rows[1][13]='UNKNOWN';
rows[2][2]='B';rows[2][6]='AL/BO';rows[3][9]='C';rows[3][13]='BO';
rows[4][1]='waiting';rows[5][2]='A';rows[5][6]='UNKNOWN';
function setup(){
 const count={};const cells=Array.from({length:40},()=>Array.from({length:26},()=>({bg:'#ffffff',font:'#123456',size:12,format:'@'})));
 const hit=n=>count[n]=(count[n]||0)+1;
 function range(r,c,n=1,w=1){
  const x={getA1Notation:()=>`${col(c)}${r}:${col(c+w-1)}${r+n-1}`,getColumn:()=>c,getLastColumn:()=>c+w-1};
  for(const [method,key] of Object.entries({setFontFamily:'family',setFontWeight:'weight',setFontSize:'size',setHorizontalAlignment:'align',setVerticalAlignment:'vertical',setNumberFormat:'format'}))x[method]=v=>{hit(method);for(let i=r-1;i<r+n-1;i++)for(let j=c-1;j<c+w-1;j++)cells[i][j][key]=v;return x;};
  x.setBorder=(...v)=>{hit('setBorder');for(let i=r-1;i<r+n-1;i++)for(let j=c-1;j<c+w-1;j++)cells[i][j].border=v;return x;};
  for(const [method,key] of [['setBackgrounds','bg'],['setFontColors','font']])x[method]=values=>{hit(method);values.forEach((row,i)=>row.forEach((v,j)=>cells[r-1+i][c-1+j][key]=v));return x;};
  x.getBackgrounds=()=>{hit('getBackgrounds');return cells.slice(r-1,r+n-1).map(row=>row.slice(c-1,c+w-1).map(v=>v.bg));};
  x.getValues=()=>{hit('getValues');return Array.from({length:n},()=>[1]);};
  return x;
 }
 function col(n){return String.fromCharCode(64+n);}
 const parse=a=>{const m=a.match(/^([A-Z])(\d+):([A-Z])(\d+)$/);return range(+m[2],m[1].charCodeAt(0)-64,+m[4]-m[2]+1,m[3].charCodeAt(0)-m[1].charCodeAt(0)+1);};
 const sheet={getRange:(...a)=>{hit('getRange');return typeof a[0]==='string'?parse(a[0]):range(...a);},getRangeList:list=>{hit('getRangeList');return {setFontSize:v=>{for(const a of list)parse(a).setFontSize(v);}};},getConditionalFormatRules:()=>[],setConditionalFormatRules:r=>{sheet.rules=r;}};
 function builder(){const data={};const b={};for(const method of ['whenFormulaSatisfied','setBackground','setFontColor','setRanges']) b[method]=v=>{data[method]=method==='setRanges'?v.map(x=>x.getA1Notation()):v;return b;};b.build=()=>data;return b;}
 const c=vm.createContext({Logger:{log(){}},console,SpreadsheetApp:{getActive:()=>({toast(){}}),BorderStyle:{SOLID:'solid'},BooleanCriteria:{CUSTOM_FORMULA:'custom'},flush:()=>hit('flush'),newConditionalFormatRule:builder},CacheService:{getScriptCache:()=>({})}});
 for(const f of ['core_saleslogPro.js','daily_formatting.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);
 vm.runInContext(require('./fixtures/daily_formatting_before.cjs'),c);
 c.getSalespersonMaps=()=>({aliasMap:{AL:'Alice',BO:'Bob'},displayCodeMap:{}});
 c.getSheets=()=>{hit('getSheets');return {today:sheet};};
 c.getDynamicLeaderboardRanges=()=>{hit('getDynamicLeaderboardRanges');return {leaderboard:'P2:R3',mtd:'Q2:Q3'};};
 c.memoizedGetSellingDays=()=>({daysElapsed:8,totalDays:26});
 c.logError=(_,e)=>{throw e;};c.toastInfo=()=>{};
 return {c,sheet,cells,count};
}
for(const source of [true,false]){
 const a=setup(),b=setup();
 for(const t of [a,b]) for(let i=1;i<8;i++) for(let j=0;j<14;j++) t.cells[i][j].bg=['#00ff00','#ffffff','#FF0000','#ff9900'][j%4];
 const backgrounds=source?rows.map(()=>Array(14).fill('#abcdef')):[];
 const fonts=source?rows.map(()=>Array(14).fill('#fedcba')):[];
 const errorsA=a.c.baselineDailyFormatting(a.sheet,clone(rows),2,{},fonts,backgrounds);
 const errorsB=b.c._formatDailyMonthlyRows(b.sheet,clone(rows),2,{AL:'Alice',BO:'Bob'},fonts,backgrounds);
 assert.equal(JSON.stringify(errorsB),JSON.stringify(errorsA));
 assert.deepEqual(b.cells,a.cells);
 assert.equal(b.count.getBackgrounds,1);assert.equal(a.count.getBackgrounds,2);
 assert.equal(b.count.setBorder,1);assert.equal(a.count.setBorder,2);
 assert(!b.count.flush);
 console.log('PASS monthly appearance parity; source colors='+source+'; calls '+JSON.stringify({before:a.count,after:b.count}));
}
for(const positive of [true,false]){
 const a=setup(),b=setup();
 if(!positive){const original=a.sheet.getRange;a.sheet.getRange=(...args)=>{const r=original(...args);r.getValues=()=>[[0],[0]];return r;};}
 a.c.baselineReapplyCF({throwOnError:true});
 b.c.reapplyCF({throwOnError:true,context:{sheets:{today:b.sheet},leaderboardRanges:{leaderboard:'P2:R3',mtd:'Q2:Q3'},leaderboardValues:[['A',positive?1:0],['B',0]]}});
 assert.equal(JSON.stringify(b.sheet.rules),JSON.stringify(a.sheet.rules));
 assert(!b.count.getSheets);assert(!b.count.getDynamicLeaderboardRanges);assert(!b.count.getValues);
 console.log('PASS conditional-format parity with '+(positive?'positive':'zero')+' totals; context avoids sheet/range/totals rereads.');
}
