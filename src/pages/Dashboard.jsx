import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";

export default function Dashboard(){

const navigate = useNavigate()

const logout = ()=>{
localStorage.removeItem("cityguard_auth")
navigate("/")
}

const [reports,setReports] = useState([])

/* MARKER ICONS */

const fireIcon = new L.Icon({
iconUrl:"https://maps.google.com/mapfiles/ms/icons/red-dot.png",
iconSize:[32,32]
})

const medicalIcon = new L.Icon({
iconUrl:"https://maps.google.com/mapfiles/ms/icons/green-dot.png",
iconSize:[32,32]
})

const crimeIcon = new L.Icon({
iconUrl:"https://maps.google.com/mapfiles/ms/icons/yellow-dot.png",
iconSize:[32,32]
})

const floodIcon = new L.Icon({
iconUrl:"https://maps.google.com/mapfiles/ms/icons/blue-dot.png",
iconSize:[32,32]
})

const getIcon = (type)=>{
if(type==="FIRE") return fireIcon
if(type==="MEDICAL") return medicalIcon
if(type==="CRIME") return crimeIcon
if(type==="FLOOD") return floodIcon
return fireIcon
}

useEffect(()=>{

const unsubscribe = onSnapshot(collection(db,"reports"),(snapshot)=>{

const data = snapshot.docs.map((doc)=>{

const d = doc.data()

return{
id:doc.id,
type:d.emergencyType ? d.emergencyType.toUpperCase() : "UNKNOWN",
location:d.location || "Unknown location",
time:d.timestamp || "Just now",

lat: d.latitude !== undefined ? Number(d.latitude) : null,
lng: d.longitude !== undefined ? Number(d.longitude) : null,

status:d.status || "NEW"
}

})

console.log("REPORT DATA:",data)

setReports(data)

if(data.length>0){
const audio = new Audio("/alert.mp3")
audio.play().catch(()=>{})
}

})

return()=>unsubscribe()

},[])


const respondToEmergency = async(id)=>{

await updateDoc(doc(db,"reports",id),{
status:"RESPONDING"
})

}

const summary = {
FIRE: reports.filter(r=>r.type==="FIRE").length,
MEDICAL: reports.filter(r=>r.type==="MEDICAL").length,
CRIME: reports.filter(r=>r.type==="CRIME").length,
FLOOD: reports.filter(r=>r.type==="FLOOD").length,
}


return(

<div className="min-h-screen bg-gray-100">

{/* HEADER */}

<div className="bg-white border-b px-10 py-4 flex justify-between items-center shadow">

<h1 className="text-2xl font-bold tracking-wide text-blue-700">
CITY GUARD
</h1>

<div className="flex gap-10 font-semibold items-center">
<button onClick={()=>navigate("/dashboard")}>HOME</button>
<button onClick={()=>navigate("/profile")}>ADMIN</button>
<button onClick={logout} className="text-red-600">LOGOUT</button>
</div>

</div>


<div className="grid grid-cols-12 gap-6 p-8">


{/* LEFT PANEL */}

<div className="col-span-3 space-y-6">

<div className="bg-white shadow-lg rounded overflow-hidden">

<div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white px-4 py-2 font-semibold">
ACTIVE EMERGENCIES
</div>

<div className="divide-y">

{reports.slice(0,3).map((r)=>(
<div key={r.id} className="p-4 space-y-2">

<div>
🚨 <b>{r.type}</b>
<div className="text-xs text-gray-500">{r.location}</div>
</div>

<button
onClick={()=>respondToEmergency(r.id)}
className="bg-blue-600 text-white px-2 py-1 text-xs rounded hover:bg-blue-700"
>
RESPOND
</button>

</div>
))}

</div>
</div>


<div className="bg-white shadow-lg rounded overflow-hidden">

<div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white px-4 py-2 font-semibold">
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

<div className="col-span-6 bg-white shadow-lg rounded overflow-hidden">

<div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white px-4 py-2 font-semibold">
LIVE MAP
</div>

<div className="h-[520px]">

<MapContainer
center={[16.0430,120.3333]}
zoom={14}
className="w-full h-full"
>

<TileLayer
url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
/>

{reports.map((r)=>(
r.lat !== null && r.lng !== null &&(

<Marker
key={r.id}
position={[r.lat,r.lng]}
icon={getIcon(r.type)}
>

<Popup>
<b>{r.type}</b>
<br/>
{r.location}
</Popup>

</Marker>

)
))}

</MapContainer>

</div>

</div>


{/* RIGHT PANEL */}

<div className="col-span-3 space-y-6">

<div className="bg-white shadow-lg rounded overflow-hidden">

<div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white px-4 py-2 font-semibold">
EMERGENCY SUMMARY
</div>

<div className="p-4 grid grid-cols-2 gap-3 text-white text-center">

<div className="bg-red-600 p-4 rounded">
<div className="text-2xl font-bold">{summary.FIRE}</div>
<div className="text-sm">🔥 FIRE</div>
</div>

<div className="bg-green-600 p-4 rounded">
<div className="text-2xl font-bold">{summary.MEDICAL}</div>
<div className="text-sm">🚑 MEDICAL</div>
</div>

<div className="bg-yellow-500 p-4 rounded">
<div className="text-2xl font-bold">{summary.CRIME}</div>
<div className="text-sm">🚓 CRIME</div>
</div>

<div className="bg-blue-600 p-4 rounded">
<div className="text-2xl font-bold">{summary.FLOOD}</div>
<div className="text-sm">🌊 FLOOD</div>
</div>

</div>

</div>


<div className="bg-white shadow-lg rounded overflow-hidden">

<div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white px-4 py-2 font-semibold">
NOTIFICATIONS
</div>

<div className="max-h-60 overflow-y-auto divide-y">

{reports.map((report)=>(
<div key={report.id} className="p-3 hover:bg-gray-100">

<div className="flex justify-between text-sm">
<b>🚨 {report.type}</b>
<span className="text-gray-500 text-xs">{report.time}</span>
</div>

<div className="text-xs text-gray-600">
{report.location}
</div>

</div>
))}

</div>

</div>

</div>

</div>

</div>

)
}