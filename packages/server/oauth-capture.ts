import { chromium } from 'playwright';

const clientId = 'efjhaULMQ7WVHyMbEtSg';
const clientSecret = '21fngWCBwJAGRMwmNTJRX01l8sg4VJVJ';
const redirectUri = 'https://ollgbdihmfdmjnjjdfclaknkbnfgfdnl.chromiumapp.org/';

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
    headers: {
      Authorization: `Basic ${basic}`,
    },
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${JSON.stringify(body)}`);
  }

  return body;
}

async function queryPresence(accessToken: string) {
  const endpoints = [
    'https://api.zoom.us/v2/users/me/presence_status',
    'https://api.zoom.us/v2/users/me',
  ];

  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const text = await res.text();
    console.log(`API ${endpoint} -> ${res.status}`);
    console.log(text);
    if (res.ok) {
      return;
    }
  }
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

  console.log('Open auth URL:', authUrl.toString());
  await page.goto(authUrl.toString(), { waitUntil: 'domcontentloaded' });
  console.log('Please complete Zoom login + consent in the opened browser...');

  const start = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  while (!code && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!code) {
    throw new Error('Timed out waiting for OAuth authorization code');
  }

  console.log('Captured authorization code. Exchanging for tokens...');
  const token = await exchangeCodeForTokens(code);

  console.log('Token exchange success.');
  console.log('access_token (first 24):', String(token.access_token).slice(0, 24));
  console.log('refresh_token (first 24):', String(token.refresh_token).slice(0, 24));
  console.log('expires_in:', token.expires_in);
  console.log('scope:', token.scope);

  console.log('Querying Zoom API for actual status...');
  await queryPresence(token.access_token);

  await browser.close();
}

run().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
