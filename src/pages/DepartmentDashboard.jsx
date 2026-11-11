
import { useEffect, useMemo, useState } from "react";
import { getAuth, signOut } from "firebase/auth";
import {
  collection,
  onSnapshot,
  query,
  where
} from "firebase/firestore";
import { db } from "../firebase";
import { useNavigate } from "react-router-dom";

export default function DepartmentDashboard() {
  const auth = getAuth();
  const navigate = useNavigate();

  const department = localStorage.getItem("cityguard_department");
  console.log("Logged-in Department:", department);
  const [reports, setReports] = useState([]);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!department) {
      setLoading(false);
      return;
    }

    const reportsRef = collection(db, "reports");

    const q1 = query(
      reportsRef,
      where("assignedDepartment", "==", department)
    );

    const q2 = query(
      reportsRef,
      where("assignedDepartments", "array-contains", department)
    );

    let singleReports = [];
    let multipleReports = [];
    let loaded1 = false;
    let loaded2 = false;

    const updateReports = () => {
      const combined = new Map();

      [...singleReports, ...multipleReports].forEach((report) => {
        combined.set(report.id, report);
      });

      const data = Array.from(combined.values());

      data.sort((a, b) => {
        const dateA = a.createdAt?.seconds
          ? a.createdAt.seconds
          : 0;
        const dateB = b.createdAt?.seconds
          ? b.createdAt.seconds
          : 0;

        return dateB - dateA;
      });

      setReports(data);

      if (loaded1 && loaded2) {
        setLoading(false);
      }
    };

    const unsubscribe1 = onSnapshot(
      q1,
      (snapshot) => {
        singleReports = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data()
        }));

        loaded1 = true;
        updateReports();
      },
      (error) => {
        console.error("Department query error:", error);
        loaded1 = true;
        updateReports();
      }
    );

    const unsubscribe2 = onSnapshot(
      q2,
      (snapshot) => {
        multipleReports = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data()
        }));

        loaded2 = true;
        updateReports();
      },
      (error) => {
        console.error("Multi-department query error:", error);
        loaded2 = true;
        updateReports();
      }
    );

    return () => {
      unsubscribe1();
      unsubscribe2();
    };
  }, [department]);

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      const category = r.aiCategory || r.type || "Emergency";
      const searchText = search.toLowerCase();

      const matchesSearch =
        category.toLowerCase().includes(searchText) ||
        (r.description || "").toLowerCase().includes(searchText) ||
        (r.barangay || "").toLowerCase().includes(searchText);

      const matchesFilter =
        activeFilter === "All" ||
        (activeFilter === "Dispatched" && r.status === "dispatched") ||
        (activeFilter === "Resolved" && r.status === "resolved") ||
        (activeFilter === "Pending" &&
          (!r.status || r.status === "pending"));

      return matchesSearch && matchesFilter;
    });
  }, [reports, search, activeFilter]);

  const dispatchedCount = reports.filter(
    (r) => r.status === "dispatched"
  ).length;

  const resolvedCount = reports.filter(
    (r) => r.status === "resolved"
  ).length;

  const pendingCount = reports.filter(
  (r) => !r.status || r.status.toLowerCase() === "pending"
).length;

  const formatDate = (value) => {
    if (!value) return "Date unavailable";

    const date = value.seconds
      ? new Date(value.seconds * 1000)
      : value.toDate
      ? value.toDate()
      : new Date(value);

    if (isNaN(date.getTime())) return "Date unavailable";

    return date.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const getStatus = (status) => {
    if (status === "dispatched") return "Dispatched";
    if (status === "resolved") return "Resolved";
    return "Pending";
  };

  const getCategoryIcon = (category) => {
    const icons = {
      Fire: "🔥",
      Flood: "🌊",
      Crime: "🚨",
      Terrorist: "⚠️",
      Accident: "🚑",
      "Medical Emergency": "🏥"
    };

    return icons[category] || "🚨";
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error:", error);
    }

    localStorage.removeItem("cityguard_auth");
    localStorage.removeItem("cityguard_role");
    localStorage.removeItem("cityguard_department");

    navigate("/");
  };

  return (
    <div className="department-app">
      <style>{`
        * {
          box-sizing: border-box;
        }

        .department-app {
          min-height: 100vh;
          display: flex;
          background: #f3f6fb;
          color: #172033;
          font-family: Arial, sans-serif;
        }

        .dept-sidebar {
          width: 250px;
          min-height: 100vh;
          background: #101b32;
          color: white;
          padding: 26px 18px;
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
        }

        .dept-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 5px 8px 30px;
          border-bottom: 1px solid #293650;
        }

        .dept-brand-icon {
          width: 43px;
          height: 43px;
          background: #244fca;
          border-radius: 12px;
          display: grid;
          place-items: center;
          font-size: 23px;
        }

        .dept-brand h2 {
          font-size: 17px;
          margin: 0;
          letter-spacing: 1px;
        }

        .dept-brand small {
          color: #9eacc6;
          font-size: 10px;
        }

        .dept-menu-label {
          color: #8392ae;
          font-size: 10px;
          font-weight: bold;
          letter-spacing: 1.5px;
          margin: 30px 10px 12px;
        }

        .dept-menu-item {
          padding: 13px 14px;
          border-radius: 9px;
          margin-bottom: 7px;
          font-size: 13px;
          color: #c4cde0;
          background: #1b2a48;
        }

        .dept-sidebar-bottom {
          margin-top: auto;
          border-top: 1px solid #293650;
          padding-top: 20px;
        }

        .dept-main {
          flex: 1;
          min-width: 0;
          padding: 30px 36px;
        }

        .dept-topbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 15px;
          margin-bottom: 30px;
        }

        .dept-topbar h1 {
          margin: 0 0 7px;
          font-size: 25px;
          color: #14213b;
        }

        .dept-topbar p {
          margin: 0;
          font-size: 13px;
          color: #8290a6;
        }

        .dept-account {
          display: flex;
          align-items: center;
          gap: 10px;
          background: white;
          border: 1px solid #e7ebf2;
          border-radius: 12px;
          padding: 10px 14px;
        }

        .dept-avatar {
          width: 37px;
          height: 37px;
          background: #e6edff;
          color: #2452c8;
          display: grid;
          place-items: center;
          border-radius: 50%;
          font-weight: bold;
        }

        .dept-account strong {
          font-size: 12px;
          display: block;
        }

        .dept-account small {
          color: #8490a4;
          font-size: 10px;
        }

        .dept-welcome {
          background: linear-gradient(110deg, #1c3d83, #2861d5);
          color: white;
          border-radius: 16px;
          padding: 26px;
          margin-bottom: 24px;
          box-shadow: 0 8px 22px #244fca20;
        }

        .dept-welcome h2 {
          font-size: 21px;
          margin: 0 0 8px;
        }

        .dept-welcome p {
          color: #d7e2ff;
          font-size: 13px;
          margin: 0;
        }

        .dept-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 30px;
        }

        .dept-stat {
          background: white;
          border: 1px solid #e8edf4;
          border-radius: 13px;
          padding: 19px;
          min-width: 0;
        }

        .dept-stat-label {
          font-size: 12px;
          color: #7c899e;
        }

        .dept-stat-value {
          font-size: 27px;
          font-weight: bold;
          margin-top: 12px;
          color: #17243e;
        }

        .dept-stat-icon {
          font-size: 20px;
          margin-bottom: 12px;
        }

        .dept-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 15px;
          margin-bottom: 17px;
        }

        .dept-section-header h2 {
          font-size: 18px;
          margin: 0;
        }

        .dept-search {
          width: 260px;
          max-width: 100%;
          border: 1px solid #dfe5ef;
          background: white;
          border-radius: 9px;
          padding: 11px 13px;
          outline: none;
          font-size: 12px;
        }

        .dept-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 18px;
        }

        .dept-filter {
          border: 1px solid #e0e6ef;
          background: white;
          color: #66748b;
          border-radius: 20px;
          padding: 8px 15px;
          font-size: 11px;
          cursor: pointer;
        }

        .dept-filter.active {
          background: #2454c5;
          color: white;
          border-color: #2454c5;
        }

        .dept-incident {
          background: white;
          border: 1px solid #e8edf4;
          border-radius: 13px;
          padding: 19px;
          margin-bottom: 13px;
          display: flex;
          justify-content: space-between;
          gap: 15px;
        }

        .dept-incident h3 {
          margin: 0 0 9px;
          font-size: 15px;
        }

        .dept-incident p {
          color: #75839a;
          font-size: 12px;
          line-height: 1.6;
          margin: 6px 0;
          overflow-wrap: anywhere;
        }

        .dept-incident-date {
          font-size: 10px !important;
          color: #9aa5b5 !important;
        }

        .dept-status {
          display: inline-block;
          border-radius: 20px;
          padding: 6px 10px;
          font-size: 10px;
          font-weight: bold;
          white-space: nowrap;
          height: fit-content;
        }

        .status-dispatched {
          color: #1c58b5;
          background: #e7f0ff;
        }

        .status-resolved {
          color: #16804c;
          background: #e3f7ed;
        }

        .status-pending {
          color: #a66b12;
          background: #fff3d9;
        }

        .dept-empty {
          background: white;
          border: 1px dashed #d5deea;
          padding: 45px 15px;
          text-align: center;
          border-radius: 13px;
          color: #8b98aa;
          font-size: 13px;
        }

        .dept-logout {
          width: 100%;
          border: 1px solid #44516a;
          background: transparent;
          color: #e3e9f5;
          padding: 12px;
          border-radius: 9px;
          cursor: pointer;
          font-size: 12px;
        }

        .dept-logout:hover {
          background: #293b5d;
        }

        @media (max-width: 1000px) {
          .dept-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 700px) {
          .department-app {
            display: block;
          }

          .dept-sidebar {
            width: 100%;
            min-height: auto;
            padding: 15px;
          }

          .dept-brand {
            padding-bottom: 12px;
          }

          .dept-menu-label,
          .dept-menu-item {
            display: none;
          }

          .dept-sidebar-bottom {
            border: none;
            padding: 10px 0 0;
          }

          .dept-main {
            padding: 22px 15px;
          }

          .dept-topbar {
            align-items: flex-start;
            flex-direction: column;
          }

          .dept-topbar h1 {
            font-size: 21px;
          }

          .dept-section-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .dept-search {
            width: 100%;
          }

          .dept-incident {
            flex-direction: column;
          }

          .dept-status {
            align-self: flex-start;
          }
        }

        @media (max-width: 380px) {
          .dept-stats {
            grid-template-columns: 1fr 1fr;
            gap: 9px;
          }

          .dept-stat {
            padding: 13px;
          }

          .dept-stat-value {
            font-size: 22px;
          }
        }
      `}</style>

      <aside className="dept-sidebar">
        <div className="dept-brand">
          <div className="dept-brand-icon">🚨</div>
          <div>
            <h2>CITYGUARD</h2>
            <small>COMMAND CENTER</small>
          </div>
        </div>

        <div className="dept-menu-label">MAIN MENU</div>
        <div className="dept-menu-item">▦ &nbsp; Dashboard</div>
        <div className="dept-menu-item">🚨 &nbsp; Assigned Incidents</div>

        <div className="dept-sidebar-bottom">
          <button className="dept-logout" onClick={handleLogout}>
            ↪ &nbsp; Logout
          </button>
        </div>
      </aside>

      <main className="dept-main">
        <header className="dept-topbar">
          <div>
            <h1>Department Dashboard</h1>
            <p>Monitor and manage your assigned emergency incidents.</p>
          </div>

          <div className="dept-account">
            <div className="dept-avatar">
              {(department || "D").charAt(0)}
            </div>
            <div>
              <strong>{department || "Department"}</strong>
              <small>Department Account</small>
            </div>
          </div>
        </header>

        <section className="dept-welcome">
          <h2>Welcome, {department || "Department"}!</h2>
          <p>
            CityGuard Emergency Response Management System
          </p>
        </section>

        <section className="dept-stats">
          <div className="dept-stat">
            <div className="dept-stat-icon">📋</div>
            <div className="dept-stat-label">Total Assigned</div>
            <div className="dept-stat-value">{reports.length}</div>
          </div>

          <div className="dept-stat">
            <div className="dept-stat-icon">🚑</div>
            <div className="dept-stat-label">Dispatched</div>
            <div className="dept-stat-value">{dispatchedCount}</div>
          </div>

          <div className="dept-stat">
            <div className="dept-stat-icon">⏳</div>
            <div className="dept-stat-label">Pending</div>
            <div className="dept-stat-value">{pendingCount}</div>
          </div>

          <div className="dept-stat">
            <div className="dept-stat-icon">✅</div>
            <div className="dept-stat-label">Resolved</div>
            <div className="dept-stat-value">{resolvedCount}</div>
          </div>
        </section>

        <section>
          <div className="dept-section-header">
            <h2>Assigned Incidents</h2>

            <input
              className="dept-search"
              type="text"
              placeholder="Search incident..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="dept-filters">
            {["All", "Dispatched", "Pending", "Resolved"].map((filter) => (
              <button
                key={filter}
                className={`dept-filter ${
                  activeFilter === filter ? "active" : ""
                }`}
                onClick={() => setActiveFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="dept-empty">Loading assigned incidents...</div>
          ) : filteredReports.length === 0 ? (
            <div className="dept-empty">
              <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
              <strong>No incidents found</strong>
              <p>Assigned incidents will appear here.</p>
            </div>
          ) : (
            filteredReports.map((r) => {
              const category = r.aiCategory || r.type || "Emergency";
              const statusClass =
                r.status === "dispatched"
                  ? "status-dispatched"
                  : r.status === "resolved"
                  ? "status-resolved"
                  : "status-pending";

              return (
                <article className="dept-incident" key={r.id}>
                  <div>
                    <h3>
                      {getCategoryIcon(category)} &nbsp; {category}
                    </h3>

                    <p>
                      <strong>Description:</strong>{" "}
                      {r.description || "No description provided"}
                    </p>

                    <p>
                      <strong>Location:</strong>{" "}
                      {r.barangay || "Location from map"}
                    </p>

                    <p className="dept-incident-date">
                      Reported: {formatDate(r.createdAt)}
                    </p>
                  </div>

                  <span className={`dept-status ${statusClass}`}>
                    {getStatus(r.status)}
                  </span>
                </article>
              );
            })
          )}
        </section>
      </main>
    </div>
  );
}
