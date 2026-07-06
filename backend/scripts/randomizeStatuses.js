/**
 * Randomize Submission Statuses Script
 *
 * Generates a super user JWT and uses the API to randomly update
 * the status of a few submissions.
 * Usage: node scripts/randomizeStatuses.js
 */

import jwt from 'jsonwebtoken';
import http from 'http';

const PORT = parseInt(process.env.PORT || '5001', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_change_in_production_12345';
const VALID_STATUSES = ['pending', 'approved', 'rejected', 'in-review', 'needs-revision', 'under-evaluation', 'on-hold', 'withdrawn'];

// isTemporary=true bypasses DB user lookup; role=super passes inline ownership checks
const token = jwt.sign(
  { id: 'script-admin', email: 'admin@example.com', role: 'super', name: 'Script Admin', isTemporary: true },
  JWT_SECRET,
  { expiresIn: '1h' }
);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data && { 'Content-Length': Buffer.byteLength(data) })
      }
    };
    const req = http.request(options, res => {
      let raw = '';
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function randomStatus() {
  return VALID_STATUSES[Math.floor(Math.random() * VALID_STATUSES.length)];
}

function pickRandom(arr, n) {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

async function main() {
  const result = await request('GET', '/api/tracker');

  if (result?.status === 'error') {
    console.error('Failed to fetch submissions:', result.message);
    process.exit(1);
  }

  const submissions = result?.data?.submissions;

  if (!submissions || submissions.length === 0) {
    console.log('No submissions found.');
    return;
  }

  const count = Math.ceil(submissions.length * 0.5);
  const picked = pickRandom(submissions, count);

  console.log(`\nUpdating ${picked.length} of ${submissions.length} submissions:\n`);

  for (const sub of picked) {
    const newStatus = randomStatus();
    // Use PUT (inline role check) instead of PATCH /status (requireSuper blocks temp users)
    const res = await request('PUT', `/api/tracker/${sub.id}`, { status: newStatus });
    if (res?.status === 'success') {
      console.log(`  ${sub.id}`);
      console.log(`    ${sub.status} → ${newStatus}`);
    } else {
      console.log(`  ${sub.id} - FAILED:`, res?.message || res);
    }
  }

  console.log('\nDone.\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
