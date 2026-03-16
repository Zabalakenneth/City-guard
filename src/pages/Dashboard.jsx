import { useEffect, useState, useRef } from "react"
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet"
import L from "leaflet"

import { db } from "../firebase"
import { collection, onSnapshot, deleteDoc, doc, getDoc, updateDoc } from "firebase/firestore"

import { getAuth, signOut } from "firebase/auth"
import { useNavigate } from "react-router-dom"

import markerShadow from "leaflet/dist/images/marker-shadow.png"

const getMarkerIcon = (category) => {

let color = "blue"

if(category === "Fire") color = "red"
if(category === "Medical Emergency") color = "green"
if(category === "Flood") color = "blue"
if(category === "Crime") color = "black"
if(category === "Accident") color = "orange"

return new L.Icon({
iconUrl:`https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${color}.png`,
shadowUrl: markerShadow,
iconSize:[25,41],
iconAnchor:[12,41]
})

}

function MapController({selectedReport, autoZoom}){

const map = useMap()

useEffect(()=>{

if(!autoZoom) return
if(!selectedReport || !selectedReport.location) return

const lat = Number(selectedReport.location.latitude)
const lng = Number(selectedReport.location.longitude)

if(isNaN(lat) || isNaN(lng)) return

map.setView([lat,lng],16)

},[selectedReport,map,autoZoom])

return null

}

