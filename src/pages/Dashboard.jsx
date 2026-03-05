import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {

const navigate = useNavigate()

const logout = () => {
localStorage.removeItem("cityguard_auth")
navigate("/")
}

const [reports, setReports] = useState([])

useEffect(() => {

const fetchReports = async () => {

const querySnapshot = await getDocs(collection(db, "reports"))

const data = querySnapshot.docs.map((doc) => ({
id: doc.id,
type: doc.data().emergencyType?.toUpperCase() || "UNKNOWN",
location: doc.data().location || "Unknown location",
time: doc.data().timestamp || "Just now"
}))

setReports(data)

}

fetchReports()

}, [])

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

<h1 className="text-2xl font-bold tracking-wide">
CITY GUARD
</h1>

<div className="flex gap-10 font-semibold items-center">
<button onClick={() => navigate("/dashboard")}>HOME</button>
<button onClick={() => navigate("/profile")}>ADMIN</button>
<button onClick={logout} className="text-red-600">LOGOUT</button>
</div>

</div>


{/* GRID */}
<div className="grid grid-cols-12 gap-6 p-8">


{/* LEFT COLUMN */}
<div className="col-span-3 space-y-6">


<div className="bg-white shadow border">

<div className="bg-red-600 text-white px-4 py-2 font-semibold">
ACTIVE EMERGENCIES
</div>

<div className="divide-y">

{reports.slice(0,3).map((r)=>(

<div key={r.id} className="p-4 flex justify-between">

<div>
🚨 <b>{r.type}</b>
<div className="text-xs text-gray-500">{r.location}</div>
</div>

<span className="bg-yellow-500 text-white px-2 py-1 text-xs rounded">
NEW
</span>

</div>

))}

</div>
</div>


<div className="bg-white shadow border">

<div className="bg-red-600 text-white px-4 py-2 font-semibold">
ASSIGNED RESPONDERS
</div>

<div className="divide-y">

<div className="p-4 flex justify-between">
<div>
🚓 <b>PNP</b>
<div className="text-xs text-gray-500">Dagupan City</div>
</div>

<span className="bg-green-600 text-white px-2 py-1 text-xs rounded">
ON SCENE
</span>
</div>


<div className="p-4 flex justify-between">
<div>
🚒 <b>BFP</b>
<div className="text-xs text-gray-500">Dagupan City</div>
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

<div className="h-[520px] relative">

<iframe
title="map"
className="w-full h-full"
src="https://www.openstreetmap.org/export/embed.html?bbox=120.28%2C15.98%2C120.38%2C16.10&layer=mapnik&marker=16.0430%2C120.3333"
/>

{/* SAMPLE EMERGENCY MARKERS */}
<div className="absolute top-20 left-40 text-red-600 text-xl animate-bounce">🚨</div>
<div className="absolute top-60 left-72 text-red-600 text-xl animate-bounce">🚨</div>
<div className="absolute top-96 left-52 text-red-600 text-xl animate-bounce">🚨</div>

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

<div className="text-center py-2 border-t">

<button
onClick={() => navigate("/reports")}
className="text-blue-600 text-sm font-semibold hover:underline"
>

View All

</button>

</div>
</div>


{/* NOTIFICATIONS */}
<div className="bg-white shadow border">

<div className="bg-red-600 text-white px-4 py-2 font-semibold">
NOTIFICATIONS
</div>

<div className="max-h-60 overflow-y-auto divide-y">

{reports.map((report) => (

<div key={report.id} className="p-3 hover:bg-gray-100 cursor-pointer transition">

<div className="flex justify-between items-center">

<span className="font-semibold text-sm">
{report.type}
</span>

<span className="text-xs text-gray-500">
{report.time}
</span>

</div>

<div className="text-xs text-gray-600">
{report.location}
</div>

</div>

))}

</div>

<div className="text-center py-2 border-t">

<button className="text-blue-600 text-sm font-semibold hover:underline">
View All
</button>

</div>

</div>


</div>
</div>
</div>

)

}