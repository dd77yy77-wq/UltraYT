const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const overlay = require('../src/overlay')
const { tempDir } = require('./helpers/feed')

function install(root, version, { complete = true } = {}) {
    const dir = path.join(root, version)
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }))
    if (complete) fs.writeFileSync(path.join(dir, 'src', 'index.js'), '')
}

test('versions are compared by number, not by text', () => {
    assert.equal(overlay.compareVersions('2.10.0', '2.9.0'), 1)
    assert.equal(overlay.compareVersions('2.1.0', '2.1.0'), 0)
    assert.equal(overlay.compareVersions('1.9.9', '2.0.0'), -1)
})

test('the updates folder lives next to the unpacked program', () => {
    assert.equal(overlay.updatesRoot({ LOCALAPPDATA: '/data' }), path.join('/data', 'UltraYT', 'updates'))
})

test('the bundled code is used when nothing was downloaded', () => {
    assert.equal(overlay.chooseOverlay({ root: path.join(tempDir(), 'missing'), bundledVersion: '2.1.0' }), null)
    assert.equal(overlay.chooseOverlay({ root: tempDir(), bundledVersion: '2.1.0' }), null)
})

test('the newest complete version that is newer than the bundled one is chosen', () => {
    const root = tempDir()
    install(root, '2.0.0')
    install(root, '2.1.0')
    install(root, '2.2.0')
    install(root, '2.3.0', { complete: false })
    fs.mkdirSync(path.join(root, 'junk'))

    assert.equal(overlay.chooseOverlay({ root, bundledVersion: '2.1.0' }).version, '2.2.0')
})

test('a version that never loads a page is dropped after three launches', () => {
    const root = tempDir()
    install(root, '2.2.0')

    for (let launch = 1; launch <= overlay.MAX_ATTEMPTS; launch++) {
        assert.equal(overlay.chooseOverlay({ root, bundledVersion: '2.1.0' })?.version, '2.2.0', `launch ${launch}`)
    }

    assert.equal(overlay.chooseOverlay({ root, bundledVersion: '2.1.0' }), null)
    assert.deepEqual(overlay.readState(root).bad, [ '2.2.0' ])
})

test('a version that loaded a page starts counting from zero again', () => {
    const root = tempDir()
    install(root, '2.2.0')

    for (let launch = 1; launch <= 10; launch++) {
        assert.equal(overlay.chooseOverlay({ root, bundledVersion: '2.1.0' })?.version, '2.2.0', `launch ${launch}`)
        overlay.markGood(root, '2.2.0')
    }

    assert.deepEqual(overlay.readState(root), { attempts: {}, bad: [] })
})

test('a version that throws on start is never chosen again, an older good one is used instead', () => {
    const root = tempDir()
    install(root, '2.2.0')
    install(root, '2.3.0')

    assert.equal(overlay.chooseOverlay({ root, bundledVersion: '2.1.0' }).version, '2.3.0')
    overlay.markBad(root, '2.3.0')

    assert.equal(overlay.chooseOverlay({ root, bundledVersion: '2.1.0' }).version, '2.2.0')
    overlay.markBad(root, '2.2.0')

    assert.equal(overlay.chooseOverlay({ root, bundledVersion: '2.1.0' }), null)
})

test('a damaged state file is treated as empty', () => {
    const root = tempDir()
    install(root, '2.2.0')
    fs.writeFileSync(path.join(root, 'state.json'), '{ not json')

    assert.equal(overlay.chooseOverlay({ root, bundledVersion: '2.1.0' }).version, '2.2.0')
})
