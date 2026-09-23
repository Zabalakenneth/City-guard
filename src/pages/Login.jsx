import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";

function Login() {

const navigate = useNavigate()

const [email,setEmail] = useState("")
const [password,setPassword] = useState("")
const [error,setError] = useState("")

const handleLogin = async (e) => {

e.preventDefault()

try{

await signInWithEmailAndPassword(auth,email,password)

localStorage.setItem("cityguard_auth","1")

navigate("/dashboard")

}catch(err){

setError("Invalid email or password")

}

}

return (

<div style={{
display:"flex",
height:"100vh",
background:"linear-gradient(180deg,#020202 0%,#001eff 50%,#00008b 100%)",
alignItems:"center",
justifyContent:"space-between",
padding:"0 80px"
}}>

<div style={{marginLeft:"140px"}}>

<h1 style={{fontSize:"64px",marginBottom:"20px",fontWeight:"700"}}>
CITY GUARD
</h1>

<h4 style={{marginBottom:"10px"}}>LOG IN</h4>

<form onSubmit={handleLogin}>

<input
type="email"
placeholder="Email"
value={email}
onChange={(e)=>setEmail(e.target.value)}
required
style={{
width:"360px",
height:"45px",
marginBottom:"12px",
padding:"10px",
display:"block",
background:"#dcdcdc",
border:"none"
}}
/>

<input
type="password"
placeholder="Password"
value={password}
onChange={(e)=>setPassword(e.target.value)}
required
style={{
width:"360px",
height:"45px",
marginBottom:"8px",
padding:"10px",
display:"block",
background:"#dcdcdc",
border:"none"
}}
/>

{error && (
<p style={{color:"red",fontSize:"13px"}}>{error}</p>
)}

<Link
to="/forgot-password"
style={{
fontSize:"13px",
color:"#fdfdfd",
textDecoration:"none",
display:"block",
marginBottom:"10px"
}}
>
Forgot password
</Link>

<button
type="submit"
style={{
width:"360px",
height:"45px",
background:"#e50914",
color:"white",
border:"none",
cursor:"pointer",
fontWeight:"600",
marginTop:"20px"
}}
>

LOG IN

</button>

</form>

</div>

<div style={{flex:1,display:"flex",justifyContent:"flex-end"}}>

<img
src="/bag.png"
alt="Emergency Bag"
style={{
width:"720px",
transform:"translateX(60px) scale(1.15)",
filter:"drop-shadow(0 30px 40px rgba(0,0,0,0.25))"
}}
/>

</div>

</div>

)

}

export default Login