function Dashboard(){

const auth = getAuth()
const navigate = useNavigate()

const [reports,setReports] = useState([])
const [notifList,setNotifList] = useState([])
const [selectedReport,setSelectedReport] = useState(null)

const [showNotif,setShowNotif] = useState(false)

const [activeFilter,setActiveFilter] = useState("All")

const [viewImage,setViewImage] = useState(null)

const [alertPopup,setAlertPopup] = useState(null)

const [settings,setSettings] = useState({
aiDetection:true,
autoZoom:true,
showImages:true,
enableAlerts:true
})

const popupRefs = useRef({})

/* SMART EMERGENCY ALERT SOUNDS */

const playAlertSound = (category) => {

let sound = "/siren.mp3"

if(category === "Fire") sound = "/fire.mp3"
if(category === "Medical Emergency") sound = "/ambulance.mp3"
if(category === "Crime") sound = "/police.mp3"
if(category === "Accident") sound = "/accident.mp3"
if(category === "Flood") sound = "/flood.mp3"

const audio = new Audio(sound)
audio.volume = 1
audio.play().catch(()=>{})

}

/* LOAD SETTINGS */

useEffect(()=>{
loadSettings()
},[])

const loadSettings = async ()=>{

try{

const ref = doc(db,"system","settings")
const snap = await getDoc(ref)

if(snap.exists()){
setSettings(snap.data())
}

}catch(err){
console.log(err)
}

}

/* REALTIME REPORT LISTENER */

useEffect(()=>{

const unsub = onSnapshot(collection(db,"reports"),(snapshot)=>{

let data = snapshot.docs.map(doc=>({
id:doc.id,
...doc.data()
}))

if(!settings.aiDetection){
data = []
}

setReports(data)
setNotifList(data.filter(r => !r.read))

const newReports = snapshot.docChanges().filter(
change => change.type === "added"
)

if(newReports.length > 0){

const newReport = newReports[0].doc.data()

if(settings.enableAlerts){

setAlertPopup(newReport)
playAlertSound(newReport.aiCategory)

setTimeout(()=>{
setAlertPopup(null)
},6000)

}

}

})

return ()=>unsub()

},[settings])

/* POPUP + IMAGE */

useEffect(()=>{

if(selectedReport && popupRefs.current[selectedReport.id]){
popupRefs.current[selectedReport.id].openPopup()
}

if(settings.showImages && selectedReport?.imageUrl){
setViewImage(selectedReport.imageUrl)
}

},[selectedReport,settings])

/* MARK AS READ */

const markAsRead = async(id)=>{

try{

await updateDoc(doc(db,"reports",id),{
read:true
})

}catch(err){
console.log(err)
}

}

/* LOGOUT */

const handleLogout = async ()=>{

try{
await signOut(auth)
navigate("/")
}catch(err){
console.log(err)
}

}

/* RESOLVE INCIDENT */

const resolveIncident = async (id)=>{

try{
await deleteDoc(doc(db,"reports",id))
alert("Incident resolved")
}catch(err){
console.log(err)
}

}

/* OPEN REPORT */

const openReport = (r)=>{

setSelectedReport(r)
setShowNotif(false)

if(!r.read){
markAsRead(r.id)
}

}

/* COUNTERS */

const unread = reports.filter(r=>!r.read).length

const fireCount = reports.filter(r=>r.aiCategory==="Fire").length
const medicalCount = reports.filter(r=>r.aiCategory==="Medical Emergency").length
const accidentCount = reports.filter(r=>r.aiCategory==="Accident").length
const floodCount = reports.filter(r=>r.aiCategory==="Flood").length
const crimeCount = reports.filter(r=>r.aiCategory==="Crime").length

return(

<div style={{height:"100vh",display:"flex",flexDirection:"column"}}>

{alertPopup && (

<div
onClick={()=>{

setSelectedReport(alertPopup)

if(popupRefs.current[alertPopup.id]){
popupRefs.current[alertPopup.id].openPopup()
}

}}
style={{
position:"fixed",
top:"20px",
left:"50%",
transform:"translateX(-50%)",
background:"red",
color:"white",
padding:"15px 25px",
borderRadius:"8px",
fontWeight:"bold",
zIndex:9999,
cursor:"pointer"
}}
>

🚨 NEW EMERGENCY ALERT: {alertPopup.aiCategory || "Incident"}  
<br/>
<small>Click to view location</small>

</div>

)}

<div style={{
background:"linear-gradient(90deg,#0f2bb8,#1e40ff)",
color:"white",
padding:"14px 18px",
fontSize:"20px",
fontWeight:"bold",
display:"flex",
justifyContent:"space-between",
alignItems:"center"
}}>

<div>CITYGUARD COMMAND CENTER</div>

<div style={{display:"flex",gap:"15px",alignItems:"center",position:"relative"}}>

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

{showNotif && (

<div style={{
position:"absolute",
top:"35px",
right:"0",
width:"300px",
background:"white",
color:"black",
borderRadius:"6px",
boxShadow:"0 4px 10px rgba(0,0,0,0.2)",
zIndex:999
}}>

<div
style={{
display:"flex",
justifyContent:"space-between",
alignItems:"center",
padding:"10px",
fontWeight:"bold",
borderBottom:"1px solid #eee"
}}
>

<span>Notifications</span>

<button
onClick={()=>{

setNotifList([])

}}
style={{
background:"#ff4d4d",
color:"white",
border:"none",
padding:"4px 10px",
borderRadius:"6px",
cursor:"pointer",
fontSize:"12px"
}}
>

Clear

</button>

</div>

{reports.length===0 && (
<p style={{padding:"10px"}}>No alerts</p>
)}

{notifList.slice().reverse().slice(0,5).map((r)=>(

<div
key={r.id}
onClick={()=>openReport(r)}
style={{
padding:"10px",
borderBottom:"1px solid #eee",
cursor:"pointer",
background:r.read ? "white" : "#e6f0ff"
}}
>

<b>{r.aiCategory || "Emergency"}</b>

<br/>

<small>{r.description}</small>

{!r.read && (
<span style={{
color:"red",
fontSize:"12px"
}}>
 ● new
</span>
)}

</div>

))}

</div>

)}

<button
onClick={()=>navigate("/profile")}
style={{
padding:"6px 12px",
border:"none",
background:"#374151",
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

<div style={{
display:"flex",
gap:"20px",
padding:"10px",
background:"#0f172a",
color:"white"
}}>

<div style={{cursor:"pointer"}} onClick={()=>setActiveFilter("Fire")}>🔥 Fire: {fireCount}</div>
<div style={{cursor:"pointer"}} onClick={()=>setActiveFilter("Medical Emergency")}>🚑 Medical: {medicalCount}</div>
<div style={{cursor:"pointer"}} onClick={()=>setActiveFilter("Accident")}>🚗 Accident: {accidentCount}</div>
<div style={{cursor:"pointer"}} onClick={()=>setActiveFilter("Flood")}>🌊 Flood: {floodCount}</div>
<div style={{cursor:"pointer"}} onClick={()=>setActiveFilter("Crime")}>🚓 Crime: {crimeCount}</div>
<div style={{cursor:"pointer"}} onClick={()=>setActiveFilter("All")}>📋 All</div>

</div>

<div style={{flex:1,display:"flex",overflow:"hidden"}}>

<div style={{
width:"300px",
background:"#f4f4f4",
height:"100%",
overflowY:"auto",
padding:"10px"
}}>

<h3>Incidents</h3>

{reports
.filter(r=>activeFilter==="All" || r.aiCategory===activeFilter)
.map((r)=>(

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

<br/><br/>

<button
onClick={(e)=>{
e.stopPropagation()
resolveIncident(r.id)
}}
style={{
background:"green",
color:"white",
border:"none",
padding:"5px 10px",
borderRadius:"4px",
cursor:"pointer"
}}
>

Resolve

</button>

</div>

))}

</div>

<div style={{flex:1}}>

<MapContainer center={[16.0430,120.3333]} zoom={13} style={{height:"100%",width:"100%"}}>

<MapController selectedReport={selectedReport} autoZoom={settings.autoZoom}/>

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
ref={(ref)=>{
if(ref) popupRefs.current[report.id] = ref
}}
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
onClick={()=>setViewImage(report.imageUrl)}
style={{width:"100%",borderRadius:"6px",cursor:"pointer"}}
/>

)}

<br/><br/>

<button
onClick={()=>resolveIncident(report.id)}
style={{
background:"green",
color:"white",
border:"none",
padding:"6px 12px",
borderRadius:"4px",
cursor:"pointer"
}}
>

Resolve Incident

</button>

</div>

</Popup>

</Marker>

)

})}

</MapContainer>

</div>

</div>

{viewImage && (

<div style={{
position:"fixed",
top:0,
left:0,
width:"100%",
height:"100%",
background:"rgba(0,0,0,0.9)",
display:"flex",
justifyContent:"center",
alignItems:"center",
zIndex:9999
}}>

<button
onClick={()=>setViewImage(null)}
style={{
position:"absolute",
top:"20px",
right:"30px",
fontSize:"30px",
background:"none",
border:"none",
color:"white",
cursor:"pointer"
}}
>

✖

</button>

<img
src={viewImage}
style={{
maxWidth:"90%",
maxHeight:"90%",
borderRadius:"10px"
}}
/>

</div>

)}

</div>

)

}

export default Dashboard