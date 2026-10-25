// Runs src/desktop.js in a real Chromium (Playwright) against a stand-in for YouTube's player markup.
// Skipped when Playwright or its Chromium is not installed.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

let playwright = null
try { playwright = require('playwright') } catch {}

const script = fs.readFileSync(path.join(__dirname, '..', 'src', 'desktop.js'), 'utf-8')

// the pieces of the real player the script relies on: #movie_player, .ytp-autohide and YouTube's own .ytp-fullscreen-button
const watchPage = (withNativeButton = true) => `<!doctype html><title>t</title>
<body style="margin:0">
<div id="movie_player" class="html5-video-player" style="position:relative;width:800px;height:450px;background:#222">
  <video class="html5-main-video" style="width:100%;height:100%"></video>
  <div class="ytp-chrome-bottom" style="position:absolute;left:0;right:0;bottom:0;height:48px"></div>
  ${withNativeButton ? '<button class="ytp-fullscreen-button ytp-button" style="position:absolute;right:0;bottom:0;width:48px;height:48px"></button>' : ''}
</div>
<script>
  window.__playerClicks = 0
  window.__nativeClicks = 0
  const player = document.getElementById('movie_player')
  player.addEventListener('click', (e) => { if (!e.target.closest('.ytp-fullscreen-button')) window.__playerClicks++ }) // YouTube's own button bubbles up too, that is normal
  const native = player.querySelector('.ytp-fullscreen-button')
  native?.addEventListener('click', () => {
    window.__nativeClicks++
    if (document.fullscreenElement) document.exitFullscreen(); else player.requestFullscreen()
  })
</script></body>`

async function withPage(run, { html = watchPage(), url = 'https://www.youtube.com/watch?v=x' } = {}) {
    const browser = await playwright.chromium.launch()
    try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 600 }, locale: 'ru-RU' })
        await page.route('https://www.youtube.com/**', (route) => route.fulfill({ contentType: 'text/html', body: html }))
        await page.route('https://example.org/**', (route) => route.fulfill({ contentType: 'text/html', body: html }))
        await page.addInitScript(script)
        await page.goto(url)
        await run(page)
    } finally {
        await browser.close()
    }
}

const button = (page) => page.locator('#ultrayt-fullscreen')

test('a large button appears inside the player and is big enough for a finger', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'attached' })
        assert.equal(await page.evaluate(() => document.getElementById('ultrayt-fullscreen').parentElement.id), 'movie_player')

        const box = await button(page).boundingBox()
        assert.ok(box.width >= 64 && box.height >= 64, `button is ${box.width}x${box.height}`)
        assert.equal(await button(page).getAttribute('aria-label'), 'Во весь экран')
    })
})

test('tapping it presses the native fullscreen button, switches the icon and does not reach the player', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })
        await button(page).click()
        await page.waitForFunction(() => !!document.fullscreenElement)

        assert.equal(await page.evaluate(() => window.__nativeClicks), 1)
        assert.equal(await page.evaluate(() => window.__playerClicks), 0, 'the click must not pause the video')
        assert.equal(await page.evaluate(() => document.fullscreenElement.id), 'movie_player')
        assert.equal(await button(page).getAttribute('data-state'), 'exit')

        await button(page).click()
        await page.waitForFunction(() => !document.fullscreenElement)
        assert.equal(await button(page).getAttribute('data-state'), 'enter')
    })
})

test('it uses the browser fullscreen when YouTube\'s own button is missing', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })
        await button(page).click()
        await page.waitForFunction(() => !!document.fullscreenElement)
        assert.equal(await page.evaluate(() => document.fullscreenElement.id), 'movie_player')
    }, { html: watchPage(false) })
})

test('it hides together with the player controls and comes back with them', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })

        await page.evaluate(() => document.getElementById('movie_player').classList.add('ytp-autohide'))
        await page.waitForFunction(() => {
            const style = getComputedStyle(document.getElementById('ultrayt-fullscreen'))
            return style.pointerEvents === 'none' && style.opacity === '0' // opacity fades, so wait for the end of the transition
        })

        await page.evaluate(() => document.getElementById('movie_player').classList.remove('ytp-autohide'))
        await page.waitForFunction(() => getComputedStyle(document.getElementById('ultrayt-fullscreen')).pointerEvents === 'auto')
    })
})

test('it moves to a new player when the page replaces it without reloading', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'attached' })
        await page.evaluate(() => {
            document.getElementById('movie_player').remove()
            const next = document.createElement('div')
            next.id = 'movie_player'
            next.className = 'html5-video-player'
            next.style.cssText = 'position:relative;width:640px;height:360px'
            document.body.appendChild(next)
            window.__nextPlayer = next
        })
        await page.waitForFunction(() => document.getElementById('ultrayt-fullscreen')?.parentElement === window.__nextPlayer)
        assert.equal(await page.evaluate(() => document.querySelectorAll('#ultrayt-fullscreen').length), 1)
    })
})

test('nothing is added on other sites', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await page.waitForTimeout(1200)
        assert.equal(await page.evaluate(() => document.querySelectorAll('#ultrayt-fullscreen').length), 0)
        assert.equal(await page.evaluate(() => window.__ultraytDesktop), undefined)
    }, { url: 'https://example.org/watch' })
})

test('nothing is added on a page without a player', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await page.waitForTimeout(1200)
        assert.equal(await page.evaluate(() => document.querySelectorAll('#ultrayt-fullscreen').length), 0)
    }, { html: '<!doctype html><title>t</title><body>home</body>', url: 'https://www.youtube.com/' })
})
