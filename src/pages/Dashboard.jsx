import { useEffect, useState, useRef } from "react"
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet"
import L from "leaflet"

import { db } from "../firebase"
import { collection, onSnapshot, doc, getDoc, updateDoc } from "firebase/firestore"

import { getAuth, signOut } from "firebase/auth"
import { useNavigate } from "react-router-dom"

import markerShadow from "leaflet/dist/images/marker-shadow.png"

// ✅ P17 REVISION: localStorage-backed state persistence. The dashboard's live
// state (OTW responder progress, road routes, department selections, notification
// read/cleared state, sound queue, alerted-response tracking, settings) is saved
// to localStorage so it SURVIVES navigation to Settings / Admin Profile and back.
// Without this, remounting the Dashboard resets everything and the whole app
// "restarts" (OTW driving, sound alerts, notifications all begin again).
//
// ✅ FIX (P24 REVISION) — SHARED-STATE CONTRACT, keep this block IDENTICAL in
// Dashboard.jsx, Profile.jsx and SystemSettings.jsx.
// All three screens read and write the SAME record, because all three take part in
// the live OTW drive and in the alert sounds. Two cross-file bugs came from the old
// helper, which REPLACED the whole record:
//   * a write from one screen could wipe the drive timeline another screen needed,
//     which is what made the OTW pin pause and then resume from the old spot;
//   * the in-flight `soundQueue` was part of the record, so a siren still queued when
//     the operator navigated away PLAYED AGAIN on return - even for an incident that
//     had been resolved in the meantime (Profile can resolve one).
// `patchSharedState` only merges the keys a screen actually owns, so no screen can
// clobber another's state.
const LS_KEY = "cg_dashboard_state_v1"

function loadSharedState() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch (e) {
    return {}
  }
}

function patchSharedState(patch) {
  try {
    const next = { ...loadSharedState(), ...patch }
    localStorage.setItem(LS_KEY, JSON.stringify(next))
    return next
  } catch (e) {
    // ignore quota / serialization errors
    return null
  }
}

// ✅ P1 REVISION: Only 5 categories (Others removed)
const CATEGORIES = [
  "Fire", "Flood", "Medical Emergency", "Accident", "Crime"
]

// ✅ P1 REVISION: Department-themed colors (used for markers + OTW lines)
const DEPT_COLORS = {
  "BFP": "#e11d48",
  "PNP": "#111827",
  "CDRRMO/MDRRMO": "#2563eb",
  "Medical Emergency Team and Responders": "#16a34a"
}

// ✅ P5 REVISION: Department responder emoji (shown on the live map while OTW)
const DEPT_EMOJI = {
  "BFP": "🚒",
  "PNP": "🚓",
  "CDRRMO/MDRRMO": "🚜",
  "Medical Emergency Team and Responders": "🚑"
}

// ✅ FIX (P21 REVISION): Icon instances are CACHED, one per category / department.
// Previously a brand-new L.Icon / L.divIcon object was handed to <Marker icon={...}>
// on EVERY render. react-leaflet calls marker.setIcon() whenever the `icon` prop's
// object identity changes, and setIcon() DESTROYS that marker's open popup. Because
// the dashboard re-renders every second (responder tick), the popup kept closing by
// itself and the OTW driving pin appeared to "move". Reusing one cached instance per
// category/department keeps the identity stable, so popups stay open and the pins
// stay put.
const markerIconCache = {}
const deptIconCache = {}

const getMarkerIcon = (category) => {
  let color = "blue"
  if (category === "Fire") color = "red"
  if (category === "Medical Emergency") color = "green"
  if (category === "Flood") color = "blue"
  if (category === "Crime") color = "black"
  if (category === "Accident") color = "orange"

  if (!markerIconCache[color]) {
    markerIconCache[color] = new L.Icon({
      iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${color}.png`,
      shadowUrl: markerShadow,
      iconSize: [25, 41],
      iconAnchor: [12, 41]
    })
  }
  return markerIconCache[color]
}

// ✅ P10 REVISION: Each department gets a DISTINCT custom marker icon (different
// color + emoji per department) so they don't all look the same. Used for both
// the department base markers and the moving OTW responder markers.
const getDeptIcon = (dept) => {
  if (deptIconCache[dept]) return deptIconCache[dept]
  const color = DEPT_COLORS[dept] || "#2d5be3"
  const emoji = DEPT_EMOJI[dept] || "🚨"
  deptIconCache[dept] = L.divIcon({
    className: "",
    html: `<div style="width:34px;height:34px;border-radius:50%;background:${color};color:white;display:flex;align-items:center;justify-content:center;font-size:18px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18]
  })
  return deptIconCache[dept]
}

// ✅ FIX (P21 REVISION): The map is re-centred ONCE per explicit map-navigation
// request. It used to depend on the whole `selectedReport` object plus `settings`, so
// EVERY render re-centred the map and snapped it back while the operator was dragging.
// It also required settings.autoZoom (default OFF), which silently swallowed every
// click-to-navigate. Now a click publishes { id, mode, lat, lng, token } and this
// controller consumes it exactly once — afterwards you can pan / drag / zoom freely,
// and only a NEW click moves the map again.
function MapController({ mapFocus }) {
  const map = useMap()
  const handledRef = useRef(-1)
  useEffect(() => {
    if (!mapFocus || !mapFocus.token) return
    if (handledRef.current === mapFocus.token) return
    const lat = Number(mapFocus.lat)
    const lng = Number(mapFocus.lng)
    if (isNaN(lat) || isNaN(lng)) return
    handledRef.current = mapFocus.token
    map.setView([lat, lng], 16)
  }, [mapFocus, map])
  return null
}

// ✅ REVISION: Dagupan City test-area center (Region 1 / Pangasinan)
const DAGUPAN_CENTER = { lat: 16.0430, lng: 120.3333 }

// ✅ P8 REVISION: Each department has its OWN separate starting location, all
// within Dagupan City only (BFP station, PNP station, CDRRMO/MDRRMO office,
// Medical/ambulance base — each at a different lat/lng inside Dagupan).
const DEPT_START = {
  "BFP": { lat: 16.0430, lng: 120.3333 },                                  // BFP Dagupan station (city center)
  "PNP": { lat: 16.0452, lng: 120.3312 },                                  // PNP Dagupan station
  "CDRRMO/MDRRMO": { lat: 16.0412, lng: 120.3352 },                        // CDRRMO/MDRRMO office
  "Medical Emergency Team and Responders": { lat: 16.0460, lng: 120.3360 } // Medical/EMS base
}

// ✅ P8 REVISION: Get a department's own starting location (falls back to the
// Dagupan center if a department has no dedicated start defined).
function getDeptStart(dept) {
  return DEPT_START[dept] || DAGUPAN_CENTER
}

// ✅ REVISION: Check whether a GPS point is inside the Dagupan / test area
// (testRadiusKm centered on Dagupan City, default 200km).
function isWithinTestArea(lat, lng, testRadiusKm) {
  const radiusKm = testRadiusKm || 200
  const distKm = distanceMeters(lat, lng, DAGUPAN_CENTER.lat, DAGUPAN_CENTER.lng) / 1000
  return distKm <= radiusKm
}

// ✅ P1 REVISION: Haversine distance in meters
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ✅ P10 REVISION: Total length (meters) of a route polyline (array of [lat,lng])
function routeLength(route) {
  let total = 0
  for (let i = 1; i < route.length; i++) {
    total += distanceMeters(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1])
  }
  return total
}

// ✅ P10 REVISION: Move a responder `step` meters forward along a road route
// polyline from its current position (returns the new {lat,lng}).
function moveAlongRoute(route, cur, step) {
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < route.length; i++) {
    const d = distanceMeters(cur.lat, cur.lng, route[i][0], route[i][1])
    if (d < bestDist) { bestDist = d; bestIdx = i }
  }
  let remaining = step
  let i = bestIdx
  let pos = { lat: route[i][0], lng: route[i][1] }
  while (i < route.length - 1 && remaining > 0) {
    const seg = distanceMeters(route[i][0], route[i][1], route[i + 1][0], route[i + 1][1])
    if (seg <= remaining) {
      remaining -= seg
      i++
      pos = { lat: route[i][0], lng: route[i][1] }
    } else {
      const frac = remaining / seg
      pos = {
        lat: route[i][0] + (route[i + 1][0] - route[i][0]) * frac,
        lng: route[i][1] + (route[i + 1][1] - route[i][1]) * frac
      }
      remaining = 0
    }
  }
  return pos
}

// ✅ FIX (P23 REVISION): Simulated responder speed in metres per SECOND. The OTW
// position is now derived from this speed and the wall clock (dispatchedAt -> now)
// instead of being nudged forward by a per-tick increment. The number is deliberately
// the same pace this dashboard already used (250 m per 1-second tick), so a drive still
// takes exactly as long as before - only its timing source changed.
const RESPONDER_SPEED_MPS = 250

