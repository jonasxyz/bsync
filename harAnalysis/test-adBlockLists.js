#!/usr/bin/env node

'use strict';

// Simple test to verify that AdBlockLists detects tracking requests in HAR entries
// Uses well-known tracker URLs from EasyPrivacy

const assert = require('assert');
const AdBlockLists = require('./adBlockLists');

function makeHarEntry(url, mimeType) {
	return {
		request: { url },
		response: { content: { mimeType } },
	};
}

async function run() {
	console.log('🧪 Test: AdBlockLists erkennt Tracking-Anfragen in HAR-Einträgen');

	// Initialize lists (loads EasyPrivacy/EasyList; uses cache when available)
	const lists = new AdBlockLists({ verbose: true });
	await lists.initialized;

	const pageUrl = 'https://example.com/';

	const cases = [
		{
			name: 'Google Analytics (analytics.js) → tracking',
			entry: makeHarEntry('https://www.google-analytics.com/analytics.js', 'application/javascript'),
			expectMatched: true,
			expectCategory: 'tracking',
		},
		{
			name: 'Google Analytics (collect XHR) → tracking',
			entry: makeHarEntry('https://www.google-analytics.com/collect?v=1&_v=j96', 'application/json'),
			expectMatched: true,
			expectCategory: 'tracking',
		},
		{
			name: 'Google Tag Manager (gtm.js) → tracking',
			entry: makeHarEntry('https://www.googletagmanager.com/gtm.js', 'application/javascript'),
			expectMatched: true,
			expectCategory: 'tracking',
		},
		{
			name: 'Facebook Pixel (fbevents.js) → tracking',
			entry: makeHarEntry('https://connect.facebook.net/en_US/fbevents.js', 'application/javascript'),
			expectMatched: true,
			expectCategory: 'tracking',
		},
		{
			name: 'Facebook Pixel (image beacon) → tracking',
			entry: makeHarEntry('https://www.facebook.com/tr/?id=123456&ev=PageView', 'image/gif'),
			expectMatched: true,
			expectCategory: 'tracking',
		},
		{
			name: 'Bing/Microsoft Ads tracking (bat.js) → tracking',
			entry: makeHarEntry('https://bat.bing.com/bat.js', 'application/javascript'),
			expectMatched: true,
			expectCategory: 'tracking',
		},
		{
			name: 'Hotjar pixel (gif) → tracking',
			entry: makeHarEntry('https://static.hotjar.com/c/hotjar-123456.js?sv=6', 'application/javascript'),
			expectMatched: true,
			expectCategory: 'tracking',
		},
		{
			name: 'DoubleClick ad script → ads',
			entry: makeHarEntry('https://doubleclick.net/instream/ad_status.js', 'application/javascript'),
			expectMatched: true,
			expectCategory: 'ads',
		},
		{
			name: 'Google ads (adsbygoogle.js) → ads',
			entry: makeHarEntry('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'application/javascript'),
			expectMatched: true,
			expectCategory: 'ads',
		},
		{
			name: 'First-party script → allowed',
			entry: makeHarEntry('https://example.com/assets/app.js', 'application/javascript'),
			expectMatched: false,
			expectCategory: null,
		},
		{
			name: 'Tracker URL ohne MIME-Type → tracking',
			entry: { request: { url: 'https://www.google-analytics.com/r/collect?v=1' }, response: { content: {} } },
			expectMatched: true,
			expectCategory: 'tracking',
		},
	];

	let failures = 0;
	for (const t of cases) {
		const res = lists.classifyHarEntry(t.entry, pageUrl);
		const okMatched = res.matched === t.expectMatched;
		const okCategory = res.category === t.expectCategory;
		if (okMatched && okCategory) {
			console.log(`  ✅ ${t.name}`);
		} else {
			failures++;
			console.error(`  ❌ ${t.name}`);
			console.error(`     got: matched=${res.matched}, category=${res.category}`);
			console.error(`     expected: matched=${t.expectMatched}, category=${t.expectCategory}`);
		}
	}

	// At least ensure tracking cases were recognized
	const trackingUrls = cases.filter(c => c.expectCategory === 'tracking').map(c => c.entry.request.url);
	for (const url of trackingUrls) {
		const res = lists.classifyHarEntry(makeHarEntry(url, 'application/javascript'), pageUrl);
		try {
			assert.strictEqual(res.category, 'tracking', `Expected tracking for ${url}`);
		} catch (e) {
			failures++;
			console.error(`  ❌ Assertion failed: ${e.message}`);
		}
	}

	if (failures > 0) {
		console.error(`\n❌ Test abgeschlossen mit ${failures} Fehler(n).`);
		process.exit(1);
	}

	console.log('\n🎉 Alle Tests erfolgreich: Tracking-Erkennung funktioniert.');
}

run().catch(err => {
	console.error('❌ Unerwarteter Fehler:', err);
	process.exit(1);
});


