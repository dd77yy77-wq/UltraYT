//builds the update bundle for the current version in package.json and the feed that points to it
//
//  node tools/make-update.js [--notes "what changed"]
//
//writes updates/app-<version>.json.gz and version.json in the repository root; commit and push both to publish the update
//running copies of UltraYT look at version.json (see updateFeedUrl in src/constants.js) and download the bundle if it is newer than what they run

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { isSafePath } = require('../src/self-update.js')
const { VERSION_PATTERN } = require('../src/overlay.js')

const ROOT = path.join(__dirname, '..')
const KEEP_IN_PACKAGE = [ 'name', 'version', 'description', 'main', 'license', 'author' ] //same as build.sh
const IGNORED = new Set([ '.DS_Store', 'Thumbs.db' ])

function walk(dir, prefix, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (IGNORED.has(entry.name)) continue;

        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        const full = path.join(dir, entry.name)

        if (entry.isDirectory()) walk(full, rel, out);
        else if (entry.isFile()) out.push({ rel, full });
        else throw new Error(`Unsupported file type: ${rel}`);
    }
}

//everything the running app needs besides Electron itself, keyed by its path inside the app folder
function collectFiles(root = ROOT) {
    const files = {}

    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
    const trimmed = {}
    for (const key of KEEP_IN_PACKAGE) if (key in pkg) trimmed[key] = pkg[key];
    files['package.json'] = Buffer.from(JSON.stringify(trimmed, null, 4))

    for (const [ folder, target ] of [ [ 'src', 'src' ], [ 'locale', 'locale' ], [ 'assets', 'assets' ], [ 'shims', 'node_modules' ] ]) {
        const found = []
        walk(path.join(root, folder), target, found)

        for (const { rel, full } of found) files[rel] = fs.readFileSync(full);
    }

    return { version: pkg.version, files };
}

function buildBundle({ version, files }) {
    if (!VERSION_PATTERN.test(version)) throw new Error(`"${version}" is not a valid version (use 1.2.3)`);

    const encoded = {}
    for (const rel of Object.keys(files).sort()) {
        if (!isSafePath(rel)) throw new Error(`This path cannot be part of an update: ${rel}`);
        encoded[rel] = files[rel].toString('base64')
    }

    if (!encoded['src/index.js']) throw new Error('src/index.js is missing');

    return zlib.gzipSync(Buffer.from(JSON.stringify({ version, files: encoded })), { level: 9 });
}

function main() {
    const notesAt = process.argv.indexOf('--notes')
    const notes = notesAt > -1 ? process.argv[notesAt + 1] || '' : ''

    const { version, files } = collectFiles()
    const bundle = buildBundle({ version, files })
    const name = `app-${version}.json.gz`

    const dir = path.join(ROOT, 'updates')
    fs.mkdirSync(dir, { recursive: true })

    //the feed only ever points to the newest bundle, so older ones are not needed
    for (const old of fs.readdirSync(dir)) if (/^app-.*\.json\.gz$/.test(old) && old !== name) fs.rmSync(path.join(dir, old));

    fs.writeFileSync(path.join(dir, name), bundle)

    const feed = {
        version,
        url: `updates/${name}`,
        sha256: crypto.createHash('sha256').update(bundle).digest('hex'),
        size: bundle.length,
        notes
    }
    fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify(feed, null, 4) + '\n')

    console.log(`${name}: ${bundle.length} bytes, ${Object.keys(files).length} files`)
    console.log(`version.json: ${version}`)
}

if (require.main === module) main();

module.exports = { collectFiles, buildBundle }