// ✅ FIX (P23 REVISION): the point `meters` along a route polyline. Because it is an
// ABSOLUTE distance from the START of the route (rather than "move N metres from
// wherever the marker currently happens to be"), the same elapsed time always yields the
// same position - which is exactly what makes the drive survive leaving and re-entering
// the dashboard.
function pointAlongRoute(route, meters) {
  if (!route || route.length === 0) return null
  if (route.length === 1 || meters <= 0) return { lat: route[0][0], lng: route[0][1] }
  let remaining = meters
  for (let i = 1; i < route.length; i++) {
    const seg = distanceMeters(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1])
    if (seg <= remaining) {
      remaining -= seg
    } else {
      const frac = remaining / seg
      return {
        lat: route[i - 1][0] + (route[i][0] - route[i - 1][0]) * frac,
        lng: route[i - 1][1] + (route[i][1] - route[i - 1][1]) * frac
      }
    }
  }
  const last = route[route.length - 1]
  return { lat: last[0], lng: last[1] }
}

// ✅ FIX (P24 REVISION): the OTW drive runs off an ABSOLUTE timeline.
// A drive is `{ anchor, start, dest, dept, route }`, where `anchor` is the wall-clock
// dispatch time. The position is then a pure function of `now` - it does NOT depend on
// how long the dashboard happened to be mounted, so leaving for System Settings or
// Profile and coming back lands the pin exactly where it should be by then.
function computeDrivePos(drive, now) {
  if (!drive || !drive.dest) return null
  const start = drive.start || DAGUPAN_CENTER
  const anchor = typeof drive.anchor === "number" ? drive.anchor : now
  const elapsedSec = Math.max(0, (now - anchor) / 1000)
  const route = drive.route && drive.route.length > 1 ? drive.route : null
  const total = route
    ? routeLength(route)
    : distanceMeters(start.lat, start.lng, drive.dest.lat, drive.dest.lng)
  const travelled = Math.min(total, elapsedSec * RESPONDER_SPEED_MPS)
  const progress = total > 0 ? Math.min(1, travelled / total) : 1
  if (travelled >= total) {
    return { lat: drive.dest.lat, lng: drive.dest.lng, dept: drive.dept, progress: 1 }
  }
  if (route) {
    const p = pointAlongRoute(route, travelled)
    return { lat: p.lat, lng: p.lng, dept: drive.dept, progress }
  }
  const frac = total > 0 ? travelled / total : 1
  return {
    lat: start.lat + (drive.dest.lat - start.lat) * frac,
    lng: start.lng + (drive.dest.lng - start.lng) * frac,
    dept: drive.dept,
    progress
  }
}

// ✅ FIX (P24 REVISION): build the drive timeline from the currently-dispatched
// incidents. The existing anchor is KEPT when there already is one, so the locally
// recorded dispatch instant wins over the value that comes back from Firestore - a
// Firestore round-trip would otherwise shift the pin backwards each remount.
// The OSRM road route is cached INTO the record, so a remount can recompute the
// position correctly even before the route request comes back.
function buildDrives(reports, deptRoutes, prevDrives) {
  const now = Date.now()
  const prev = prevDrives || {}
  const next = {}
  reports.forEach((r) => {
    if (!r || r.status !== "dispatched" || !r.assignedDepartment || !r.location) return
    const lat = Number(r.location.latitude)
    const lng = Number(r.location.longitude)
    if (isNaN(lat) || isNaN(lng)) return
    const existing = prev[r.id]
    const fetched = deptRoutes && deptRoutes[r.id]
    const route = fetched && fetched.length > 1 ? fetched : (existing && existing.route ? existing.route : null)
    next[r.id] = {
      anchor: existing && typeof existing.anchor === "number"
        ? existing.anchor
        : (r.dispatchedAt && r.dispatchedAt.seconds
            ? r.dispatchedAt.seconds * 1000
            : (r.dispatchedAt ? new Date(r.dispatchedAt).getTime() : now)),
      start: getDeptStart(r.assignedDepartment),
      dest: { lat, lng },
      dept: r.assignedDepartment,
      route
    }
  })
  return next
}

// ✅ FIX (P24 REVISION): the live responder map, computed from the drive timeline for
// a given instant. Used both for the 1-second tick and for the FIRST frame after a
// remount - which is what removes the visible pause.
function tickResponders(drives, now) {
  const out = {}
  Object.keys(drives || {}).forEach((id) => {
    const pos = computeDrivePos(drives[id], now)
    if (pos) out[id] = pos
  })
  return out
}

// ✅ FIX (P24 REVISION): shallow compare, so an unchanged tick keeps the same object
// identity and does not churn React state (or the persisted record) every second.
function sameResponders(a, b) {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (let i = 0; i < ka.length; i++) {
    const x = a[ka[i]]
    const y = b[ka[i]]
    if (!y) return false
    if (x.lat !== y.lat || x.lng !== y.lng || x.dept !== y.dept || x.progress !== y.progress) return false
  }
  return true
}

// Converts a Firestore Timestamp, string, Date or millisecond number into milliseconds.
function toMs(value) {
  if (!value) return 0
  if (typeof value === "number") return value
  if (typeof value.seconds === "number") return value.seconds * 1000
  if (typeof value.toDate === "function") return value.toDate().getTime()
  const t = new Date(value).getTime()
  return isNaN(t) ? 0 : t
}

// ✅ P1 REVISION: Format response time as "Resolved within X minutes Y seconds"
function formatResponseTime(createdAt, resolvedAt) {
  const start = toMs(createdAt)
  const end = toMs(resolvedAt)
  if (!start || !end) return "—"
  const diffSec = Math.max(0, Math.floor((end - start) / 1000))
  const m = Math.floor(diffSec / 60)
  const s = diffSec % 60
  return `Resolved within ${m} minutes ${s} seconds`
}

// Elapsed time that stops once the incident is resolved or marked fake.
function formatElapsed(createdAt, endAt, frozenSeconds) {
  const start = toMs(createdAt)
  if (!start) return "—"
  let diffSec
  if (typeof frozenSeconds === "number") {
    diffSec = frozenSeconds
  } else {
    // Without a resolve or reject stamp there is nothing to freeze on, so keep counting.
    const end = endAt ? toMs(endAt) : Date.now()
    if (!end) return "—"
    diffSec = Math.max(0, Math.floor((end - start) / 1000))
  }
  const m = Math.floor(diffSec / 60)
  const s = diffSec % 60
  return `${m}m ${s}s`
}

// Converts a Firestore timestamp, string or Date into milliseconds for sorting.
function reportTimeMs(createdAt) {
  return toMs(createdAt)
}

// ✅ REVISION: Robust date formatting (handles Firestore Timestamp, string, Date)
function formatDate(timestamp) {
  if (!timestamp) return "No date"
  let d
  if (typeof timestamp === "string") {
    d = new Date(timestamp)
  } else if (timestamp.seconds) {
    d = new Date(timestamp.seconds * 1000)
  } else if (timestamp.toDate) {
    d = timestamp.toDate()
  } else {
    d = new Date(timestamp)
  }
  if (isNaN(d.getTime())) return "No date"
  return d.toLocaleString()
}

// ✅ P18 REVISION: The incident's ORIGINAL AI-suggested category (the "blue text")
// is the single source of truth for its type/category. The department dropdown
// must NEVER change it. We read `aiCategory` FIRST (falling back to `type` only
// for legacy records that have no aiCategory) so the category never derives from
// the assigned department. This keeps the dashboard counts, markers, popups, and
// the Profile analytics/history on the ORIGINAL incident type.
const reportType = (r) => r.aiCategory || r.type

// Lowercases the status so a stray capital never breaks the routing.
const reportStatus = (r) => (r.status ? String(r.status).toLowerCase() : "pending")

// One sign per status, so two signs can never stack.
const STATUS_SIGNS = {
  dispatched: { text: "🚚 OTW", color: "#2d5be3" },
  resolved: { text: "\u2713 RESOLVED", color: "green" },
  rejected: { text: "\u2717 FAKE", color: "#999" },
}

// Returns the single sign for a report, or null when it should show none.
const statusSign = (r) => STATUS_SIGNS[reportStatus(r)] || null

// Video extensions Cloudinary uses. The mobile app stores the video URL in
// imageUrl whenever the report has no photo, so the extension is the only
// reliable way to tell a video URL apart from a photo URL.
const VIDEO_EXT = /\.(mp4|mov|webm|m4v|avi|ogv|quicktime)(\?|$)/i

const asUrl = (v) => (v ? String(v).trim() : "")
const isVideoUrl = (url) => !!url && VIDEO_EXT.test(url)

