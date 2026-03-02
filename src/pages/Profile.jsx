import { useNavigate } from "react-router-dom"

export default function Profile() {
  const navigate = useNavigate()

  const handleLogout = () => {
    localStorage.removeItem("cityguard_auth")
    navigate("/")
  }

  return (
    <div className="min-h-screen bg-gray-100">

      {/* NAVBAR */}
      <div className="bg-white border-b px-10 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-wide">CITY GUARD</h1>

        <div className="flex gap-10 font-semibold">
          <button onClick={() => navigate("/dashboard")}>HOME</button>
          <button onClick={() => navigate("/dashboard")}>REPORTS</button>
          <button onClick={() => navigate("/profile")} className="text-red-600">
            ADMIN
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <div className="grid grid-cols-12 gap-6 p-8">

        {/* LEFT SIDEBAR */}
        <div className="col-span-3 space-y-6">

          <div className="bg-white shadow border">
            <div className="bg-red-600 text-white px-4 py-2 font-semibold">
              ADMIN MENU
            </div>

            <div className="p-4 space-y-3 text-sm">
              <div className="font-semibold">Profile Info</div>
              <div>System Settings</div>
              <div>Logs</div>
            </div>
          </div>

        </div>

        {/* MAIN PROFILE */}
        <div className="col-span-6 space-y-6">

          <div className="bg-white shadow border">
            <div className="bg-red-600 text-white px-4 py-2 font-semibold">
              ADMIN PROFILE
            </div>

            <div className="p-6 space-y-4">

              <div>
                <div className="text-sm text-gray-500">Name</div>
                <div className="font-semibold text-lg">Admin User</div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Email</div>
                <div className="font-semibold text-lg">admin@cityguard.com</div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Role</div>
                <div className="font-semibold text-lg">System Administrator</div>
              </div>

              <button
                onClick={handleLogout}
                className="mt-6 bg-red-600 text-white px-6 py-2 rounded hover:bg-red-700 transition"
              >
                LOG OUT
              </button>

            </div>
          </div>

        </div>

        {/* RIGHT SIDE */}
        <div className="col-span-3 space-y-6">

          <div className="bg-white shadow border">
            <div className="bg-red-600 text-white px-4 py-2 font-semibold">
              SYSTEM STATUS
            </div>

            <div className="p-4 text-sm">
              All services running normally.
            </div>
          </div>

        </div>

      </div>
    </div>
  )
}