// Vercel Serverless Function: Share data via Vercel KV (Redis)
// Falls back to in-memory storage if KV is not configured

let memoryStore = {};

async function getKV() {
  // Try to use Vercel KV if available
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import('@vercel/kv');
      return kv;
    } catch (e) {
      // KV not available, fall through
    }
  }
  return null;
}

function generateShareId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export default async function handler(req, res) {
  const kv = await getKV();

  if (req.method === 'POST') {
    // Save shared data
    try {
      const data = req.body;
      const id = generateShareId();
      const key = 'pdfredline:' + id;

      if (kv) {
        // Store in Vercel KV with 30-day expiry
        await kv.set(key, JSON.stringify(data), { ex: 30 * 24 * 60 * 60 });
      } else {
        // Fallback: in-memory (will be lost on cold start)
        memoryStore[key] = JSON.stringify(data);
      }

      return res.status(200).json({ id });
    } catch (e) {
      console.error('Share save error:', e);
      return res.status(500).json({ error: 'Failed to save' });
    }
  }

  if (req.method === 'GET') {
    // Load shared data
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    try {
      const key = 'pdfredline:' + id;
      let raw;

      if (kv) {
        raw = await kv.get(key);
      } else {
        raw = memoryStore[key] ? JSON.parse(memoryStore[key]) : null;
      }

      if (!raw) {
        return res.status(404).json({ error: 'Not found' });
      }

      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return res.status(200).json(data);
    } catch (e) {
      console.error('Share load error:', e);
      return res.status(500).json({ error: 'Failed to load' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
