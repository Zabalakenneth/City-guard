import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"

import { db } from "../firebase"
import { doc, getDoc, setDoc } from "firebase/firestore"

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

function SystemSettings() {
  const navigate = useNavigate()

  const [aiDetection, setAiDetection] = useState(true)
  const [autoZoom, setAutoZoom] = useState(true)
  const [showImages, setShowImages] = useState(true)
  const [enableAlerts, setEnableAlerts] = useState(true)
  const [autoCleanup, setAutoCleanup] = useState(false)
  const [cleanupDays, setCleanupDays] = useState(30)

  // New settings
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.8)
  const [resolveRadiusM, setResolveRadiusM] = useState(100)
  const [responseTargetMin, setResponseTargetMin] = useState(10)
  const [responseCriticalMin, setResponseCriticalMin] = useState(20)
  const [testRadiusKm, setTestRadiusKm] = useState(200) // ✅ 200km for Region 1/Pangasinan

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  const [drives] = useState(() => loadSharedState().drives || {})

  // Alert & notification sound toggle (persisted in localStorage)
  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem("cg_soundEnabled") !== "false"
  )

  // Play a short beep via Web Audio API (no external asset needed)
  const playBeep = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.4)
    } catch (err) {
      console.log("Beep error:", err)
    }
  }

  const toggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev
      localStorage.setItem("cg_soundEnabled", String(next))
      if (next) playBeep()
      return next
    })
  }

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const ref = doc(db, "system", "settings")
      const snap = await getDoc(ref)
      if (snap.exists()) {
        const data = snap.data()
        setAiDetection(data.aiDetection ?? true)
        setAutoZoom(data.autoZoom ?? true)
        setShowImages(data.showImages ?? true)
        setEnableAlerts(data.enableAlerts ?? true)
        setAutoCleanup(data.autoCleanup ?? false)
        setCleanupDays(data.cleanupDays ?? 30)
        setConfidenceThreshold(data.confidenceThreshold ?? 0.8)
        setResolveRadiusM(data.resolveRadiusM ?? 100)
        setResponseTargetMin(data.responseTargetMin ?? 10)
        setResponseCriticalMin(data.responseCriticalMin ?? 20)
        setTestRadiusKm(data.testRadiusKm ?? 200)
      }
      patchSharedState({ drives })
      setLoading(false)
    } catch (err) {
      console.log(err)
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    try {
      setSaving(true)
      setMessage("")
      await setDoc(doc(db, "system", "settings"), {
        aiDetection,
        autoZoom,
        showImages,
        enableAlerts,
        autoCleanup,
        cleanupDays: Number(cleanupDays),
        confidenceThreshold: Number(confidenceThreshold),
        resolveRadiusM: Number(resolveRadiusM),
        responseTargetMin: Number(responseTargetMin),
        responseCriticalMin: Number(responseCriticalMin),
        testRadiusKm: Number(testRadiusKm)
      })
      setMessage("✅ Settings saved successfully")
      patchSharedState({
        drives,
        settings: {
          ...(loadSharedState().settings || {}),
          aiDetection,
          autoZoom,
          showImages,
          enableAlerts,
          confidenceThreshold: Number(confidenceThreshold),
          resolveRadiusM: Number(resolveRadiusM),
          responseTargetMin: Number(responseTargetMin),
          responseCriticalMin: Number(responseCriticalMin),
          testRadiusKm: Number(testRadiusKm)
        }
      })
      setSaving(false)
    } catch (err) {
      console.log(err)
      setMessage("❌ Error saving settings")
      setSaving(false)
    }
  }

  const resetSettings = () => {
    setAiDetection(true)
    setAutoZoom(true)
    setShowImages(true)
    setEnableAlerts(true)
    setAutoCleanup(false)
    setCleanupDays(30)
    setConfidenceThreshold(0.8)
    setResolveRadiusM(100)
    setResponseTargetMin(10)
    setResponseCriticalMin(20)
    setTestRadiusKm(200)
    setMessage("⚠ Settings reset (not saved yet)")
  }

  if (loading) {
    return <p style={{ padding: "40px" }}>Loading settings...</p>
  }

  return (
    <div style={{ padding: "40px", fontFamily: "Arial" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>CITY GUARD</h1>
        <div style={{ display: "flex", gap: "20px" }}>
          <p style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>HOME</p>
          <p style={{ cursor: "pointer" }} onClick={() => navigate("/profile")}>ADMIN</p>
        </div>
      </div>

      <hr />

      <div style={{ display: "flex", gap: "30px", marginTop: "30px" }}>
        {/* LEFT MENU */}
        <div style={{ width: "230px", border: "1px solid #ccc", borderRadius: "6px" }}>
          <div style={{ background: "#2d5be3", color: "white", padding: "10px", fontWeight: "bold" }}>
            ADMIN MENU
          </div>
          <div style={{ padding: "15px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <p style={{ cursor: "pointer" }} onClick={() => navigate("/profile")}>👤 Profile Info</p>
            <p style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>🚨 Incident Dashboard</p>
            <p style={{ color: "blue" }}>⚙ System Settings</p>
          </div>
        </div>

        {/* MAIN SETTINGS */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* AI SETTINGS */}
          <div style={{ border: "1px solid #ccc", borderRadius: "6px" }}>
            <div style={{ background: "#444", color: "white", padding: "10px", fontWeight: "bold" }}>
              AI DETECTION SETTINGS
            </div>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "15px" }}>
              <label>
                <input type="checkbox" checked={aiDetection} onChange={() => setAiDetection((prev) => !prev)} />
                Enable AI Incident Detection
              </label>
              <label>
                <input type="checkbox" checked={autoZoom} onChange={() => setAutoZoom((prev) => !prev)} />
                Auto Zoom Map to Incident
              </label>
              <label>
                <input type="checkbox" checked={showImages} onChange={() => setShowImages((prev) => !prev)} />
                Auto Show Incident Images
              </label>

              {/* AI confidence threshold (80–100%) */}
              <div>
                <p>AI Confidence Threshold (accept reports at %)</p>
                <input
                  type="number"
                  min="0.5"
                  max="1"
                  step="0.05"
                  value={confidenceThreshold}
                  onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                  style={{ padding: "8px", width: "120px" }}
                />
                <small style={{ color: "#666", display: "block", marginTop: "4px" }}>
                  Reports below this confidence are automatically rejected. Default: 0.80 (80%)
                </small>
              </div>
            </div>
          </div>

          {/* ALERT SETTINGS */}
          <div style={{ border: "1px solid #ccc", borderRadius: "6px" }}>
            <div style={{ background: enableAlerts ? "#e33" : "#777", color: "white", padding: "10px", fontWeight: "bold" }}>
              EMERGENCY ALERT SETTINGS
            </div>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "15px" }}>
              <label>
                <input type="checkbox" checked={enableAlerts} onChange={() => setEnableAlerts((prev) => !prev)} />
                Enable Emergency Alerts
              </label>
              {!enableAlerts && (
                <div style={{ background: "#fff3cd", color: "#856404", padding: "10px", borderRadius: "6px", fontWeight: "bold" }}>
                  ⚠ Emergency alerts are currently DISABLED. No siren sound or popup will appear in the dashboard.
                </div>
              )}
            </div>
          </div>

          {/* ALERT & NOTIFICATION SOUNDS */}
          <div style={{ border: "1px solid #ccc", borderRadius: "6px" }}>
            <div style={{ background: "#b45309", color: "white", padding: "10px", fontWeight: "bold" }}>
              ALERT & NOTIFICATION SOUNDS
            </div>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "15px" }}>
              <label>
                <input type="checkbox" checked={soundEnabled} onChange={toggleSound} />
                Enable Alert & Notification Sounds
              </label>
              <div>
                <button
                  onClick={playBeep}
                  style={{ padding: "8px 16px", background: "#b45309", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
                >
                  🔊 Test Sound
                </button>
                <small style={{ color: "#666", display: "block", marginTop: "6px" }}>
                  When enabled, the dashboard plays a sound when a new emergency report arrives. Setting is saved on this device.
                </small>
              </div>
            </div>
          </div>

          {/* RESPONSE TIME SETTINGS */}
          <div style={{ border: "1px solid #ccc", borderRadius: "6px" }}>
            <div style={{ background: "#0f766e", color: "white", padding: "10px", fontWeight: "bold" }}>
              RESPONSE TIME STANDARDS
            </div>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "15px" }}>
              <div>
                <p>Response Target (minutes) — warning threshold</p>
                <input type="number" min="1" value={responseTargetMin} onChange={(e) => setResponseTargetMin(Number(e.target.value))} style={{ padding: "8px", width: "120px" }} />
                <small style={{ color: "#666", display: "block", marginTop: "4px" }}>Default: 10 minutes</small>
              </div>
              <div>
                <p>Response Critical (minutes) — critical threshold</p>
                <input type="number" min="1" value={responseCriticalMin} onChange={(e) => setResponseCriticalMin(Number(e.target.value))} style={{ padding: "8px", width: "120px" }} />
                <small style={{ color: "#666", display: "block", marginTop: "4px" }}>Default: 20 minutes</small>
              </div>
            </div>
          </div>

          {/* RESOLVE VERIFICATION SETTINGS */}
          <div style={{ border: "1px solid #ccc", borderRadius: "6px" }}>
            <div style={{ background: "#166534", color: "white", padding: "10px", fontWeight: "bold" }}>
              RESOLVE VERIFICATION
            </div>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "15px" }}>
              <div>
                <p>Resolve Radius (meters) — responder must be within this distance</p>
                <input type="number" min="10" value={resolveRadiusM} onChange={(e) => setResolveRadiusM(Number(e.target.value))} style={{ padding: "8px", width: "120px" }} />
                <small style={{ color: "#666", display: "block", marginTop: "4px" }}>
                  Resolve button only enables when responder GPS matches incident location. Default: 100m
                </small>
              </div>
            </div>
          </div>

          {/* TESTING RANGE SETTINGS */}
          <div style={{ border: "1px solid #ccc", borderRadius: "6px" }}>
            <div style={{ background: "#7c3aed", color: "white", padding: "10px", fontWeight: "bold" }}>
              TESTING RANGE
            </div>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "15px" }}>
              <div>
                <p>Test Radius (km) — Region 1 / Pangasinan testing</p>
                <input type="number" min="1" value={testRadiusKm} onChange={(e) => setTestRadiusKm(Number(e.target.value))} style={{ padding: "8px", width: "120px" }} />
                <small style={{ color: "#666", display: "block", marginTop: "4px" }}>
                  Expanded to 200km radius for Region 1 / Pangasinan testing. Default: 200
                </small>
              </div>
            </div>
          </div>

          {/* HISTORY SETTINGS */}
          <div style={{ border: "1px solid #ccc", borderRadius: "6px" }}>
            <div style={{ background: "#222", color: "white", padding: "10px", fontWeight: "bold" }}>
              HISTORY SETTINGS
            </div>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "15px" }}>
              <label>
                <input type="checkbox" checked={autoCleanup} onChange={() => setAutoCleanup((prev) => !prev)} />
                Enable Auto Cleanup
              </label>
              <div>
                <p>Auto Delete History After (days)</p>
                <input type="number" min="1" value={cleanupDays} onChange={(e) => setCleanupDays(Number(e.target.value))} style={{ padding: "8px", width: "120px" }} />
                <small style={{ color: "#666" }}>System will automatically delete incidents older than {cleanupDays} days</small>
              </div>
            </div>
          </div>

          {/* SYSTEM INFO */}
          <div style={{ border: "1px solid #ccc", borderRadius: "6px" }}>
            <div style={{ background: "#2d5be3", color: "white", padding: "10px", fontWeight: "bold" }}>
              SYSTEM INFORMATION
            </div>
            <div style={{ padding: "20px" }}>
              <p>System Version: <b>1.0</b></p>
              <p>Database: <b>Firebase</b></p>
              <p>AI Engine: <b>TensorFlow</b></p>
              <p>Status: <b style={{ color: "green" }}>Running</b></p>
            </div>
          </div>

          {message && <p style={{ fontWeight: "bold" }}>{message}</p>}

          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={saveSettings} disabled={saving} style={{ padding: "12px", background: "#2d5be3", color: "white", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}>
              {saving ? "Saving..." : "SAVE SETTINGS"}
            </button>
            <button onClick={resetSettings} style={{ padding: "12px", background: "#555", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}>
              RESET DEFAULT
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SystemSettings