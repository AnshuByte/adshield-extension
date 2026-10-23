// Generates the declarativeNetRequest rulesets from curated domain lists.
// Run: node tools/build-rules.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RULES_DIR = join(ROOT, "rules");
mkdirSync(RULES_DIR, { recursive: true });

// resourceTypes that can appear in a normal subresource block rule
const SUB = [
  "script", "sub_frame", "stylesheet", "image", "font",
  "object", "xmlhttprequest", "ping", "media", "websocket", "other"
];
// A navigation-capable set (used only for the malicious redirector list)
const NAV = ["main_frame", ...SUB];

/**
 * Networks that exist to open unexpected tabs / navigate the page / paint
 * invisible click layers. Blocking main_frame here is deliberate: a stray
 * navigation to one of these domains gets stopped instead of redirected.
 */
const REDIRECTORS = [
  "recrampwiped.com",      // popunder/tabunder engine found on moviesmod
  "adsboosters.xyz",       // injects the rgba(0,0,0,0.01) click overlay
  "traffmovie.com",        // adboosters loader target
  "eo9viqvtjnmst.com",     // cloaked banner/redirect host on moviesmod
  "popads.net",
  "popcash.net",
  "propellerads.com",
  "propellerclick.com",
  "adsterra.com",
  "highperformanceformat.com",
  "monetag.com",
  "hilltopads.net",
  "hilltopads.com",
  "juicyads.com",
  "exoclick.com",
  "exdynsrv.com",
  "magsrv.com",
  "trafficjunky.net",
  "trafficfactory.biz",
  "trafficstars.com",
  "realsrv.com",
  "tsyndicate.com",
  "onclckds.com",
  "onclickalgo.com",
  "clickadu.com",
  "adcash.com",
  "popmyads.com",
  "mgid.com",
  "adspyglass.com",
  "clickaine.com",
  "zeropark.com",
  "ad-maven.com",
  "ad-maven.net",
  "clickmonetizer.com",
  "dolohen.com",
  "pemsrv.com",
  "mybetterads.com",
  // Redirect networks and deceptive ad hosts found on pesktop.com
  "jdpirata98.it.com",
  "it.com",
  "yvjskep4.click",
  "dubzenom.com",
  "dc9xwpjprguup.cloudfront.net",
  "a-ads.com",
  "acceptable.a-ads.com",
  "ukankingwithea.com",
  "enaightdecipie.com",
  "unlockr.app"
];

/** Mainstream display/video ad servers. Subresources only, so pages still load. */
const ADS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adservice.google.com",
  "googletagservices.com",
  "2mdn.net",
  "amazon-adsystem.com",
  "taboola.com",
  "outbrain.com",
  "criteo.com",
  "criteo.net",
  "pubmatic.com",
  "rubiconproject.com",
  "openx.net",
  "casalemedia.com",
  "smartadserver.com",
  "adform.net",
  "33across.com",
  "sharethrough.com",
  "teads.tv",
  "adsrvr.org",
  "bidswitch.net",
  "indexww.com",
  "lijit.com",
  "media.net",
  "moatads.com",
  "serving-sys.com",
  "spotxchange.com",
  "tremorhub.com",
  "yieldmo.com",
  "zedo.com",
  "3lift.com",
  "districtm.io",
  "emxdgt.com",
  "improvedigital.com",
  "innity.net",
  "loopme.me",
  "nativo.com",
  "seedtag.com",
  "sovrn.com",
  "triplelift.com",
  "yieldlab.net",
  "adotmob.com",
  "adnxs.com",
  "adsafeprotected.com",
  "imrworldwide.com",
  "gumgum.com"
];

/** Analytics, push prompts and link shorteners. Off by default (can break sites). */
const TRACKERS = [
  "google-analytics.com",
  "analytics.google.com",
  "googletagmanager.com",
  "connect.facebook.net",
  "hotjar.com",
  "hotjar.io",
  "fullstory.com",
  "clarity.ms",
  "mixpanel.com",
  "segment.io",
  "segment.com",
  "amplitude.com",
  "heap.io",
  "inspectlet.com",
  "luckyorange.com",
  "mouseflow.com",
  "smartlook.com",
  "newrelic.com",
  "nr-data.net",
  "sentry.io",
  "bugsnag.com",
  "rollbar.com",
  "datadoghq.com",
  "appsflyer.com",
  "adjust.com",
  "onesignal.com",
  "pushengage.com",
  "bit.ly",
  "tinyurl.com",
  "ouo.io",
  "ouo.press",
  "shrinkme.io",
  "sh.st",
  "adf.ly",
  "short.gy",
  "clk.sh",
  "exe.io",
  "fc.lc",
  "linkshortify.com"
];

function rulesFor(domains, { base, priority, types, note }) {
  return domains.map((domain, i) => ({
    id: base + i,
    priority,
    action: { type: "block" },
    condition: { urlFilter: `||${domain}^`, resourceTypes: types }
  }));
}

const customRedirects = [
  {
    id: 1999,
    priority: 3,
    action: { type: "block" },
    condition: { urlFilter: "*pwxcd=", resourceTypes: ["script", "xmlhttprequest", "sub_frame", "other"] }
  }
];

const redirects = [...rulesFor(REDIRECTORS, { base: 1000, priority: 3, types: NAV }), ...customRedirects];
const ads = rulesFor(ADS, { base: 2000, priority: 1, types: SUB });
const trackers = rulesFor(TRACKERS, { base: 3000, priority: 1, types: SUB });

function write(name, payload) {
  const file = join(RULES_DIR, name);
  writeFileSync(file, JSON.stringify(payload, null, 2) + "\n");
  return { file, count: payload.length };
}

const out = [
  write("redirects.json", redirects),
  write("ads.json", ads),
  write("trackers.json", trackers)
];

for (const o of out) console.log(`${o.count.toString().padStart(3)} rules -> ${o.file}`);
console.log(`total: ${out.reduce((n, o) => n + o.count, 0)} rules`);
