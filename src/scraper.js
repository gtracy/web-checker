const puppeteer = require('puppeteer-core');

/**
 * Scrapes the Patagonia Worn Wear Bags & Duffels page.
 * @param {import('puppeteer-core').Browser} browser - The puppeteer browser instance.
 * @returns {Promise<Array<{id: string, title: string, price: string, url: string}>>}
 */
async function scrapeItems(browser) {
    const page = await browser.newPage();

    // Set User-Agent to look like a real browser
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto('https://wornwear.patagonia.com/collections/bags-and-duffels', {
        waitUntil: 'networkidle0',
        timeout: 60000
    });

    // Listen to browser console logs
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

    // Selector for the product grid container
    await page.waitForSelector('ul#algolia-product-grid');

    // Scroll down a to trigger lazy loading if needed (though initial load usually has items)
    // We'll scroll to bottom once to be safe, scraping often works better if elements are in viewport
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight || totalHeight > 5000) { // Limit scroll to avoid infinite loop
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });

    // Extract items
    const items = await page.evaluate(() => {
        // Based on dump, the children are divs with class product-card-wrapper
        const productNodes = document.querySelectorAll('ul#algolia-product-grid .product-card-wrapper');
        console.log(`Found ${productNodes.length} nodes for selector .product-card-wrapper`);
        const products = [];

        productNodes.forEach(node => {
            const linkEl = node.querySelector('a.card__product-url');
            const priceEl = node.querySelector('.card__information .price-item--regular, .card__information .price');

            if (linkEl) {
                const title = linkEl.innerText.trim();
                const url = linkEl.href;
                // Use the ID from the link ID attribute, e.g., "CardLink-9369186238760" -> "9369186238760"
                // Or if not present, hash the URL. The subagent said ID is reliable.
                const idRaw = linkEl.id || '';
                const id = idRaw.replace('CardLink-', '') || url.split('/').pop();

                const price = priceEl ? priceEl.innerText.trim() : 'N/A';

                products.push({
                    id,
                    title,
                    price,
                    url
                });
            } else {
                console.log('Node found but no link element inside', node.className);
            }
        });

        return products;
    });

    if (items.length === 0) {
        console.log('No items scraped. Dumping partial HTML of container...');
        const container = await page.$('ul#algolia-product-grid');
        if (container) {
            const html = await page.evaluate(el => el.innerHTML, container);
            console.log(html.substring(0, 500));
        } else {
            console.log('Container ul#algolia-product-grid not found during dump');
        }
    }

    return items;
}

module.exports = { scrapeItems };
