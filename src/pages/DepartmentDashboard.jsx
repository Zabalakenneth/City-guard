
import { useEffect, useMemo, useRef, useState } from "react";
import { getAuth, signOut } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where
} from "firebase/firestore";
import { db } from "../firebase";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Converts a Firestore Timestamp, string, Date or millisecond number into milliseconds.
function toMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const t = new Date(value).getTime();
  return isNaN(t) ? 0 : t;
}

// Straight-line distance in metres, used to estimate the drive time.
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Same road speed the admin dashboard drives the pin with, so both maps agree.
const RESPONDER_SPEED_KMH = 50;
const RESPONDER_SPEED_MPS = RESPONDER_SPEED_KMH / 3.6;

// Same precision the admin saves a route with, so both maps measure one line.
const ROUTE_DECIMALS = 5;

function roundCoord(value) {
  const factor = Math.pow(10, ROUTE_DECIMALS);
  return Math.round(value * factor) / factor;
}

// Total length in metres of a route polyline, using the same sum as the admin map.
function routeLength(route) {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += distanceMeters(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1]);
  }
  return total;
}

// Reads a saved road path in either shape, so an older report still draws its route.
function routePoints(route) {
  if (!Array.isArray(route) || route.length < 2) return null;
  const out = [];
  for (let i = 0; i < route.length; i++) {
    const p = route[i];
    const lat = Array.isArray(p) ? p[0] : p && p.lat;
    const lng = Array.isArray(p) ? p[1] : p && p.lng;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    out.push([roundCoord(lat), roundCoord(lng)]);
  }
  return out.length > 1 ? out : null;
}

// Points a saved route from the base to the incident, so the line never draws backwards.
function orientRoute(route, start, dest) {
  if (!route || route.length < 2) return route;
  const first = route[0];
  const last = route[route.length - 1];
  const firstToStart = distanceMeters(first[0], first[1], start.lat, start.lng);
  const lastToStart = distanceMeters(last[0], last[1], start.lat, start.lng);
  return lastToStart < firstToStart ? [...route].reverse() : route;
}

// The point `meters` along the route, copied from the admin map in the same way.
function pointAlongRoute(route, meters) {
  if (!route || route.length === 0) return null;
  if (route.length === 1 || meters <= 0) return { lat: route[0][0], lng: route[0][1] };
  let remaining = meters;
  for (let i = 1; i < route.length; i++) {
    const seg = distanceMeters(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1]);
    if (seg <= remaining) {
      remaining -= seg;
    } else {
      const frac = remaining / seg;
      return {
        lat: route[i - 1][0] + (route[i][0] - route[i - 1][0]) * frac,
        lng: route[i - 1][1] + (route[i][1] - route[i - 1][1]) * frac
      };
    }
  }
  const last = route[route.length - 1];
  return { lat: last[0], lng: last[1] };
}

// One trip calculation shared with the admin dashboard, so the numbers match exactly.
function tripStatsFrom(record, now) {
  if (!record || !record.metres) return null;
  const anchorMs = typeof record.anchorMs === "number" ? record.anchorMs : now;
  const speedKmh = record.speedKmh || RESPONDER_SPEED_KMH;
  const travelSec = record.metres / (speedKmh / 3.6);
  const elapsedSec = Math.max(0, (now - anchorMs) / 1000);
  const travelledSec = Math.min(travelSec, elapsedSec);
  return {
    km: record.metres / 1000,
    travelSec: travelledSec,
    etaSec: Math.max(0, travelSec - travelledSec),
    speedKmh,
    arrived: travelledSec >= travelSec
  };
}

// True once this department's pin has really stopped at the incident.
function arrivedFor(r, dept) {
  if (r.arrivedAtByDept && r.arrivedAtByDept[dept]) return true;
  const assigned =
    Array.isArray(r.assignedDepartments) && r.assignedDepartments.length
      ? r.assignedDepartments
      : [r.assignedDepartment].filter(Boolean);
  // A single-department report also accepts the shared stamp written by older builds.
  if (r.arrivedAt && assigned.length <= 1) return true;
  // The saved trip record is the same one the admin map drives its pin with.
  const rec = r.tripRecords && r.tripRecords[dept];
  if (rec && rec.metres && rec.anchorMs) {
    const stats = tripStatsFrom(rec, Date.now());
    return !!(stats && stats.arrived);
  }
  const start = DEPT_START[dept];
  const lat = Number(r.location && r.location.latitude);
  const lng = Number(r.location && r.location.longitude);
  const dispatchedMs = dispatchedAtFor(r, dept);
  if (!start || isNaN(lat) || isNaN(lng) || !dispatchedMs) return false;
  const metres = distanceMeters(start.lat, start.lng, lat, lng);
  return Date.now() - dispatchedMs >= (metres / RESPONDER_SPEED_MPS) * 1000;
}

// Departments that already assigned a team, so each one drives on its own.
function dispatchedDeptsOf(r) {
  if (Array.isArray(r.dispatchedByDepartments) && r.dispatchedByDepartments.length)
    return r.dispatchedByDepartments;
  const assigned =
    Array.isArray(r.assignedDepartments) && r.assignedDepartments.length
      ? r.assignedDepartments
      : [r.assignedDepartment].filter(Boolean);
  // Older reports have no per-department list, so a dispatched report counts for all.
  return r.status === "dispatched" ? assigned : [];
}

// True while this department still owns a pin, so a resolved team leaves no line.
function activeForDept(r, dept) {
  if (r.status === "resolved") return false;
  if (!dispatchedDeptsOf(r).includes(dept)) return false;
  const done = Array.isArray(r.resolvedByDepartments) ? r.resolvedByDepartments : [];
  return !done.includes(dept);
}

// The instant one department dispatched, so each pin starts its own clock.
function dispatchedAtFor(r, dept) {
  const map = r.dispatchedAtByDept || {};
  return toMs(map[dept]) || toMs(r.dispatchedAt);
}

// Fixed order so every account names the responders in the same sequence.
const DEPT_ORDER = ["PNP", "Medical Emergency Team and Responders", "BFP", "CDRRMO/MDRRMO"];

