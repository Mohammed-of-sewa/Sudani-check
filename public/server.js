const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = "https://api.fast.com/netflix/speedtest/v2";

app.use(express.static(path.join(__dirname, "public")));

function unescapeJsonString(s) {
  try { return JSON.parse(`"${s}"`); } catch { return s; }
}

async function getFastToken() {
  const html = await (await fetch("https://fast.com/", {
    headers: { "User-Agent": "Mozilla/5.0" }
  })).text();

  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map(m => m[1])
    .filter(x => /app-.*\.js/i.test(x));

  if (!scripts.length) throw new Error("Could not find Fast.com JavaScript bundle.");

  for (const src of scripts) {
    const url = new URL(src, "https://fast.com/").href;
    const js = await (await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    })).text();

    const m =
      js.match(/token\s*:\s*["']([A-Za-z0-9_-]+)["']/) ||
      js.match(/token["']?\s*[:=]\s*["']([A-Za-z0-9_-]+)["']/);

    if (m) return m[1];
  }

  throw new Error("Could not extract the current Fast.com token.");
}

function normalizeTarget(t) {
  return {
    url: t.url || "",
    city: t.location?.city || "",
    country: t.location?.country || "",
    name: t.location?.name || "",
    hostname: (() => {
      try { return new URL(t.url).hostname; } catch { return ""; }
    })()
  };
}

async function getTargets() {
  const token = await getFastToken();
  const url = `${API_BASE}?https=true&token=${encodeURIComponent(token)}&urlCount=20`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
  });
  if (!response.ok) throw new Error(`Fast.com API returned HTTP ${response.status}`);
  const data = await response.json();
  return {
    tokenFound: true,
    client: data.client || {},
    targets: (data.targets || []).map(normalizeTarget),
    endpoint: API_BASE
  };
}

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  const start = performance.now();

  try {
    // A tiny range request is enough to measure application-level RTT.
    const u = new URL(url);
    u.searchParams.set("poolcheck", Date.now().toString());

    const r = await fetch(u, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Range": "bytes=0-0",
        "Cache-Control": "no-cache"
      },
      signal: controller.signal
    });

    const ms = performance.now() - start;
    return {
      ok: true,
      ms: Math.round(ms * 10) / 10,
      status: r.status
    };
  } catch (e) {
    return { ok: false, error: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(timer);
  }
}

app.get("/api/pool", async (req, res) => {
  try {
    const data = await getTargets();

    // Probe in parallel, but keep the result bounded.
    const probed = await Promise.all(data.targets.map(async (t) => ({
      ...t,
      probe: await probe(t.url)
    })));

    probed.sort((a, b) => {
      const am = a.probe.ok ? a.probe.ms : Infinity;
      const bm = b.probe.ok ? b.probe.ms : Infinity;
      return am - bm;
    });

    const best = probed.find(x => x.probe.ok) || null;
    const paris = probed.filter(x =>
      /paris|par/i.test(`${x.city} ${x.name} ${x.hostname}`)
    );

    res.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      client: {
        ip: data.client.ip || null,
        isp: data.client.isp || null,
        asn: data.client.asn || null,
        city: data.client.location?.city || null,
        country: data.client.location?.country || null,
        countryCode: data.client.location?.countryCode || null
      },
      endpoint: data.endpoint,
      targetCount: probed.length,
      best,
      paris,
      targets: probed
    });
  } catch (e) {
    res.status(502).json({
      ok: false,
      error: e.message,
      hint: "Fast.com may have changed its frontend/API, or the server cannot reach Fast.com."
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Sudani Fast Pool Checker: http://localhost:${PORT}`);
});
