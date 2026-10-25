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
// native: 'works' (the button toggles fullscreen), 'dead' (it is there but does nothing), 'none' (no such button)
// hostile: page handlers that take or cancel touches, pointers and clicks the way a player could
const watchPage = ({ native = 'works', hostile = false } = {}) => `<!doctype html><title>t</title>
<body style="margin:0">
<div id="movie_player" class="html5-video-player" style="position:relative;width:800px;height:450px;background:#222">
  <video class="html5-main-video" style="width:100%;height:100%"></video>
  <div class="ytp-chrome-bottom" style="position:absolute;left:0;right:0;bottom:0;height:48px"></div>
  ${native !== 'none' ? '<button class="ytp-fullscreen-button ytp-button" style="position:absolute;right:0;bottom:0;width:48px;height:48px"></button>' : ''}
</div>
<script>
  window.__playerClicks = 0
  window.__nativeClicks = 0
  const player = document.getElementById('movie_player')
  player.addEventListener('click', (e) => { if (!e.target.closest('.ytp-fullscreen-button')) window.__playerClicks++ }) // YouTube's own button bubbles up too, that is normal
  const native = player.querySelector('.ytp-fullscreen-button')
  if (${native === 'works'}) native?.addEventListener('click', () => {
    window.__nativeClicks++
    if (document.fullscreenElement) document.exitFullscreen(); else player.requestFullscreen()
  })
  else native?.addEventListener('click', () => { window.__nativeClicks++ })

  if (${hostile}) {
    for (const target of [window, document, player]) {
      for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
        target.addEventListener(type, (e) => { if (e.target.id === 'ultrayt-fullscreen' || e.target.closest?.('#ultrayt-fullscreen')) { e.stopImmediatePropagation(); e.preventDefault() } }, true)
      }
      for (const type of ['touchstart', 'touchend']) {
        target.addEventListener(type, (e) => { e.stopImmediatePropagation(); e.preventDefault() }, { capture: true, passive: false })
      }
    }
  }
</script></body>`

async function withPage(run, { html = watchPage(), url = 'https://www.youtube.com/watch?v=x' } = {}) {
    const browser = await playwright.chromium.launch()
    try {
        const context = await browser.newContext({ viewport: { width: 1000, height: 600 }, locale: 'ru-RU', hasTouch: true })
        const page = await context.newPage()
        await page.route('https://www.youtube.com/**', (route) => route.fulfill({ contentType: 'text/html', body: html }))
        await page.route('https://example.org/**', (route) => route.fulfill({ contentType: 'text/html', body: html }))
        await page.addInitScript(script)
        await page.goto(url)
        await run(page, context)
    } finally {
        await browser.close()
    }
}

const button = (page) => page.locator('#ultrayt-fullscreen')
const hasFullscreen = (page) => page.waitForFunction(() => !!document.fullscreenElement)
const noFullscreen = (page) => page.waitForFunction(() => !document.fullscreenElement)
const buttonTakesTaps = (page, taps) => page.waitForFunction((taps) => getComputedStyle(document.getElementById('ultrayt-fullscreen')).pointerEvents === (taps ? 'auto' : 'none'), taps)
const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

test('a large button appears inside the player and is big enough for a finger', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'attached' })
        assert.equal(await page.evaluate(() => document.getElementById('ultrayt-fullscreen').parentElement.id), 'movie_player')

        const circle = await page.locator('#ultrayt-fullscreen > span').boundingBox()
        assert.ok(circle.width >= 100 && circle.height >= 100, `the round button is ${circle.width}x${circle.height}`)

        const area = await button(page).boundingBox()
        assert.ok(area.width >= circle.width + 30, `the tap area is ${area.width}x${area.height}, the round button ${circle.width}`)
        assert.equal(await button(page).getAttribute('aria-label'), 'Во весь экран')
    })
})

test('a click presses the native fullscreen button once, switches the icon and does not reach the player', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })
        await button(page).click()
        await hasFullscreen(page)

        assert.equal(await page.evaluate(() => window.__playerClicks), 0, 'the click must not pause the video')
        assert.equal(await page.evaluate(() => document.fullscreenElement.id), 'movie_player')
        assert.equal(await button(page).getAttribute('data-state'), 'exit')

        await page.waitForTimeout(1300) // longer than the fallback delay: nothing may toggle a second time
        assert.equal(await page.evaluate(() => window.__nativeClicks), 1)
        assert.equal(await page.evaluate(() => !!document.fullscreenElement), true)

        await button(page).click()
        await noFullscreen(page)
        await page.waitForFunction(() => document.getElementById('ultrayt-fullscreen').dataset.state === 'enter')
    })
})

test('it uses the browser fullscreen when YouTube\'s own button is missing', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })
        await button(page).click()
        await hasFullscreen(page)
        assert.equal(await page.evaluate(() => document.fullscreenElement.id), 'movie_player')
    }, { html: watchPage({ native: 'none' }) })
})

test('it does the job itself when YouTube\'s own button does nothing', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })
        await button(page).click()
        await hasFullscreen(page)
        assert.equal(await page.evaluate(() => window.__nativeClicks), 1)
    }, { html: watchPage({ native: 'dead' }) })
})

test('a finger tap works, also near the edge of the tap area and outside the round picture', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })
        const area = await button(page).boundingBox()

        // 6 px inside the corner of the square: far from the centre and outside the circle
        await page.touchscreen.tap(area.x + 6, area.y + 6)
        await hasFullscreen(page)
        assert.equal(await page.evaluate(() => window.__playerClicks), 0, 'the tap must not reach the player')
    })
})

