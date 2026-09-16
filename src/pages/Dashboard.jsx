import { useEffect, useState, useRef } from "react"
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet"
import L from "leaflet"

import { db } from "../firebase"
import { collection, onSnapshot, doc, getDoc, updateDoc } from "firebase/firestore"

import { getAuth, signOut } from "firebase/auth"
import { useNavigate } from "react-router-dom"

import markerShadow from "leaflet/dist/images/marker-shadow.png"

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

// Only 5 categories (Others removed)
const CATEGORIES = [
  "Fire", "Flood", "Medical Emergency", "Accident", "Crime"
]

// Department-themed colors (used for markers + OTW lines)
const DEPT_COLORS = {
  "BFP": "#e11d48",
  "PNP": "#111827",
  "CDRRMO/MDRRMO": "#2563eb",
  "Medical Emergency Team and Responders": "#16a34a"
}

// Department responder emoji (shown on the live map while OTW)
const DEPT_EMOJI = {
  "BFP": "🚒",
  "PNP": "🚓",
  "CDRRMO/MDRRMO": "🚜",
  "Medical Emergency Team and Responders": "🚑"
}

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

// Dagupan City test-area center (Region 1 / Pangasinan)
const DAGUPAN_CENTER = { lat: 16.0430, lng: 120.3333 }

const DEPT_START = {
  "BFP": { lat: 16.0430, lng: 120.3333 },                                  // BFP Dagupan station (city center)
  "PNP": { lat: 16.0452, lng: 120.3312 },                                  // PNP Dagupan station
  "CDRRMO/MDRRMO": { lat: 16.0412, lng: 120.3352 },                        // CDRRMO/MDRRMO office
  "Medical Emergency Team and Responders": { lat: 16.0460, lng: 120.3360 } // Medical/EMS base
}

function getDeptStart(dept) {
  return DEPT_START[dept] || DAGUPAN_CENTER
}

function isWithinTestArea(lat, lng, testRadiusKm) {
  const radiusKm = testRadiusKm || 200
  const distKm = distanceMeters(lat, lng, DAGUPAN_CENTER.lat, DAGUPAN_CENTER.lng) / 1000
  return distKm <= radiusKm
}

// Haversine distance in meters
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

// Total length (meters) of a route polyline (array of [lat,lng])
function routeLength(route) {
  let total = 0
  for (let i = 1; i < route.length; i++) {
    total += distanceMeters(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1])
  }
  return total
}

// Move a responder `step` meters forward along a road route polyline from its current position (returns the new {lat,lng}).
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

const RESPONDER_SPEED_MPS = 250

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

function tickResponders(drives, now) {
  const out = {}
  Object.keys(drives || {}).forEach((id) => {
    const pos = computeDrivePos(drives[id], now)
    if (pos) out[id] = pos
  })
  return out
}

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

// Format response time as "Resolved within X minutes Y seconds"
function formatResponseTime(createdAt, resolvedAt) {
  if (!createdAt || !resolvedAt) return "—"
  const start = createdAt?.seconds ? createdAt.seconds * 1000 : new Date(createdAt).getTime()
  const end = resolvedAt?.seconds ? resolvedAt.seconds * 1000 : new Date(resolvedAt).getTime()
  const diffSec = Math.max(0, Math.floor((end - start) / 1000))
  const m = Math.floor(diffSec / 60)
  const s = diffSec % 60
  return `Resolved within ${m} minutes ${s} seconds`
}

// Live elapsed time for active incidents
function formatElapsed(createdAt) {
  if (!createdAt) return "—"
  const start = createdAt?.seconds ? createdAt.seconds * 1000 : new Date(createdAt).getTime()
  const diffSec = Math.max(0, Math.floor((Date.now() - start) / 1000))
  const m = Math.floor(diffSec / 60)
  const s = diffSec % 60
  return `${m}m ${s}s`
}

// Robust date formatting (handles Firestore Timestamp, string, Date)
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

