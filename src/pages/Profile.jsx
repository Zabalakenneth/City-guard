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


// RESOLVE INCIDENT
const resolveIncident = async (id)=>{
if(!window.confirm("Mark this as resolved?")) return

try{
await updateDoc(doc(db,"reports",id),{
status: "resolved",
resolvedAt: new Date()
})
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


// ANALYTICS
const fireCount = reports.filter(r=>r.aiCategory==="Fire").length
const medicalCount = reports.filter(r=>r.aiCategory==="Medical Emergency").length
const accidentCount = reports.filter(r=>r.aiCategory==="Accident").length
const floodCount = reports.filter(r=>r.aiCategory==="Flood").length
const crimeCount = reports.filter(r=>r.aiCategory==="Crime").length

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
<b>{a.aiCategory}</b>
<br/>
<small>{a.description}</small>
</div>

<span
onClick={()=>resolveIncident(a.id)}
style={{cursor:"pointer",color:"green",fontWeight:"bold"}}
>
✔ Resolve
</span>

</div>

))}

</div>
</div>

{/* HISTORY */}
<div style={cardStyle}>
<div style={{background:"#222",color:"white",padding:"10px",fontWeight:"bold"}}>
EMERGENCY HISTORY (RESOLVED)
</div>

<div style={{padding:"20px"}}>

<div style={{marginBottom:"15px",display:"flex",gap:"10px"}}>
<button onClick={()=>setHistoryFilter("All")}>All</button>
<button onClick={()=>setHistoryFilter("Fire")}>🔥 Fire</button>
<button onClick={()=>setHistoryFilter("Medical Emergency")}>🚑 Medical</button>
<button onClick={()=>setHistoryFilter("Accident")}>🚗 Accident</button>
<button onClick={()=>setHistoryFilter("Flood")}>🌊 Flood</button>
<button onClick={()=>setHistoryFilter("Crime")}>🚓 Crime</button>
</div>

<table style={{width:"100%",borderCollapse:"collapse"}}>
<thead>
<tr style={{background:"#f5f5f5"}}>
<th>Date</th>
<th>Type</th>
<th>Description</th>
<th>Status</th>
</tr>
</thead>

<tbody>

{reports
.filter(r => r.status === "resolved")
.filter(r => historyFilter==="All" || r.aiCategory===historyFilter)
.sort((a,b)=>{
const aTime = a.resolvedAt?.seconds || 0
const bTime = b.resolvedAt?.seconds || 0
return bTime - aTime
})
.map((r)=>(

<tr key={r.id}>
<td>{r.resolvedAt?.toDate?.().toLocaleString?.() || "No date"}</td>
<td>{r.aiCategory}</td>
<td>{r.description}</td>

<td style={{color:"green",fontWeight:"bold"}}>
RESOLVED
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