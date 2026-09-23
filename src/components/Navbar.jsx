import { Link, useNavigate } from 'react-router-dom'

export default function Navbar(){
  const nav = useNavigate()
  function logout(){
    localStorage.removeItem('cityguard_auth')
    nav('/')
  }
  return (
    <header className="flex justify-between items-center bg-red-600 text-white p-4">
      <h1 className="text-xl font-bold">CITY GUARD</h1>
      <nav>
        <Link to="/dashboard" className="mx-2">Home</Link>
        <Link to="/profile" className="mx-2">Profile</Link>
        <button onClick={logout} className="mx-2 underline">Logout</button>
      </nav>
    </header>
  )
}
