import { useState } from "react"
import { useNavigate } from "react-router-dom"

function SystemSettings(){

const navigate = useNavigate()

const [aiDetection,setAiDetection] = useState(true)
const [autoZoom,setAutoZoom] = useState(true)
const [showImages,setShowImages] = useState(true)
const [enableAlerts,setEnableAlerts] = useState(true)
const [autoCleanup,setAutoCleanup] = useState(false)
const [cleanupDays,setCleanupDays] = useState(30)

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
onChange={()=>setAiDetection(!aiDetection)}
/>
 Enable AI Incident Detection
</label>

<label>
<input
type="checkbox"
checked={autoZoom}
onChange={()=>setAutoZoom(!autoZoom)}
/>
 Auto Zoom Map to Incident
</label>

<label>
<input
type="checkbox"
checked={showImages}
onChange={()=>setShowImages(!showImages)}
/>
 Auto Show Incident Images
</label>

</div>

</div>

{/* ALERT SETTINGS */}

<div style={{border:"1px solid #ccc",borderRadius:"6px"}}>

<div style={{background:"#e33",color:"white",padding:"10px",fontWeight:"bold"}}>
EMERGENCY ALERT SETTINGS
</div>

<div style={{padding:"20px",display:"flex",flexDirection:"column",gap:"15px"}}>

<label>
<input
type="checkbox"
checked={enableAlerts}
onChange={()=>setEnableAlerts(!enableAlerts)}
/>
 Enable Emergency Alerts
</label>

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
onChange={()=>setAutoCleanup(!autoCleanup)}
/>
 Enable Auto Cleanup
</label>

<div>

<p>Auto Delete History After (days)</p>

<input
type="number"
value={cleanupDays}
onChange={(e)=>setCleanupDays(e.target.value)}
style={{padding:"8px",width:"120px"}}
/>

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

</div>

</div>

</div>

)

}

export default SystemSettings
