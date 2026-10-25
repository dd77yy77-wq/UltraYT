// Runs src/inject.js in a real Chromium (Playwright) with a fake gamepad and checks the key events it produces.
// Skipped when Playwright or its Chromium is not installed.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

let playwright = null
try { playwright = require('playwright') } catch {}

const script = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject.js'), 'utf-8')

async function withPage(run) {
    const browser = await playwright.chromium.launch()
    try {
        const page = await browser.newPage()
        await page.route('https://www.youtube.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>t</title><body>yt</body>' }))
        await page.route('https://example.org/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>other</body>' }))

        // a fake gamepad that the test controls through window.__pad
        await page.addInitScript(() => {
            window.__pad = { index: 0, connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] }
            window.__present = true
            navigator.getGamepads = () => (window.__present ? [window.__pad, null, null, null] : [null, null, null, null])
            window.__events = []
            document.addEventListener('keydown', (e) => window.__events.push('down:' + e.keyCode))
            document.addEventListener('keyup', (e) => window.__events.push('up:' + e.keyCode))
        })
        await page.addInitScript(script)

        await run(page)
    } finally {
        await browser.close()
    }
}

const events = (page) => page.evaluate(() => window.__events.slice())
const frames = (page, n = 3) => page.evaluate((n) => new Promise((resolve) => { let i = 0; const tick = () => (++i >= n ? resolve() : requestAnimationFrame(tick)); requestAnimationFrame(tick) }), n)

test('a button press and release become keydown and keyup with keyCode 32768 + button index', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await page.goto('https://www.youtube.com/tv')
        await page.bringToFront()
        await page.evaluate(() => window.focus())
        assert.equal(await page.evaluate(() => document.hasFocus()), true)

        await page.evaluate(() => { window.__pad.buttons[0].pressed = true })  // A
        await frames(page)
        await page.evaluate(() => { window.__pad.buttons[0].pressed = false })
        await frames(page)

        assert.deepEqual(await events(page), ['down:32768', 'up:32768'])
    })
})

test('the left stick and the d-pad buttons map to the keys leanback expects', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await page.goto('https://www.youtube.com/tv')
        await page.evaluate(() => window.focus())

        await page.evaluate(() => { window.__pad.axes[0] = -0.9 })  // stick left -> 32768 + 19
        await frames(page)
        await page.evaluate(() => { window.__pad.axes[0] = 0 })
        await frames(page)
        await page.evaluate(() => { window.__pad.axes[1] = 0.9 })   // stick down -> 32768 + 18
        await frames(page)
        await page.evaluate(() => { window.__pad.axes[1] = 0 })
        await frames(page)
        await page.evaluate(() => { window.__pad.buttons[12].pressed = true })  // d-pad up -> 32768 + 12
        await frames(page)
        await page.evaluate(() => { window.__pad.buttons[12].pressed = false })
        await frames(page)

        assert.deepEqual(await events(page), ['down:32787', 'up:32787', 'down:32786', 'up:32786', 'down:32780', 'up:32780'])
    })
})

test('a held button repeats after a delay and stops when released', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await page.goto('https://www.youtube.com/tv')
        await page.evaluate(() => window.focus())

        await page.evaluate(() => { window.__pad.buttons[13].pressed = true }) // d-pad down
        await page.waitForTimeout(900)
        await page.evaluate(() => { window.__pad.buttons[13].pressed = false })
        await frames(page)
        const list = await events(page)

        const downs = list.filter((e) => e === 'down:32781').length
        assert.ok(downs >= 3, `expected repeats, got ${downs}`)
        assert.equal(list[list.length - 1], 'up:32781')

        const after = (await events(page)).length
        await page.waitForTimeout(400)
        assert.equal((await events(page)).length, after, 'no more events after release')
    })
})

test('unplugging a pad that is holding a button releases it', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await page.goto('https://www.youtube.com/tv')
        await page.evaluate(() => window.focus())

        await page.evaluate(() => { window.__pad.buttons[1].pressed = true })
        await frames(page)
        await page.evaluate(() => { window.__present = false })
        await frames(page)

        const list = await events(page)
        assert.equal(list[0], 'down:32769')
        assert.ok(list.includes('up:32769'))
    })
})

test('the script does nothing on other sites', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await page.goto('https://example.org/')
        await page.evaluate(() => window.focus())

        await page.evaluate(() => { window.__pad.buttons[0].pressed = true })
        await frames(page)

        assert.deepEqual(await events(page), [])
        assert.equal(await page.evaluate(() => typeof window.__ultraytLite), 'undefined')
    })
})