// Resolves the photo and the video of a report INDEPENDENTLY.
//   - videoUrl set            -> that is the video
//   - imageUrl is a video file -> it is the video URL the mobile app copied over
//   - imageUrl is anything else -> it is a real photo
// A report can carry both (a photo was taken, then the AI asked for a video
// backup and the photo was never dropped), so both are returned separately.
function evidenceParts(r) {
  const imageUrl = asUrl(r.imageUrl)
  const rawVideo = asUrl(r.videoUrl)

  let photoUrl = null
  let videoUrl = rawVideo || null

  if (imageUrl) {
    if (isVideoUrl(imageUrl)) {
      // Never hand a video URL to an <img> tag.
      if (!videoUrl) videoUrl = imageUrl
    } else {
      photoUrl = imageUrl
    }
  }

  return { photoUrl, videoUrl }
}

// ✅ P20 REVISION: AUTO-DETECT the responding department from the incident's
// ORIGINAL AI category. This replaces the manual dropdown — the department is
// chosen automatically from the incident details and shown in a read-only box.
//   Fire → BFP
//   Crime → PNP
//   Flood → CDRRMO/MDRRMO
//   Medical Emergency -> Medical Emergency Team and Responders
//   Accident -> Medical Emergency Team and Responders (medical response is the
//               most appropriate first responder for an accident; PNP is a
//               reasonable alternative for traffic/road accidents)
const autoDetectDept = (r) => {
  const cat = reportType(r)
  if (cat === "Fire") return "BFP"
  if (cat === "Crime") return "PNP"
  if (cat === "Flood") return "CDRRMO/MDRRMO"
  if (cat === "Medical Emergency") return "Medical Emergency Team and Responders"
  if (cat === "Accident") return "Medical Emergency Team and Responders"
  return "BFP" // default fallback
}

