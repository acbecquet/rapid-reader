// Shared CORS + bearer-token gate for the API endpoints.
// Returns true when the request may proceed; otherwise the response has
// already been written.
import { hasRedis } from './store.js';

export function gate(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  const required = process.env.RAPID_READER_TOKEN;
  if (required === undefined && hasRedis()) {
    res.status(503).json({ error: 'Set the RAPID_READER_TOKEN env var' });
    return false;
  }
  if (required !== undefined) {
    const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    if (bearer !== required && req.query?.token !== required) {
      res.status(401).json({ error: 'bad or missing token' });
      return false;
    }
  }
  return true;
}
