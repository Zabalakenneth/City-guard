import { Link } from "react-router-dom";

function ForgotPassword() {
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        backgroundColor: "#efefef",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* LEFT SIDE */}
      <div
        style={{
          width: "50%",
          paddingLeft: "120px",
          paddingTop: "80px",
          zIndex: 2,
        }}
      >
        <h1 style={{ fontSize: "54px", fontWeight: "800", marginBottom: "40px" }}>
          CITY GUARD
        </h1>

        <h3 style={{ marginBottom: "20px", letterSpacing: "1px" }}>
          FORGOT PASSWORD
        </h3>

        <input
          type="email"
          placeholder="Email"
          style={inputStyle}
        />

        <input
          type="text"
          placeholder="Verification Code"
          style={inputStyle}
        />

        <input
          type="password"
          placeholder="New Password"
          style={inputStyle}
        />

        <button style={buttonStyle}>
          RESET PASSWORD
        </button>

        <Link to="/" style={backStyle}>
          Back to login
        </Link>
      </div>

      {/* RIGHT IMAGE */}
      <div
        style={{
          width: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2,
        }}
      >
        <img
          src="/bag.png"
          alt="Emergency Bag"
          style={{
            width: "620px",
            filter: "drop-shadow(0 40px 60px rgba(0,0,0,0.25))",
          }}
        />
      </div>

      {/* WAVE BACKGROUND */}
      <div
        style={{
          position: "absolute",
          width: "120%",
          height: "420px",
          background: "#ffffff",
          borderBottomLeftRadius: "60% 100%",
          borderBottomRightRadius: "60% 100%",
          top: "120px",
          left: "-10%",
          zIndex: 1,
        }}
      />

      {/* BOTTOM RED BAR */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          width: "100%",
          height: "70px",
          backgroundColor: "#e50914",
          zIndex: 3,
        }}
      />
    </div>
  );
}

const inputStyle = {
  display: "block",
  width: "360px",
  height: "45px",
  marginBottom: "16px",
  padding: "10px",
  background: "#dcdcdc",
  border: "none",
};

const buttonStyle = {
  width: "360px",
  height: "45px",
  backgroundColor: "#e50914",
  color: "white",
  border: "none",
  fontWeight: "600",
  cursor: "pointer",
  marginTop: "6px",
  transition: "0.2s",
};

const backStyle = {
  display: "block",
  marginTop: "18px",
  fontSize: "13px",
  color: "#444",
  textDecoration: "none",
};

export default ForgotPassword;