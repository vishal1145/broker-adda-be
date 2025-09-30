import axios from 'axios';

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Geocode an address string -> { lat, lng }
 * Uses Google if key is set; falls back to OpenStreetMap Nominatim.
 */
export async function geocodeAddress(fullAddress) {
  if (!fullAddress || !fullAddress.trim()) {
    return null;
  }

  // Normalize common typos and whitespace
  const addressNormalized = fullAddress.replace(/Utter Pradesh/gi, 'Uttar Pradesh').replace(/\s+/g, ' ').trim();

  // Build address candidates by sanitizing duplicates and reducing verbosity
  const partsRaw = addressNormalized.split(',').map(p => p.trim()).filter(Boolean);
  // Remove consecutive duplicates (e.g., "Agra Fort, Agra Fort")
  const partsNoConsecutiveDup = partsRaw.filter((p, i) => i === 0 || p.toLowerCase() !== partsRaw[i - 1].toLowerCase());
  // Cap length to avoid overly verbose queries
  const capped = partsNoConsecutiveDup.slice(0, 5);

  // Heuristic: try these variants from most specific to more general
  const buildCandidates = () => {
    const candidates = [];
    // 1) Full sanitized string
    if (capped.length) candidates.push(capped.join(', '));
    // 2) If looks like POI + locality + state + country: [first, last 3]
    if (capped.length >= 4) {
      const poiPlus = [capped[0], ...capped.slice(-3)].join(', ');
      candidates.push(poiPlus);
    }
    // 3) Locality + state + country (last 3)
    if (capped.length >= 3) candidates.push(capped.slice(-3).join(', '));
    // 4) First two parts (often place + city)
    if (capped.length >= 2) candidates.push(capped.slice(0, 2).join(', '));
    // 5) City + State if identifiable (middle + penultimate)
    if (capped.length >= 2) candidates.push([capped[capped.length - 2], capped[capped.length - 1]].join(', '));
    // Deduplicate candidates
    return Array.from(new Set(candidates.map(c => c.trim()).filter(Boolean)));
  };
  const candidates = buildCandidates();

  try {
    // Prefer Google Maps Geocoding API if available
    if (GOOGLE_KEY) {
      const url = 'https://maps.googleapis.com/maps/api/geocode/json';
      const { data } = await axios.get(url, {
        params: { address: fullAddress, key: GOOGLE_KEY }
      });
      if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
        const { lat, lng } = data.results[0].geometry.location;
        return { lat, lng };
      }
    }

    // Fallback: OpenStreetMap Nominatim (FREE; be nice with rate limits)
    const nominatimUrl = 'https://nominatim.openstreetmap.org/search';
    for (const candidate of candidates) {
      const { data: osm } = await axios.get(nominatimUrl, {
        params: { q: candidate, format: 'json', limit: 1, countrycodes: 'in', addressdetails: 1 },
        headers: { 'User-Agent': 'BrokerAdda/1.0 (contact@yourdomain.com)' }
      });
      if (Array.isArray(osm) && osm[0]?.lat && osm[0]?.lon) {
        const coords = { lat: parseFloat(osm[0].lat), lng: parseFloat(osm[0].lon) };
        return coords;
      }
    }

    return null;
  } catch (err) {
    // Don't break profile completion if geocoding fails
    return null;
  }
}
