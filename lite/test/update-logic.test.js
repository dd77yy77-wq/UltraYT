// Builds test/update_logic_check.cpp (the pure parts of the self-update: versions, feed, addresses, SHA-256, program check)
// with the system C++ compiler and runs it. Skipped when there is no g++ or clang++.

const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const compiler = ['g++', 'clang++'].find((name) => spawnSync(name, ['--version']).status === 0)
const source = path.join(__dirname, 'update_logic_check.cpp')

let directory = null
let program = null

function build() {
    if (program) return program
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lite-update-'))
    program = path.join(directory, 'check')
    execFileSync(compiler, ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror', '-o', program, source], { stdio: 'pipe' })
    return program
}

test.after(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }) })

test('versions, feed, addresses, SHA-256 and the program check behave', { skip: !compiler }, () => {
    const result = spawnSync(build(), [], { encoding: 'utf-8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /all checks passed/)
})

test('SHA-256 agrees with node on random files of awkward sizes', { skip: !compiler }, () => {
    for (const size of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 65537, 440000]) {
        const file = path.join(directory ?? (build(), directory), `data-${size}`)
        const bytes = crypto.randomBytes(size)
        fs.writeFileSync(file, bytes)

        const mine = execFileSync(build(), ['sha', file], { encoding: 'utf-8' }).trim()
        assert.equal(mine, crypto.createHash('sha256').update(bytes).digest('hex'), `size ${size}`)
    }
})

test('the published feed is readable by the program and describes the file in lite/dist', { skip: !compiler }, () => {
    const feedFile = path.join(__dirname, '..', 'version.json')
    const result = spawnSync(build(), ['feed', feedFile], { encoding: 'utf-8' })
    assert.equal(result.status, 0, 'the program would not accept lite/version.json')

    const [version, url, sha256, size] = result.stdout.trim().split('\n')
    const file = path.join(__dirname, '..', 'dist', url.split('/').pop())
    assert.ok(fs.existsSync(file), `${file} is missing`)

    const bytes = fs.readFileSync(file)
    assert.equal(bytes.length, Number(size))
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha256)
    assert.ok(bytes.includes(Buffer.from(`/${version} (UltraYT, Windows)`, 'utf16le')), 'the file is not the version the feed names')
    assert.ok(url.endsWith(`-${version}.exe`))
})
