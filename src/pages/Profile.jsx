import { useEffect, useState } from "react"
import { getAuth, signOut } from "firebase/auth"
import { useNavigate } from "react-router-dom"

import { db } from "../firebase"
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore"

function Profile(){

const auth = getAuth()
const navigate = useNavigate()

const [user,setUser] = useState(null)
const [time,setTime] = useState(new Date())
const [alerts,setAlerts] = useState([])

useEffect(()=>{

setUser(auth.currentUser)

const timer = setInterval(()=>{
setTime(new Date())
},1000)

return ()=>clearInterval(timer)

},[])


// FIRESTORE ALERT LISTENER

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


const handleLogout = async ()=>{

await signOut(auth)
navigate("/")

}


// CLICK ALERT → OPEN DASHBOARD

const openAlert = (alert)=>{
navigate(`/dashboard?reportId=${alert.id}`)
}


return(

<div style={{padding:"40px",fontFamily:"Arial"}}>

{/* HEADER */}

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

<p style={{color:"blue",cursor:"pointer"}}>
ADMIN
</p>

</div>

</div>

<hr/>

<div style={{display:"flex",gap:"30px",marginTop:"30px"}}>

{/* ADMIN MENU */}

<div style={{
width:"250px",
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

<div style={{padding:"15px"}}>
<p>Profile Info</p>
<p>System Settings</p>
<p>Logs</p>
</div>

</div>


{/* PROFILE + ALERTS */}

<div style={{
flex:1,
display:"flex",
flexDirection:"column",
gap:"20px"
}}>

{/* PROFILE */}

<div style={{
border:"1px solid #ccc",
borderRadius:"6px"
}}>

<div style={{
background:"#2d5be3",
color:"white",
padding:"10px",
fontWeight:"bold"
}}>
ADMIN PROFILE
</div>

<div style={{padding:"20px"}}>

<p><b>Name</b></p>
<p>{user?.displayName || "Administrator"}</p>

<p><b>Email</b></p>
<p>{user?.email || "No email available"}</p>

<p><b>Role</b></p>
<p>System Administrator</p>

<p><b>Last Login</b></p>
<p>{time.toLocaleString()}</p>

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
}}
>
LOG OUT
</button>

</div>

</div>


{/* RECENT ALERTS */}

<div style={{
border:"1px solid #ccc",
borderRadius:"6px"
}}>

<div style={{
background:"#e33",
color:"white",
padding:"10px",
fontWeight:"bold"
}}>
RECENT EMERGENCY ALERTS
</div>

<div style={{padding:"15px"}}>

{alerts.length === 0 && <p>No recent alerts</p>}

{alerts.map((a)=>(
<div
key={a.id}
onClick={()=>openAlert(a)}
style={{
borderBottom:"1px solid #eee",
padding:"10px 0",
cursor:"pointer"
}}
>

<b>{a.aiCategory || "Emergency"}</b>

<br/>

<small>{a.description}</small>

</div>
))}

</div>

</div>

</div>


{/* SYSTEM STATUS */}

<div style={{
width:"300px",
border:"1px solid #ccc",
borderRadius:"6px"
}}>

<div style={{
background:"#2d5be3",
color:"white",
padding:"10px",
fontWeight:"bold"
}}>
SYSTEM STATUS
</div>

<div style={{padding:"20px"}}>

<p>🟢 Firebase: Connected</p>
<p>🟢 Database: Online</p>
<p>🟢 AI Detection: Running</p>

<p style={{marginTop:"20px"}}>
Current Time:
</p>

<b>{time.toLocaleTimeString()}</b>

</div>

</div>

</div>

</div>

)

}

export default Profile