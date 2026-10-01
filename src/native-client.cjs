'use strict';
const { EventEmitter } = require('node:events');
const path = require('node:path');

// Uses the existing UI and read-only ACK adapter. Does not inject whatsapp-web.js.
class NativeClient extends EventEmitter {
  constructor(options, launcher) {
    super();
    this.options = options;
    this.launcher = launcher;
    this.stopping = false;
  }
  async initialize() {
    const puppeteer = this.launcher || require(require.resolve('puppeteer', {
      paths: [path.dirname(require.resolve('whatsapp-web.js'))]
    }));
    this.pupBrowser = await puppeteer.launch({ ...this.options.puppeteer,
      userDataDir: path.join(this.options.sessionDir, 'session') });
    if (this.stopping) { await this.pupBrowser.close(); return; }
    this.pupPage = (await this.pupBrowser.pages())[0] || await this.pupBrowser.newPage();
    await this.pupPage.setUserAgent(this.options.userAgent);
    await this.pupPage.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 90000 });
    let lastQr;
    while (!this.stopping) {
      const state = await this.pupPage.evaluate(() => {
        const side = document.querySelector('#side');
        let modelsReady = false;
        try { modelsReady = !!window.require('WAWebCollections').Msg; } catch {}
        const qr = document.querySelector('[data-ref]');
        return { ready: !!side && side.getBoundingClientRect().width > 0 && modelsReady,
          qr: qr?.querySelector('canvas') ? qr.getAttribute('data-ref') : null };
      });
      if (state.ready) { this.emit('ready'); return; }
      if (state.qr && state.qr !== lastQr) { lastQr = state.qr; this.emit('qr', state.qr); }
      await new Promise(resolve => { this.wake = resolve; this.timer = setTimeout(resolve, 1000); });
      this.wake = null;
    }
  }
  async destroy() {
    this.stopping = true;
    clearTimeout(this.timer);
    this.wake?.();
    await this.pupBrowser?.close();
  }
}
module.exports = { NativeClient };