function Dashboard() {
  const auth = getAuth()
  const navigate = useNavigate()

  const [reports, setReports] = useState([])
  const [tick, setTick] = useState(0)

  // ✅ P17 REVISION: Load persisted dashboard state once on mount so the app
  // resumes where it left off instead of restarting.
  const [persisted] = useState(() => loadSharedState())

  // ✅ P1 REVISION: Live clock for response-time tracking
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const [notifList, setNotifList] = useState([])
  const [selectedReport, setSelectedReport] = useState(null)

  // ✅ FIX (P24 REVISION): the in-flight alert queue is deliberately NOT restored from
  // the shared record. A siren that was still queued when the operator navigated away
  // used to play again on return - and because Profile.jsx can resolve an incident while
  // the dashboard is unmounted, that could be a siren for an ALREADY RESOLVED incident,
  // which is exactly what must never happen. Sound now lives only in this mounted
  // session, so a resolved notification can never be followed by a sound.
  const [soundQueue, setSoundQueue] = useState([])
  const isPlayingRef = useRef(false)
  const [showNotif, setShowNotif] = useState(false)
  const [activeFilter, setActiveFilter] = useState("All")
  const [statusFilter, setStatusFilter] = useState("All")
  const [deptFilter, setDeptFilter] = useState("All")
  const [alertPopup, setAlertPopup] = useState(null)
  // Elapsed-time alerts are kept in a list so the 10 and 20 minute ones can both show.
  const [timeAlerts, setTimeAlerts] = useState([])

  // Adds an elapsed-time alert without dropping the one already showing.
  const pushTimeAlert = (level, text) => {
    setTimeAlerts((prev) => [...prev.slice(-3), { level, text, at: Date.now() }])
  }

  // Width of the Incidents panel, changed by dragging its right edge.
  const [incidentPanelWidth, setIncidentPanelWidth] = useState(340)
  const resizingRef = useRef(false)

  // Drag the panel edge left or right to resize the Incidents list.
  const startResize = (e) => {
    e.preventDefault()
    resizingRef.current = true
    const startX = e.clientX
    const startWidth = incidentPanelWidth
    const onMove = (ev) => {
      if (!resizingRef.current) return
      const next = Math.min(900, Math.max(220, startWidth + (ev.clientX - startX)))
      setIncidentPanelWidth(next)
    }
    const onUp = () => {
      resizingRef.current = false
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  // ✅ FIX (P21 REVISION): One-shot map-navigation request. `mode` says WHICH live-map
  // target to open — "evidence" (the incident's own marker/popup) or "otw" (the
  // assigned OTW driving pin) — and `token` forces the effect to run again even when
  // the SAME record is clicked a second time after the operator has panned away.
  const [mapFocus, setMapFocus] = useState(null)

  // ✅ REVISION: Live responder position (for OTW tracking on the map)
  const [responderPos, setResponderPos] = useState(null)

  // ✅ P5 REVISION: Simulated department responder positions that move from
  // the Dagupan center toward each assigned incident (reportId -> {lat,lng,dept,progress})
  // ✅ FIX (P24 REVISION): responder positions are DERIVED from the persisted drive
  // timeline and seeded for the CURRENT instant on mount. Previously the marker was
  // restored from the position that had been saved when the operator left the
  // dashboard, so on return it sat frozen until the Firestore listener plus the OSRM
  // route arrived - the "pauses and then resumes from where it paused" symptom - and
  // then jumped forward. Seeding from the clock removes that gap entirely.
  const [deptResponders, setDeptResponders] = useState(() =>
    tickResponders(persisted?.drives || {}, Date.now())
  )

  // ✅ FIX (P24 REVISION): the persisted OTW drive timeline: one record per dispatched
  // incident, `{ anchor, start, dest, dept, route }`. Profile.jsx clears a report's
  // entry when it resolves it, so a resolved incident can never leave a phantom pin
  // behind for the next dashboard mount.
  const [drives, setDrives] = useState(persisted?.drives || {})
  const drivesRef = useRef(persisted?.drives || {})

  // ✅ FIX (P24 REVISION): incidents resolved ELSEWHERE (Profile.jsx can resolve one from
  // its EMERGENCY HISTORY table) are read from the shared record on mount. Without this the
  // dashboard trusted only its own bookkeeping, so a mount after an admin resolved from the
  // Profile screen could still treat the incident as live and sound its 10/20-minute alert -
  // a sound for an incident that was already resolved.
  const [resolvedIds, setResolvedIds] = useState(() => new Set(persisted?.resolvedIds || []))
  const resolvedIdsRef = useRef(resolvedIds)

  // ✅ P9 REVISION: Local department selection per incident (reportId -> dept).
  // The dropdown ONLY stores the chosen value here — it does NOT dispatch.
  // The "Assign" button reads this and actually dispatches the department OTW.
  const [deptSelection, setDeptSelection] = useState(persisted?.deptSelection || {})

  // ✅ P10 REVISION: Road routes per dispatched report (reportId -> [[lat,lng],...])
  // fetched from the OSRM public routing API so responders drive along roads.
  const [deptRoutes, setDeptRoutes] = useState(persisted?.deptRoutes || {})

  const [settings, setSettings] = useState(persisted?.settings || {
    aiDetection: true,
    autoZoom: false,
    showImages: true,
    enableAlerts: true,
    confidenceThreshold: 0.8,
    resolveRadiusM: 100,
    responseTargetMin: 10,
    responseCriticalMin: 20,
    testRadiusKm: 200
  })
  const [alertedReports, setAlertedReports] = useState(persisted?.alertedReports || {})
  // ✅ P17 REVISION: Track which report ids already triggered the new-incident
  // sound/alert so they do NOT replay when the dashboard remounts (the initial
  // onSnapshot "added" batch would otherwise re-fire every alert on navigation).
  const [alertedReportIds, setAlertedReportIds] = useState(() => new Set(persisted?.alertedReportIds || []))
  const alertedReportIdsRef = useRef(alertedReportIds)
  useEffect(() => { alertedReportIdsRef.current = alertedReportIds }, [alertedReportIds])
  // ✅ FIX (P23 REVISION): Refs read by the long-lived response-time monitor, so that
  // monitor can be created ONCE and still see the latest reports / settings / alerted
  // state instead of a stale render snapshot.
  const reportsRef = useRef(reports)
  const settingsRef = useRef(settings)
  const alertedReportsRef = useRef(alertedReports)
  useEffect(() => { reportsRef.current = reports }, [reports])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { alertedReportsRef.current = alertedReports }, [alertedReports])
  useEffect(() => { resolvedIdsRef.current = resolvedIds }, [resolvedIds])
  // ✅ P17 REVISION: Track notification ids the admin cleared so they stay
  // cleared after navigating away and back.
  const [clearedNotifIds, setClearedNotifIds] = useState(() => new Set(persisted?.clearedNotifIds || []))
  const popupRefs = useRef({})
  const audioRef = useRef(null)

  // ✅ FIX (P24 REVISION): drop a report's drive timeline entry (and persist the
  // removal) so a resolved or rejected incident owns no pin any more. Profile.jsx does
  // the same when an admin resolves from the Profile screen, which keeps the two
  // screens from disagreeing about which incidents are still being driven to.
  const clearDrive = (id) => {
    if (!drivesRef.current[id]) return
    const next = { ...drivesRef.current }
    delete next[id]
    drivesRef.current = next
    setDrives(next)
    setDeptResponders((prev) => {
      if (!prev[id]) return prev
      const n = { ...prev }
      delete n[id]
      return n
    })
    patchSharedState({ drives: next })
  }

  // ✅ REVISION: Track the responder's live GPS position (for OTW line)
  useEffect(() => {
    if (!navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setResponderPos({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        })
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  // ✅ P1 REVISION: Load system settings (confidence threshold, resolve radius, response standards)
  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, "system", "settings"))
        if (snap.exists()) {
          const d = snap.data()
          setSettings((prev) => ({
            ...prev,
            aiDetection: d.aiDetection ?? true,
            autoZoom: d.autoZoom ?? false,
            showImages: d.showImages ?? true,
            enableAlerts: d.enableAlerts ?? true,
            confidenceThreshold: d.confidenceThreshold ?? 0.8,
            resolveRadiusM: d.resolveRadiusM ?? 100,
            responseTargetMin: d.responseTargetMin ?? 10,
            responseCriticalMin: d.responseCriticalMin ?? 20,
            testRadiusKm: d.testRadiusKm ?? 200
          }))
        }
      } catch (err) {
        console.log(err)
      }
    }
    load()
  }, [])

  // ✅ P17 REVISION: Persist live dashboard state on every change so it survives
  // navigation (route change to Settings / Admin Profile and back).
  // ✅ FIX (P24 REVISION): merge-safe persistence (see the shared-state contract at the
  // top of this file). `soundQueue` is intentionally absent - the alert queue must not
  // outlive the session that started it, or a resolved incident could be followed by a
  // replayed siren. `drives` is what lets the next mount place the OTW pin correctly.
  useEffect(() => {
    patchSharedState({
      deptResponders,
      drives,
      deptRoutes,
      deptSelection,
      alertedReports,
      alertedReportIds: [...alertedReportIds],
      clearedNotifIds: [...clearedNotifIds],
      settings,
      resolvedIds: [...resolvedIds]
    })
  }, [deptResponders, drives, deptRoutes, deptSelection, alertedReports, alertedReportIds, clearedNotifIds, settings, resolvedIds])

  const enqueueSound = (type, category) => {
    setSoundQueue((prev) => [...prev, { type, category }])
  }

  // Unlocks browser audio on the first user gesture, which autoplay policy requires.
  const audioUnlockedRef = useRef(false)
  const audioCtxRef = useRef(null)

  // Creates the shared WebAudio context used for the fallback alert tone.
  const getAudioCtx = () => {
    if (audioCtxRef.current) return audioCtxRef.current
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return null
      audioCtxRef.current = new Ctx()
    } catch (e) {
      audioCtxRef.current = null
    }
    return audioCtxRef.current
  }

  // Plays a short generated tone, used when the mp3 file cannot be played.
  const playFallbackTone = (type) => {
    const ctx = getAudioCtx()
    if (!ctx) return
    try {
      if (ctx.state === "suspended") ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "square"
      osc.frequency.value = type === "critical" ? 880 : type === "warning" ? 660 : 520
      gain.gain.value = 0.15
      osc.connect(gain)
      gain.connect(ctx.destination)
      const now = ctx.currentTime
      osc.start(now)
      osc.stop(now + 0.6)
    } catch (e) {
      // ignore
    }
  }

  // Unlocks audio on the first click or key press so later alerts are allowed to play.
  useEffect(() => {
    const unlock = () => {
      audioUnlockedRef.current = true
      const ctx = getAudioCtx()
      if (ctx && ctx.state === "suspended") ctx.resume()
    }
    window.addEventListener("click", unlock)
    window.addEventListener("keydown", unlock)
    window.addEventListener("touchstart", unlock)
    return () => {
      window.removeEventListener("click", unlock)
      window.removeEventListener("keydown", unlock)
      window.removeEventListener("touchstart", unlock)
    }
  }, [])

  // ✅ REVISION: Sound effects for alerts + notifications (enabled)
  useEffect(() => {
    if (isPlayingRef.current) return
    if (soundQueue.length === 0) return
    // ✅ REVISION: Respect the sound toggle from System Settings
    if (localStorage.getItem("cg_soundEnabled") === "false") {
      setSoundQueue([])
      return
    }
    const { type, category } = soundQueue[0]
    let sound = "/siren.mp3"
    if (type === "warning") sound = "/warning.mp3"
    if (type === "critical") sound = "/critical.mp3"
    if (!type) {
      if (category === "Fire") sound = "/fire.mp3"
      if (category === "Medical Emergency") sound = "/ambulance.mp3"
      if (category === "Crime") sound = "/police.mp3"
      if (category === "Accident") sound = "/accident.mp3"
      if (category === "Flood") sound = "/flood.mp3"
    }
    isPlayingRef.current = true
    let settled = false
    // Advances the queue exactly once, whichever way the sound ends.
    const done = () => {
      if (settled) return
      settled = true
      isPlayingRef.current = false
      setSoundQueue((prev) => prev.slice(1))
    }
    const audio = new Audio(sound)
    audio.onended = done
    // A missing or blocked file falls back to a generated tone, so an alert is always heard.
    audio.onerror = () => { playFallbackTone(type); done() }
    audio.play().then(() => {}).catch(() => { playFallbackTone(type); done() })
    audioRef.current = audio
  }, [soundQueue])

  // ✅ P1 REVISION: REALTIME listener — only accept reports with AI confidence 80–100%
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "reports"), (snapshot) => {
      let data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

      // ✅ AI Filtering: reject low-confidence reports automatically.
      // EXCEPTION: a report the reporter described in their own words is kept.
      // The mobile app deliberately saves those (manuallyDescribed: true, LOW
      // severity) when photo and video both scored below the threshold, so the
      // incident still reaches responders with whatever evidence it has.
      data = data.filter((r) => {
        if (r.manuallyDescribed === true) return true
        const conf = r.aiConfidence
        if (typeof conf !== "number") return true // legacy
        return conf >= settings.confidenceThreshold
      })

      if (!settings.aiDetection) data = []

      setReports(data)
      setNotifList(data.filter((r) => !r.read))

      const newReports = snapshot.docChanges().filter(
        (change) => change.type === "added"
      )
      if (newReports.length > 0) {
        const newReport = newReports[0].doc.data()
        const newId = newReports[0].doc.id
        const conf = newReport.aiConfidence
        const accepted =
          newReport.manuallyDescribed === true ||
          typeof conf !== "number" ||
          conf >= settings.confidenceThreshold
        // ✅ P17 REVISION: Only alert/sound for reports not already alerted, so
        // navigating back to the dashboard does NOT replay the sound.
        const alreadyAlerted = alertedReportIdsRef.current.has(newId)
        if (accepted && settings.enableAlerts !== false && !alreadyAlerted) {
          // ✅ FIX (P23 REVISION): flag it SYNCHRONOUSLY as well, so this sound
          // cannot replay when the dashboard is re-opened before the persisted
          // state has been written.
          alertedReportIdsRef.current.add(newId)
          setAlertedReportIds((prev) => new Set(prev).add(newId))
          setAlertPopup(newReport)
          enqueueSound(null, newReport.aiCategory)
          setTimeout(() => setAlertPopup(null), 6000)
        }
      }
    })
    return () => unsub()
  }, [settings])

  // ✅ FIX (P21 REVISION): the popup is opened ONCE per explicit click, driven by the
  // same one-shot token as the map — it no longer re-fires on every `settings` change.
  useEffect(() => {
    if (!mapFocus) return
    const key = mapFocus.mode === "otw" ? `otw:${mapFocus.id}` : mapFocus.id
    const ref = popupRefs.current[key]
    if (ref) ref.openPopup()
  }, [mapFocus])

  // ✅ P1 REVISION: Response time standards monitoring (target 10–20 min)
  // ✅ FIX (P23 REVISION): this monitor is now created ONCE and reads the latest state
  // from refs. It used to be destroyed and re-created every time `reports` / `settings` /
  // `alertedReports` changed - and the 1-second responder tick changes `reports`
  // constantly - so the interval was almost always restarted before it could fire, and
  // the repeat guard was read from a stale render. That is what let the same incident
  // sound its 10/20-minute alert OVER AND OVER. The "already alerted" flag is also
  // written synchronously into a ref BEFORE the sound is queued, so each incident sounds
  // its warning and its critical alert exactly ONCE - and never again, even after the
  // dashboard is left and re-opened.
  useEffect(() => {
    const check = () => {
      const s = settingsRef.current
      // Only an explicit false disables alerts, so a partial settings object still alerts.
      if (s.enableAlerts === false) return
      const now = Date.now()
      const settled = alertedReportsRef.current
      reportsRef.current.forEach((r) => {
        if (!r.createdAt || r.status === "resolved" || r.status === "rejected") return
        if (resolvedIdsRef.current.has(r.id)) return
        const created = r.createdAt?.seconds
          ? r.createdAt.seconds * 1000
          : new Date(r.createdAt).getTime()
        const diffMinutes = (now - created) / 1000 / 60

        if (diffMinutes >= s.responseTargetMin && diffMinutes < s.responseCriticalMin && !settled[r.id]) {
          settled[r.id] = "warning"
          enqueueSound("warning", r.aiCategory)
          pushTimeAlert("warning", `WARNING: ${r.aiCategory} has passed ${s.responseTargetMin} minutes`)
          setAlertedReports((prev) => ({ ...prev, [r.id]: "warning" }))
        }
        if (diffMinutes >= s.responseCriticalMin && settled[r.id] !== "critical") {
          settled[r.id] = "critical"
          enqueueSound("critical", r.aiCategory)
          pushTimeAlert("critical", `CRITICAL: ${r.aiCategory} has passed ${s.responseCriticalMin} minutes`)
          setAlertedReports((prev) => ({ ...prev, [r.id]: "critical" }))
        }
      })
    }
    // Run once on mount so an already-overdue incident alerts without waiting a tick.
    check()
    const interval = setInterval(check, 10000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Old status routing: a card click selects that report and opens its live-map popup.
  const openReport = (r) => {
    setSelectedReport(r)
    if (!r.location) return
    const lat = Number(r.location.latitude)
    const lng = Number(r.location.longitude)
    if (isNaN(lat) || isNaN(lng)) return
    setMapFocus({ id: r.id, mode: "evidence", lat, lng, token: Date.now() })
  }

  // ✅ FIX (P21 REVISION): ONE place that decides where the live map goes, so every
  // click path (Incidents card, notification, alert banner, live-map popup) routes to
  // the correct pin: "otw" -> the assigned OTW driving pin, "evidence" -> the
  // incident's own marker, "card" -> the driving pin while OTW, else the evidence pin.
  const focusMap = (report, mode) => {
    if (!report) return
    const otwResp = deptResponders[report.id]
    const wantOtw =
      (mode === "otw" || mode === "card") &&
      report.status === "dispatched" &&
      !!otwResp
    if (wantOtw) {
      setSelectedReport(report)
      setMapFocus({ id: report.id, mode: "otw", lat: otwResp.lat, lng: otwResp.lng, token: Date.now() })
      return
    }
    if (!report.location) return
    const lat = Number(report.location.latitude)
    const lng = Number(report.location.longitude)
    if (isNaN(lat) || isNaN(lng)) return
    setSelectedReport(report)
    setMapFocus({ id: report.id, mode: "evidence", lat, lng, token: Date.now() })
  }

  // ✅ FIX (P21 REVISION): Stop all alert audio — pause whatever is playing and empty
  // the queue. Called the instant an incident is resolved, so the resolve notification
  // is SILENT (the requirement: "the sound alert must be none").
  const silenceAlerts = () => {
    try {
      if (audioRef.current) {
        audioRef.current.onended = null
        audioRef.current.pause()
        audioRef.current = null
      }
    } catch (e) {
      // ignore
    }
    isPlayingRef.current = false
    setSoundQueue((prev) => (prev.length === 0 ? prev : []))
  }

  const markAsRead = async (id) => {
    try {
      await updateDoc(doc(db, "reports", id), { read: true })
    } catch (err) {
      console.log(err)
    }
  }

  const handleLogout = async () => {
    try {
      await signOut(auth)
      navigate("/")
    } catch (err) {
      console.log(err)
    }
  }

  // ✅ P18 REVISION: Assign a department to respond to an incident (OTW).
  // This writes ONLY the responding department fields (assignedDepartment,
  // status, dispatchedAt, assignedBy). It MUST NEVER write `type` or
  // `aiCategory` — the incident's category stays the ORIGINAL AI-suggested one.
  const assignDepartment = async (id, dept) => {
    if (!dept) return
    try {
      await updateDoc(doc(db, "reports", id), {
        assignedDepartment: dept,
        status: "dispatched",
        dispatchedAt: new Date(),
        assignedBy: auth.currentUser?.email || "admin"
      })
      // ✅ FIX (P24 REVISION): anchor this drive's timeline IMMEDIATELY and persist it.
      // Before this, the dispatch instant only reached storage on the next 1-second
      // tick, so navigating to System Settings / Profile straight after Assign could
      // lose it and the pin would resume on the wrong spot. `anchor` is the local
      // dispatch time (not the Firestore round-trip), so it is exact.
      const dispatchedReport = reportsRef.current.find((x) => x.id === id)
      if (dispatchedReport && dispatchedReport.location) {
        const lat = Number(dispatchedReport.location.latitude)
        const lng = Number(dispatchedReport.location.longitude)
        if (!isNaN(lat) && !isNaN(lng)) {
          const seeded = {
            ...drivesRef.current,
            [id]: {
              anchor: Date.now(),
              start: getDeptStart(dept),
              dest: { lat, lng },
              dept,
              route: deptRoutes[id] && deptRoutes[id].length > 1 ? deptRoutes[id] : null
            }
          }
          drivesRef.current = seeded
          setDrives(seeded)
          setDeptResponders(tickResponders(seeded, Date.now()))
          patchSharedState({ drives: seeded })
        }
      }
      enqueueSound(null, "Fire") // notify sound on assignment
    } catch (err) {
      console.log(err)
      alert("Error assigning department")
    }
  }

  // Marks a report as fake and freezes its elapsed time, the same way resolving does.
  const rejectReport = async (id) => {
    if (!window.confirm("Mark this report as FAKE / not a real incident? This cannot be undone.")) return
    try {
      // Read the report once so the frozen elapsed time is computed from its own createdAt.
      const target = reportsRef.current.find((x) => x.id === id)
      const rejectedAt = new Date()
      const startMs = target ? toMs(target.createdAt) : 0
      const responseSeconds = startMs ? Math.max(0, Math.floor((rejectedAt.getTime() - startMs) / 1000)) : null
      await updateDoc(doc(db, "reports", id), {
        status: "rejected",
        rejectedAt,
        // Frozen response time, so the History table never depends on a live clock.
        responseSeconds,
        rejectedBy: auth.currentUser?.email || "admin",
        rejectionReason: "Marked as fake by admin"
      })
      // Settled reports no longer need elapsed-time alerts, so remember this one too.
      setResolvedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
      resolvedIdsRef.current.add(id)
      alert("✅ Report marked as fake / rejected")
    } catch (err) {
      console.log(err)
      alert("Error rejecting report")
    }
  }

  // ✅ P5 REVISION: Auto-resolve — the DEPARTMENT is the resolver. When the
  // assigned department responder arrives at the incident (within resolveRadiusM),
  // the incident auto-resolves. The admin does NOT manually resolve.
  // ✅ P18 REVISION: `resolvedBy` is the DEPARTMENT (the resolver), but the
  // incident's `type`/`aiCategory` are NEVER touched — they stay the ORIGINAL
  // AI-suggested category.
  const autoResolve = async (id, dept) => {
    // ✅ FIX (P24 REVISION): this incident is resolved, so it no longer owns a drive.
    // Clearing the timeline entry (persisted) means the OTW pin cannot come back to
    // life on the next mount - including after a trip to System Settings or Profile.
    clearDrive(id)
    // ✅ FIX (P24 REVISION): remember the resolve globally so the response-time monitor can
    // never decide this incident still deserves a 10/20-minute alert - not now, and not
    // after the dashboard is re-opened.
    setResolvedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
    resolvedIdsRef.current.add(id)
    // Read the report once so the frozen elapsed time is computed from its own createdAt.
    const target = reportsRef.current.find((x) => x.id === id)
    if (!target || reportStatus(target) === "resolved") return
    const resolvedAt = new Date()
    const startMs = toMs(target.createdAt)
    const responseSeconds = startMs ? Math.max(0, Math.floor((resolvedAt.getTime() - startMs) / 1000)) : null
    try {
      await updateDoc(doc(db, "reports", id), {
        status: "resolved",
        resolvedAt,
        // Frozen response time, so the History table never depends on a live clock.
        responseSeconds,
        resolvedBy: dept || "responder",
        autoResolved: true
      })
      // ✅ FIX (P21 REVISION): RESOLVING IS SILENT. This used to enqueue a "critical"
      // siren right after resolving — the exact opposite of the requirement. The resolve
      // notification itself is kept EXACTLY as before (same alert, same wording, no design
      // change); we only (a) stop enqueuing the siren and (b) silence any alert audio that
      // is still playing, so the resolve notification comes up with NO sound.
      silenceAlerts()
      alert(`✅ ${dept || "Department"} has arrived at the incident and it is auto-resolved.`)
    } catch (err) {
      console.log(err)
    }
  }

  // ✅ P10 REVISION: Fetch a real road route (OSRM public API) from each
  // department's own base to its assigned incident, so responders drive along
  // roads instead of a straight line.
  useEffect(() => {
    let cancelled = false
    const dispatched = reports.filter(
      (r) => r.status === "dispatched" && r.assignedDepartment && r.location
    )
    if (dispatched.length === 0) return
    const fetchRoutes = async () => {
      const tasks = dispatched.map(async (r) => {
        const start = getDeptStart(r.assignedDepartment)
        const lat = Number(r.location.latitude)
        const lng = Number(r.location.longitude)
        if (isNaN(lat) || isNaN(lng)) return null
        const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${lng},${lat}?overview=full&geometries=geojson`
        try {
          const res = await fetch(url)
          const data = await res.json()
          if (!data.routes || !data.routes[0] || !data.routes[0].geometry) return null
          const coords = data.routes[0].geometry.coordinates.map(([lng2, lat2]) => [lat2, lng2])
          return { id: r.id, coords }
        } catch (err) {
          return null
        }
      })
      const results = await Promise.all(tasks)
      if (cancelled) return
      setDeptRoutes((prev) => {
        const next = { ...prev }
        results.forEach((res) => { if (res) next[res.id] = res.coords })
        return next
      })
    }
    fetchRoutes()
    return () => { cancelled = true }
  }, [reports])

  // ✅ P5 REVISION: Animate department responders along the road route (or a
  // straight fallback line) from each department's own base toward the incident.
  // ✅ FIX (P23 REVISION): the responder's position is derived from an ABSOLUTE timeline
  // (dispatchedAt -> now, at RESPONDER_SPEED_MPS) instead of a per-tick increment.
  // Navigating to Settings / Admin Profile and back REMOUNTS the dashboard, so an
  // increment-based position restarted from whatever value had been persisted: the drive
  // visibly PAUSED while the operator was away and then continued from that same spot.
  // Because the position is now a function of the wall clock, a remount lands exactly
  // where the drive should be by now - it keeps moving continuously and its position /
  // progress never pause or reset.
  useEffect(() => {
    const animate = () => {
      // ✅ FIX (P24 REVISION): refresh the drive timeline (routes / anchors) FIRST, then
      // derive the responder positions from it for this instant. `reports` is empty for
      // the first frames after a remount, so in that window we keep the drive timeline
      // we loaded from storage instead of pruning it to nothing - that is what stops the
      // pin from blinking out, and it lets the correct position be computed immediately.
      const now = Date.now()
      let nextDrives = drivesRef.current
      if (reports.length > 0) {
        nextDrives = buildDrives(reports, deptRoutes, drivesRef.current)
        if (JSON.stringify(nextDrives) !== JSON.stringify(drivesRef.current)) {
          drivesRef.current = nextDrives
          setDrives(nextDrives)
        }
      }
      const nextResp = tickResponders(nextDrives, now)
      setDeptResponders((prev) => (sameResponders(prev, nextResp) ? prev : nextResp))
    }
    animate()
    const interval = setInterval(animate, 1000)
    return () => clearInterval(interval)
  }, [reports, deptRoutes])

  // ✅ P5 REVISION: Auto-resolve when a department responder arrives at the incident
  useEffect(() => {
    reports.forEach((r) => {
      if (!r || r.status !== "dispatched" || !r.assignedDepartment) return
      const resp = deptResponders[r.id]
      if (!resp || !r.location) return
      const lat = Number(r.location.latitude)
      const lng = Number(r.location.longitude)
      if (isNaN(lat) || isNaN(lng)) return
      const dist = distanceMeters(resp.lat, resp.lng, lat, lng)
      const radius = settings.resolveRadiusM || 100
      if (dist <= radius) {
        autoResolve(r.id, r.assignedDepartment)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptResponders, reports, settings.resolveRadiusM])

  const unread = reports.filter((r) => !r.read).length

  // ✅ P18 REVISION: Category counts use the ORIGINAL AI-suggested category
  // (reportType = aiCategory first), never a department-derived value.
  const fireCount = reports.filter((r) => reportType(r) === "Fire").length
  const medicalCount = reports.filter((r) => reportType(r) === "Medical Emergency").length
  const accidentCount = reports.filter((r) => reportType(r) === "Accident").length
  const floodCount = reports.filter((r) => reportType(r) === "Flood").length
  const crimeCount = reports.filter((r) => reportType(r) === "Crime").length

  const formatTime = (timestamp) => {
    if (!timestamp) return "No time"
    let created
    if (typeof timestamp === "string") {
      created = Date.parse(timestamp)
    } else if (timestamp.seconds) {
      created = timestamp.seconds * 1000
    } else {
      created = new Date(timestamp).getTime()
    }
    const diff = Math.floor((Date.now() - created) / 1000)
    if (diff < 60) return "Just now"
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`
    return `${Math.floor(diff / 86400)} day ago`
  }

  // ✅ P1 REVISION: Filtering by type, status, department
  const filteredReports = reports.filter((r) => {
    const st = reportStatus(r)
    if (activeFilter !== "All" && reportType(r) !== activeFilter) return false
    // Strict match, so an unassigned report never shows under Dispatched or Rejected.
    if (statusFilter !== "All" && st !== statusFilter.toLowerCase()) return false
    if (deptFilter !== "All" && r.assignedDepartment !== deptFilter) return false
    return true
  // Newest report first, oldest last.
  }).sort((a, b) => reportTimeMs(b.createdAt) - reportTimeMs(a.createdAt))

  const departments = [...new Set(reports.map((r) => r.assignedDepartment).filter(Boolean))]
  
  // Printable incident reports
  const handlePrintReports = () => {
    const printWindow = window.open("", "_blank", "width=1000,height=700")

    if (!printWindow) {
      alert("Please allow pop-ups to print incident reports.")
      return
    }

    const escapeHtml = (value) =>
      String(value ?? "—").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char])

    const rows = filteredReports.map((r) => `
      <tr>
        <td>${escapeHtml(r.id)}</td>
        <td>${escapeHtml(reportType(r) || "Emergency")}</td>
        <td>${escapeHtml(reportStatus(r))}</td>
        <td>${escapeHtml(r.description)}</td>
        <td>${escapeHtml(r.barangay)}</td>
        <td>${escapeHtml(r.severity)}</td>
        <td>${escapeHtml(r.assignedDepartment)}</td>
        <td>${escapeHtml(formatTime(r.createdAt))}</td>
        <td>${escapeHtml(
          formatElapsed(
            r.createdAt,
            r.resolvedAt || r.rejectedAt,
            r.responseSeconds
          )
        )}</td>
      </tr>
    `).join("")

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>CityGuard Incident Reports</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 24px;
              color: #111827;
            }
            h1, p { text-align: center; }
            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 11px;
            }
            th, td {
              border: 1px solid #999;
              padding: 6px;
              text-align: left;
              overflow-wrap: anywhere;
            }
            th {
              background: #e5e7eb;
            }
            @media print {
              body { margin: 10mm; }
              tr { break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <h1>CITYGUARD</h1>
          <h2 style="text-align:center">Incident Reports</h2>
          <p>
            Generated: ${escapeHtml(new Date().toLocaleString())}
          </p>
          <p>Total reports: ${filteredReports.length}</p>
          <table>
            <thead>
              <tr>
                <th>Report ID</th>
                <th>Category</th>
                <th>Status</th>
                <th>Description</th>
                <th>Barangay</th>
                <th>Severity</th>
                <th>Department</th>
                <th>Date Reported</th>
                <th>Elapsed / Response Time</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="9">No reports found.</td></tr>'}
            </tbody>
          </table>
          <script>
            window.onload = () => {
              window.print()
            }
          </script>
        </body>
      </html>
    `)

    printWindow.document.close()
  }


  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {alertPopup && (
        <div
          onClick={() => { silenceAlerts(); focusMap(alertPopup, "card") }}
          style={{
            position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)",
            background: "red", color: "white", padding: "15px 25px", borderRadius: "8px",
            fontWeight: "bold", zIndex: 9999, cursor: "pointer"
          }}
        >
          🚨 NEW EMERGENCY ALERT: {reportType(alertPopup) || "Incident"}
          <br />
          <small>Click to view location</small>
        </div>
      )}

      {/* Elapsed-time alerts for the 10 and 20 minute response standards. */}
      {timeAlerts.map((t, i) => (
        <div
          key={`${t.at}-${i}`}
          onClick={() => { silenceAlerts(); setTimeAlerts((prev) => prev.filter((x) => x !== t)) }}
          style={{
            position: "fixed", top: `${90 + i * 56}px`, left: "50%", transform: "translateX(-50%)",
            background: t.level === "critical" ? "#b91c1c" : "#b45309", color: "white",
            padding: "12px 20px", borderRadius: "8px", fontWeight: "bold", zIndex: 9999, cursor: "pointer"
          }}
        >
          {t.text}
          <br />
          <small>Click to dismiss</small>
        </div>
      ))}

      <div style={{
        background: "linear-gradient(90deg,#0f2bb8,#1e40ff)", color: "white",
        padding: "14px 18px", fontSize: "20px", fontWeight: "bold",
        display: "flex", justifyContent: "space-between", alignItems: "center"
      }}>
        <div>CITYGUARD COMMAND CENTER</div>
        <div style={{ display: "flex", gap: "15px", alignItems: "center", position: "relative" }}>
          <div style={{ cursor: "pointer" }} onClick={() => setShowNotif(!showNotif)}>
            🔔
            {unread > 0 && (
              <span style={{
                background: "red", color: "white", borderRadius: "50%",
                padding: "3px 7px", fontSize: "12px", marginLeft: "5px"
              }}>
                {unread}
              </span>
            )}
          </div>

          {showNotif && (
            <div style={{
              position: "absolute", top: "35px", right: "0", width: "300px",
              background: "white", color: "black", borderRadius: "6px",
              boxShadow: "0 4px 10px rgba(0,0,0,0.2)", zIndex: 999
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px", fontWeight: "bold", borderBottom: "1px solid #eee" }}>
                <span>Notifications</span>
                <button onClick={() => setClearedNotifIds((prev) => new Set([...prev, ...notifList.map((r) => r.id)]))} style={{ background: "#ff4d4d", color: "white", border: "none", padding: "4px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}>
                  Clear
                </button>
              </div>
              {reports.length === 0 && <p style={{ padding: "10px" }}>No alerts</p>}
              {notifList.filter((r) => !clearedNotifIds.has(r.id)).slice().reverse().slice(0, 5).map((r) => (
                <div key={r.id} onClick={() => { silenceAlerts(); focusMap(r, "card"); markAsRead(r.id) }} style={{ padding: "10px", borderBottom: "1px solid #eee", cursor: "pointer", background: r.read ? "white" : "#e6f0ff" }}>
                  <b>{reportType(r) || "Emergency"}</b>
                  <small>⏱️ {formatTime(r.createdAt)}</small>
                  <br />
                  <small>{r.description}</small>
                  {!r.read && <span style={{ color: "red", fontSize: "12px" }}> ● new</span>}
                </div>
              ))}
            </div>
          )}

          <button onClick={() => navigate("/profile")} style={{ padding: "6px 12px", border: "none", background: "#374151", color: "white", borderRadius: "5px", cursor: "pointer" }}>
            Admin Profile
          </button>
          <button onClick={() => navigate("/system-settings")} style={{ padding: "6px 12px", border: "none", background: "#374151", color: "white", borderRadius: "5px", cursor: "pointer" }}>
            Settings
          </button>
          <button onClick={handleLogout} style={{ padding: "6px 12px", border: "none", background: "red", color: "white", borderRadius: "5px", cursor: "pointer" }}>
            Logout
          </button>
        </div>
      </div>

      {/* Category filter bar */}
      <div style={{ display: "flex", gap: "20px", padding: "10px", background: "#0f172a", color: "white", flexWrap: "wrap" }}>
        <div style={{ cursor: "pointer" }} onClick={() => setActiveFilter("Fire")}>🔥 Fire: {fireCount}</div>
        <div style={{ cursor: "pointer" }} onClick={() => setActiveFilter("Medical Emergency")}>🚑 Medical: {medicalCount}</div>
        <div style={{ cursor: "pointer" }} onClick={() => setActiveFilter("Accident")}>🚗 Accident: {accidentCount}</div>
        <div style={{ cursor: "pointer" }} onClick={() => setActiveFilter("Flood")}>🌊 Flood: {floodCount}</div>
        <div style={{ cursor: "pointer" }} onClick={() => setActiveFilter("Crime")}>🚓 Crime: {crimeCount}</div>
        <div style={{ cursor: "pointer" }} onClick={() => setActiveFilter("All")}>📋 All</div>
      </div>
      
      {/* ✅ P1 REVISION: Status + Department filters */}
<div
  style={{
    display: "flex",
    gap: "10px",
    padding: "8px 10px",
    background: "#1e293b",
    color: "white",
    alignItems: "center",
    flexWrap: "wrap"
  }}
>
  <span style={{ fontSize: "13px" }}>Status:</span>

  {["All", "Pending", "Dispatched", "Resolved", "Rejected"].map((s) => (
    <button
      key={s}
      onClick={() => setStatusFilter(s)}
      style={{
        padding: "4px 10px",
        border: "none",
        borderRadius: "4px",
        cursor: "pointer",
        background: statusFilter === s ? "#2d5be3" : "#334155",
        color: "white",
        fontSize: "12px"
      }}
    >
      {s}
    </button>
  ))}

  <span style={{ fontSize: "13px", marginLeft: "10px" }}>
    Dept:
  </span>

  <select
    value={deptFilter}
    onChange={(e) => setDeptFilter(e.target.value)}
    style={{
      padding: "4px 8px",
      borderRadius: "4px",
      fontSize: "12px"
    }}
  >
    <option value="All">All Departments</option>
    {departments.map((d) => (
      <option key={d} value={d}>{d}</option>
    ))}
  </select>

  <button
    onClick={handlePrintReports}
    style={{
      padding: "5px 12px",
      border: "none",
      borderRadius: "4px",
      background: "#16a34a",
      color: "white",
      cursor: "pointer",
      fontSize: "12px"
    }}
  >
    🖨️ Print Reports
  </button>
</div>


      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ display: "flex", height: "100%", flexShrink: 0 }}>
          <div style={{ width: `${incidentPanelWidth}px`, background: "#f4f4f4", height: "100%", overflowY: "auto", padding: "10px" }}>
          <h3>Incidents</h3>

          {filteredReports.map((r) => {
            const st = reportStatus(r)
            const isResolved = st === "resolved"
            const isRejected = st === "rejected"
            const isDispatched = st === "dispatched"
            const sign = statusSign(r)
            return (
              <div key={r.id} onClick={() => openReport(r)} style={{
                background: "white", padding: "10px", marginBottom: "10px", borderRadius: "6px",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)", cursor: "pointer",
                borderLeft: isResolved ? "4px solid green" : isRejected ? "4px solid #999" : isDispatched ? "4px solid #2d5be3" : "4px solid red"
              }}>
                <b>{reportType(r) || "Emergency"}</b>
                {/* One sign per report, taken from the status table above. */}
                {sign && (
                  <span style={{ color: sign.color, fontSize: "11px", marginLeft: "6px" }}>{sign.text}</span>
                )}
                <br />
                <div style={{ color: "#666", fontSize: "12px", marginTop: "4px" }}>
                  ⏱️ Elapsed: {formatElapsed(r.createdAt, r.resolvedAt || r.rejectedAt, r.responseSeconds)}
                </div>
                <div style={{ marginTop: "6px", fontSize: "13px" }}>{r.description}</div>
                {/* Evidence is no longer shown in the Incidents list. */}
                {r.barangay && (
                  <div style={{ marginTop: "4px", fontSize: "11px", color: "#666" }}>
                    📍 Barangay: {r.barangay}
                  </div>
                )}
                {r.severity && (
                  <div style={{ marginTop: "2px", fontSize: "11px", color: r.severity === "High" ? "red" : r.severity === "Medium" ? "orange" : "green" }}>
                    ⚠️ Severity: {r.severity}
                  </div>
                )}
                {r.assignedDepartment && (
                  <div style={{ marginTop: "4px", fontSize: "11px", color: "#2d5be3" }}>
                    🏛️ {r.assignedDepartment}
                  </div>
                )}
                <br />
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                  {/* ✅ P20 REVISION: AUTOMATIC department box (replaces the dropdown).
                      The department is AUTO-DETECTED from the incident's original AI
                      category and shown in a read-only filled box — no arrow, no
                      choices. The "Assign" button dispatches the auto-detected
                      department OTW. Once dispatched (OTW), the box, Assign button,
                      and Fake button are removed for that incident. */}
                  {!isResolved && !isRejected && !isDispatched && (
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          padding: "5px 8px", borderRadius: "4px", fontSize: "12px",
                          border: "1px solid #2d5be3", background: "#eef2ff", color: "#111827",
                          fontWeight: "600", maxWidth: "150px", whiteSpace: "nowrap",
                          overflow: "hidden", textOverflow: "ellipsis"
                        }}
                        title={autoDetectDept(r)}
                      >
                        {autoDetectDept(r)}
                      </div>
                      {/* ✅ P9 REVISION: "Assign" button — dispatches the auto-detected department OTW */}
                      <button
                        onClick={(e) => { e.stopPropagation(); assignDepartment(r.id, autoDetectDept(r)) }}
                        style={{
                          background: "#2d5be3", color: "white", border: "none",
                          padding: "5px 10px", borderRadius: "4px", cursor: "pointer",
                          fontWeight: "600", fontSize: "12px"
                        }}
                      >
                        Assign
                      </button>
                    </div>
                  )}
                  {/* ✅ P5 REVISION: Manual Resolve removed — the department auto-resolves on arrival.
                      ✅ P19 REVISION: Fake button also hidden once the incident is dispatched (OTW). */}
                  {!isResolved && !isRejected && !isDispatched && (
                    <button
                      onClick={(e) => { e.stopPropagation(); rejectReport(r.id) }}
                      style={{ background: "#999", color: "white", border: "none", padding: "5px 10px", borderRadius: "4px", cursor: "pointer" }}
                    >
                      ✗ Fake
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          </div>
          {/* Drag this edge left or right to resize the Incidents panel. */}
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            style={{ width: "6px", cursor: "col-resize", background: "#cbd5e1", height: "100%", flexShrink: 0 }}
          />
        </div>

        <div style={{ flex: 1 }}>
          <MapContainer center={[16.0430, 120.3333]} zoom={13} style={{ height: "100%", width: "100%" }}>
            <MapController mapFocus={mapFocus} />
            <TileLayer attribution="© OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

            {/* ✅ REVISION: Responder (admin) live position marker */}
            {responderPos && (
              <Marker position={[responderPos.lat, responderPos.lng]}>
                <Popup>
                  <b>You (Responder)</b>
                  <br />
                  <small>Live GPS position</small>
                </Popup>
              </Marker>
            )}

            {/* ✅ P9 REVISION: Each department's own base marker, ALWAYS visible on the
                live map at its own Dagupan location (BFP station, PNP station,
                CDRRMO/MDRRMO office, Medical/EMS base), with the department emoji + name. */}
            {Object.keys(DEPT_START).map((dept) => {
              const base = DEPT_START[dept]
              const isDispatched = reports.some(
                (r) => r.status === "dispatched" && r.assignedDepartment === dept
              )
              return (
                <Marker key={dept} position={[base.lat, base.lng]} icon={getDeptIcon(dept)}>
                  <Popup>
                    <b>{DEPT_EMOJI[dept] || "🚨"} {dept}</b>
                    <br />
                    <small>{isDispatched ? "🚗 OTW to incident" : "📍 Base location (Dagupan)"}</small>
                  </Popup>
                </Marker>
              )
            })}

            {reports.map((report) => {
              if (!report.location) return null
              const lat = Number(report.location.latitude)
              const lng = Number(report.location.longitude)
              if (isNaN(lat) || isNaN(lng)) return null
              const deptColor = DEPT_COLORS[report.assignedDepartment] || "#2d5be3"
              const isDispatched = reportStatus(report) === "dispatched"
              const sign = statusSign(report)
              const deptResp = deptResponders[report.id]
              // Each piece of evidence is resolved on its own, so a report with a
              // photo and a video backup renders both players.
              const evidence = evidenceParts(report)
              return (
                <div key={report.id}>
                  {/* ✅ P5 REVISION: Department-themed OTW line from Dagupan to the incident,
                      with the department responder emoji + OTW message moving along it */}
                  {isDispatched && (
                    <>
                      {/* ✅ P10 REVISION: The colored themed line is the ROAD ROUTE
                          polyline (OSRM) from the department's own base to the incident. */}
                      <Polyline
                        positions={deptRoutes[report.id] && deptRoutes[report.id].length > 1
                          ? deptRoutes[report.id]
                          : [[getDeptStart(report.assignedDepartment).lat, getDeptStart(report.assignedDepartment).lng], [lat, lng]]}
                        pathOptions={{ color: deptColor, weight: 4, dashArray: "8, 8" }}
                      />
                      {deptResp && (
                        <Marker position={[deptResp.lat, deptResp.lng]} icon={getDeptIcon(report.assignedDepartment)} ref={(ref) => { if (ref) popupRefs.current[`otw:${report.id}`] = ref }}>
                          <Popup>
                            <b>{DEPT_EMOJI[report.assignedDepartment] || "🚨"} {report.assignedDepartment}</b>
                            <br />
                            <small>🚗 OTW to incident</small>
                          </Popup>
                        </Marker>
                      )}
                    </>
                  )}
                  <Marker key={report.id} position={[lat, lng]} icon={getMarkerIcon(reportType(report))} ref={(ref) => { if (ref) popupRefs.current[report.id] = ref }}>
                    <Popup>
                      <div style={{ width: "240px" }}>
                        <b>{reportType(report)}</b>
                        {/* Same single-sign rule as the list card. */}
                        {sign && (
                          <span style={{ color: sign.color, marginLeft: "6px" }}>{sign.text}</span>
                        )}
                        <br /><br />
                        {report.description}
                        <br /><br />
                        {/* Reporter name and number are shown only in the live map popup. */}
                        {report.reporterName && (
                          <div style={{ fontSize: "12px", color: "#666" }}>
                            👤 Reporter: {report.reporterName}
                          </div>
                        )}
                        {report.reporterPhone && (
                          <div style={{ fontSize: "12px", color: "#666" }}>
                            📞 Contact: {report.reporterPhone}
                          </div>
                        )}
                        {report.barangay && (
                          <div style={{ fontSize: "12px", color: "#666" }}>
                            📍 Barangay: {report.barangay}
                          </div>
                        )}
                        {report.severity && (
                          <div style={{ fontSize: "12px", color: report.severity === "High" ? "red" : report.severity === "Medium" ? "orange" : "green" }}>
                            ⚠️ Severity: {report.severity}
                          </div>
                        )}
                        <div style={{ fontSize: "12px", color: "#666" }}>
                          📍 {lat.toFixed(5)}, {lng.toFixed(5)}
                        </div>
                        <a
                          href={`https://www.google.com/maps?q=${lat},${lng}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: "12px", color: "#2d5be3" }}
                        >
                          View on Google Maps
                        </a>
                        <br />
                        {report.assignedDepartment && <div style={{ fontSize: "12px", color: deptColor }}>🏛️ {report.assignedDepartment}</div>}
                        <br />
                        <div style={{ fontSize: "12px", color: "#666" }}>
                          ⏱️ Elapsed: {formatElapsed(report.createdAt, report.resolvedAt || report.rejectedAt, report.responseSeconds)}
                        </div>
                        <br />
                        {/* Evidence lives only here in the popup, never in the Incidents list. */}
                        {/* Each piece is read on its own, so a report that has a photo AND a */}
                        {/* video backup shows both instead of only one of them. */}
                        {evidence.photoUrl && (
                          <div style={{ marginTop: "4px" }}>
                            <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>
                              Photo evidence
                            </div>
                            <a href={evidence.photoUrl} target="_blank" rel="noreferrer">
                              <img
                                src={evidence.photoUrl}
                                alt="Incident evidence"
                                onError={(e) => {
                                  // Broken Cloudinary link: hide the broken-image icon and
                                  // show the note below it instead of a blank frame.
                                  e.currentTarget.style.display = "none"
                                  const note = e.currentTarget.closest("a")?.nextElementSibling
                                  if (note) note.style.display = "block"
                                }}
                                style={{
                                  width: "100%",
                                  maxHeight: "180px",
                                  objectFit: "cover",
                                  borderRadius: "6px",
                                  border: "1px solid #ddd",
                                  display: "block",
                                  cursor: "zoom-in"
                                }}
                              />
                            </a>
                            <div style={{ display: "none", fontSize: "11px", color: "#c62828" }}>
                              Photo could not load
                            </div>
                          </div>
                        )}
                        {/* The video player is built from videoUrl only, or from a video */}
                        {/* URL that the mobile app stored in imageUrl. */}
                        {evidence.videoUrl && (
                          <div style={{ marginTop: evidence.photoUrl ? "8px" : "4px" }}>
                            <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>
                              Video evidence
                            </div>
                            <video
                              src={evidence.videoUrl}
                              controls
                              playsInline
                              preload="metadata"
                              style={{
                                width: "100%",
                                maxHeight: "180px",
                                borderRadius: "6px",
                                border: "1px solid #ddd",
                                display: "block",
                                background: "#000"
                              }}
                            />
                          </div>
                        )}
                        {!evidence.photoUrl && !evidence.videoUrl && (
                          <div style={{ fontSize: "11px", color: "#999" }}>
                            No evidence attached
                          </div>
                        )}
                        <br />
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {/* Fake is a pending-only action, same rule as the list card. */}
                          {reportStatus(report) === "pending" && (
                            <button onClick={() => rejectReport(report.id)} style={{
                              background: "#999", color: "white", border: "none", padding: "6px 12px", borderRadius: "4px", cursor: "pointer"
                            }}>
                              ✗ Fake
                            </button>
                          )}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                </div>
              )
            })}
          </MapContainer>
        </div>
      </div>
    </div>
  )
}

export default Dashboard