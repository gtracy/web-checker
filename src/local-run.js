const puppeteer = require('puppeteer-core');
const pino = require('pino');
const fs = require('fs/promises');
const path = require('path');
const { scrapeItems } = require('./scraper');

const logger = pino({
    level: 'info',
    transport: {
        target: 'pino-pretty'
    }
});

const STATE_FILE = path.join(__dirname, '../state.json');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; // Common path on macOS

async function runLocal() {
    let browser = null;
    try {
        // 1. Retrieve State
        let previousIds = [];
        try {
            const data = await fs.readFile(STATE_FILE, 'utf8');
            previousIds = JSON.parse(data);
        } catch (err) {
            logger.info({ msg: 'No local state file found or empty, starting fresh' });
        }

        // 2. Launch Browser
        // Note: Locally we need a real Chrome path if using puppeteer-core
        // Or we rely on user having Chrome installed.
        logger.info({ msg: 'Launching local browser' });
        browser = await puppeteer.launch({
            executablePath: CHROME_PATH,
            headless: false, // Run headful for visibility or true for background
            defaultViewport: { width: 1280, height: 800 }
        });

        // 3. Scrape
        logger.info({ msg: 'Scraping items...' });
        const currentItems = await scrapeItems(browser);
        const currentIds = currentItems.map(item => item.id);

        // 4. Compare
        const newItems = currentItems.filter(item => !previousIds.includes(item.id));

        // 5. Log
        if (newItems.length > 0) {
            logger.info({
                msg: 'New items found!',
                count: newItems.length,
                items: newItems
            });
        } else {
            logger.info({ msg: 'No new items found', totalScraped: currentItems.length });
        }

        // 6. Save State
        if (currentIds.length > 0) {
            await fs.writeFile(STATE_FILE, JSON.stringify(currentIds, null, 2));
            logger.info({ msg: 'State saved to local file', path: STATE_FILE });
        }

    } catch (error) {
        logger.error({ msg: 'Error in local run', error: error.message, stack: error.stack });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

runLocal();
