import express from 'express';
import fetch from 'node-fetch';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const VEHICLE_POSITIONS_URL =
  process.env.VEHICLE_POSITIONS_URL ||
  'https://gtfs.adelaidemetro.com.au/v1/realtime/vehicle_positions';

const app = express();
app.use(express.static('public'));

app.get('/api/vehicle_positions.json', async (_req, res) => {
  try {
    const r = await fetch(VEHICLE_POSITIONS_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Feed error ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);

    const vehicles = feed.entity
      .filter(e => e.vehicle && e.vehicle.position)
      .map(e => {
        const v = e.vehicle;
        return {
          id: v.vehicle?.label || v.vehicle?.id || e.id,
          label: v.vehicle?.label || v.vehicle?.id || e.id,
          route: v.trip?.routeId || v.trip?.tripId || null,
          lat: v.position.latitude,
          lon: v.position.longitude,
          bearing: v.position.bearing ?? null,
          timestamp: v.timestamp ? Number(v.timestamp) * 1000 : null
        };
      });

    res.set('Cache-Control', 'no-store');
    res.json({ vehicles, updated: Date.now() });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Failed to fetch or parse GTFS-RT feed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
