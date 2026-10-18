// Used by the uploader and the repository migration so downloaded tools stay standalone.
export const ANALYTICS_START = '<!-- RMIT analytics privacy v1 -->';
export const ANALYTICS_END = '<!-- /RMIT analytics privacy v1 -->';
const BASE_URL = 'https://rmit-ve-learningexperience.github.io/tools/';
const APPROVED_EVENTS = ['app_initialized', 'diagnosis_started', 'diagnostic_completed', 'diagnosis_restarted'];

function js(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function renderAnalyticsSnippet(measurementId, toolPath) {
  if (!/^G-[A-Z0-9]+$/.test(measurementId)) throw new Error('Invalid analytics measurement ID.');
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]*\.html$/.test(toolPath) || toolPath.includes('..')) {
    throw new Error('Analytics requires an approved repository HTML path.');
  }
  const identity = {
    page_location: BASE_URL + toolPath,
    page_referrer: '',
    page_title: 'RMIT tool: ' + toolPath,
    ignore_referrer: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  };
  return `${ANALYTICS_START}
<script data-rmit-analytics="privacy-v1">
(function () {
  'use strict';
  var measurementId = ${js(measurementId)};
  var identity = ${js(identity)};
  var approvedEvents = ${js(APPROVED_EVENTS)};
  window.dataLayer = window.dataLayer || [];
  function send() { window.dataLayer.push(arguments); }
  // Advertising stays denied. Analytics notice/consent must follow RMIT's approved policy.
  send('consent', 'default', {ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied'});
  send('set', 'ads_data_redaction', true);
  send('set', 'url_passthrough', false);
  send('set', identity);
  send('js', new Date());
  send('config', measurementId, Object.assign({send_page_view: true}, identity));
  // This interface accepts only fixed event names; caller-supplied payloads are discarded.
  window.rmitTrackEvent = function (name) {
    if (approvedEvents.indexOf(name) !== -1) {
      send('event', name, Object.assign({send_to: measurementId}, identity));
    }
  };
}());
</script>
<script async referrerpolicy="no-referrer" src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
${ANALYTICS_END}`;
}

export function injectGoogleAnalytics(source, measurementId, toolPath) {
  if (!measurementId) return source;
  // Replace our managed block and legacy standard snippets instead of preserving unsafe settings.
  let cleaned = source.replace(/<!-- RMIT analytics privacy v1 -->[\s\S]*?<!-- \/RMIT analytics privacy v1 -->\s*/g, '');
  cleaned = cleaned.replace(/<script\b[^>]*src=["']https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-[A-Z0-9]+["'][^>]*><\/script>\s*<script\b[^>]*>\s*window\.dataLayer[\s\S]*?<\/script>/g, '');
  // A custom tag needs review: don't silently deploy a second, conflicting analytics policy.
  if (/googletagmanager\.com\/(?:gtag\/js|gtm\.js)|\bgtag\s*\(/.test(cleaned)) {
    throw new Error('Custom Google tracking found. Replace it with the approved privacy snippet before uploading.');
  }
  if (source.includes('<!-- rmit-analytics: disabled -->')) return cleaned;
  const snippet = renderAnalyticsSnippet(measurementId, toolPath);
  if (/<\/head>/i.test(cleaned)) return cleaned.replace(/<\/head>/i, `${snippet}\n</head>`);
  if (/<html[^>]*>/i.test(cleaned)) return cleaned.replace(/<html[^>]*>/i, match => `${match}\n<head>${snippet}</head>`);
  return `${snippet}\n${cleaned}`;
}
