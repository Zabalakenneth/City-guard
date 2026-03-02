import { useNavigate } from "react-router-dom"

export default function Dashboard() {

  const navigate = useNavigate()

  const logout = () => {
    localStorage.removeItem("cityguard_auth")
    navigate("/")
  }

  // 🔴 SAMPLE REPORT DATA (replace later with database)
  const reports = [
    { id: 1, type: "FIRE" },
    { id: 2, type: "FIRE" },
    { id: 3, type: "FLOOD" },
    { id: 4, type: "CRIME" },
    { id: 5, type: "MEDICAL" },
    { id: 6, type: "MEDICAL" },
  ]

  // 🔴 AUTO COUNTING LOGIC
  const summary = {
    FIRE: reports.filter(r => r.type === "FIRE").length,
    MEDICAL: reports.filter(r => r.type === "MEDICAL").length,
    CRIME: reports.filter(r => r.type === "CRIME").length,
    FLOOD: reports.filter(r => r.type === "FLOOD").length,
  }

  return (
    <div className="min-h-screen bg-gray-100">

      {/* NAVBAR */}
      <div className="bg-white border-b px-10 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-wide">CITY GUARD</h1>

        <div className="flex gap-10 font-semibold items-center">
          <button onClick={() => navigate("/dashboard")}>HOME</button>
          <button>REPORTS</button>
          <button onClick={() => navigate("/profile")}>ADMIN</button>

          <button onClick={logout} className="text-red-600 font-bold">
            LOG OUT
          </button>
        </div>
      </div>

      {/* GRID */}
      <div className="grid grid-cols-12 gap-6 p-8">

        {/* LEFT COLUMN */}
        <div className="col-span-3 space-y-6">

          {/* ACTIVE EMERGENCIES */}
          <div className="bg-white shadow border">
            <div className="bg-red-600 text-white px-4 py-2 font-semibold">
              ACTIVE EMERGENCIES
            </div>

            <div className="divide-y">
              <div className="p-4 flex justify-between">
                <div>
                  🔥 <b>Building Fire</b>
                  <div className="text-xs text-gray-500">Barangay Pantal</div>
                </div>
                <span className="bg-green-600 text-white px-2 py-1 text-xs rounded">
                  RESPONDED
                </span>
              </div>

              <div className="p-4 flex justify-between">
                <div>
                  🌊 <b>Flood</b>
                  <div className="text-xs text-gray-500">Barangay Pantal</div>
                </div>
                <span className="bg-yellow-500 text-white px-2 py-1 text-xs rounded">
                  NEW
                </span>
              </div>

              <div className="p-4 flex justify-between">
                <div>
                  🚗 <b>Car Accident</b>
                  <div className="text-xs text-gray-500">Barangay Pantal</div>
                </div>
                <span className="bg-blue-600 text-white px-2 py-1 text-xs rounded">
                  IN PROGRESS
                </span>
              </div>
            </div>
          </div>

          {/* ASSIGNED RESPONDERS */}
          <div className="bg-white shadow border">
            <div className="bg-red-600 text-white px-4 py-2 font-semibold">
              ASSIGNED RESPONDERS
            </div>

            <div className="divide-y">
              <div className="p-4 flex justify-between">
                <div>
                  🚓 <b>PNP</b>
                  <div className="text-xs text-gray-500">Barangay Pantal</div>
                </div>
                <span className="bg-green-600 text-white px-2 py-1 text-xs rounded">
                  ON SCENE
                </span>
              </div>

              <div className="p-4 flex justify-between">
                <div>
                  🚒 <b>BFP</b>
                  <div className="text-xs text-gray-500">Barangay Pantal</div>
                </div>
                <span className="bg-green-600 text-white px-2 py-1 text-xs rounded">
                  ON SCENE
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* MAP */}
        <div className="col-span-6 bg-white shadow border">
          <div className="bg-red-600 text-white px-4 py-2 font-semibold">
            LIVE MAP
          </div>

          <div className="h-[520px]">
            <iframe
              title="map"
              className="w-full h-full"
              src="https://www.openstreetmap.org/export/embed.html"
            />
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="col-span-3 space-y-6">

          {/* SUMMARY */}
          <div className="bg-white shadow border">
            <div className="bg-red-600 text-white px-4 py-2 font-semibold">
              EMERGENCY SUMMARY
            </div>

            <div className="p-4 grid grid-cols-2 gap-3 text-white text-center">

              <div className="bg-red-600 p-4 rounded">
                <div className="text-2xl font-bold">{summary.FIRE}</div>
                <div className="text-sm">FIRE</div>
              </div>

              <div className="bg-green-600 p-4 rounded">
                <div className="text-2xl font-bold">{summary.MEDICAL}</div>
                <div className="text-sm">MEDICAL</div>
              </div>

              <div className="bg-yellow-500 p-4 rounded">
                <div className="text-2xl font-bold">{summary.CRIME}</div>
                <div className="text-sm">CRIME</div>
              </div>

              <div className="bg-blue-600 p-4 rounded">
                <div className="text-2xl font-bold">{summary.FLOOD}</div>
                <div className="text-sm">FLOOD</div>
              </div>

            </div>
          </div>

          <div className="bg-white shadow h-40"></div>
          <div className="bg-white shadow h-40"></div>

        </div>

      </div>
    </div>
  )
}