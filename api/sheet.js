import crypto from 'node:crypto';

// ponytail: in-memory cache for google access token (1h lifetime)
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && tokenExpiry > now + 60) return cachedToken;

  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claimSet = Buffer.from(JSON.stringify({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: creds.token_uri,
    exp: now + 3600,
    iat: now
  })).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${claimSet}`);
  const signature = sign.sign(creds.private_key, 'base64url');
  const jwt = `${header}.${claimSet}.${signature}`;

  const res = await fetch(creds.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'Auth failed');
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in || 3600);
  return cachedToken;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { spreadsheetId, sheet } = req.query;
  if (!spreadsheetId) return res.status(400).json({ error: 'spreadsheetId required' });

  try {
    const token = await getAccessToken();
    const sheetParam = sheet ? `'${sheet}'` : 'A1:Z500';
    const range = encodeURIComponent(sheetParam);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;

    const apiRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await apiRes.json();

    if (!apiRes.ok) return res.status(apiRes.status).json(data);

    // Extract headers and rows
    const values = data.values || [];
    const cols = values.length ? values[0] : [];
    const rows = values.length > 1 ? values.slice(1) : [];

    return res.status(200).json({ cols, rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
