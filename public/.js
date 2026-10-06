const $ = id => document.getElementById(id);

function esc(s) {
  return String(s ?? "—").replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function place(t) {
  const p = [t.city, t.country].filter(Boolean).join(", ");
  return p || t.name || "Unknown";
}
function row(t) {
  const rtt = t.probe?.ok ? `${t.probe.ms} ms` : `<span class="fail">${esc(t.probe?.error || "failed")}</span>`;
  return `<div class="row">
    <div>
      <div class="place">${esc(place(t))}<span class="tag">${esc(t.country || "")}</span></div>
      <div class="host">${esc(t.hostname || t.url)}</div>
    </div>
    <div class="rtt">${rtt}</div>
  </div>`;
}
async function check() {
  $("checkBtn").disabled = true;
  $("status").textContent = "Connecting to Fast.com and retrieving CDN targets…";
  $("poolState").textContent = "CHECKING…";
  $("poolState").className = "pool unknown";
  try {
    const r = await fetch("/api/pool", {cache:"no-store"});
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || "Request failed");

    $("ip").textContent = d.client.ip || "—";
    $("isp").textContent = d.client.isp || "—";
    $("asn").textContent = d.client.asn || "—";
    $("clientLoc").textContent =
      [d.client.city, d.client.country].filter(Boolean).join(", ") || "—";
    $("targetCount").textContent = d.targetCount;
    $("parisCount").textContent = d.paris.length;
    $("endpoint").textContent = d.endpoint;

    if (d.paris.length) {
      const bestParis = d.paris.find(x => x.probe.ok) || d.paris[0];
      $("poolState").textContent = "PARIS DETECTED";
      $("poolState").className = "pool good";
      $("poolDetail").textContent =
        `${place(bestParis)} • ${bestParis.probe.ok ? bestParis.probe.ms + " ms" : "probe failed"} • ${bestParis.hostname}`;
    } else if (d.best) {
      $("poolState").textContent = place(d.best).toUpperCase();
      $("poolState").className = "pool other";
      $("poolDetail").textContent =
        `${d.best.probe.ms} ms • ${d.best.hostname}`;
    } else {
      $("poolState").textContent = "NO REACHABLE TARGET";
      $("poolState").className = "pool unknown";
      $("poolDetail").textContent = "Fast.com returned targets, but none could be probed.";
    }

    $("parisList").className = d.paris.length ? "list" : "list empty";
    $("parisList").innerHTML = d.paris.length
      ? d.paris.map(row).join("")
      : "Fast.com did not return a target identified as Paris.";

    $("targetList").className = d.targets.length ? "list" : "list empty";
    $("targetList").innerHTML = d.targets.length
      ? d.targets.map(row).join("")
      : "No targets returned.";

    $("status").textContent =
      `Checked ${new Date(d.checkedAt).toLocaleString()} • ${d.targetCount} targets returned.`;
  } catch (e) {
    $("status").textContent = `Error: ${e.message}`;
    $("poolState").textContent = "ERROR";
    $("poolState").className = "pool unknown";
    $("poolDetail").textContent = "Check your internet connection or the Fast.com API availability.";
  } finally {
    $("checkBtn").disabled = false;
  }
}
$("checkBtn").addEventListener("click", check);
