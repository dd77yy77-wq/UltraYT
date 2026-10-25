//downloads a newer version of the app code (not Electron itself) and stores it where boot.js picks it up on the next launch
//
//feed (version.json): { version, url, sha256, size, notes }, where url is the update bundle, relative to the feed or absolute on the same host
//bundle: gzipped JSON { version, files: { "src/index.js": "<base64>", ... } }, made by tools/make-update.js

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { VERSION_PATTERN, compareVersions, readState } = require('./overlay')

const MAX_FEED_BYTES = 64 * 1024
const MAX_BUNDLE_BYTES = 20 * 1024 * 1024
const MAX_UNPACKED_BYTES = 60 * 1024 * 1024
const KEEP_VERSIONS = 2

const SEGMENT_PATTERN = /^[A-Za-z0-9_@-][A-Za-z0-9_@.-]*$/
const ROOT_FOLDERS = [ 'src', 'locale', 'assets', 'node_modules' ]

//only these paths may be written, and only inside the version's own folder
function isSafePath(rel) {
    if (typeof rel !== 'string') return false;
    if (rel === 'package.json') return true;

    const parts = rel.split('/')
    return parts.length >= 2 && ROOT_FOLDERS.includes(parts[0]) && parts.every((part) => SEGMENT_PATTERN.test(part));
}

async function download(url, { fetchImpl, timeoutMs, maxBytes, userAgent }) {
    const res = await fetchImpl(url, {
        headers: { 'User-Agent': userAgent, 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(timeoutMs)
    })

    if (!res.ok) throw new Error(`${url} answered ${res.status}`);

    const declared = Number(res.headers.get('content-length'))
    if (declared > maxBytes) throw new Error(`${url} is too large (${declared} bytes)`);

    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > maxBytes) throw new Error(`${url} is too large (${buffer.length} bytes)`);

    return buffer;
}

function parseFeed(buffer) {
    const feed = JSON.parse(buffer.toString('utf-8'))

    if (!feed || typeof feed !== 'object') throw new Error('The update feed is not an object');
    if (!VERSION_PATTERN.test(feed.version)) throw new Error('The update feed has no valid version');
    if (typeof feed.url !== 'string' || !feed.url) throw new Error('The update feed has no bundle url');
    if (!/^[0-9a-f]{64}$/.test(feed.sha256)) throw new Error('The update feed has no valid checksum');

    return feed;
}

function parseBundle(buffer, version) {
    const manifest = JSON.parse(zlib.gunzipSync(buffer, { maxOutputLength: MAX_UNPACKED_BYTES * 2 }).toString('utf-8'))

    if (!manifest || manifest.version !== version || !manifest.files || typeof manifest.files !== 'object') {
        throw new Error('The update bundle does not match the feed');
    }

    const files = []
    let total = 0;

    for (const [ rel, encoded ] of Object.entries(manifest.files)) {
        if (!isSafePath(rel) || typeof encoded !== 'string') throw new Error(`The update bundle has an unexpected file: ${rel}`);

        const data = Buffer.from(encoded, 'base64')
        total += data.length;
        if (total > MAX_UNPACKED_BYTES) throw new Error('The update bundle is too large once unpacked');

        files.push({ rel, data })
    }

    if (!files.some((file) => file.rel === 'src/index.js')) throw new Error('The update bundle has no src/index.js');

    const pkg = files.find((file) => file.rel === 'package.json')
    if (!pkg || JSON.parse(pkg.data.toString('utf-8')).version !== version) throw new Error('The update bundle has a wrong package.json');

    return files;
}

function writeVersion(updatesDir, version, files) {
    const target = path.join(updatesDir, version)
    const temp = path.join(updatesDir, `${version}.tmp-${process.pid}`)

    fs.rmSync(temp, { recursive: true, force: true })

    try {
        for (const { rel, data } of files) {
            const file = path.join(temp, ...rel.split('/'))
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, data)
        }

        fs.rmSync(target, { recursive: true, force: true })
        fs.renameSync(temp, target)
    } catch (err) {
        fs.rmSync(temp, { recursive: true, force: true })
        throw err;
    }
}

//keeps the newest few downloaded versions, removes the rest (and leftovers of interrupted downloads)
function prune(updatesDir) {
    let names;
    try {
        names = fs.readdirSync(updatesDir)
    } catch {
        return;
    }

    const versions = names.filter((name) => VERSION_PATTERN.test(name)).sort((a, b) => compareVersions(b, a))

    for (const name of names) {
        const stale = versions.indexOf(name) >= KEEP_VERSIONS || /\.tmp-\d+$/.test(name)
        if (stale) fs.rmSync(path.join(updatesDir, name), { recursive: true, force: true })
    }
}

//checks the feed and, if there is a newer version than currentVersion, downloads and stores it
//returns { status: 'current' | 'ready', latestVersion }: 'ready' means a newer version is stored and starts on the next launch
async function stageUpdate({
    feedUrl,
    currentVersion,
    updatesDir,
    fetchImpl = globalThis.fetch,
    allowInsecure = false, //tests only
    timeoutMs = 20000,
    userAgent = 'UltraYT'
}) {
    const feedLocation = new URL(feedUrl)
    if (feedLocation.protocol !== 'https:' && !allowInsecure) throw new Error('The update feed must use https');

    const options = { fetchImpl, timeoutMs, userAgent }
    const feed = parseFeed(await download(feedUrl, { ...options, maxBytes: MAX_FEED_BYTES }))

    if (compareVersions(feed.version, currentVersion) <= 0) {
        return { status: 'current', latestVersion: feed.version };
    }

    //a version that already failed to start here is not offered again (a fixed one has a higher number)
    if (readState(updatesDir).bad.includes(feed.version)) {
        return { status: 'current', latestVersion: currentVersion };
    }

    const stored = path.join(updatesDir, feed.version)
    if (fs.existsSync(path.join(stored, 'src', 'index.js'))) {
        return { status: 'ready', latestVersion: feed.version };
    }

    const bundleLocation = new URL(feed.url, feedUrl)
    if (bundleLocation.origin !== feedLocation.origin) throw new Error('The update bundle is on a different host than the feed');

    const bundle = await download(bundleLocation.href, { ...options, maxBytes: MAX_BUNDLE_BYTES })

    if (crypto.createHash('sha256').update(bundle).digest('hex') !== feed.sha256) {
        throw new Error('The update bundle does not match its checksum');
    }

    const files = parseBundle(bundle, feed.version)

    fs.mkdirSync(updatesDir, { recursive: true })
    writeVersion(updatesDir, feed.version, files)
    prune(updatesDir)

    return { status: 'ready', latestVersion: feed.version };
}

module.exports = {
    isSafePath,
    stageUpdate,
    prune
}
