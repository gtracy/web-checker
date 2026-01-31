const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const pino = require('pino');
const { scrapeItems } = require('./scraper');

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: undefined // Remove pid and hostname for cleaner CloudWatch logs
});

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const sns = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET_NAME = process.env.STATE_BUCKET_NAME;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const STATE_KEY = 'state.json';
const RANDOM_WINDOW_MINUTES = 10;

// Helper to stream to string for S3 body
const streamToString = (stream) =>
    new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });

exports.handler = async (event) => {
    // 1. Random Sleep
    const sleepTimeMs = Math.floor(Math.random() * RANDOM_WINDOW_MINUTES * 60 * 1000);
    logger.info({ msg: 'Starting execution with random sleep', sleepTimeMs });

    if (sleepTimeMs > 0) {
        await new Promise(resolve => setTimeout(resolve, sleepTimeMs));
    }

    let browser = null;
    try {
        // 2. Retrieve State
        let previousIds = [];
        try {
            const data = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: STATE_KEY }));
            const bodyContents = await streamToString(data.Body);
            previousIds = JSON.parse(bodyContents);
        } catch (err) {
            if (err.name === 'NoSuchKey') {
                logger.info({ msg: 'No previous state found, starting fresh' });
            } else {
                logger.warn({ msg: 'Error retrieving state from S3', error: err.message });
            }
        }

        // 3. Launch Browser
        logger.info({ msg: 'Launching browser' });
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        // 4. Scrape
        const currentItems = await scrapeItems(browser);
        const currentIds = currentItems.map(item => item.id);

        // 5. Compare
        const newItems = currentItems.filter(item => !previousIds.includes(item.id));

        // 6. Log & Alert
        if (newItems.length > 0) {
            logger.info({
                msg: 'New items found!',
                count: newItems.length,
                items: newItems
            });

            // Send SNS Alert
            if (SNS_TOPIC_ARN) {
                try {
                    const message = `Found ${newItems.length} new Patagonia bags:\n\n` +
                        newItems.map(item => `- ${item.title} (${item.price})\n  ${item.url}`).join('\n\n');

                    await sns.send(new PublishCommand({
                        TopicArn: SNS_TOPIC_ARN,
                        Subject: `New Patagonia Worn Wear Items Found (${newItems.length})`,
                        Message: message
                    }));
                    logger.info({ msg: 'SNS Alert sent' });
                } catch (snsErr) {
                    logger.error({ msg: 'Failed to send SNS alert', error: snsErr.message });
                }
            }

        } else {
            logger.info({ msg: 'No new items found', totalScraped: currentItems.length });
        }

        // 7. Save State
        // Only save if we successfully scraped something to avoid clearing state on empty errors
        if (currentIds.length > 0) {
            await s3.send(new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: STATE_KEY,
                Body: JSON.stringify(currentIds),
                ContentType: 'application/json'
            }));
            logger.info({ msg: 'State updated in S3' });
        }

    } catch (error) {
        logger.error({ msg: 'Global error in handler', error: error.message, stack: error.stack });
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
};
