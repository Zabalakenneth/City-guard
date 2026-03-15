import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"

import { db } from "../firebase"
import { doc, getDoc, setDoc } from "firebase/firestore"

function SystemSettings(){

const navigate = useNavigate()

const [aiDetection,setAiDetection] = useState(true)
const [autoZoom,setAutoZoom] = useState(true)
const [showImages,setShowImages] = useState(true)
const [enableAlerts,setEnableAlerts] = useState(true)
const [autoCleanup,setAutoCleanup] = useState(false)
const [cleanupDays,setCleanupDays] = useState(30)

const [loading,setLoading] = useState(true)
const [saving,setSaving] = useState(false)
const [message,setMessage] = useState("")

useEffect(()=>{
loadSettings()
},[])

const loadSettings = async ()=>{

try{

const ref = doc(db,"system","settings")
const snap = await getDoc(ref)

if(snap.exists()){

const data = snap.data()

setAiDetection(data.aiDetection ?? true)
setAutoZoom(data.autoZoom ?? true)
setShowImages(data.showImages ?? true)
setEnableAlerts(data.enableAlerts ?? true)
setAutoCleanup(data.autoCleanup ?? false)
setCleanupDays(data.cleanupDays ?? 30)

}

setLoading(false)

}catch(err){

console.log(err)
setLoading(false)

}

}

const saveSettings = async ()=>{

try{

setSaving(true)
setMessage("")

await setDoc(doc(db,"system","settings"),{

aiDetection,
autoZoom,
showImages,
enableAlerts,
autoCleanup,
cleanupDays:Number(cleanupDays)

})

setMessage("✅ Settings saved successfully")

setSaving(false)

}catch(err){

console.log(err)
setMessage("❌ Error saving settings")
setSaving(false)

}

}

const resetSettings = ()=>{

setAiDetection(true)
setAutoZoom(true)
setShowImages(true)
setEnableAlerts(true)
setAutoCleanup(false)
setCleanupDays(30)

setMessage("⚠ Settings reset (not saved yet)")

}

if(loading){
return <p style={{padding:"40px"}}>Loading settings...</p>
}

return(

<div style={{padding:"40px",fontFamily:"Arial"}}>

<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>

<h1>CITY GUARD</h1>

<div style={{display:"flex",gap:"20px"}}>

<p style={{cursor:"pointer"}} onClick={()=>navigate("/dashboard")}>
HOME
</p>

<p style={{cursor:"pointer"}} onClick={()=>navigate("/profile")}>
ADMIN
</p>

</div>

</div>

<hr/>

<div style={{display:"flex",gap:"30px",marginTop:"30px"}}>

{/* LEFT MENU */}

<div style={{width:"230px",border:"1px solid #ccc",borderRadius:"6px"}}>

<div style={{background:"#2d5be3",color:"white",padding:"10px",fontWeight:"bold"}}>
ADMIN MENU
</div>

<div style={{padding:"15px",display:"flex",flexDirection:"column",gap:"12px"}}>

<p style={{cursor:"pointer"}} onClick={()=>navigate("/profile")}>
👤 Profile Info
</p>

<p style={{cursor:"pointer"}} onClick={()=>navigate("/dashboard")}>
🚨 Incident Dashboard
</p>

<p style={{color:"blue"}}>
⚙ System Settings
</p>

</div>

</div>

{/* MAIN SETTINGS */}

<div style={{flex:1,display:"flex",flexDirection:"column",gap:"20px"}}>

{/* AI SETTINGS */}

<div style={{border:"1px solid #ccc",borderRadius:"6px"}}>

<div style={{background:"#444",color:"white",padding:"10px",fontWeight:"bold"}}>
AI DETECTION SETTINGS
</div>

<div style={{padding:"20px",display:"flex",flexDirection:"column",gap:"15px"}}>

<label>
<input
type="checkbox"
checked={aiDetection}
onChange={()=>setAiDetection(prev=>!prev)}
/>
 Enable AI Incident Detection
</label>

<label>
<input
type="checkbox"
checked={autoZoom}
onChange={()=>setAutoZoom(prev=>!prev)}
/>
 Auto Zoom Map to Incident
</label>

<label>
<input
type="checkbox"
checked={showImages}
onChange={()=>setShowImages(prev=>!prev)}
/>
 Auto Show Incident Images
</label>

</div>

</div>

{/* ALERT SETTINGS */}

<div style={{border:"1px solid #ccc",borderRadius:"6px"}}>

<div style={{
background: enableAlerts ? "#e33" : "#777",
color:"white",
padding:"10px",
fontWeight:"bold"
}}>
EMERGENCY ALERT SETTINGS
</div>

<div style={{padding:"20px",display:"flex",flexDirection:"column",gap:"15px"}}>

<label>
<input
type="checkbox"
checked={enableAlerts}
onChange={()=>setEnableAlerts(prev=>!prev)}
/>
 Enable Emergency Alerts
</label>

{!enableAlerts && (

<div style={{
background:"#fff3cd",
color:"#856404",
padding:"10px",
borderRadius:"6px",
fontWeight:"bold"
}}>

⚠ Emergency alerts are currently DISABLED.  
No siren sound or popup will appear in the dashboard.

</div>

)}

</div>

</div>

{/* HISTORY SETTINGS */}

<div style={{border:"1px solid #ccc",borderRadius:"6px"}}>

<div style={{background:"#222",color:"white",padding:"10px",fontWeight:"bold"}}>
HISTORY SETTINGS
</div>

<div style={{padding:"20px",display:"flex",flexDirection:"column",gap:"15px"}}>

<label>
<input
type="checkbox"
checked={autoCleanup}
onChange={()=>setAutoCleanup(prev=>!prev)}
/>
 Enable Auto Cleanup
</label>

<div>

<p>Auto Delete History After (days)</p>

<input
type="number"
min="1"
value={cleanupDays}
onChange={(e)=>setCleanupDays(Number(e.target.value))}
style={{padding:"8px",width:"120px"}}
/>

<small style={{color:"#666"}}>
System will automatically delete incidents older than {cleanupDays} days
</small>

</div>

</div>

</div>

{/* SYSTEM INFO */}

<div style={{border:"1px solid #ccc",borderRadius:"6px"}}>

<div style={{background:"#2d5be3",color:"white",padding:"10px",fontWeight:"bold"}}>
SYSTEM INFORMATION
</div>

<div style={{padding:"20px"}}>

<p>System Version: <b>1.0</b></p>
<p>Database: <b>Firebase</b></p>
<p>AI Engine: <b>TensorFlow</b></p>
<p>Status: <b style={{color:"green"}}>Running</b></p>

</div>

</div>

{message && (

<p style={{fontWeight:"bold"}}>
{message}
</p>

)}

<div style={{display:"flex",gap:"10px"}}>

<button
onClick={saveSettings}
disabled={saving}
style={{
padding:"12px",
background:"#2d5be3",
color:"white",
border:"none",
borderRadius:"6px",
fontWeight:"bold",
cursor:"pointer"
}}
>

{saving ? "Saving..." : "SAVE SETTINGS"}

</button>

<button
onClick={resetSettings}
style={{
padding:"12px",
background:"#555",
color:"white",
border:"none",
borderRadius:"6px",
cursor:"pointer"
}}
>

RESET DEFAULT

</button>

</div>

</div>

</div>

</div>

)

}

export default SystemSettings