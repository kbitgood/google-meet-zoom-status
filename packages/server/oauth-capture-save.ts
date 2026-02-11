import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const clientId = 'efjhaULMQ7WVHyMbEtSg';
const clientSecret = '21fngWCBwJAGRMwmNTJRX01l8sg4VJVJ';
const redirectUri = 'https://ollgbdihmfdmjnjjdfclaknkbnfgfdnl.chromiumapp.org/';
const outFile = '/tmp/zoom-oauth-token.json';

const authUrl = new URL('https://zoom.us/oauth/authorize');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);

function extractCode(u: string): string | null {
  try {
    const parsed = new URL(u);
    return parsed.searchParams.get('code');
  } catch {
    return null;
  }
}

async function exchangeCodeForTokens(code: string) {
  const tokenUrl = new URL('https://zoom.us/oauth/token');
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${JSON.stringify(body)}`);
  }

  return body;
}

async function run() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  let code: string | null = null;
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    const c = extractCode(frame.url());
    if (c) code = c;
  });

  page.on('requestfailed', (req) => {
    const c = extractCode(req.url());
    if (c) code = c;
  });

  await page.goto(authUrl.toString(), { waitUntil: 'domcontentloaded' });

  const deadline = Date.now() + 5 * 60 * 1000;
  while (!code && Date.now() < deadline) {
    await page.waitForTimeout(300);
  }

  if (!code) {
    throw new Error('Timed out waiting for OAuth code');
  }

  const token = await exchangeCodeForTokens(code);
  writeFileSync(outFile, JSON.stringify(token, null, 2));
  console.log(`saved_token_file=${outFile}`);
  console.log(`access_token_prefix=${String(token.access_token).slice(0, 12)}`);
  console.log(`refresh_token_prefix=${String(token.refresh_token).slice(0, 12)}`);

  await browser.close();
}

run().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
