const puppeteer = require('puppeteer');
const axios = require('axios');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

async function getSnapshots(url) {
  const currentDate = new Date();
  const limitDate = new Date();
  limitDate.setFullYear(limitDate.getFullYear() - 20);

  const limitTimestamp = limitDate.toISOString().replace(/[-:T.]/g, '').slice(0, 14);

  const cdxApiUrl = `http://web.archive.org/cdx/search/cdx?url=${url}&output=json&fl=timestamp`;
  const response = await axios.get(cdxApiUrl);

  return response.data.slice(1).filter(snapshot => snapshot[0] >= limitTimestamp);
}

async function navigateWithRetry(page, url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await page.goto(url, options);
      return true;
    } catch (error) {
      console.error(`Failed to navigate to ${url}. Retry ${i + 1} of ${retries}.`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  console.error(`Failed to navigate to ${url} after ${retries} retries.`);
  return false;
}

function formatTimestamp(timestamp) {
  const date = new Date(
    parseInt(timestamp.substring(0, 4)),
    parseInt(timestamp.substring(4, 6)) - 1,
    parseInt(timestamp.substring(6, 8)),
    parseInt(timestamp.substring(8, 10)),
    parseInt(timestamp.substring(10, 12)),
    parseInt(timestamp.substring(12, 14))
  );

  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();

  return `${pad(month)}-${pad(day)}-${year}`;
}

function pad(n) {
  return n < 10 ? '0' + n : n;
}

async function run(url) {
  let browser;

  const delayTime = 2000;

  try {
    const snapshots = await getSnapshots(url);

    browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(2 * 60 * 1000);

    const domain = new URL(url).hostname;
    const outputFile = `output_${domain}.csv`;

    const csvWriter = createCsvWriter({
      path: outputFile,
      header: [
        { id: 'timestamp', title: 'TIMESTAMP' },
        { id: 'text', title: 'TEXT' },
      ],
    });

    let data = [];
    let lastContent = null;

    for (const snapshot of snapshots) {
      const timestamp = snapshot[0];
      const formattedTimestamp = formatTimestamp(timestamp);

      const waybackURL = `http://web.archive.org/web/${timestamp}id_/${url}`;

      console.log(`Fetching snapshot from ${waybackURL}...`);

      const success = await navigateWithRetry(page, waybackURL, { waitUntil: 'networkidle0' });

      if (!success) {
        console.log(`Skipping snapshot from ${waybackURL} due to navigation failures.`);
        continue;
      }

      let text;
      try {
        text = await page.evaluate(() => document.body.innerText);
      } catch (error) {
        console.log(`Failed to evaluate script in the page at ${waybackURL}. Skipping this snapshot.`);
        continue;
      }

      const cleanedText = text.trim().replace(/\s+/g, ' ');

      if (cleanedText === lastContent) {
        console.log('Content is the same as the last snapshot. Skipping...');
        continue;
      }

      lastContent = cleanedText;
      console.log(`Timestamp: ${formattedTimestamp}`);
      console.log(cleanedText);
      data.push({ timestamp: formattedTimestamp, text: cleanedText });

      await page.waitForTimeout(delayTime);
    }

    await csvWriter.writeRecords(data);
    console.log(`Data written to ${outputFile}`);
  } catch (e) {
    console.error('Scrape failed: ', e);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Read the URL from the command line arguments
const url = process.argv[2];

// Call the run function with the provided URL
run(url);