test('a tap still works when the page cancels touches and takes pointer events and clicks', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })
        const { x, y } = centre(await button(page).boundingBox())

        await page.touchscreen.tap(x, y)
        await hasFullscreen(page)
        await page.waitForFunction(() => document.getElementById('ultrayt-fullscreen').dataset.state === 'exit')

        const again = centre(await button(page).boundingBox()) // it moved up in fullscreen
        await page.touchscreen.tap(again.x, again.y)
        await noFullscreen(page)
    }, { html: watchPage({ hostile: true }) })
})

test('the button stays pressable when YouTube hides its controls while the finger is down', { skip: !playwright }, async () => {
    await withPage(async (page, context) => {
        await button(page).waitFor({ state: 'visible' })
        const { x, y } = centre(await button(page).boundingBox())
        const cdp = await context.newCDPSession(page)

        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        await page.evaluate(() => document.getElementById('movie_player').classList.add('ytp-autohide'))
        await page.waitForTimeout(700) // the controls and the button would be gone by now
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

        await hasFullscreen(page)
    })
})

test('a finger that slides a little before lifting still counts, one that goes far away does not', { skip: !playwright }, async () => {
    await withPage(async (page, context) => {
        await button(page).waitFor({ state: 'visible' })
        const area = await button(page).boundingBox()
        const { x, y } = centre(area)
        const cdp = await context.newCDPSession(page)

        // far away: not a press
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 300, y: y - 200 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await page.waitForTimeout(1200)
        assert.equal(await page.evaluate(() => !!document.fullscreenElement), false)

        // a few pixels off: a press
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 12, y: y - 8 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await hasFullscreen(page)
    })
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
        await buttonTakesTaps(page, true)
    })
})

test('a tap on the player while the button is hidden brings it back for the next tap', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })
        const { x, y } = centre(await button(page).boundingBox())

        await page.evaluate(() => document.getElementById('movie_player').classList.add('ytp-autohide'))
        await buttonTakesTaps(page, false)

        await page.touchscreen.tap(x, y)                       // goes to the player, as before
        assert.equal(await page.evaluate(() => window.__playerClicks), 1)
        await buttonTakesTaps(page, true)                      // and the button is there now, although YouTube still has its controls hidden
        assert.equal(await page.evaluate(() => document.getElementById('movie_player').classList.contains('ytp-autohide')), true)

        await page.touchscreen.tap(x, y)
        await hasFullscreen(page)
        assert.equal(await page.evaluate(() => window.__playerClicks), 1)
    })
})

test('it goes away by itself after a while without touches when the controls are hidden', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })
        await page.evaluate(() => { window.__ultraytDesktop.config.activityMs = 1500 })
        const { x, y } = centre(await button(page).boundingBox())
        const opacity = (value) => page.waitForFunction((value) => getComputedStyle(document.getElementById('ultrayt-fullscreen')).opacity === value, value)

        await page.evaluate(() => document.getElementById('movie_player').classList.add('ytp-autohide'))
        await opacity('0')
        await page.touchscreen.tap(x, y)
        await opacity('1')
        await opacity('0')
    })
})

test('the long-press menu does not open over the button', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })
        const { x, y } = centre(await button(page).boundingBox())

        const prevented = await page.evaluate(({ x, y }) => {
            const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })
            document.getElementById('ultrayt-fullscreen').dispatchEvent(event)
            return event.defaultPrevented
        }, { x, y })
        assert.equal(prevented, true)

        const elsewhere = await page.evaluate(() => {
            const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })
            document.getElementById('movie_player').dispatchEvent(event)
            return event.defaultPrevented
        })
        assert.equal(elsewhere, false)
    })
})

test('the keyboard works too', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })
        await button(page).focus()
        await page.keyboard.press('Enter')
        await hasFullscreen(page)
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

test('in fullscreen the button sits higher than in the window', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })
        const player = await page.locator('#movie_player').boundingBox()
        const distance = async () => {
            const circle = await page.locator('#ultrayt-fullscreen > span').boundingBox()
            const frame = await page.evaluate(() => document.fullscreenElement ? { top: 0, height: innerHeight } : null)
            const bottom = frame ? frame.height : player.y + player.height
            return Math.round(bottom - (circle.y + circle.height))
        }

        const inWindow = await distance()
        await button(page).click()
        await hasFullscreen(page)
        await page.waitForFunction(() => document.getElementById('ultrayt-fullscreen').dataset.state === 'exit')
        const inFullscreen = await distance()

        assert.ok(inWindow >= 80 && inWindow <= 100, `in the window ${inWindow}`)
        assert.ok(inFullscreen >= inWindow + 60, `in fullscreen ${inFullscreen}, in the window ${inWindow}`)
    })
})

test('it steps aside while the settings menu is open', { skip: !playwright }, async () => {
    await withPage(async (page) => {
        await button(page).waitFor({ state: 'visible' })
        await page.evaluate(() => {
            const settings = document.createElement('button')
            settings.className = 'ytp-settings-button'
            settings.setAttribute('aria-expanded', 'false')
            document.getElementById('movie_player').appendChild(settings)
            window.__settings = settings
        })
        await page.evaluate(() => window.__settings.setAttribute('aria-expanded', 'true'))
        await buttonTakesTaps(page, false)

        await page.evaluate(() => window.__settings.setAttribute('aria-expanded', 'false'))
        await buttonTakesTaps(page, true)
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