// Sorts a department list into the fixed order, so both accounts read the same sentence.
function orderedDepts(list) {
  return [...list].sort((a, b) => {
    const ia = DEPT_ORDER.indexOf(a);
    const ib = DEPT_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

// Short elapsed text, so both departments read the same frozen duration.
function formatElapsedShort(seconds) {
  if (typeof seconds !== "number") return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// Shared popup ledger, so a popup saved by one account is never replayed on a remount.
const NOTICE_KEY = "cg_dept_notices_v1";

function loadNotices() {
  try {
    const raw = localStorage.getItem(NOTICE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function patchNotices(patch) {
  try {
    const next = { ...loadNotices(), ...patch };
    localStorage.setItem(NOTICE_KEY, JSON.stringify(next));
    return next;
  } catch (e) {
    // ignore quota or serialization errors
    return null;
  }
}

// Department base locations, matching the admin dashboard so the arrival estimate lines up.
const DEPT_START = {
  "BFP": { lat: 16.0430, lng: 120.3333 },
  "PNP": { lat: 16.0452, lng: 120.3312 },
  "CDRRMO/MDRRMO": { lat: 16.0412, lng: 120.3352 },
  "Medical Emergency Team and Responders": { lat: 16.0460, lng: 120.3360 }
};

// Same department colours the admin live map uses, so both maps read the same.
const DEPT_COLORS = {
  "BFP": "#e11d48",
  "PNP": "#111827",
  "CDRRMO/MDRRMO": "#2563eb",
  "Medical Emergency Team and Responders": "#16a34a"
};

// Same department emoji the admin live map uses on its pins.
const DEPT_EMOJI = {
  "BFP": "\uD83D\uDE92",
  "PNP": "\uD83D\uDE93",
  "CDRRMO/MDRRMO": "\uD83D\uDE9C",
  "Medical Emergency Team and Responders": "\uD83D\uDE91"
};

// The vehicle emoji for an incident type, matching the admin dashboard trip line.
function vehicleEmoji(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("medical") || t.includes("accident")) return "\uD83D\uDE91";
  if (t.includes("crime") || t.includes("terrorist")) return "\uD83D\uDE93";
  return "\uD83D\uDEA8";
}

// The department a report's category points at, so a pending report can be routed.
function autoDetectDept(r) {
  const cat = r.aiCategory || r.type;
  if (cat === "Terrorist") return ["PNP", "Medical Emergency Team and Responders"];
  if (cat === "Fire") return ["BFP"];
  if (cat === "Crime") return ["PNP"];
  if (cat === "Flood") return ["CDRRMO/MDRRMO"];
  if (cat === "Medical Emergency") return ["Medical Emergency Team and Responders"];
  if (cat === "Accident") return ["Medical Emergency Team and Responders"];
  return ["BFP"];
}

// Icons are cached per department, so a marker is not rebuilt on every clock tick.
const deptIconCache = {};

const getDeptIcon = (dept) => {
  if (deptIconCache[dept]) return deptIconCache[dept];
  const color = DEPT_COLORS[dept] || "#2d5be3";
  const emoji = DEPT_EMOJI[dept] || "\uD83D\uDEA8";
  deptIconCache[dept] = L.divIcon({
    className: "",
    html: `<div style="width:34px;height:34px;border-radius:50%;background:${color};color:white;display:flex;align-items:center;justify-content:center;font-size:18px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18]
  });
  return deptIconCache[dept];
};

// Incident pins are cached per colour, so the map does not flicker while it ticks.
const incidentIconCache = {};

const getIncidentIcon = (category) => {
  let color = "blue";
  if (category === "Fire") color = "red";
  if (category === "Medical Emergency") color = "green";
  if (category === "Flood") color = "blue";
  if (category === "Crime") color = "black";
  if (category === "Accident") color = "orange";
  if (!incidentIconCache[color]) {
    incidentIconCache[color] = new L.Icon({
      iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${color}.png`,
      shadowUrl: markerShadow,
      iconSize: [25, 41],
      iconAnchor: [12, 41]
    });
  }
  return incidentIconCache[color];
};

// Read-only live map for one department, so the account only sees its own incidents.
function DeptLiveMap({ department, reports }) {
  const base = DEPT_START[department] || { lat: 16.0430, lng: 120.3333 };
  // Routes fetched here, so this map draws its own line even when the admin screen is closed.
  const [ownRoutes, setOwnRoutes] = useState({});

  // Only reports this department must answer, so a terrorist report shows on both maps.
  const mine = reports.filter((r) => {
    const assigned =
      Array.isArray(r.assignedDepartments) && r.assignedDepartments.length
        ? r.assignedDepartments
        : [r.assignedDepartment].filter(Boolean);
    return assigned.includes(department);
  });

  // Fetches the road path for any dispatched report that has no saved route yet.
  useEffect(() => {
    let cancelled = false;
    const pending = mine.filter(
      (r) => activeForDept(r, department) && r.location
    );
    if (!pending.length) return;
    const load = async () => {
      const out = {};
      await Promise.all(
        pending.map(async (r) => {
          const rec = r.tripRecords && r.tripRecords[department];
          // A saved route is already the same line the admin map walks.
          if (rec && rec.route) return;
          const lat = Number(r.location.latitude);
          const lng = Number(r.location.longitude);
          if (isNaN(lat) || isNaN(lng)) return;
          const url = `https://router.project-osrm.org/route/v1/driving/${base.lng},${base.lat};${lng},${lat}?overview=full&geometries=geojson`;
          try {
            const res = await fetch(url);
            const data = await res.json();
            if (!data.routes || !data.routes[0] || !data.routes[0].geometry) return;
            out[r.id] = data.routes[0].geometry.coordinates.map(([lng2, lat2]) => [lat2, lng2]);
          } catch (e) {
            // A failed fetch keeps the straight line, so the pin still moves.
          }
        })
      );
      if (!cancelled && Object.keys(out).length) {
        setOwnRoutes((prev) => ({ ...prev, ...out }));
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [reports, department]);

  // The trip inputs the admin saved for this report, so both screens read the same numbers.
  const savedTrip = (r) => {
    const rec = r.tripRecords && r.tripRecords[department];
    // A route fetched here is used when the admin has not saved one yet.
    const own = ownRoutes[r.id];
    if (rec && rec.metres && rec.anchorMs) {
      // A route fetched here replaces a missing one, and its length is measured the same way.
      if (rec.route || !own) return rec;
      const lat = Number(r.location && r.location.latitude);
      const lng = Number(r.location && r.location.longitude);
      if (isNaN(lat) || isNaN(lng)) return rec;
      const route = orientRoute(routePoints(own), base, { lat, lng });
      if (!route) return rec;
      return { ...rec, route, metres: routeLength(route) };
    }
    // Older reports have no saved record, so the straight-line estimate is the fallback.
    const lat = Number(r.location && r.location.latitude);
    const lng = Number(r.location && r.location.longitude);
    const anchorMs = dispatchedAtFor(r, department);
    if (isNaN(lat) || isNaN(lng) || !anchorMs) return null;
    const route = orientRoute(routePoints(own), base, { lat, lng });
    return {
      anchorMs,
      metres: route ? routeLength(route) : distanceMeters(base.lat, base.lng, lat, lng),
      speedKmh: RESPONDER_SPEED_KMH,
      route: route || undefined
    };
  };

  // Position and figures of this department's responder, from the shared trip calculation.
  const responderPos = (r) => {
    const lat = Number(r.location && r.location.latitude);
    const lng = Number(r.location && r.location.longitude);
    if (isNaN(lat) || isNaN(lng)) return null;
    const rec = savedTrip(r);
    if (!rec) return null;
    const stats = tripStatsFrom(rec, Date.now());
    if (!stats) return null;
    // The admin map stamps arrival when the pin stops, so that stamp decides it here too.
    const stamped = arrivedFor(r, department) || stats.arrived;
    // The saved road path is the same line the admin pin walks, so the metres match.
    const route = orientRoute(routePoints(rec.route), base, { lat, lng });
    const total = route
      ? routeLength(route)
      : distanceMeters(base.lat, base.lng, lat, lng);
    // The same travelled distance the admin pin uses for this instant.
    const travelled = Math.min(total, stats.travelSec * RESPONDER_SPEED_MPS);
    let posLat;
    let posLng;
    if (route) {
      // Walking the road path keeps the pin in the same place as the admin map.
      const p = pointAlongRoute(route, travelled);
      posLat = p.lat;
      posLng = p.lng;
    } else {
      // Reports with no saved route fall back to the straight line, exactly like the admin map.
      const frac = total > 0 ? Math.min(1, travelled / total) : 1;
      posLat = base.lat + (lat - base.lat) * frac;
      posLng = base.lng + (lng - base.lng) * frac;
    }
    return {
      lat: posLat,
      lng: posLng,
      arrived: stamped,
      km: stats.km,
      travelSec: stats.travelSec,
      etaSec: stamped ? 0 : stats.etaSec,
      speedKmh: stats.speedKmh,
      route
    };
  };

  // Formats seconds as "5m 22s", the same way the admin dashboard does.
  const formatDuration = (totalSeconds) => {
    const sec = Math.max(0, Math.round(totalSeconds || 0));
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  };

  return (
    <MapContainer
      center={[base.lat, base.lng]}
      zoom={13}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution="\u00a9 OpenStreetMap"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* This department's own base, so the account knows where its responders start. */}
      <Marker position={[base.lat, base.lng]} icon={getDeptIcon(department)}>
        <Popup>
          <b>{DEPT_EMOJI[department] || "\uD83D\uDEA8"} {department}</b>
          <br />
          <small>Base location (Dagupan)</small>
        </Popup>
      </Marker>

      {mine.map((r) => {
        if (!r.location) return null;
        const lat = Number(r.location.latitude);
        const lng = Number(r.location.longitude);
        if (isNaN(lat) || isNaN(lng)) return null;
        const category = r.aiCategory || r.type || "Emergency";
        const dispatched = activeForDept(r, department);
        const pos = dispatched ? responderPos(r) : null;

        return (
          <div key={r.id}>
            {/* The route line shows only while this department is on the way. */}
            {pos && (
              <Polyline
                positions={pos.route && pos.route.length > 1
                  ? pos.route
                  : [[base.lat, base.lng], [lat, lng]]}
                pathOptions={{
                  color: DEPT_COLORS[department] || "#2d5be3",
                  weight: 4,
                  dashArray: "8, 8"
                }}
              />
            )}

            {/* The moving pin is the department's own responder, never another department's. */}
            {pos && (
              <Marker position={[pos.lat, pos.lng]} icon={getDeptIcon(department)}>
                <Popup>
                  <b>{DEPT_EMOJI[department] || "\uD83D\uDEA8"} {department}</b>
                  <br />
                  <small>{pos.arrived ? "Arrived at the incident" : "On the way to the incident"}</small>
                  {/* Same trip figures the admin dashboard shows, so both maps agree. */}
                  <div style={{ fontSize: "11px", color: pos.arrived ? "#15803d" : "#2d5be3", marginTop: "4px" }}>
                    {vehicleEmoji(category)} Dispatched · ETA {formatDuration(pos.etaSec)} · travelling {formatDuration(pos.travelSec)} · 📏 {pos.km.toFixed(1)} km · {pos.speedKmh} km/h
                  </div>
                </Popup>
              </Marker>
            )}

            <Marker position={[lat, lng]} icon={getIncidentIcon(category)}>
              <Popup>
                <b>{category}</b>
                <br />
                {r.description || "No description provided"}
                <br />
                <small>{r.barangay || "Location from map"}</small>
                <br />
                <small>{getStatusLabel(r.status)}</small>
              </Popup>
            </Marker>
          </div>
        );
      })}
    </MapContainer>
  );
}

// Plain status text for the map popup, so it never shows a raw field value.
function getStatusLabel(status) {
  if (status === "dispatched") return "Dispatched";
  if (status === "resolved") return "Resolved";
  return "Pending";
}

export default function DepartmentDashboard() {
  const auth = getAuth();
  const navigate = useNavigate();

  const department = localStorage.getItem("cityguard_department");
  console.log("Logged-in Department:", department);
  const [reports, setReports] = useState([]);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  // Current report order, so the arrow button can flip it between newest and oldest first.
  const [sortDir, setSortDir] = useState("desc");
  const [loading, setLoading] = useState(true);
  // Ticks once a second so the arrival estimate can unlock the resolve button without a reload.
  const [clock, setClock] = useState(0);
  // Popup shown after this department resolves, so the responder sees the result.
  const [resolveNotice, setResolveNotice] = useState(null);
  // Popup shown while a terrorist report still waits for the other department.
  const [waitNotice, setWaitNotice] = useState(null);
  // Popup shown when the admin endorses a new report to this department, with a stoppable sound.
  const [newReportNotice, setNewReportNotice] = useState(null);
  // Popup shown after this department assigns its own team, with a short chime.
  const [dispatchNotice, setDispatchNotice] = useState(null);
  // Popup shown when this department's own pin reaches the incident, with a short chime.
  const [arrivalNotice, setArrivalNotice] = useState(null);
  // Alert audio handle, so clicking the popup can stop the sound at once.
  const alertAudioRef = useRef(null);
  // Shared WebAudio context, used for the fallback tone when the mp3 cannot play.
  const audioCtxRef = useRef(null);
  // Reports already announced to this account, so a remount never replays a popup.
  const newReportSavedRef = useRef(
    new Set(Array.isArray(loadNotices().newReport) ? loadNotices().newReport : [])
  );
  const dispatchSavedRef = useRef(
    new Set(Array.isArray(loadNotices().dispatch) ? loadNotices().dispatch : [])
  );
  const arrivalSavedRef = useRef(
    new Set(Array.isArray(loadNotices().arrival) ? loadNotices().arrival : [])
  );
  // First-load flags, so reports already on screen are never announced as new.
  const newReportPrimedRef = useRef(false);
  const arrivalPrimedRef = useRef(false);
  // Reports whose resolved popup was already shown to this account, so it never repeats.
  const resolvedNoticeRef = useRef(new Set());
  // Mount instant, so a resolve from an earlier visit is never announced.
  const sessionStartRef = useRef(Date.now());
  // Resolved popups already saved, so leaving the page and returning cannot replay one.
  const resolvedSavedRef = useRef(
    new Set(Array.isArray(loadNotices().resolved) ? loadNotices().resolved : [])
  );
  // Waiting popups already saved, so the waiting message also shows once per report.
  const waitSavedRef = useRef(
    new Set(Array.isArray(loadNotices().waiting) ? loadNotices().waiting : [])
  );

  // Auto-dismiss the resolve popup after a few seconds.
  useEffect(() => {
    if (!resolveNotice) return;
    const timer = setTimeout(() => setResolveNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [resolveNotice]);

  // Auto-dismiss the waiting popup after a few seconds.
  useEffect(() => {
    if (!waitNotice) return;
    const timer = setTimeout(() => setWaitNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [waitNotice]);

  // Auto-dismiss the new report popup, but only after the sound has had time to play.
  useEffect(() => {
    if (!newReportNotice) return;
    const timer = setTimeout(() => setNewReportNotice(null), 20000);
    return () => clearTimeout(timer);
  }, [newReportNotice]);

  // Auto-dismiss the dispatch popup after a few seconds.
  useEffect(() => {
    if (!dispatchNotice) return;
    const timer = setTimeout(() => setDispatchNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [dispatchNotice]);

  // Auto-dismiss the arrival popup after a few seconds.
  useEffect(() => {
    if (!arrivalNotice) return;
    const timer = setTimeout(() => setArrivalNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [arrivalNotice]);

  // Creates the shared WebAudio context used for the fallback alert tone.
  const getAudioCtx = () => {
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx();
    } catch (e) {
      audioCtxRef.current = null;
    }
    return audioCtxRef.current;
  };

  // Plays a short generated tone, used when the mp3 file cannot be played.
  const playFallbackTone = () => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 700;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      osc.start(now);
      osc.stop(now + 0.6);
    } catch (e) {
      // ignore
    }
  };

  // Plays a short two-note chime for the dispatch and arrival popups.
  const playChime = () => {
    if (localStorage.getItem("cg_soundEnabled") === "false") return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;
      [660, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = now + i * 0.18;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.18);
      });
    } catch (e) {
      // ignore
    }
  };

  // Stops the alert sound at once, so clicking the popup silences it.
  const stopAlertSound = () => {
    if (alertAudioRef.current) {
      try {
        alertAudioRef.current.pause();
        alertAudioRef.current.currentTime = 0;
      } catch (e) {
        // ignore
      }
      alertAudioRef.current = null;
    }
    const ctx = getAudioCtx();
    if (ctx && ctx.state === "running") {
      try {
        ctx.suspend();
      } catch (e) {
        // ignore
      }
    }
  };

  // Picks the alert file for an incident category, matching the admin dashboard.
  const soundForCategory = (category) => {
    if (category === "Fire") return "/fire.mp3";
    if (category === "Medical Emergency") return "/ambulance.mp3";
    if (category === "Crime") return "/police.mp3";
    if (category === "Accident") return "/ambulance.mp3";
    if (category === "Terrorist") return "/police.mp3";
    if (category === "Flood") return "/flood.mp3";
    return "/siren.mp3";
  };

  // Plays the alert sound for a new endorsed report, unless sound is switched off.
  const playAlertSound = (category) => {
    if (localStorage.getItem("cg_soundEnabled") === "false") return;
    stopAlertSound();
    try {
      const audio = new Audio(soundForCategory(category));
      audio.onerror = () => playFallbackTone();
      audio.play().then(() => {}).catch(() => playFallbackTone());
      alertAudioRef.current = audio;
    } catch (e) {
      playFallbackTone();
    }
  };

  // Stops any alert sound when this screen closes, so it never plays on another page.
  useEffect(() => {
    return () => stopAlertSound();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClock((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!department) {
      setLoading(false);
      return;
    }

    const reportsRef = collection(db, "reports");

    const q1 = query(
      reportsRef,
      where("assignedDepartment", "==", department)
    );

    const q2 = query(
      reportsRef,
      where("assignedDepartments", "array-contains", department)
    );

    // Pending reports carry no department yet, so they need their own query.
    const q3 = query(reportsRef, where("status", "==", "pending"));

    let singleReports = [];
    let multipleReports = [];
    let pendingReports = [];
    let loaded1 = false;
    let loaded2 = false;
    let loaded3 = false;

    const updateReports = () => {
      const combined = new Map();

      [...singleReports, ...multipleReports, ...pendingReports].forEach((report) => {
        combined.set(report.id, report);
      });

      const data = Array.from(combined.values());

      data.sort((a, b) => {
        const dateA = a.createdAt?.seconds
          ? a.createdAt.seconds
          : 0;
        const dateB = b.createdAt?.seconds
          ? b.createdAt.seconds
          : 0;

        return dateB - dateA;
      });

      setReports(data);

      if (loaded1 && loaded2 && loaded3) {
        setLoading(false);
      }
    };

    const unsubscribe1 = onSnapshot(
      q1,
      (snapshot) => {
        singleReports = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data()
        }));

        loaded1 = true;
        updateReports();
      },
      (error) => {
        console.error("Department query error:", error);
        loaded1 = true;
        updateReports();
      }
    );

    const unsubscribe2 = onSnapshot(
      q2,
      (snapshot) => {
        multipleReports = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data()
        }));

        loaded2 = true;
        updateReports();
      },
      (error) => {
        console.error("Multi-department query error:", error);
        loaded2 = true;
        updateReports();
      }
    );

    // A pending report is shown only to the department its category points at.
    const unsubscribe3 = onSnapshot(
      q3,
      (snapshot) => {
        pendingReports = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((report) => autoDetectDept(report).includes(department));

        loaded3 = true;
        updateReports();
      },
      (error) => {
        console.error("Pending query error:", error);
        loaded3 = true;
        updateReports();
      }
    );

    return () => {
      unsubscribe1();
      unsubscribe2();
      unsubscribe3();
    };
  }, [department]);

  // A report counts as resolved for this department once it is fully resolved or this department already resolved it.
  const isResolvedForDept = (r) =>
    r.status === "resolved" ||
    (Array.isArray(r.resolvedByDepartments) &&
      r.resolvedByDepartments.includes(department));

  // Every department that must answer this report; a terrorist report needs both PNP and medical.
  const assignedDeptsOf = (r) =>
    Array.isArray(r.assignedDepartments) && r.assignedDepartments.length
      ? r.assignedDepartments
      : [r.assignedDepartment].filter(Boolean);

  // True only once this department's pin has really stopped at the incident.
  const hasArrived = (r) => arrivedFor(r, department);

  // This account's own status, so a report it has not dispatched stays pending.
  const deptStatus = (r) => {
    if (isResolvedForDept(r)) return "resolved";
    if (dispatchedDeptsOf(r).includes(department)) return "dispatched";
    return "pending";
  };

  // The resolve button shows only after this department's own pin arrives.
  const canResolve = (r) =>
    dispatchedDeptsOf(r).includes(department) &&
    hasArrived(r) &&
    !isResolvedForDept(r);
  // Names the department a resolved-here report still waits for, or null.
  const waitingFor = (r) => {
    const assigned = assignedDeptsOf(r);
    if (assigned.length <= 1) return null;
    // A fully resolved report has nobody left to wait for.
    if (r.status === "resolved") return null;
    if (!isResolvedForDept(r)) return null;
    const done = Array.isArray(r.resolvedByDepartments) ? r.resolvedByDepartments : [];
    // Only departments that have not resolved yet are still being waited for.
    const other = orderedDepts(assigned.filter((d) => d !== department && !done.includes(d)));
    // The dispatched sign uses the full department name, so it is never ambiguous.
    return other.length ? other.join(" and ") : null;
  };

  // The one resolved message both departments see, naming every responder together.
  const resolvedMessage = (r) => {
    const assigned = orderedDepts(assignedDeptsOf(r));
    return assigned.length > 1
      ? `${assigned.join(" and ")} have both resolved the incident. The report is now resolved.`
      : "You have resolved this incident. The report is now resolved.";
  };

  // Shows the resolved popup once per account and report, so a remount cannot replay it.
  const announceResolved = (r) => {
    if (resolvedNoticeRef.current.has(r.id)) return;
    resolvedNoticeRef.current.add(r.id);
    const key = `${department}::${r.id}`;
    // Save this account's popup, so navigating back cannot show it a second time.
    if (!resolvedSavedRef.current.has(key)) {
      resolvedSavedRef.current.add(key);
      patchNotices({ resolved: [...resolvedSavedRef.current].slice(-200) });
    }
    setWaitNotice(null);
    setResolveNotice({
      text: resolvedMessage(r),
      // The frozen duration is shared, so both departments read the same elapsed time.
      elapsed: formatElapsedShort(r.responseSeconds),
      at: Date.now()
    });
  };

  // Shows the waiting popup once when this department resolved but the report is still open.
  const announceWaiting = (other, reportId) => {
    const key = `${department}::${reportId}`;
    if (waitSavedRef.current.has(key)) return;
    waitSavedRef.current.add(key);
    patchNotices({ waiting: [...waitSavedRef.current].slice(-200) });
    setResolveNotice(null);
    setWaitNotice({
      text: `Waiting for ${other} to resolve. The report stays open until both resolve.`,
      at: Date.now()
    });
  };

  // The department that resolved first waits here, then sees the same resolved popup.
  useEffect(() => {
    reports.forEach((r) => {
      if (r.status !== "resolved") return;
      if (!isResolvedForDept(r)) return;
      // A popup already saved for this account stays silent, so a return never replays it.
      if (resolvedSavedRef.current.has(`${department}::${r.id}`)) return;
      // Only a resolve from this visit is announced, so an old one stays silent.
      const resolvedMs = toMs(r.resolvedAt);
      if (!resolvedMs || resolvedMs < sessionStartRef.current) return;
      announceResolved(r);
    });
  }, [reports]);

  // Restores the waiting popup once when this department comes back mid-wait.
  useEffect(() => {
    reports.forEach((r) => {
      const other = waitingFor(r);
      if (!other) return;
      announceWaiting(other, r.id);
    });
  }, [reports, department]);

  // Records this department's resolve; a terrorist report only closes once every assigned department resolved.
  const resolveIncident = async (r) => {
    if (!window.confirm("Mark this incident as resolved?")) return;

    try {
      const assigned =
        Array.isArray(r.assignedDepartments) && r.assignedDepartments.length
          ? r.assignedDepartments
          : [r.assignedDepartment].filter(Boolean);
      const already = Array.isArray(r.resolvedByDepartments)
        ? r.resolvedByDepartments
        : [];
      const nextResolved = already.includes(department)
        ? already
        : [...already, department];
      const allResolved = assigned.every((d) => nextResolved.includes(d));

      const patch = { resolvedByDepartments: nextResolved };

      // Keep each department's own resolve instant so the history can show both for a terrorist report.
      patch.resolvedAtByDept = {
        ...(r.resolvedAtByDept || {}),
        [department]: new Date()
      };

      // Only the final resolve freezes the elapsed time, so a partial terrorist resolve keeps counting.
      if (allResolved) {
        const resolvedAt = new Date();
        const startMs = toMs(r.createdAt);
        patch.status = "resolved";
        patch.resolvedAt = resolvedAt;
        patch.responseSeconds = startMs
          ? Math.max(0, Math.floor((resolvedAt.getTime() - startMs) / 1000))
          : null;
        patch.resolvedBy = department;
        patch.autoResolved = false;
        // Every department gets the same resolve instant, so their timing matches exactly.
        patch.resolvedAtByDept = Object.fromEntries(assigned.map((d) => [d, resolvedAt]));
      }

      await updateDoc(doc(db, "reports", r.id), patch);

      // A partial terrorist resolve only shows the waiting popup, never the resolved one.
      if (!allResolved) {
        const other = orderedDepts(assigned.filter((d) => d !== department)).join(" and ");
        // The waiting popup names the other department in full, never shortened.
        announceWaiting(other || "the other department", r.id);
        return;
      }

      // Tell this department the report is now fully resolved.
      setWaitNotice(null);
      // A terrorist report names both responders in the same single popup.
      announceResolved(r);
    } catch (error) {
      console.error("Resolve error:", error);
    }
  };

  // A report the admin marked as fake is never counted or listed for a department.
  const isFakeReport = (r) => r.status === "rejected";

  // True once the admin endorsed this report to this department.
  const isEndorsed = (r) =>
    !!r.endorsedAt &&
    assignedDeptsOf(r).includes(department) &&
    r.status !== "rejected" &&
    r.status !== "resolved";

  // Only the PNP and Medical accounts assign their own team, and only once each.
  const canAssignTeam = (r) =>
    isEndorsed(r) &&
    !dispatchedDeptsOf(r).includes(department) &&
    (department === "PNP" ||
      department === "Medical Emergency Team and Responders");

  // Assigning a team dispatches only this department, so the other one stays pending.
  const assignTeam = async (r) => {
    try {
      const already = dispatchedDeptsOf(r);
      const nextDepts = already.includes(department)
        ? already
        : [...already, department];
      const patch = {
        dispatchedByDepartments: nextDepts,
        dispatchedAtByDept: {
          ...(r.dispatchedAtByDept || {}),
          [department]: new Date()
        },
        teamAssignedBy: department
      };
      // The shared status turns dispatched only once every assigned department sent a team.
      if (assignedDeptsOf(r).every((d) => nextDepts.includes(d))) {
        patch.status = "dispatched";
        patch.dispatchedAt = new Date();
      }
      await updateDoc(doc(db, "reports", r.id), patch);
      // Confirms the dispatch on this screen, with a short chime.
      const key = `${department}::${r.id}`;
      dispatchSavedRef.current.add(key);
      patchNotices({ dispatch: [...dispatchSavedRef.current].slice(-200) });
      setDispatchNotice({
        text: `${department} has been dispatched and is on the way to the incident.`,
        at: Date.now()
      });
      playChime();
    } catch (error) {
      console.error("Assign team error:", error);
    }
  };

  // Announces a newly endorsed report once per account, with the alert sound.
  useEffect(() => {
    if (!department) return;
    if (department !== "PNP" && department !== "Medical Emergency Team and Responders") return;
    // Waits for the first data load, so an empty list is never treated as primed.
    if (loading) return;
    // The first load only records what is already there, so old reports stay silent.
    if (!newReportPrimedRef.current) {
      newReportPrimedRef.current = true;
      reports.forEach((r) => {
        if (isEndorsed(r)) newReportSavedRef.current.add(`${department}::${r.id}`);
      });
      patchNotices({ newReport: [...newReportSavedRef.current].slice(-200) });
      return;
    }
    reports.forEach((r) => {
      if (!isEndorsed(r)) return;
      const key = `${department}::${r.id}`;
      if (newReportSavedRef.current.has(key)) return;
      newReportSavedRef.current.add(key);
      patchNotices({ newReport: [...newReportSavedRef.current].slice(-200) });
      const category = r.aiCategory || r.type || "Emergency";
      setNewReportNotice({
        text: `A ${category} report has been endorsed to your department. Please send your team.`,
        at: Date.now()
      });
      playAlertSound(category);
    });
  }, [reports, department, loading]);

  // Announces this department's own pin arrival once per account, with a short chime.
  useEffect(() => {
    if (!department) return;
    if (department !== "PNP" && department !== "Medical Emergency Team and Responders") return;
    // Waits for the first data load, so an empty list is never treated as primed.
    if (loading) return;
    // The first load only records what is already there, so an old arrival stays silent.
    if (!arrivalPrimedRef.current) {
      arrivalPrimedRef.current = true;
      reports.forEach((r) => {
        if (activeForDept(r, department) && hasArrived(r)) {
          arrivalSavedRef.current.add(`${department}::${r.id}`);
        }
      });
      patchNotices({ arrival: [...arrivalSavedRef.current].slice(-200) });
      return;
    }
    reports.forEach((r) => {
      if (!activeForDept(r, department)) return;
      if (!hasArrived(r)) return;
      const key = `${department}::${r.id}`;
      if (arrivalSavedRef.current.has(key)) return;
      arrivalSavedRef.current.add(key);
      patchNotices({ arrival: [...arrivalSavedRef.current].slice(-200) });
      setArrivalNotice({
        text: "Your team has reached the incident location. Resolve the report to confirm.",
        at: Date.now()
      });
      playChime();
    });
  }, [reports, department, clock, loading]);

  // Only real reports, so the counts and the list never include a fake one.
  const realReports = useMemo(
    () => reports.filter((r) => !isFakeReport(r)),
    [reports]
  );

  const filteredReports = useMemo(() => {
    const list = realReports.filter((r) => {
      const category = r.aiCategory || r.type || "Emergency";
      const searchText = search.toLowerCase();

      const matchesSearch =
        category.toLowerCase().includes(searchText) ||
        (r.description || "").toLowerCase().includes(searchText) ||
        (r.barangay || "").toLowerCase().includes(searchText);

      const matchesFilter =
        activeFilter === "All" ||
        // A report still mid-drive stays in Dispatched, even after this department resolved.
        (activeFilter === "Dispatched" && deptStatus(r) === "dispatched") ||
        // Only a fully resolved report moves to Resolved, so a waiting one does not.
        (activeFilter === "Resolved" && deptStatus(r) === "resolved") ||
        (activeFilter === "Pending" && deptStatus(r) === "pending");

      return matchesSearch && matchesFilter;
    });

    // Applies the chosen direction to the visible list, so the arrow really reorders it.
    return [...list].sort((a, b) => {
      const diff = toMs(a.createdAt) - toMs(b.createdAt);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [realReports, search, activeFilter, sortDir, department]);

  const dispatchedCount = realReports.filter(
    (r) => deptStatus(r) === "dispatched"
  ).length;

  const resolvedCount = realReports.filter((r) => deptStatus(r) === "resolved").length;

  const pendingCount = realReports.filter(
    (r) => deptStatus(r) === "pending"
  ).length;

  const formatDate = (value) => {
    if (!value) return "Date unavailable";

    const date = value.seconds
      ? new Date(value.seconds * 1000)
      : value.toDate
      ? value.toDate()
      : new Date(value);

    if (isNaN(date.getTime())) return "Date unavailable";

    return date.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const getStatus = (status) => {
    if (status === "dispatched") return "Dispatched";
    if (status === "resolved") return "Resolved";
    return "Pending";
  };

  const getCategoryIcon = (category) => {
    const icons = {
      Fire: "🔥",
      Flood: "🌊",
      Crime: "🚨",
      Terrorist: "⚠️",
      Accident: "🚑",
      "Medical Emergency": "🏥"
    };

    return icons[category] || "🚨";
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error:", error);
    }

    localStorage.removeItem("cityguard_auth");
    localStorage.removeItem("cityguard_role");
    localStorage.removeItem("cityguard_department");

    navigate("/");
  };

  return (
    <div className="department-app">
      {/* Popup shown when the admin endorses a new report, click to stop the sound. */}
      {newReportNotice && (
        <div
          onClick={() => {
            stopAlertSound();
            setNewReportNotice(null);
          }}
          style={{
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#b91c1c",
            color: "white",
            padding: "15px 25px",
            borderRadius: "8px",
            fontWeight: "bold",
            zIndex: 10001,
            cursor: "pointer",
            maxWidth: "520px"
          }}
        >
          {"\uD83D\uDEA8"} New endorsed report
          <br />
          <small>{newReportNotice.text}</small>
        </div>
      )}

      {/* Popup shown after this department assigns its own team, click to stop the chime. */}
      {dispatchNotice && (
        <div
          onClick={() => {
            stopAlertSound();
            setDispatchNotice(null);
          }}
          style={{
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1d4ed8",
            color: "white",
            padding: "15px 25px",
            borderRadius: "8px",
            fontWeight: "bold",
            zIndex: 10000,
            cursor: "pointer",
            maxWidth: "520px"
          }}
        >
          {"\uD83D\uDE97"} Team dispatched
          <br />
          <small>{dispatchNotice.text}</small>
        </div>
      )}

      {/* Popup shown when this department's own pin reaches the incident, click to stop the chime. */}
      {arrivalNotice && (
        <div
          onClick={() => {
            stopAlertSound();
            setArrivalNotice(null);
          }}
          style={{
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1d4ed8",
            color: "white",
            padding: "15px 25px",
            borderRadius: "8px",
            fontWeight: "bold",
            zIndex: 10000,
            cursor: "pointer",
            maxWidth: "520px"
          }}
        >
          {"\u2705"} Responder on site
          <br />
          <small>{arrivalNotice.text}</small>
        </div>
      )}

      {/* Popup shown while a terrorist report waits for the other department. */}
      {waitNotice && (
        <div
          onClick={() => setWaitNotice(null)}
          style={{
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#b45309",
            color: "white",
            padding: "15px 25px",
            borderRadius: "8px",
            fontWeight: "bold",
            zIndex: 10000,
            cursor: "pointer",
            maxWidth: "520px"
          }}
        >
          {"\u23f3"} Waiting for the other department
          <br />
          <small>{waitNotice.text}</small>
        </div>
      )}

      {/* Popup shown after this department resolves an incident. */}
      {resolveNotice && (
        <div
          onClick={() => setResolveNotice(null)}
          style={{
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#16804c",
            color: "white",
            padding: "15px 25px",
            borderRadius: "8px",
            fontWeight: "bold",
            zIndex: 9999,
            cursor: "pointer",
            maxWidth: "520px"
          }}
        >
          {"\u2705"} Incident resolved
          <br />
          <small>{resolveNotice.text}</small>
          {resolveNotice.elapsed && (
            <>
              <br />
              <small>Elapsed: {resolveNotice.elapsed}</small>
            </>
          )}
        </div>
      )}

      <style>{`
        * {
          box-sizing: border-box;
        }

        .department-app {
          min-height: 100vh;
          display: flex;
          background: #f3f6fb;
          color: #172033;
          font-family: Arial, sans-serif;
        }

        .dept-sidebar {
          width: 250px;
          min-height: 100vh;
          background: #101b32;
          color: white;
          padding: 26px 18px;
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
        }

        .dept-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 5px 8px 30px;
          border-bottom: 1px solid #293650;
        }

        .dept-brand-icon {
          width: 43px;
          height: 43px;
          background: #244fca;
          border-radius: 12px;
          display: grid;
          place-items: center;
          font-size: 23px;
        }

        .dept-brand h2 {
          font-size: 17px;
          margin: 0;
          letter-spacing: 1px;
        }

        .dept-brand small {
          color: #9eacc6;
          font-size: 10px;
        }

        .dept-menu-label {
          color: #8392ae;
          font-size: 10px;
          font-weight: bold;
          letter-spacing: 1.5px;
          margin: 30px 10px 12px;
        }

        .dept-menu-item {
          padding: 13px 14px;
          border-radius: 9px;
          margin-bottom: 7px;
          font-size: 13px;
          color: #c4cde0;
          background: #1b2a48;
        }

        .dept-sidebar-bottom {
          margin-top: auto;
          border-top: 1px solid #293650;
          padding-top: 20px;
        }

        .dept-main {
          flex: 1;
          min-width: 0;
          padding: 30px 36px;
        }

        .dept-topbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 15px;
          margin-bottom: 30px;
        }

        .dept-topbar h1 {
          margin: 0 0 7px;
          font-size: 25px;
          color: #14213b;
        }

        .dept-topbar p {
          margin: 0;
          font-size: 13px;
          color: #8290a6;
        }

        .dept-account {
          display: flex;
          align-items: center;
          gap: 10px;
          background: white;
          border: 1px solid #e7ebf2;
          border-radius: 12px;
          padding: 10px 14px;
        }

        .dept-avatar {
          width: 37px;
          height: 37px;
          background: #e6edff;
          color: #2452c8;
          display: grid;
          place-items: center;
          border-radius: 50%;
          font-weight: bold;
        }

        .dept-account strong {
          font-size: 12px;
          display: block;
        }

        .dept-account small {
          color: #8490a4;
          font-size: 10px;
        }

        .dept-welcome {
          background: linear-gradient(110deg, #1c3d83, #2861d5);
          color: white;
          border-radius: 16px;
          padding: 26px;
          margin-bottom: 24px;
          box-shadow: 0 8px 22px #244fca20;
        }

        .dept-welcome h2 {
          font-size: 21px;
          margin: 0 0 8px;
        }

        .dept-welcome p {
          color: #d7e2ff;
          font-size: 13px;
          margin: 0;
        }

        .dept-map-card {
          background: white;
          border: 1px solid #e8edf4;
          border-radius: 13px;
          padding: 16px;
          margin-bottom: 24px;
        }

        .dept-map-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }

        .dept-map-head h2 {
          font-size: 15px;
          margin: 0;
          color: #17243e;
        }

        .dept-map-head span {
          font-size: 11px;
          color: #7c899e;
        }

        .dept-map-body {
          height: 320px;
          border-radius: 10px;
          overflow: hidden;
        }

        .dept-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 30px;
        }

        .dept-stat {
          background: white;
          border: 1px solid #e8edf4;
          border-radius: 13px;
          padding: 19px;
          min-width: 0;
        }

        .dept-stat-label {
          font-size: 12px;
          color: #7c899e;
        }

        .dept-stat-value {
          font-size: 27px;
          font-weight: bold;
          margin-top: 12px;
          color: #17243e;
        }

        .dept-stat-icon {
          font-size: 20px;
          margin-bottom: 12px;
        }

        .dept-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 15px;
          margin-bottom: 17px;
        }

        .dept-section-header h2 {
          font-size: 18px;
          margin: 0;
        }

        .dept-search {
          width: 260px;
          max-width: 100%;
          border: 1px solid #dfe5ef;
          background: white;
          border-radius: 9px;
          padding: 11px 13px;
          outline: none;
          font-size: 12px;
        }

        .dept-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 18px;
        }

        .dept-filter {
          border: 1px solid #e0e6ef;
          background: white;
          color: #66748b;
          border-radius: 20px;
          padding: 8px 15px;
          font-size: 11px;
          cursor: pointer;
        }

        .dept-filter.active {
          background: #2454c5;
          color: white;
          border-color: #2454c5;
        }

        .dept-sort {
          margin-left: auto;
          min-width: 38px;
          font-size: 14px;
          line-height: 1;
        }

        .dept-incident {
          background: white;
          border: 1px solid #e8edf4;
          border-radius: 13px;
          padding: 19px;
          margin-bottom: 13px;
          display: flex;
          justify-content: space-between;
          gap: 15px;
        }

        /* Lets the long waiting sign keep its own width on one line. */
        .dept-incident > div:first-child {
          min-width: 0;
        }

        .dept-incident h3 {
          margin: 0 0 9px;
          font-size: 15px;
        }

        .dept-incident p {
          color: #75839a;
          font-size: 12px;
          line-height: 1.6;
          margin: 6px 0;
          overflow-wrap: anywhere;
        }

        .dept-incident-date {
          font-size: 10px !important;
          color: #9aa5b5 !important;
        }

        .dept-status {
          display: inline-block;
          border-radius: 20px;
          padding: 6px 10px;
          font-size: 10px;
          font-weight: bold;
          white-space: nowrap;
          height: fit-content;
        }

        .dept-incident-actions {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
          flex: 0 0 auto;
        }

        .dept-resolve {
          border: none;
          background: #16804c;
          color: white;
          border-radius: 8px;
          padding: 8px 14px;
          font-size: 11px;
          font-weight: bold;
          cursor: pointer;
        }

        .dept-assign-team {
          border: none;
          background: #2d5be3;
          color: white;
          border-radius: 8px;
          padding: 8px 14px;
          font-size: 11px;
          font-weight: bold;
          cursor: pointer;
        }

        .status-dispatched {
          color: #1c58b5;
          background: #e7f0ff;
        }

        .status-resolved {
          color: #16804c;
          background: #e3f7ed;
        }

        .status-pending {
          color: #a66b12;
          background: #fff3d9;
        }

        .dept-status-waiting {
          color: #b45309;
          background: #fff3d9;
          /* Keeps the full waiting label on one straight line, never wrapped. */
          white-space: nowrap;
          word-break: keep-all;
          overflow-wrap: normal;
          display: inline-block;
          max-width: none;
          font-size: 9px;
          text-align: right;
        }

        .dept-empty {
          background: white;
          border: 1px dashed #d5deea;
          padding: 45px 15px;
          text-align: center;
          border-radius: 13px;
          color: #8b98aa;
          font-size: 13px;
        }

        .dept-logout {
          width: 100%;
          border: 1px solid #44516a;
          background: transparent;
          color: #e3e9f5;
          padding: 12px;
          border-radius: 9px;
          cursor: pointer;
          font-size: 12px;
        }

        .dept-logout:hover {
          background: #293b5d;
        }

        @media (max-width: 1000px) {
          .dept-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 700px) {
          .department-app {
            display: block;
          }

          .dept-sidebar {
            width: 100%;
            min-height: auto;
            padding: 15px;
          }

          .dept-brand {
            padding-bottom: 12px;
          }

          .dept-menu-label,
          .dept-menu-item {
            display: none;
          }

          .dept-sidebar-bottom {
            border: none;
            padding: 10px 0 0;
          }

          .dept-main {
            padding: 22px 15px;
          }

          .dept-topbar {
            align-items: flex-start;
            flex-direction: column;
          }

          .dept-topbar h1 {
            font-size: 21px;
          }

          .dept-section-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .dept-search {
            width: 100%;
          }

          .dept-incident {
            flex-direction: column;
          }

          .dept-status {
            align-self: flex-start;
          }

          /* On narrow screens the sign still stays on one line and scrolls if needed. */
          .dept-status-waiting {
            white-space: nowrap;
            max-width: 100%;
            overflow-x: auto;
          }
        }

        @media (max-width: 380px) {
          .dept-stats {
            grid-template-columns: 1fr 1fr;
            gap: 9px;
          }

          .dept-stat {
            padding: 13px;
          }

          .dept-stat-value {
            font-size: 22px;
          }

          .dept-map-body {
            height: 240px;
          }
        }
      `}</style>

      <aside className="dept-sidebar">
        <div className="dept-brand">
          <div className="dept-brand-icon">🚨</div>
          <div>
            <h2>CITYGUARD</h2>
            <small>COMMAND CENTER</small>
          </div>
        </div>

        <div className="dept-menu-label">MAIN MENU</div>
        <div className="dept-menu-item">▦ &nbsp; Dashboard</div>
        <div className="dept-menu-item">🚨 &nbsp; Assigned Incidents</div>

        <div className="dept-sidebar-bottom">
          <button className="dept-logout" onClick={handleLogout}>
            ↪ &nbsp; Logout
          </button>
        </div>
      </aside>

      <main className="dept-main">
        <header className="dept-topbar">
          <div>
            <h1>Department Dashboard</h1>
            <p>Monitor and manage your assigned emergency incidents.</p>
          </div>

          <div className="dept-account">
            <div className="dept-avatar">
              {(department || "D").charAt(0)}
            </div>
            <div>
              <strong>{department || "Department"}</strong>
              <small>Department Account</small>
            </div>
          </div>
        </header>

        <section className="dept-welcome">
          <h2>Welcome, {department || "Department"}!</h2>
          <p>
            CityGuard Emergency Response Management System
          </p>
        </section>

        {/* Read-only live map, so this account can monitor its own incidents. */}
        <section className="dept-map-card">
          <div className="dept-map-head">
            <h2>{department || "Department"} Live Map</h2>
            <span>Monitoring only</span>
          </div>
          <div className="dept-map-body">
            <DeptLiveMap department={department} reports={reports} />
          </div>
        </section>

        <section className="dept-stats">
          <div className="dept-stat">
            <div className="dept-stat-icon">📋</div>
            <div className="dept-stat-label">Total Assigned</div>
            <div className="dept-stat-value">{realReports.length}</div>
          </div>

          <div className="dept-stat">
            <div className="dept-stat-icon">🚑</div>
            <div className="dept-stat-label">Dispatched</div>
            <div className="dept-stat-value">{dispatchedCount}</div>
          </div>

          <div className="dept-stat">
            <div className="dept-stat-icon">⏳</div>
            <div className="dept-stat-label">Pending</div>
            <div className="dept-stat-value">{pendingCount}</div>
          </div>

          <div className="dept-stat">
            <div className="dept-stat-icon">✅</div>
            <div className="dept-stat-label">Resolved</div>
            <div className="dept-stat-value">{resolvedCount}</div>
          </div>
        </section>

        <section>
          <div className="dept-section-header">
            <h2>Assigned Incidents</h2>

            <input
              className="dept-search"
              type="text"
              placeholder="Search incident..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="dept-filters">
            {["All", "Dispatched", "Pending", "Resolved"].map((filter) => (
              <button
                key={filter}
                className={`dept-filter ${
                  activeFilter === filter ? "active" : ""
                }`}
                onClick={() => setActiveFilter(filter)}
              >
                {filter}
              </button>
            ))}

            {/* Flips the report order between newest first and oldest first. */}
            <button
              type="button"
              className="dept-filter dept-sort"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              title={sortDir === "asc" ? "Oldest first" : "Newest first"}
              aria-label={
                sortDir === "asc"
                  ? "Sorted oldest first, click for newest first"
                  : "Sorted newest first, click for oldest first"
              }
            >
              {sortDir === "asc" ? "\u2191" : "\u2193"}
            </button>
          </div>

          {loading ? (
            <div className="dept-empty">Loading assigned incidents...</div>
          ) : filteredReports.length === 0 ? (
            <div className="dept-empty">
              <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
              <strong>No incidents found</strong>
              <p>Assigned incidents will appear here.</p>
            </div>
          ) : (
            filteredReports.map((r) => {
              const category = r.aiCategory || r.type || "Emergency";
              const resolvedForDept = isResolvedForDept(r);
              const statusClass = resolvedForDept
                ? "status-resolved"
                : deptStatus(r) === "dispatched"
                ? "status-dispatched"
                : "status-pending";

              return (
                <article className="dept-incident" key={r.id}>
                  <div>
                    <h3>
                      {getCategoryIcon(category)} &nbsp; {category}
                    </h3>

                    <p>
                      <strong>Description:</strong>{" "}
                      {r.description || "No description provided"}
                    </p>

                    <p>
                      <strong>Location:</strong>{" "}
                      {r.barangay || "Location from map"}
                    </p>

                    <p className="dept-incident-date">
                      Reported: {formatDate(r.createdAt)}
                    </p>
                  </div>

                  <div className="dept-incident-actions">
                    {/* A resolved-here but still-open terrorist report names who it waits for. */}
                    {waitingFor(r) ? (
                      <span
                        className="dept-status dept-status-waiting"
                        style={{ whiteSpace: "nowrap", display: "inline-block" }}
                      >
                        {`resolved waiting for ${waitingFor(r)} to resolve`}
                      </span>
                    ) : (
                      <span className={`dept-status ${statusClass}`}>
                        {resolvedForDept ? "Resolved" : getStatus(deptStatus(r))}
                      </span>
                    )}

                    {/* Resolve is offered only in the dispatched part, after the pin arrives. */}
                    {canResolve(r) && (
                      <button
                        className="dept-resolve"
                        onClick={() => resolveIncident(r)}
                      >
                        Resolve
                      </button>
                    )}

                    {/* Assign a team sits below the pending sign, only after the admin endorsed it. */}
                    {canAssignTeam(r) && (
                      <button
                        className="dept-assign-team"
                        onClick={() => assignTeam(r)}
                      >
                        Assign a team
                      </button>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </section>
      </main>
    </div>
  );
}
