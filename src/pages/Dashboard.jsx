import { useEffect, useState } from "react"
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet"
import L from "leaflet"

import { db } from "../firebase"
import { collection, onSnapshot } from "firebase/firestore"

import { getAuth, signOut } from "firebase/auth"
import { useNavigate } from "react-router-dom"

import markerShadow from "leaflet/dist/images/marker-shadow.png"


// marker color based on category
const getMarkerIcon = (category) => {

let color = "blue"

if(category === "Fire") color = "red"
if(category === "Medical Emergency") color = "green"
if(category === "Flood") color = "blue"
if(category === "Crime") color = "black"

return new L.Icon({
iconUrl:`https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${color}.png`,
shadowUrl: markerShadow,
iconSize:[25,41],
iconAnchor:[12,41]
})

}


// map controller
function MapController({selectedReport}){

const map = useMap()

useEffect(()=>{

if(!selectedReport || !selectedReport.location) return

const lat = Number(selectedReport.location.latitude)
const lng = Number(selectedReport.location.longitude)

if(isNaN(lat) || isNaN(lng)) return

map.setView([lat,lng],16)

},[selectedReport])

return null
}



function Dashboard(){

const auth = getAuth()
const navigate = useNavigate()

const [reports,setReports] = useState([])
const [selectedReport,setSelectedReport] = useState(null)

const [showNotif,setShowNotif] = useState(false)
const [unread,setUnread] = useState(0)


// FIRESTORE LISTENER

useEffect(()=>{

const unsub = onSnapshot(collection(db,"reports"),(snapshot)=>{

const data = snapshot.docs.map(doc=>({
id:doc.id,
...doc.data()
}))

setReports(data)

setUnread(snapshot.docChanges().length)

})

return ()=>unsub()

},[])



const handleLogout = async ()=>{

try{

await signOut(auth)
navigate("/")

}catch(err){

console.log(err)

}

}


// click notification

const openReport = (r)=>{
setSelectedReport(r)
setShowNotif(false)
setUnread(0)
}



return(

<div style={{height:"100vh",display:"flex",flexDirection:"column"}}>

{/* HEADER */}

<div style={{
background:"#111",
color:"white",
padding:"12px",
fontSize:"20px",
fontWeight:"bold",
display:"flex",
justifyContent:"space-between",
alignItems:"center"
}}>

<div>CITYGUARD COMMAND CENTER</div>

<div style={{display:"flex",gap:"15px",alignItems:"center",position:"relative"}}>

{/* NOTIFICATION BELL */}

<div style={{cursor:"pointer"}} onClick={()=>setShowNotif(!showNotif)}>

🔔

{unread>0 && (
<span style={{
background:"red",
color:"white",
borderRadius:"50%",
padding:"3px 7px",
fontSize:"12px",
marginLeft:"5px"
}}>
{unread}
</span>
)}

</div>


{/* NOTIFICATION DROPDOWN */}

{showNotif && (

<div style={{
position:"absolute",
top:"40px",
right:"0",
width:"300px",
background:"white",
color:"black",
borderRadius:"6px",
boxShadow:"0 4px 10px rgba(0,0,0,0.2)",
maxHeight:"300px",
overflowY:"auto",
zIndex:999
}}>

{reports.length===0 && (
<p style={{padding:"10px"}}>No alerts</p>
)}

{reports.slice(0,5).map((r)=>(
<div
key={r.id}
onClick={()=>openReport(r)}
style={{
padding:"10px",
borderBottom:"1px solid #eee",
cursor:"pointer"
}}
>

<b>{r.aiCategory}</b>

<br/>

<small>{r.description}</small>

</div>
))}

</div>

)}



<button
onClick={()=>navigate("/profile")}
style={{
padding:"6px 12px",
border:"none",
background:"#444",
color:"white",
borderRadius:"5px",
cursor:"pointer"
}}
>
Admin Profile
</button>


<button
onClick={handleLogout}
style={{
padding:"6px 12px",
border:"none",
background:"red",
color:"white",
borderRadius:"5px",
cursor:"pointer"
}}
>
Logout
</button>

</div>

</div>


{/* STATISTICS */}

<div style={{
display:"flex",
gap:"20px",
padding:"10px",
background:"#222",
color:"white"
}}>

<div>🔥 Fire: {reports.filter(r=>r.aiCategory==="Fire").length}</div>
<div>🚑 Medical: {reports.filter(r=>r.aiCategory==="Medical Emergency").length}</div>
<div>🌊 Flood: {reports.filter(r=>r.aiCategory==="Flood").length}</div>
<div>🚓 Crime: {reports.filter(r=>r.aiCategory==="Crime").length}</div>

</div>



{/* MAIN AREA */}

<div style={{flex:1,display:"flex",overflow:"hidden"}}>

{/* INCIDENT LIST */}

<div style={{
width:"300px",
background:"#f4f4f4",
height:"100%",
overflowY:"auto",
padding:"10px"
}}>

<h3>Incidents</h3>

{reports.map((r)=>(

<div
key={r.id}
onClick={()=>setSelectedReport(r)}
style={{
background:"white",
padding:"10px",
marginBottom:"10px",
borderRadius:"6px",
boxShadow:"0 2px 4px rgba(0,0,0,0.1)",
cursor:"pointer"
}}
>

<b>{r.aiCategory || "Emergency"}</b>

<br/>

<small>{r.description}</small>

</div>

))}

</div>



{/* MAP */}

<div style={{flex:1}}>

<MapContainer
center={[16.0430,120.3333]}
zoom={13}
style={{height:"100%",width:"100%"}}
>

<MapController selectedReport={selectedReport}/>

<TileLayer
attribution="© OpenStreetMap"
url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
/>

{reports.map((report)=>{

if(!report.location) return null

const lat = Number(report.location.latitude)
const lng = Number(report.location.longitude)

if(isNaN(lat)||isNaN(lng)) return null

return(

<Marker
key={report.id}
position={[lat,lng]}
icon={getMarkerIcon(report.aiCategory)}
>

<Popup>

<div style={{width:"200px"}}>

<b>{report.aiCategory}</b>

<br/><br/>

{report.description}

<br/><br/>

{report.imageUrl && (
<img
src={report.imageUrl}
alt="report"
style={{
width:"100%",
borderRadius:"6px"
}}
/>
)}

</div>

</Popup>

</Marker>

)

})}

</MapContainer>

</div>

</div>

</div>

)

}

export default Dashboard