const reportType = (r) => r.aiCategory || r.type

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

  // Load persisted dashboard state once on mount so the app resumes where it left off instead of restarting.
  const [persisted] = useState(() => loadSharedState())

  // Live clock for response-time tracking
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const [notifList, setNotifList] = useState([])
  const [selectedReport, setSelectedReport] = useState(null)

  const [soundQueue, setSoundQueue] = useState([])
  const isPlayingRef = useRef(false)
  const [showNotif, setShowNotif] = useState(false)
  const [activeFilter, setActiveFilter] = useState("All")
  const [statusFilter, setStatusFilter] = useState("All")
  const [deptFilter, setDeptFilter] = useState("All")
  const [alertPopup, setAlertPopup] = useState(null)

  const [mapFocus, setMapFocus] = useState(null)

  // Live responder position (for OTW tracking on the map)
  const [responderPos, setResponderPos] = useState(null)

  const [deptResponders, setDeptResponders] = useState(() =>
    tickResponders(persisted?.drives || {}, Date.now())
  )

  const [drives, setDrives] = useState(persisted?.drives || {})
  const drivesRef = useRef(persisted?.drives || {})

  const [resolvedIds, setResolvedIds] = useState(() => new Set(persisted?.resolvedIds || []))
  const resolvedIdsRef = useRef(resolvedIds)

  const [deptSelection, setDeptSelection] = useState(persisted?.deptSelection || {})

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
  const [alertedReportIds, setAlertedReportIds] = useState(() => new Set(persisted?.alertedReportIds || []))
  const alertedReportIdsRef = useRef(alertedReportIds)
  useEffect(() => { alertedReportIdsRef.current = alertedReportIds }, [alertedReportIds])
  
  const reportsRef = useRef(reports)
  const settingsRef = useRef(settings)
  const alertedReportsRef = useRef(alertedReports)
  useEffect(() => { reportsRef.current = reports }, [reports])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { alertedReportsRef.current = alertedReports }, [alertedReports])
  useEffect(() => { resolvedIdsRef.current = resolvedIds }, [resolvedIds])
  // Track notification ids the admin cleared so they stay cleared after navigating away and back.
  const [clearedNotifIds, setClearedNotifIds] = useState(() => new Set(persisted?.clearedNotifIds || []))
  const popupRefs = useRef({})
  const audioRef = useRef(null)

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

  // Track the responder's live GPS position (for OTW line)
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

  // Load system settings (confidence threshold, resolve radius, response standards)
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

  // Sound effects for alerts + notifications (enabled)
  useEffect(() => {
    if (isPlayingRef.current) return
    if (soundQueue.length === 0) return
    // Respect the sound toggle from System Settings
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
    const audio = new Audio(sound)
    audio.onended = () => {
      isPlayingRef.current = false
      setSoundQueue((prev) => prev.slice(1))
    }
    audio.play().then(() => {}).catch(() => {
      isPlayingRef.current = false
      setSoundQueue((prev) => prev.slice(1))
    })
    audioRef.current = audio
  }, [soundQueue])

  // REALTIME listener — only accept reports with AI confidence 80–100%
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "reports"), (snapshot) => {
      let data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

      // AI Filtering: reject low-confidence reports automatically
      data = data.filter((r) => {
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
        const accepted = typeof conf !== "number" || conf >= settings.confidenceThreshold
        // Only alert/sound for reports not already alerted, so navigating back to the dashboard does NOT replay the sound.
        const alreadyAlerted = alertedReportIdsRef.current.has(newId)
        if (accepted && settings.enableAlerts && !alreadyAlerted) {
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

  useEffect(() => {
    if (!mapFocus) return
    const key = mapFocus.mode === "otw" ? `otw:${mapFocus.id}` : mapFocus.id
    const ref = popupRefs.current[key]
    if (ref) ref.openPopup()
  }, [mapFocus])

  useEffect(() => {
    const interval = setInterval(() => {
      const s = settingsRef.current
      if (!s.enableAlerts) return
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
          alert(`⚠️ WARNING!\n${r.aiCategory}\nLagpas ${s.responseTargetMin} minutes na`)
          setAlertedReports((prev) => ({ ...prev, [r.id]: "warning" }))
        }
        if (diffMinutes >= s.responseCriticalMin && settled[r.id] !== "critical") {
          settled[r.id] = "critical"
          enqueueSound("critical", r.aiCategory)
          alert(`🚨 CRITICAL!\n${r.aiCategory}\nLagpas ${s.responseCriticalMin} minutes na!`)
          setAlertedReports((prev) => ({ ...prev, [r.id]: "critical" }))
        }
      })
    }, 10000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const assignDepartment = async (id, dept) => {
    if (!dept) return
    try {
      await updateDoc(doc(db, "reports", id), {
        assignedDepartment: dept,
        status: "dispatched",
        dispatchedAt: new Date(),
        assignedBy: auth.currentUser?.email || "admin"
      })
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

  // Mark a report as fake / not-resolve (admin rejection)
  const rejectReport = async (id) => {
    if (!window.confirm("Mark this report as FAKE / not a real incident? This cannot be undone.")) return
    try {
      await updateDoc(doc(db, "reports", id), {
        status: "rejected",
        rejectedAt: new Date(),
        rejectedBy: auth.currentUser?.email || "admin",
        rejectionReason: "Marked as fake by admin"
      })
      alert("✅ Report marked as fake / rejected")
    } catch (err) {
      console.log(err)
      alert("Error rejecting report")
    }
  }

  const autoResolve = async (id, dept) => {
    clearDrive(id)
    setResolvedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
    resolvedIdsRef.current.add(id)
    try {
      await updateDoc(doc(db, "reports", id), {
        status: "resolved",
        resolvedAt: new Date(),
        resolvedBy: dept || "responder",
        autoResolved: true
      })
      silenceAlerts()
      alert(`✅ ${dept || "Department"} has arrived at the incident and it is auto-resolved.`)
    } catch (err) {
      console.log(err)
    }
  }

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

  useEffect(() => {
    const animate = () => {
  
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

  // Auto-resolve when a department responder arrives at the incident
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

  // Category counts use the ORIGINAL AI-suggested category (reportType = aiCategory first), never a department-derived value.
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

  // Filtering by type, status, department
  const filteredReports = reports.filter((r) => {
    if (activeFilter !== "All" && reportType(r) !== activeFilter) return false
    if (statusFilter === "Pending" && r.status === "resolved") return false
    if (statusFilter === "Resolved" && r.status !== "resolved") return false
    if (deptFilter !== "All" && r.assignedDepartment !== deptFilter) return false
    return true
  })

  const departments = [...new Set(reports.map((r) => r.assignedDepartment).filter(Boolean))]

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {alertPopup && (
        <div
          onClick={() => { focusMap(alertPopup, "card") }}
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
                <div key={r.id} onClick={() => { focusMap(r, "card"); markAsRead(r.id) }} style={{ padding: "10px", borderBottom: "1px solid #eee", cursor: "pointer", background: r.read ? "white" : "#e6f0ff" }}>
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

      {/* Status + Department filters */}
      <div style={{ display: "flex", gap: "10px", padding: "8px 10px", background: "#1e293b", color: "white", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "13px" }}>Status:</span>
        {["All", "Pending", "Dispatched", "Resolved", "Rejected"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} style={{
            padding: "4px 10px", border: "none", borderRadius: "4px", cursor: "pointer",
            background: statusFilter === s ? "#2d5be3" : "#334155", color: "white", fontSize: "12px"
          }}>
            {s}
          </button>
        ))}
        <span style={{ fontSize: "13px", marginLeft: "10px" }}>Dept:</span>
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} style={{ padding: "4px 8px", borderRadius: "4px", fontSize: "12px" }}>
          <option value="All">All Departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ width: "340px", background: "#f4f4f4", height: "100%", overflowY: "auto", padding: "10px" }}>
          <h3>Incidents</h3>

          {filteredReports.map((r) => {
            const isResolved = r.status === "resolved"
            const isRejected = r.status === "rejected"
            const isDispatched = r.status === "dispatched"
            return (
              <div key={r.id} onClick={() => focusMap(r, "card")} style={{
                background: "white", padding: "10px", marginBottom: "10px", borderRadius: "6px",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)", cursor: "pointer",
                borderLeft: isResolved ? "4px solid green" : isRejected ? "4px solid #999" : isDispatched ? "4px solid #2d5be3" : "4px solid red"
              }}>
                <b>{reportType(r) || "Emergency"}</b>
                {isResolved && <span style={{ color: "green", fontSize: "11px", marginLeft: "6px" }}>✓ RESOLVED</span>}
                {isRejected && <span style={{ color: "#999", fontSize: "11px", marginLeft: "6px" }}>✗ FAKE</span>}
                {isDispatched && <span style={{ color: "#2d5be3", fontSize: "11px", marginLeft: "6px" }}>🚚 OTW</span>}
                <br />
                <div style={{ color: "#666", fontSize: "12px", marginTop: "4px" }}>
                  ⏱️ {isResolved ? formatResponseTime(r.createdAt, r.resolvedAt) : `Elapsed: ${formatElapsed(r.createdAt)}`}
                </div>
                <div style={{ marginTop: "6px", fontSize: "13px" }}>{r.description}</div>
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
                  {/* AUTOMATIC department box (replaces the dropdown). */}
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
                      {/* "Assign" button — dispatches the auto-detected department OTW */}
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
                  {/* Manual Resolve removed — the department auto-resolves on arrival.
                      Fake button also hidden once the incident is dispatched (OTW). */}
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

        <div style={{ flex: 1 }}>
          <MapContainer center={[16.0430, 120.3333]} zoom={13} style={{ height: "100%", width: "100%" }}>
            <MapController mapFocus={mapFocus} />
            <TileLayer attribution="© OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

            {/* Responder (admin) live position marker */}
            {responderPos && (
              <Marker position={[responderPos.lat, responderPos.lng]}>
                <Popup>
                  <b>You (Responder)</b>
                  <br />
                  <small>Live GPS position</small>
                </Popup>
              </Marker>
            )}

            {/* Each department's own base marker, ALWAYS visible on the live map at its own Dagupan location (BFP station, PNP station,
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
              const isDispatched = report.status === "dispatched"
              const deptResp = deptResponders[report.id]
              return (
                <div key={report.id}>
                  {/* Department-themed OTW line from Dagupan to the incident,
                      with the department responder emoji + OTW message moving along it */}
                  {isDispatched && (
                    <>
                      {/* The colored themed line is the ROAD ROUTE
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
                        {report.status === "resolved" && <span style={{ color: "green", marginLeft: "6px" }}>✓ RESOLVED</span>}
                        {report.status === "rejected" && <span style={{ color: "#999", marginLeft: "6px" }}>✗ FAKE</span>}
                        {report.status === "dispatched" && <span style={{ color: "#2d5be3", marginLeft: "6px" }}>🚚 OTW</span>}
                        <br /><br />
                        {report.description}
                        <br /><br />
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
                        <br />
                        {report.assignedDepartment && <div style={{ fontSize: "12px", color: deptColor }}>🏛️ {report.assignedDepartment}</div>}
                        <br />
                        <div style={{ fontSize: "12px", color: "#666" }}>
                          ⏱️ {report.status === "resolved"
                            ? formatResponseTime(report.createdAt, report.resolvedAt)
                            : `Elapsed: ${formatElapsed(report.createdAt)}`}
                        </div>
                        <br />
                        {report.videoUrl && (
                          <video src={report.videoUrl} controls style={{ width: "100%", borderRadius: "6px" }} />
                        )}
                        <br /><br />
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {/* Manual Resolve removed — the department auto-resolves on arrival */}
                          {report.status !== "resolved" && report.status !== "rejected" && (
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