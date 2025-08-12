import express from 'express';
import crypto from 'crypto';
import etag from 'etag';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import path from 'path';
import { fileURLToPath } from 'url';

const VEHICLE_POSITIONS_URL =
  process.env.VEHICLE_POSITIONS_URL ||
  'https://gtfs.adelaidemetro.com.au/v1/realtime/vehicle_positions';

// Optional: point to a small JSON file that maps route_id -> { short_name, long_name, color }
// Example shape:
// { "AO1": { "short_name": "O-Bahn O1", "long_name": "City to Tea Tree", "color": "#ff6600" } }
const ROUTES_JSON_URL = process.env.ROUTES_JSON_URL || '';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve static assets
app.use(express.static('public'));

// Basic health
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Cache for route metadata (optional)
let routesMeta = {};
async function loadRoutesMeta() {
  if (!ROUTES_JSON_URL) return;
  try {
    const r = await fetch(ROUTES_JSON_URL, { headers: { 'user-agent': 'adelaide-buses-live/1.1' } });
    if (r.ok) {
      routesMeta = await r.json();
      console.log(`Loaded routes metadata from ${ROUTES_JSON_URL} (${Object.keys(routesMeta).length} routes)`);
    } else {
      console.warn(`Failed to load routes JSON ${r.status}`);
    }
  } catch (e) {
    console.warn('Error loading routes JSON:', e.message);
  }
}
loadRoutesMeta().catch(()=>{});
// Periodic refresh in case the source updates
setInterval(loadRoutesMeta, 15 * 60 * 1000).unref();

// Hashing helper
function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

// GTFS-RT proxy with ETag
let lastHash = '';
let lastJson = null;
let lastUpdated = 0;

app.get('/api/vehicle_positions.json', async (req, res) => {
  try {
    const r = await fetch(VEHICLE_POSITIONS_URL, {
      cache: 'no-store',
      headers: { 'user-agent': 'adelaide-buses-live/1.1' }
    });
    if (!r.ok) throw new Error(`Upstream feed error ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());

    // If feed content unchanged, return 304 quickly
    const currentHash = sha1(buf);
    if (lastJson && currentHash === lastHash && req.headers['if-none-match'] === etag(buf)) {
      res.status(304).end();
      return;
    }

    // Decode protobuf
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);

    // Map vehicles
    const vehicles = [];
    for (const e of feed.entity) {
      const v = e.vehicle;
      if (!v?.position || typeof v.position.latitude !== 'number' || typeof v.position.longitude !== 'number') continue;

      const routeId = v.trip?.routeId || '';
      const meta = routesMeta[routeId] || null;

      vehicles.push({
        id: v.vehicle?.label || v.vehicle?.id || e.id,
        label: v.vehicle?.label || v.vehicle?.id || e.id,
        route: routeId || null,
        route_short_name: meta?.short_name || null,
        route_long_name: meta?.long_name || null,
        route_color: meta?.color || null,
        lat: v.position.latitude,
        lon: v.position.longitude,
        bearing: typeof v.position.bearing === 'number' ? v.position.bearing : null,
        timestamp: v.timestamp ? Number(v.timestamp) * 1000 : null
      });
    }

    lastJson = { vehicles, updated: Date.now() };
    lastHash = currentHash;
    lastUpdated = Date.now();

    const tag = etag(buf);
    res.set('ETag', tag);
    res.set('Cache-Control', 'no-store');
    res.json(lastJson);
  } catch (err) {
    console.error(err);
    // If we have a recent good payload, serve it with a stale notice
    if (lastJson && Date.now() - lastUpdated < 2 * 60 * 1000) {
      res.set('Cache-Control', 'no-store');
      res.json({ ...lastJson, stale: true });
      return;
    }
    res.status(502).json({ error: 'Failed to fetch or parse GTFS-RT feed' });
  }
});

// Belt-and-braces route for root
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://0.0.0.0:${PORT}`));
