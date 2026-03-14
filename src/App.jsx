import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import SystemSettings from "./pages/SystemSettings";

function PrivateRoute({ children }) {
  const fakeAuth = localStorage.getItem("cityguard_auth") === "1";
  return fakeAuth ? children : <Navigate to="/" />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>

        {/* LOGIN */}
        <Route path="/" element={<Login />} />

        {/* FORGOT PASSWORD */}
        <Route path="/forgot-password" element={<ForgotPassword />} />

        {/* DASHBOARD (Protected) */}
        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          }
        />

        {/* PROFILE / ADMIN (Protected) */}
        <Route
          path="/profile"
          element={
            <PrivateRoute>
              <Profile />
            </PrivateRoute>
          }
        />

        {/* SYSTEM SETTINGS (Protected) */}
        <Route
          path="/system-settings"
          element={
            <PrivateRoute>
              <SystemSettings />
            </PrivateRoute>
          }
        />

      </Routes>
    </BrowserRouter>
  );
}