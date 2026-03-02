import React from "react";
import { useNavigate, Link } from "react-router-dom";

function Login() {
  const navigate = useNavigate();
  const [hoverForgot, setHoverForgot] = React.useState(false);
  const [hoverBtn, setHoverBtn] = React.useState(false);

  const handleLogin = (e) => {
    e.preventDefault();
    localStorage.setItem("cityguard_auth", "1");
    navigate("/dashboard");
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        backgroundColor: "#efefef",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 80px",
      }}
    >
      {/* LEFT */}
      <div style={{ marginLeft: "140px" }}>
        <h1 style={{ fontSize: "64px", marginBottom: "20px", fontWeight: "700" }}>
          CITY GUARD
        </h1>

        <h4 style={{ marginBottom: "10px" }}>LOG IN</h4>

        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Email"
            required
            style={{
              width: "360px",
              height: "45px",
              marginBottom: "12px",
              padding: "10px",
              display: "block",
              background: "#dcdcdc",
              border: "none",
            }}
          />

          <input
            type="password"
            placeholder="Password"
            required
            style={{
              width: "360px",
              height: "45px",
              marginBottom: "8px",
              padding: "10px",
              display: "block",
              background: "#dcdcdc",
              border: "none",
            }}
          />

          {/* forgot password */}
          <Link
            to="/forgot-password"
            onMouseEnter={() => setHoverForgot(true)}
            onMouseLeave={() => setHoverForgot(false)}
            style={{
              fontSize: "13px",
              color: hoverForgot ? "#e50914" : "#555",
              textDecoration: "none",
              display: "block",   // 👈 IMPORTANT
              marginBottom: "10px",
              transition: "0.2s",
            }}
          >
            Forgot password
          </Link>

          {/* login button */}
          <button
            type="submit"
            onMouseEnter={() => setHoverBtn(true)}
            onMouseLeave={() => setHoverBtn(false)}
            style={{
              width: "360px",
              height: "45px",
              backgroundColor: hoverBtn ? "#b20710" : "#e50914",
              color: "white",
              border: "none",
              cursor: "pointer",
              fontWeight: "600",
              display: "block",     // 👈 IMPORTANT
              marginTop: "20px",    // 👈 PUSHES BUTTON DOWN
              transition: "all 0.2s ease",
              transform: hoverBtn ? "translateY(-2px)" : "translateY(0)",
              boxShadow: hoverBtn
                ? "0 10px 20px rgba(0,0,0,0.15)"
                : "none",
            }}
          >
            LOG IN
          </button>
        </form>
      </div>

      {/* RIGHT IMAGE */}
      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
        <img
          src="/bag.png"
          alt="Emergency Bag"
          style={{
            width: "720px",
            transform: "translateX(60px) scale(1.15)",
            filter: "drop-shadow(0 30px 40px rgba(0,0,0,0.25))",
          }}
        />
      </div>
    </div>
  );
}

export default Login;