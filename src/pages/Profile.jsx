import { useEffect, useState } from "react"
import { getAuth, signOut } from "firebase/auth"
import { useNavigate } from "react-router-dom"

import { db } from "../firebase"
import {
  collection,
  query,
  limit,
  onSnapshot,
  doc,
  updateDoc
} from "firebase/firestore"

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

function Profile(){

const auth = getAuth()
const navigate = useNavigate()

const [user,setUser] = useState(null)
const [time,setTime] = useState(new Date())
const [lastLogin,setLastLogin] = useState(null)
const [alerts,setAlerts] = useState([])
const [reports,setReports] = useState([])
const [uptime,setUptime] = useState(0)
const [historyFilter,setHistoryFilter] = useState("All")
const [statusFilter,setStatusFilter] = useState("All")
const [deptFilter,setDeptFilter] = useState("All")

// USER + TIME
useEffect(()=>{
setUser(auth.currentUser)

const loginTime = new Date()
setLastLogin(loginTime)

const timer = setInterval(()=>{
setTime(new Date())
setUptime(prev=>prev+1)
},1000)

return ()=>clearInterval(timer)
},[])


// ALERTS (ACTIVE ONLY)
useEffect(()=>{

const q = query(
collection(db,"reports"),
limit(10)
)

const unsub = onSnapshot(q,(snapshot)=>{

const data = snapshot.docs
.map(doc=>({
id:doc.id,
...doc.data()
}))
.filter(item => item.status !== "resolved")

setAlerts(data)

})

return ()=>unsub()

},[])


// ALL REPORTS
useEffect(()=>{

const unsub = onSnapshot(collection(db,"reports"),(snapshot)=>{

const data = snapshot.docs.map(doc=>({
id:doc.id,
...doc.data()
}))

setReports(data)

})

return ()=>unsub()

},[])

const resolveIncident = async (id)=>{
if(!window.confirm("Mark this as resolved?")) return

try{
await updateDoc(doc(db,"reports",id),{
status: "resolved",
resolvedAt: new Date(),
resolvedBy: auth.currentUser?.email || "admin",
autoResolved: false
})

// Drop this report's drive timeline entry and mark it resolved for the dashboard.
const drives = { ...(loadSharedState().drives || {}) }
delete drives[id]
const resolvedIds = Array.isArray(loadSharedState().resolvedIds) ? loadSharedState().resolvedIds : []
if (!resolvedIds.includes(id)) resolvedIds.push(id)
patchSharedState({ drives, resolvedIds })
}catch(err){
console.error("Resolve error:", err)
}
}

const handleLogout = async ()=>{
await signOut(auth)
navigate("/")
}

const openAlert = (alert)=>{
navigate(`/dashboard?reportId=${alert.id}`)
}

const reportType = (r) => r.aiCategory || r.type
const fireCount = reports.filter(r=>reportType(r)==="Fire").length
const medicalCount = reports.filter(r=>reportType(r)==="Medical Emergency").length
const accidentCount = reports.filter(r=>reportType(r)==="Accident").length
const floodCount = reports.filter(r=>reportType(r)==="Flood").length
const crimeCount = reports.filter(r=>reportType(r)==="Crime").length

// Format response time as "Resolved within X minutes Y seconds"
const formatResponseTime = (createdAt, resolvedAt) => {
  if (!createdAt || !resolvedAt) return "—"
  const start = createdAt?.seconds ? createdAt.seconds * 1000 : new Date(createdAt).getTime()
  const end = resolvedAt?.seconds ? resolvedAt.seconds * 1000 : new Date(resolvedAt).getTime()
  const diffSec = Math.max(0, Math.floor((end - start) / 1000))
  const m = Math.floor(diffSec / 60)
  const s = diffSec % 60
  return `${m} minutes ${s} seconds`
}

// Robust date formatting (handles Firestore Timestamp, string, Date)
const formatDate = (timestamp) => {
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

// Filtering by type, status, department for the Emergency History table
const departments = [...new Set(reports.map((r) => r.assignedDepartment).filter(Boolean))]
const filteredReports = reports.filter((r) => {
  if (historyFilter !== "All" && reportType(r) !== historyFilter) return false
  if (statusFilter === "Pending" && r.status === "resolved") return false
  if (statusFilter === "Resolved" && r.status !== "resolved") return false
  if (deptFilter !== "All" && r.assignedDepartment !== deptFilter) return false
  return true
})

const max = Math.max(
fireCount,
medicalCount,
accidentCount,
floodCount,
crimeCount,
1
)

const bar = (count)=>`${(count/max)*100}%`

const formatUptime = ()=>{
let h = Math.floor(uptime/3600)
let m = Math.floor((uptime%3600)/60)
let s = uptime%60
return `${h}h ${m}m ${s}s`
}

const cardStyle = {
border:"1px solid #e5e7eb",
borderRadius:"8px",
background:"white",
boxShadow:"0 2px 8px rgba(0,0,0,0.06)"
}

return(

<div style={{
padding:"40px",
fontFamily:"Arial",
background:"#f4f6fb",
minHeight:"100vh",
width:"100%",
position:"absolute",
top:"0",
left:"0"
}}>

{/* HEADER */}
<div style={{
display:"flex",
justifyContent:"space-between",
alignItems:"center"
}}>

<h1>CITY GUARD</h1>

<div style={{display:"flex",gap:"20px"}}>
<p style={{cursor:"pointer"}} onClick={()=>navigate("/dashboard")}>HOME</p>
<p style={{color:"blue"}}>ADMIN</p>
</div>

</div>

<hr/>

<div style={{display:"flex",gap:"30px",marginTop:"30px"}}>

{/* LEFT MENU */}
<div style={{width:"230px",...cardStyle}}>
<div style={{background:"#2d5be3",color:"white",padding:"10px",fontWeight:"bold"}}>
ADMIN MENU
</div>

<div style={{padding:"15px",display:"flex",flexDirection:"column",gap:"12px"}}>
<p>👤 Profile Info</p>
<p style={{cursor:"pointer"}} onClick={()=>navigate("/dashboard")}>🚨 Incident Dashboard</p>
<p style={{cursor:"pointer"}} onClick={()=>navigate("/system-settings")}>⚙ System Settings</p>
</div>
</div>

{/* MAIN */}
<div style={{flex:1,display:"flex",flexDirection:"column",gap:"20px"}}>

{/* PROFILE */}
<div style={cardStyle}>
<div style={{background:"#2d5be3",color:"white",padding:"10px",fontWeight:"bold"}}>
ADMIN PROFILE
</div>

<div style={{padding:"20px"}}>
<p><b>Name</b></p>
<p>{user?.displayName || "Administrator"}</p>

<p><b>Email</b></p>
<p>{user?.email}</p>

<p><b>Role</b></p>
<p>System Administrator</p>

<p><b>Last Login</b></p>
<p>{lastLogin?.toLocaleString()}</p>

<button onClick={handleLogout} style={{
marginTop:"20px",
padding:"10px 20px",
background:"#2d5be3",
border:"none",
color:"white",
borderRadius:"6px",
cursor:"pointer"
}}>
LOG OUT
</button>
</div>
</div>

{/* ANALYTICS */}
<div style={cardStyle}>
<div style={{background:"#444",color:"white",padding:"10px",fontWeight:"bold"}}>
INCIDENT ANALYTICS
</div>

<div style={{padding:"20px"}}>

<p>🔥 Fire ({fireCount})</p>
<div style={{background:"#eee",height:"12px",borderRadius:"4px"}}>
<div style={{width:bar(fireCount),height:"12px",background:"red"}}/>
</div>

<p style={{marginTop:"15px"}}>🚑 Medical ({medicalCount})</p>
<div style={{background:"#eee",height:"12px",borderRadius:"4px"}}>
<div style={{width:bar(medicalCount),height:"12px",background:"green"}}/>
</div>

<p style={{marginTop:"15px"}}>🚗 Accident ({accidentCount})</p>
<div style={{background:"#eee",height:"12px",borderRadius:"4px"}}>
<div style={{width:bar(accidentCount),height:"12px",background:"orange"}}/>
</div>

<p style={{marginTop:"15px"}}>🌊 Flood ({floodCount})</p>
<div style={{background:"#eee",height:"12px",borderRadius:"4px"}}>
<div style={{width:bar(floodCount),height:"12px",background:"blue"}}/>
</div>

<p style={{marginTop:"15px"}}>🚓 Crime ({crimeCount})</p>
<div style={{background:"#eee",height:"12px",borderRadius:"4px"}}>
<div style={{width:bar(crimeCount),height:"12px",background:"black"}}/>
</div>

</div>
</div>

{/* ALERTS */}
<div style={cardStyle}>
<div style={{background:"#e33",color:"white",padding:"10px",fontWeight:"bold"}}>
RECENT EMERGENCY ALERTS
</div>

<div style={{padding:"15px"}}>
{alerts.length===0 && <p>No alerts</p>}

{alerts.map((a)=>(

<div key={a.id} style={{
borderBottom:"1px solid #eee",
padding:"10px 0",
display:"flex",
justifyContent:"space-between",
alignItems:"center"
}}>

<div onClick={()=>openAlert(a)} style={{cursor:"pointer"}}>
<b>{a.type || a.aiCategory}</b>
<br/>
<small>{a.description}</small>
</div>

</div>

))}

</div>
</div>

{/* EMERGENCY HISTORY (previously "Incident Management") */}
<div style={cardStyle}>
<div style={{background:"#222",color:"white",padding:"10px",fontWeight:"bold"}}>
EMERGENCY HISTORY
</div>

<div style={{padding:"20px"}}>

<div style={{marginBottom:"15px",display:"flex",gap:"10px",flexWrap:"wrap",alignItems:"center"}}>
<button onClick={()=>setHistoryFilter("All")}>All</button>
<button onClick={()=>setHistoryFilter("Fire")}>🔥 Fire</button>
<button onClick={()=>setHistoryFilter("Medical Emergency")}>🚑 Medical</button>
<button onClick={()=>setHistoryFilter("Accident")}>🚗 Accident</button>
<button onClick={()=>setHistoryFilter("Flood")}>🌊 Flood</button>
<button onClick={()=>setHistoryFilter("Crime")}>🚓 Crime</button>
<span style={{marginLeft:"10px"}}>Status:</span>
{["All","Pending","Resolved"].map((s)=>(
<button key={s} onClick={()=>setStatusFilter(s)} style={{background:statusFilter===s?"#2d5be3":"#eee",color:statusFilter===s?"white":"black",border:"none",padding:"4px 10px",borderRadius:"4px",cursor:"pointer"}}>
{s}
</button>
))}
<span style={{marginLeft:"10px"}}>Dept:</span>
<select value={deptFilter} onChange={(e)=>setDeptFilter(e.target.value)} style={{padding:"4px 8px",borderRadius:"4px"}}>
<option value="All">All Departments</option>
{departments.map((d)=><option key={d} value={d}>{d}</option>)}
</select>
</div>

<table style={{width:"100%",borderCollapse:"collapse"}}>
<thead>
<tr style={{background:"#f5f5f5"}}>
<th>Date</th>
<th>Type</th>
<th>Description</th>
<th>Reporter</th>
<th>Dept</th>
<th>Status</th>
<th>Response Time</th>
</tr>
</thead>

<tbody>

{filteredReports
.sort((a,b)=>{
const aTime = a.createdAt?.seconds || 0
const bTime = b.createdAt?.seconds || 0
return bTime - aTime
})
.map((r)=>(

<tr key={r.id}>
<td>{formatDate(r.createdAt)}</td>
<td>{reportType(r)}</td>
<td>{r.description}</td>
<td>{r.reporterName || "—"}</td>
<td>{r.assignedDepartment || "—"}</td>
<td style={{color:r.status==="resolved"?"green":r.status==="rejected"?"#999":"red",fontWeight:"bold"}}>
{r.status==="resolved"?"RESOLVED":r.status==="rejected"?"REJECTED":"PENDING"}
</td>
<td>
{r.status==="resolved"
? `Resolved within ${formatResponseTime(r.createdAt, r.resolvedAt)}`
: "—"}
</td>
</tr>

))}

</tbody>
</table>

</div>
</div>

</div>

{/* SYSTEM STATUS */}
<div style={{width:"280px",...cardStyle}}>
<div style={{background:"#2d5be3",color:"white",padding:"10px",fontWeight:"bold"}}>
SYSTEM STATUS
</div>

<div style={{padding:"20px"}}>
<p>🟢 Firebase: Connected</p>
<p>🟢 Database: Online</p>
<p>🟢 AI Detection: Running</p>

<p style={{marginTop:"20px"}}>Current Time</p>
<b>{time.toLocaleTimeString()}</b>

<p style={{marginTop:"20px"}}>System Uptime</p>
<b>{formatUptime()}</b>
</div>
</div>

</div>
</div>
)

}

export default Profile