import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {injectGoogleAnalytics, renderAnalyticsSnippet} from '../tools-admin-worker/src/analytics-policy.js';
const ID = 'G-1MDBG3TN2X';
const files = execFileSync('git',['ls-files','*.html'],{encoding:'utf8'}).trim().split('\n');
const marker = 'SYNTHETIC_PRIVATE_CANARY_7492';
const bootstrap = html => html.match(/<script data-rmit-analytics="privacy-v1">([\s\S]*?)<\/script>/)[1];
function execute(html) {
  const window = {};
  const context = vm.createContext({window, document:{title:marker,referrer:'https://example.invalid/'+marker}, location:{href:'https://example.invalid/?q='+marker+'#'+marker}, Date});
  new vm.Script(bootstrap(html)).runInContext(context);
  return window;
}
for (const path of files) {
  const source = readFileSync(path,'utf8');
  if (!source.includes('G-1MDBG3TN2X')) continue;
  test('safe analytics identity: '+path, () => {
    const window = execute(source);
    const initial = window.dataLayer.map(x=>Array.from(x));
    const config = initial.find(x=>x[0]==='config');
    assert.equal(config[1],ID);
    assert.equal(config[2].page_location,'https://rmit-ve-learningexperience.github.io/tools/'+path);
    assert.equal(config[2].page_title,'RMIT tool: '+path);
    assert.equal(config[2].page_referrer,'');
    assert.equal(config[2].allow_google_signals,false);
    assert.equal(config[2].allow_ad_personalization_signals,false);
    assert.equal(initial[0][0],'consent');
    assert.equal(initial[0][2].ad_user_data,'denied');
    assert.match(source, /<script async referrerpolicy="no-referrer" src="https:\/\/www.googletagmanager.com/);
    const before=window.dataLayer.length;
    window.rmitTrackEvent('diagnosis_started',{filename:marker,page_location:marker,user_data:{email:marker}});
    window.rmitTrackEvent(marker);
    window.rmitTrackEvent('option_selected',{value:marker});
    assert.equal(window.dataLayer.length,before+1);
    assert.ok(!JSON.stringify(window.dataLayer.map(x=>Array.from(x))).includes(marker));
    assert.equal(typeof window.gtag,'undefined');
  });
}
test('legacy uploads receive canonical privacy configuration',()=>{
  const legacy='<html><head><title>'+marker+'</title><script async src="https://www.googletagmanager.com/gtag/js?id='+ID+'"></script><script>window.dataLayer=[]; function gtag(){dataLayer.push(arguments);} gtag("config", "'+ID+'", {page_location: "'+marker+'"});</script></head></html>';
  const output=injectGoogleAnalytics(legacy,ID,'reviewed-tool.html');
  const window=execute(output);
  assert.ok(!JSON.stringify(window.dataLayer.map(x=>Array.from(x))).includes(marker));
  assert.equal((output.match(/googletagmanager.com\/gtag\/js/g)||[]).length,1);
});
test('custom tracking and invalid tool identities fail closed',()=>{
  assert.throws(()=>injectGoogleAnalytics('<script>gtag("event","secret")</script>',ID,'tool.html'),/Custom Google tracking/);
  for(const path of ['../private.html','tool.html?q='+marker,'/tool.html','tool.html#'+marker]) assert.throws(()=>renderAnalyticsSnippet(ID,path));
  assert.throws(()=>renderAnalyticsSnippet('G-X\"><script>','tool.html'));
});
test('explicit upload opt-out is preserved',()=>{
  const source='<!-- rmit-analytics: disabled --><html></html>';
  assert.equal(injectGoogleAnalytics(source,ID,'tool.html'),source);
});
test('untracked tools remain untracked',()=>{
  const originals=execFileSync('git',['show','HEAD:tools-directory.html'],{encoding:'utf8'});
  assert.equal(readFileSync('tools-directory.html','utf8'),originals);
  assert.ok(!readFileSync('pdf-flipbook-generator.html','utf8').includes(ID));
});
test('HVAC events have no raw URL or per-answer reporting',()=>{
  const source=readFileSync('australian_HVAC_diagnotistic_Training/app.js','utf8');
  assert.ok(!source.includes('window.location.href'));
  assert.ok(!source.includes("gtag('"));
  assert.ok(!source.includes("'option_selected'"));
  assert.ok(!source.includes("'session_end'"));
  const matches=[...source.matchAll(/rmitTrackEvent\('([^']+)'\)/g)].map(x=>x[1]);
  assert.deepEqual(matches.sort(),['app_initialized','diagnosis_started','diagnostic_completed','diagnosis_restarted'].sort());
});

test('managed snippet refresh is idempotent',()=>{
  const once=injectGoogleAnalytics('<html><head><title>Tool</title></head></html>',ID,'tool.html');
  assert.equal(injectGoogleAnalytics(once,ID,'tool.html'),once);
});

test('opt-out also removes a recognized legacy tag',()=>{
  const legacy='<!-- rmit-analytics: disabled --><script async src="https://www.googletagmanager.com/gtag/js?id='+ID+'"></script><script>window.dataLayer=[];gtag("config","'+ID+'");</script>';
  const out=injectGoogleAnalytics(legacy,ID,'tool.html');
  assert.ok(!out.includes('googletagmanager.com'));
  assert.ok(!out.includes('privacy-v1'));
});

test('BAU and KT tools have no Google tracking and carry persistent opt-outs',()=>{
  const metadata=JSON.parse(readFileSync('tools-metadata.json','utf8'));
  const excluded=Object.entries(metadata.tools).filter(([,d])=>['BAU','KT'].includes(d.owner));
  assert.equal(excluded.length,18);
  for(const [path,details] of excluded){
    const source=readFileSync(path,'utf8');
    assert.equal(details.analytics,false,path);
    assert.match(source,/<!-- rmit-analytics: disabled -->/,path);
    assert.doesNotMatch(source,/googletagmanager\.com|google-analytics\.com|\bgtag\s*\(|G-1MDBG3TN2X/,path);
  }
});
test('Kirsty uploads strip existing tags even with a blank or different owner',async()=>{
  const {applyPublisherAnalytics}=await import('../tools-admin-worker/src/analytics-policy.js');
  for(const owner of ['', 'Other']){
    const input=renderAnalyticsSnippet(ID,'tool.html')+'<h1>Keep content</h1>';
    const out=applyPublisherAnalytics(input,ID,'tool.html',{owner,actorEmail:'KIRSTY.TOD@RMIT.EDU.AU',excludedUploaders:'kirsty.tod@rmit.edu.au'});
    assert.equal(out.disabled,true);assert.ok(out.content.includes('<h1>Keep content</h1>'));assert.ok(!out.content.includes(ID));
  }
});
test('BAU replacements and old-version restores remain opted out for any uploader',async()=>{
  const {applyPublisherAnalytics}=await import('../tools-admin-worker/src/analytics-policy.js');
  const input=renderAnalyticsSnippet(ID,'tool.html')+'<main>Old version</main>';
  for(const existing of [{owner:'BAU'},{owner:'KT'},{owner:'Changed',analytics:false}]){
    const out=applyPublisherAnalytics(input,ID,'tool.html',{existing,owner:'Changed',actorEmail:'other@rmit.edu.au'});
    assert.equal(out.disabled,true);assert.ok(!out.content.includes(ID));assert.ok(out.content.includes('Old version'));
  }
});
test('excluded uploads strip legacy tags without a measurement setting',async()=>{
  const {applyPublisherAnalytics}=await import('../tools-admin-worker/src/analytics-policy.js');
  const input='<script async src="https://www.googletagmanager.com/gtag/js?id='+ID+'"></script><script>window.dataLayer=[];gtag("config","'+ID+'");</script><p>Tool</p>';
  const out=applyPublisherAnalytics(input,'','tool.html',{owner:'BAU'});
  assert.equal(out.disabled,true);assert.ok(!out.content.includes(ID));assert.ok(out.content.includes('<p>Tool</p>'));
});
test('other owners retain the approved analytics policy',async()=>{
  const {applyPublisherAnalytics}=await import('../tools-admin-worker/src/analytics-policy.js');
  const out=applyPublisherAnalytics('<html><head></head></html>',ID,'tool.html',{owner:'DMD',actorEmail:'other@rmit.edu.au',excludedUploaders:'kirsty.tod@rmit.edu.au'});
  assert.equal(out.disabled,false);assert.equal(execute(out.content).dataLayer[5][0],'config');
});
test('unknown custom tracking is rejected rather than published on excluded tools',async()=>{
  const {applyPublisherAnalytics}=await import('../tools-admin-worker/src/analytics-policy.js');
  assert.throws(()=>applyPublisherAnalytics('<script>gtag("event","secret")</script>',ID,'tool.html',{owner:'BAU'}),/Custom Google tracking/);
});
