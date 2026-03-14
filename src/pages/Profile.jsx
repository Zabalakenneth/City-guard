import { useEffect, useState } from "react"
import { getAuth, signOut } from "firebase/auth"
import { useNavigate } from "react-router-dom"

import { db } from "../firebase"
import { collection, query, orderBy, limit, onSnapshot, deleteDoc, doc } from "firebase/firestore"

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

// RECENT ALERTS
useEffect(()=>{

const q = query(
collection(db,"reports"),
orderBy("timestamp","desc"),
limit(5)
)

const unsub = onSnapshot(q,(snapshot)=>{

const data = snapshot.docs.map(doc=>({
id:doc.id,
...doc.data()
}))

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

const handleLogout = async ()=>{

await signOut(auth)
navigate("/")

}

const openAlert = (alert)=>{
navigate(`/dashboard?reportId=${alert.id}`)
}

// DELETE HISTORY
const deleteHistory = async (id)=>{

const confirmDelete = window.confirm("Are you sure you want to delete this incident?")

if(!confirmDelete) return

await deleteDoc(doc(db,"reports",id))

}

// INCIDENT COUNTS
const fireCount = reports.filter(r=>r.aiCategory==="Fire").length
const medicalCount = reports.filter(r=>r.aiCategory==="Medical Emergency").length
const floodCount = reports.filter(r=>r.aiCategory==="Flood").length
const crimeCount = reports.filter(r=>r.aiCategory==="Crime").length

const max = Math.max(fireCount,medicalCount,floodCount,crimeCount,1)

const bar = (count)=>`${(count/max)*100}%`

// UPTIME FORMAT
const formatUptime = ()=>{

let h = Math.floor(uptime/3600)
let m = Math.floor((uptime%3600)/60)
let s = uptime%60

return `${h}h ${m}m ${s}s`

}

return(

<div style={{padding:"40px",fontFamily:"Arial"}}>

<div style={{
display:"flex",
justifyContent:"space-between",
alignItems:"center"
}}>

<h1>CITY GUARD</h1>

<div style={{display:"flex",gap:"20px"}}>

<p style={{cursor:"pointer"}} onClick={()=>navigate("/dashboard")}>
HOME
</p>

<p style={{color:"blue"}}>
ADMIN
</p>

</div>

</div>

<hr/>

<div style={{display:"flex",gap:"30px",marginTop:"30px"}}>

<div style={{
width:"230px",
border:"1px solid #ccc",
borderRadius:"6px"
}}>

<div style={{
background:"#2d5be3",
color:"white",
padding:"10px",
fontWeight:"bold"
}}>
ADMIN MENU
</div>

<div style={{padding:"15px",display:"flex",flexDirection:"column",gap:"12px"}}>

<p style={{cursor:"pointer"}}>👤 Profile Info</p>

<p 
style={{cursor:"pointer"}}
onClick={()=>navigate("/dashboard")}
>
🚨 Incident Dashboard
</p>

<p
style={{cursor:"pointer"}}
onClick={()=>navigate("/system-settings")}
>
⚙ System Settings
</p>

</div>

</div>

<div style={{
flex:1,
display:"flex",
flexDirection:"column",
gap:"20px"
}}>

{/* PROFILE */}

<div style={{border:"1px solid #ccc",borderRadius:"6px"}}>

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

<button
onClick={handleLogout}
style={{
marginTop:"20px",
padding:"10px 20px",
background:"#2d5be3",
border:"none",
color:"white",
borderRadius:"5px",
cursor:"pointer"
}}>

LOG OUT

</button>

</div>

</div>

{/* INCIDENT ANALYTICS */}

<div style={{border:"1px solid #ccc",borderRadius:"6px"}}>

<div style={{background:"#444",color:"white",padding:"10px",fontWeight:"bold"}}>
INCIDENT ANALYTICS
</div>

<div style={{padding:"20px"}}>

<p>🔥 Fire ({fireCount})</p>

<div style={{background:"#eee",height:"12px",borderRadius:"4px"}}>
<div style={{width:bar(fireCount),height:"12px",background:"red",borderRadius:"4px"}}/>
</div>

<p style={{marginTop:"15px"}}>🚑 Medical ({medicalCount})</p>

<div style={{background:"#eee",height:"12px",borderRadius:"4px"}}>
<div style={{width:bar(medicalCount),height:"12px",background:"green",borderRadius:"4px"}}/>
</div>

<p style={{marginTop:"15px"}}>🌊 Flood ({floodCount})</p>

<div style={{background:"#eee",height:"12px",borderRadius:"4px"}}>
<div style={{width:bar(floodCount),height:"12px",background:"blue",borderRadius:"4px"}}/>
</div>

<p style={{marginTop:"15px"}}>🚓 Crime ({crimeCount})</p>

<div style={{background:"#eee",height:"12px",borderRadius:"4px"}}>
<div style={{width:bar(crimeCount),height:"12px",background:"black",borderRadius:"4px"}}/>
</div>

</div>

</div>

{/* RECENT ALERTS */}

<div style={{border:"1px solid #ccc",borderRadius:"6px"}}>

<div style={{background:"#e33",color:"white",padding:"10px",fontWeight:"bold"}}>
RECENT EMERGENCY ALERTS
</div>

<div style={{padding:"15px"}}>

{alerts.length===0 && <p>No alerts</p>}

{alerts.map((a)=>(

<div key={a.id} onClick={()=>openAlert(a)} style={{borderBottom:"1px solid #eee",padding:"10px 0",cursor:"pointer"}}>

<b>{a.aiCategory || "Emergency"}</b>

<br/>

<small>{a.description || "Emergency incident reported"}</small>

</div>

))}

</div>

</div>

{/* EMERGENCY HISTORY */}

<div style={{border:"1px solid #ccc",borderRadius:"6px"}}>

<div style={{background:"#222",color:"white",padding:"10px",fontWeight:"bold"}}>
EMERGENCY HISTORY
</div>

<div style={{padding:"20px"}}>

<div style={{marginBottom:"15px",display:"flex",gap:"10px"}}>

<button onClick={()=>setHistoryFilter("All")}>All</button>
<button onClick={()=>setHistoryFilter("Fire")}>🔥 Fire</button>
<button onClick={()=>setHistoryFilter("Medical Emergency")}>🚑 Medical</button>
<button onClick={()=>setHistoryFilter("Flood")}>🌊 Flood</button>
<button onClick={()=>setHistoryFilter("Crime")}>🚓 Crime</button>

</div>

<table style={{width:"100%",borderCollapse:"collapse"}}>

<thead>

<tr style={{background:"#f5f5f5"}}>

<th style={{padding:"8px",border:"1px solid #ddd"}}>Date</th>

<th style={{padding:"8px",border:"1px solid #ddd"}}>Type</th>

<th style={{padding:"8px",border:"1px solid #ddd"}}>Description</th>

<th style={{padding:"8px",border:"1px solid #ddd"}}></th>

</tr>

</thead>

<tbody>

{reports
.filter(r => historyFilter==="All" || r.aiCategory===historyFilter)
.slice()
.reverse()
.map((r)=>(

<tr key={r.id}>

<td style={{padding:"8px",border:"1px solid #ddd"}}>
{r.timestamp?.toDate?.().toLocaleString?.() || "Unknown"}
</td>

<td style={{padding:"8px",border:"1px solid #ddd"}}>
{r.aiCategory || "Emergency"}
</td>

<td style={{padding:"8px",border:"1px solid #ddd"}}>
{r.description}
</td>

<td style={{padding:"8px",border:"1px solid #ddd",textAlign:"center"}}>

<span
onClick={()=>deleteHistory(r.id)}
style={{
cursor:"pointer",
color:"red",
fontWeight:"bold"
}}

>

✖ </span>

</td>

</tr>

))}

</tbody>

</table>

</div>

</div>

</div>

<div style={{width:"280px",border:"1px solid #ccc",borderRadius:"6px"}}>

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
