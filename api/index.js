import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';

const allowOrigin = process.env.ALLOWED_ORIGIN || '*';
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, status, data) {
  cors(res);
  res.status(status).json(data);
}
function key(roomId, field) {
  return `room:${roomId}:${field}`;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const path = pathname.replace(/^\/api/, ''); // remove /api prefix

  try {
    // -------------------
    // /room
    // -------------------
    if (path === '/room') {
      if (req.method === 'POST') {
        const roomId = nanoid(8);
        await kv.set(key(roomId, 'created'), Date.now(), { ex: 3600 });
        return json(res, 201, { roomId });
      }
      if (req.method === 'GET') {
        const id = searchParams.get('id');
        if (!id) return json(res, 400, { error: 'id required' });
        const offer = await kv.get(key(id, 'offer'));
        const answer = await kv.get(key(id, 'answer'));
        return json(res, 200, {
          exists: !!(await kv.get(key(id, 'created'))),
          hasOffer: !!offer,
          hasAnswer: !!answer
        });
      }
      return json(res, 405, { error: 'Method not allowed' });
    }

    // -------------------
    // /offer
    // -------------------
    if (path === '/offer') {
      if (req.method === 'GET') {
        const roomId = searchParams.get('roomId');
        if (!roomId) return json(res, 400, { error: 'roomId required' });
        const offer = await kv.get(key(roomId, 'offer'));
        return json(res, 200, { offer: offer || null });
      }
      if (req.method === 'POST') {
        const { roomId, sdp } = req.body || {};
        if (!roomId || !sdp) return json(res, 400, { error: 'roomId and sdp required' });
        await kv.set(key(roomId, 'offer'), sdp, { ex: 3600 });
        await kv.del(key(roomId, 'candidates:caller'));
        await kv.del(key(roomId, 'candidates:callee'));
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'Method not allowed' });
    }

    // -------------------
    // /answer
    // -------------------
    if (path === '/answer') {
      if (req.method === 'GET') {
        const roomId = searchParams.get('roomId');
        if (!roomId) return json(res, 400, { error: 'roomId required' });
        const answer = await kv.get(key(roomId, 'answer'));
        return json(res, 200, { answer: answer || null });
      }
      if (req.method === 'POST') {
        const { roomId, sdp } = req.body || {};
        if (!roomId || !sdp) return json(res, 400, { error: 'roomId and sdp required' });
        await kv.set(key(roomId, 'answer'), sdp, { ex: 3600 });
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'Method not allowed' });
    }

    // -------------------
    // /candidate
    // -------------------
    if (path === '/candidate') {
      if (req.method === 'POST') {
        const { roomId, role, candidate } = req.body || {};
        if (!roomId || !role || !candidate) return json(res, 400, { error: 'roomId, role, candidate required' });
        if (!['caller', 'callee'].includes(role)) return json(res, 400, { error: 'role must be caller or callee' });
        const listKey = key(roomId, `candidates:${role}`);
        await kv.rpush(listKey, JSON.stringify(candidate));
        await kv.expire(listKey, 3600);
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'Method not allowed' });
    }

    // -------------------
    // /candidates
    // -------------------
    if (path === '/candidates') {
      if (req.method === 'GET') {
        const roomId = searchParams.get('roomId');
        const role = searchParams.get('role');
        if (!roomId || !role) return json(res, 400, { error: 'roomId and role required' });
        const sourceRole = role === 'caller' ? 'callee' : 'caller';
        const listKey = key(roomId, `candidates:${sourceRole}`);
        const items = await kv.lrange(listKey, 0, -1);
        const candidates = (items || []).map((x) => JSON.parse(x));
        return json(res, 200, { candidates, count: candidates.length });
      }
      return json(res, 405, { error: 'Method not allowed' });
    }

    // -------------------
    // Not found
    // -------------------
    return json(res, 404, { error: 'Not found' });

  } catch (err) {
    console.error(err);
    return json(res, 500, { error: 'Server error', details: err.message });
  }
}
