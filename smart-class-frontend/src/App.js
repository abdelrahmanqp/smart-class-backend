import React, { useCallback, useEffect, useRef, useState } from "react";
import { Hands } from "@mediapipe/hands";
import { FaceMesh } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";
import { drawLandmarks } from "@mediapipe/drawing_utils";

const API = "http://localhost:5000";
const SUBJECTS = ["AI", "Database", "Software"];

function usePollNotifications(role, enabled, onToast) {
  const [items, setItems] = useState([]);
  const lastSeenIdRef = useRef(0);

  useEffect(() => {
    lastSeenIdRef.current = 0;
    setItems([]);
  }, [role, enabled]);

  useEffect(() => {
    if (!enabled || !role) return;

    let alive = true;

    const load = async () => {
      try {
        const res = await fetch(`${API}/notifications/${role}`);
        const data = await res.json();
        if (!alive) return;

        const list = Array.isArray(data) ? data : [];
        setItems(list);

        const newestId = list[0]?.id || 0;
        if (lastSeenIdRef.current === 0) {
          lastSeenIdRef.current = newestId;
          return;
        }

        const newItems = list.filter((n) => n.id > lastSeenIdRef.current);
        if (newItems.length) {
          newItems
            .slice()
            .reverse()
            .forEach((n) => onToast(`${n.title}: ${n.body}`));
          lastSeenIdRef.current = newestId;
        } else if (newestId > lastSeenIdRef.current) {
          lastSeenIdRef.current = newestId;
        }
      } catch { }
    };

    load();
    const t = setInterval(load, 5000);

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [role, enabled, onToast]);

  return items;
}

export default function App() {
  const [role, setRole] = useState("student");
  const [id, setId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [user, setUser] = useState(null);
  const [subject, setSubject] = useState("AI");
  const [currentLiveSession, setCurrentLiveSession] = useState(null);
  const [recordedSessions, setRecordedSessions] = useState([]);
  const [sidebarNotifications, setSidebarNotifications] = useState([]);
  const [sessionStudents, setSessionStudents] = useState([]);
  const [boardEvents, setBoardEvents] = useState([]);
  const [studentReports, setStudentReports] = useState([]);
  const [parentStats, setParentStats] = useState(null);

  const [file, setFile] = useState(null);
  const [activeView, setActiveView] = useState("recorded");
  const [welcome, setWelcome] = useState(false);
  const [welcomeName, setWelcomeName] = useState("");

  const [liveRoom, setLiveRoom] = useState({ open: false, type: null, session: null });
  const [attendanceGate, setAttendanceGate] = useState({ open: false, session: null });
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [attendanceData, setAttendanceData] = useState(null);

  const [toasts, setToasts] = useState([]);
  const lastToastRef = useRef({ text: "", time: 0 });
  const cleanupRef = useRef(null);

  const pushToast = useCallback((text) => {
    const now = Date.now();
    if (lastToastRef.current.text === text && now - lastToastRef.current.time < 1800) return;

    lastToastRef.current = { text, time: now };
    const toastId = now + Math.random();
    setToasts((prev) => [...prev, { id: toastId, text }].slice(-4));

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 5000);
  }, []);

  usePollNotifications(role, !!user, pushToast);

  const loadSidebarNotifications = useCallback(async () => {
    try {
      const res = await fetch(`${API}/notifications/${role}`);
      const data = await res.json();
      setSidebarNotifications(
        Array.isArray(data) ? data.map((x) => ({ id: x.id, text: `${x.title}: ${x.body}` })) : []
      );
    } catch {
      setSidebarNotifications([]);
    }
  }, [role]);

  const loadCurrentSubjectData = useCallback(
    async (sub = subject) => {
      try {
        const [liveRes, sessionsRes, studentsRes, boardRes] = await Promise.all([
          fetch(`${API}/live-session/${sub}`),
          fetch(`${API}/sessions/${sub}`),
          fetch(`${API}/session-students/${sub}`),
          fetch(`${API}/board-events/${sub}`)
        ]);

        const liveData = await liveRes.json();
        const sessionsData = await sessionsRes.json();
        const studentsData = await studentsRes.json();
        const boardData = await boardRes.json();

        setCurrentLiveSession(liveData && liveData.pdf ? liveData : null);
        setRecordedSessions(Array.isArray(sessionsData) ? sessionsData : []);
        setSessionStudents(Array.isArray(studentsData) ? studentsData : []);
        setBoardEvents(Array.isArray(boardData) ? boardData : []);
      } catch {
        setCurrentLiveSession(null);
        setRecordedSessions([]);
        setSessionStudents([]);
        setBoardEvents([]);
      }
    },
    [subject]
  );

  const loadParentData = useCallback(async () => {
    if (!user || role !== "parent" || !user.student_id) return;

    try {
      const [statsRes, reportsRes] = await Promise.all([
        fetch(`${API}/parent-stats/${user.student_id}`),
        fetch(`${API}/student-reports/${user.student_id}`)
      ]);

      const statsData = await statsRes.json();
      const reportsData = await reportsRes.json();

      setParentStats(statsData || null);
      setStudentReports(Array.isArray(reportsData) ? reportsData : []);
    } catch {
      setParentStats(null);
      setStudentReports([]);
    }
  }, [role, user]);

  useEffect(() => {
    if (!user) return;

    loadSidebarNotifications();
    loadCurrentSubjectData();

    if (role === "parent") loadParentData();

    const t = setInterval(() => {
      loadSidebarNotifications();
      loadCurrentSubjectData();
      if (role === "parent") loadParentData();
    }, 4000);

    return () => clearInterval(t);
  }, [user, role, subject, loadSidebarNotifications, loadCurrentSubjectData, loadParentData]);

  const login = async (e) => {
    e.preventDefault();

    const url =
      role === "teacher"
        ? `${API}/login?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&role=${role}`
        : `${API}/login?id=${encodeURIComponent(id)}&password=${encodeURIComponent(password)}&role=${role}`;

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (data.user) {
        const display = data.user.name || data.user.student_name || "User";
        setWelcomeName(display);
        setWelcome(true);

        window.setTimeout(() => {
          setUser(data.user);
          setWelcome(false);
          pushToast(`Welcome, ${display}`);
          loadSidebarNotifications();
        }, 900);
      } else {
        pushToast("Login failed");
      }
    } catch {
      pushToast("Server error");
    }
  };

  const refreshLiveSession = useCallback(async (sub = subject) => {
    try {
      const res = await fetch(`${API}/live-session/${sub}`);
      const live = await res.json();
      const session = live && live.pdf ? live : null;
      setCurrentLiveSession(session);
      return session;
    } catch {
      setCurrentLiveSession(null);
      return null;
    }
  }, [subject]);

  const startTeacherSession = async () => {
    if (!file) {
      pushToast("Upload a PDF first");
      return;
    }

    const form = new FormData();
    form.append("pdf", file);
    form.append("doctor", user.name);
    form.append("subject", subject);

    try {
      const res = await fetch(`${API}/start-session`, {
        method: "POST",
        body: form
      });

      const data = await res.json();

      if (data.ok && data.session) {
        setCurrentLiveSession(data.session);
        setLiveRoom({ open: true, type: "teacher", session: data.session });
        pushToast(`Live session started: ${subject}`);
        loadSidebarNotifications();
      } else {
        pushToast(data.error || "Could not start session");
      }
    } catch {
      pushToast("Server error");
    }
  };

  const endTeacherSession = async (recordingBlob, sessionSubject = currentLiveSession?.subject || subject) => {
    try {
      const form = new FormData();
      form.append("subject", sessionSubject);

      if (recordingBlob) {
        form.append("recording", recordingBlob, "lecture.webm");
      }

      const res = await fetch(`${API}/end-session`, {
        method: "POST",
        body: form
      });

      const data = await res.json();

      if (data.ok) {
        setLiveRoom({ open: false, type: null, session: null });
        setCurrentLiveSession(null);
        pushToast("Session saved");
        loadCurrentSubjectData(sessionSubject);
        loadSidebarNotifications();
        return true;
      }

      pushToast(data.error || "Could not end session");
      return false;
    } catch {
      pushToast("Server error");
      return false;
    }
  };

  const openAttendanceGate = async () => {
    const live = await refreshLiveSession(subject);
    if (!live) {
      pushToast("No live session right now");
      return;
    }
    setAttendanceGate({ open: true, session: live });
  };

  const confirmAttendanceAndJoin = async () => {
    if (!attendanceGate.session || !user) return false;

    try {
      const res = await fetch(`${API}/attendance/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: Number(user.id),
          subject: attendanceGate.session.subject,
          face_verified: true
        })
      });

      const data = await res.json();

      if (data.ok) {
        setAttendanceData(data);
        setAttendanceGate({ open: false, session: null });
        setLiveRoom({ open: true, type: "student", session: attendanceGate.session });
        pushToast(`Attendance recorded for ${data.student_name}`);
        loadSidebarNotifications();
        return true;
      }

      pushToast(data.error || "Attendance failed");
      return false;
    } catch {
      pushToast("Server error");
      return false;
    }
  };

  const sendHeartbeat = async ({ focus_percent, emotion }) => {
    if (!user || !liveRoom.session) return;

    try {
      await fetch(`${API}/attendance/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: Number(user.id),
          subject: liveRoom.session.subject,
          focus_percent,
          emotion
        })
      });

      setAttendanceData((prev) =>
        prev
          ? {
            ...prev,
            focus_percent,
            emotion
          }
          : prev
      );
    } catch { }
  };

  const leaveSession = async (reason = "disconnect") => {
    if (!user || !liveRoom.session) return false;

    try {
      cleanupRef.current?.();

      await fetch(`${API}/attendance/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: Number(user.id),
          subject: liveRoom.session.subject,
          focus_percent: attendanceData?.focus_percent || 0,
          emotion: attendanceData?.emotion || "unknown",
          reason
        })
      });

      setLiveRoom({ open: false, type: null, session: null });
      setAttendanceData(null);
      setDisconnectConfirm(false);
      pushToast("Session exit saved");
      loadSidebarNotifications();
      return true;
    } catch {
      pushToast("Could not close session");
      return false;
    }
  };

  const logout = async () => {
    try {
      if (liveRoom.open && liveRoom.type === "student") {
        await leaveSession("disconnect");
      } else if (liveRoom.open && liveRoom.type === "teacher") {
        await endTeacherSession(null, liveRoom.session?.subject || subject);
      }
    } catch { }

    cleanupRef.current?.();
    cleanupRef.current = null;

    setUser(null);
    setAttendanceData(null);
    setLiveRoom({ open: false, type: null, session: null });
    setAttendanceGate({ open: false, session: null });
    setDisconnectConfirm(false);
    setParentStats(null);
    setStudentReports([]);
    pushToast("Logged out");
  };

  const openTeacherBoard = async () => {
    const live = await refreshLiveSession(subject);
    if (!live) {
      pushToast("No live session");
      return;
    }
    setLiveRoom({ open: true, type: "teacher", session: live });
  };

  if (welcome) {
    return (
      <>
        <GlobalStyles />
        <WelcomeScreen name={welcomeName} />
        <ToastStack items={toasts} />
      </>
    );
  }

  if (!user) {
    return (
      <>
        <GlobalStyles />
        <AuthScreen
          role={role}
          setRole={setRole}
          id={id}
          setId={setId}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          onLogin={login}
        />
        <ToastStack items={toasts} />
      </>
    );
  }

  if (attendanceGate.open) {
    return (
      <>
        <GlobalStyles />
        <AttendanceGateModal
          session={attendanceGate.session}
          onCancel={() => setAttendanceGate({ open: false, session: null })}
          onComplete={confirmAttendanceAndJoin}
          onToast={pushToast}
        />
        <ToastStack items={toasts} />
      </>
    );
  }

  if (liveRoom.open && liveRoom.session) {
    return (
      <>
        <GlobalStyles />
        <LiveRoom
          type={liveRoom.type}
          session={liveRoom.session}
          studentId={user.id}
          onTeacherEnd={endTeacherSession}
          onStudentDisconnect={() => setDisconnectConfirm(true)}
          onHeartbeat={sendHeartbeat}
          onEmergency={(reason) => leaveSession(reason)}
          onToast={pushToast}
          onCleanup={(fn) => {
            cleanupRef.current = fn;
          }}
        />
        {disconnectConfirm && (
          <ConfirmModal
            title="Disconnect from session"
            body="Do you really want to leave the session now?"
            onCancel={() => setDisconnectConfirm(false)}
            onConfirm={() => leaveSession("disconnect")}
          />
        )}
        <ToastStack items={toasts} />
      </>
    );
  }

  return (
    <>
      <GlobalStyles />
      <DashboardScreen
        role={role}
        user={user}
        subject={subject}
        setSubject={(s) => {
          setSubject(s);
          pushToast(`Subject changed to ${s}`);
        }}
        currentLiveSession={currentLiveSession}
        recordedSessions={recordedSessions}
        sidebarNotifications={sidebarNotifications}
        parentStats={parentStats}
        studentReports={studentReports}
        sessionStudents={sessionStudents}
        boardEvents={boardEvents}
        file={file}
        setFile={setFile}
        activeView={activeView}
        setActiveView={setActiveView}
        onTeacherStartSession={startTeacherSession}
        onOpenTeacherBoard={openTeacherBoard}
        onJoinLiveSession={openAttendanceGate}
        onLogout={logout}
      />
      <ToastStack items={toasts} />
    </>
  );
}

function AuthScreen({ role, setRole, id, setId, email, setEmail, password, setPassword, onLogin }) {
  return (
    <div className="auth-shell">
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />

      <div className="auth-grid">
        <section className="hero-panel glass-card fade-in">
          <div>
            <div className="eyebrow">Smart Class System</div>
            <h1 className="hero-title">
              Live sessions, attendance, smart board, PDFs, reports, and notifications.
            </h1>
            <p className="hero-copy">
              Doctor, student, and parent each get a clean workspace with the right tools only.
            </p>
          </div>

          <div className="feature-grid">
            <div className="feature-card">
              <h3>Doctor live board</h3>
              <p>Hand tracking writes directly on the board.</p>
            </div>
            <div className="feature-card">
              <h3>Student attendance</h3>
              <p>Face scan before joining the class.</p>
            </div>
            <div className="feature-card">
              <h3>Parent statistics</h3>
              <p>Attendance, focus, emotion, and reports.</p>
            </div>
            <div className="feature-card">
              <h3>Notifications</h3>
              <p>Session start, join, leave, and save alerts.</p>
            </div>
          </div>
        </section>

        <section className="auth-card glass-card fade-in">
          <form onSubmit={onLogin}>
            <div className="panel-head">
              <div>
                <div className="section-kicker">Login</div>
                <h2>Enter the workspace</h2>
              </div>
              <div className="status-pill">Secure access</div>
            </div>

            <div className="subject-row auth-role-row">
              <button
                type="button"
                className={`mini-chip ${role === "student" ? "active" : ""}`}
                onClick={() => setRole("student")}
              >
                Student
              </button>
              <button
                type="button"
                className={`mini-chip ${role === "parent" ? "active" : ""}`}
                onClick={() => setRole("parent")}
              >
                Parent
              </button>
              <button
                type="button"
                className={`mini-chip ${role === "teacher" ? "active" : ""}`}
                onClick={() => setRole("teacher")}
              >
                Doctor
              </button>
            </div>

            {role !== "teacher" ? (
              <input className="login-input" placeholder="ID" value={id} onChange={(e) => setId(e.target.value)} />
            ) : (
              <input className="login-input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            )}

            <input
              className="login-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button className="control-btn" type="submit">
              Login
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function DashboardScreen({
  role,
  user,
  subject,
  setSubject,
  currentLiveSession,
  recordedSessions,
  sidebarNotifications,
  parentStats,
  studentReports,
  sessionStudents,
  boardEvents,
  file,
  setFile,
  activeView,
  setActiveView,
  onTeacherStartSession,
  onOpenTeacherBoard,
  onJoinLiveSession,
  onLogout
}) {
  const displayName = user?.name || user?.student_name || "User";

  return (
    <div className="dashboard-shell">
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />

      <div className="topbar">
        <div>
          <div className="eyebrow">Smart Class System</div>
          <h1>{displayName}</h1>
          <p>
            {role === "teacher"
              ? "Doctor dashboard"
              : role === "student"
                ? "Student dashboard"
                : "Parent dashboard"}{" "}
            · {role === "parent" ? "Student statistics" : subject}
          </p>
        </div>

        <button className="control-btn danger small-logout" onClick={onLogout}>
          Logout
        </button>
      </div>

      <div className="dashboard-grid">
        <main className="main-panel glass-card fade-in">
          {role !== "parent" && (
            <>
              <div className="panel-head">
                <div>
                  <div className="section-kicker">Subjects</div>
                  <h2>Choose a subject</h2>
                </div>
                <div className="status-pill">{currentLiveSession ? "Live session available" : "No live session"}</div>
              </div>

              <div className="subject-row">
                {SUBJECTS.map((sub) => (
                  <button
                    key={sub}
                    className={`subject-chip ${subject === sub ? "active" : ""}`}
                    onClick={() => setSubject(sub)}
                  >
                    <span>{sub}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {role === "teacher" && (
            <section className="soft-panel">
              <div className="panel-head">
                <div>
                  <div className="section-kicker">Session control</div>
                  <h3>Upload PDF and start live board</h3>
                </div>
              </div>

              <div className="field-stack">
                <label className="field-label">Lecture PDF</label>
                <input
                  className="file-input"
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setFile(e.target.files[0] || null)}
                />
              </div>

              <button className="control-btn" onClick={onTeacherStartSession}>
                Start Session
              </button>

              {currentLiveSession && (
                <button className="control-btn secondary" onClick={onOpenTeacherBoard} style={{ marginTop: 12 }}>
                  Open Live Board
                </button>
              )}

              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">Subject</div>
                  <div className="stat-value">{subject}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Recorded sessions</div>
                  <div className="stat-value">{recordedSessions.length}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Live status</div>
                  <div className="stat-value">{currentLiveSession ? "On" : "Off"}</div>
                </div>
              </div>

              <div className="soft-panel inner-panel">
                <div className="panel-head">
                  <div>
                    <div className="section-kicker">Recent sessions</div>
                    <h3>{subject}</h3>
                  </div>
                </div>

                <div className="list-grid">
                  {recordedSessions.length === 0 ? (
                    <div className="empty-state">No recorded sessions for this subject yet.</div>
                  ) : (
                    recordedSessions.map((s) => (
                      <div key={s.id} className="list-card">
                        <div className="list-title">Session #{s.id}</div>
                        <div className="list-meta">Doctor: {s.doctor}</div>
                        <div className="list-meta">Started: {s.started_at || "-"}</div>
                        <div className="list-action" onClick={() => window.open(s.pdf, "_blank")}>
                          Open PDF
                        </div>
                        {s.recording && (
                          <div className="list-action" onClick={() => window.open(s.recording, "_blank")}>
                            Open Video
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="soft-panel inner-panel">
                <div className="panel-head">
                  <div>
                    <div className="section-kicker">Students in session</div>
                    <h3>Current roster</h3>
                  </div>
                </div>

                <div className="list-grid">
                  {sessionStudents.length === 0 ? (
                    <div className="empty-state">No student reports yet.</div>
                  ) : (
                    sessionStudents.map((row) => (
                      <div key={row.id} className="list-card">
                        <div className="list-title">Student #{row.student_id}</div>
                        <div className="list-meta">Subject: {row.subject}</div>
                        <div className="list-meta">Doctor: {row.doctor || "-"}</div>
                        <div className="list-meta">Focus: {row.focus_percent}%</div>
                        <div className="list-meta">Emotion: {row.emotion}</div>
                        <div className="list-meta">Status: {row.status}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="soft-panel inner-panel">
                <div className="panel-head">
                  <div>
                    <div className="section-kicker">Board log</div>
                    <h3>{subject}</h3>
                  </div>
                </div>

                <div className="list-grid">
                  {boardEvents.length === 0 ? (
                    <div className="empty-state">No board actions yet.</div>
                  ) : (
                    boardEvents.map((ev) => (
                      <div key={ev.id} className="list-card">
                        <div className="list-title">{ev.action}</div>
                        <div className="list-meta">Color: {ev.color}</div>
                        <div className="list-meta">At: {ev.created_at || "-"}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          )}

          {role === "student" && (
            <section className="soft-panel">
              <div className="panel-head">
                <div>
                  <div className="section-kicker">Subject workspace</div>
                  <h3>{subject}</h3>
                </div>
                <div className="status-pill">{currentLiveSession ? "Live session available" : "No live session"}</div>
              </div>

              <div className="student-cta-row">
                {currentLiveSession ? (
                  <button className="control-btn" onClick={onJoinLiveSession}>
                    Join Live Session
                  </button>
                ) : (
                  <div className="empty-state">No doctor is live right now.</div>
                )}
              </div>

              <div className="tab-row">
                <button
                  className={`tab-btn ${activeView === "recorded" ? "active" : ""}`}
                  onClick={() => setActiveView("recorded")}
                >
                  Recorded Sessions
                </button>
                <button
                  className={`tab-btn ${activeView === "pdfs" ? "active" : ""}`}
                  onClick={() => setActiveView("pdfs")}
                >
                  PDFs
                </button>
              </div>

              <div className="tab-panel">
                {activeView === "recorded" && (
                  <div className="list-grid">
                    {recordedSessions.length === 0 ? (
                      <div className="empty-state">No recorded sessions for this subject yet.</div>
                    ) : (
                      recordedSessions.map((s) => (
                        <div key={s.id} className="list-card">
                          <div className="list-title">Session #{s.id}</div>
                          <div className="list-meta">Doctor: {s.doctor}</div>
                          <div className="list-meta">Subject: {s.subject}</div>
                          {s.recording && (
                            <div className="list-action" onClick={() => window.open(s.recording, "_blank")}>
                              Open Video
                            </div>
                          )}
                          <div className="list-action" onClick={() => window.open(s.pdf, "_blank")}>
                            Open PDF
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {activeView === "pdfs" && (
                  <div className="list-grid">
                    {recordedSessions.length === 0 ? (
                      <div className="empty-state">No PDFs for this subject yet.</div>
                    ) : (
                      recordedSessions.map((s) => (
                        <div key={s.id} className="list-card">
                          <div className="list-title">PDF for session #{s.id}</div>
                          <div className="list-meta">Doctor: {s.doctor}</div>
                          <div className="list-action" onClick={() => window.open(s.pdf, "_blank")}>
                            Open PDF
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {role === "parent" && (
            <section className="soft-panel">
              <div className="panel-head">
                <div>
                  <div className="section-kicker">Student statistics</div>
                  <h3>{parentStats?.studentName || user.student_name}</h3>
                </div>
                <div className="status-pill">{parentStats?.statusText || "Loading stats"}</div>
              </div>

              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">Attendance</div>
                  <div className="stat-value">{parentStats ? `${parentStats.attendancePercent}%` : "0%"}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Present records</div>
                  <div className="stat-value">{parentStats ? parentStats.presentCount : 0}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Total records</div>
                  <div className="stat-value">{parentStats ? parentStats.totalRecords : 0}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Average focus</div>
                  <div className="stat-value">{parentStats ? `${parentStats.averageFocus || 0}%` : "0%"}</div>
                </div>
              </div>

              <div className="soft-panel inner-panel">
                <div className="panel-head">
                  <div>
                    <div className="section-kicker">Latest report</div>
                    <h3>{parentStats?.studentName || "Student"}</h3>
                  </div>
                </div>

                <div className="list-grid">
                  <div className="list-card">
                    <div className="list-title">{parentStats?.latestReport?.subject || "No data yet"}</div>
                    <div className="list-meta">Doctor: {parentStats?.latestReport?.doctor || "-"}</div>
                    <div className="list-meta">Check-in: {parentStats?.latestReport?.check_in_time || "-"}</div>
                    <div className="list-meta">Check-out: {parentStats?.latestReport?.check_out_time || "-"}</div>
                    <div className="list-meta">Focus: {parentStats?.latestReport?.focus_percent ?? 0}%</div>
                    <div className="list-meta">Emotion: {parentStats?.latestReport?.emotion || "-"}</div>
                    <div className="list-meta">Exit reason: {parentStats?.latestReport?.exit_reason || "N/A"}</div>
                  </div>
                </div>
              </div>

              <div className="soft-panel inner-panel">
                <div className="panel-head">
                  <div>
                    <div className="section-kicker">Full reports</div>
                    <h3>Attendance history</h3>
                  </div>
                </div>

                <div className="list-grid">
                  {studentReports.length === 0 ? (
                    <div className="empty-state">No reports yet.</div>
                  ) : (
                    studentReports.map((r) => (
                      <div key={r.id} className="list-card">
                        <div className="list-title">{r.subject || "Unknown subject"}</div>
                        <div className="list-meta">Doctor: {r.doctor || "-"}</div>
                        <div className="list-meta">Check-in: {r.check_in_time || "-"}</div>
                        <div className="list-meta">Check-out: {r.check_out_time || "-"}</div>
                        <div className="list-meta">Focus: {r.focus_percent ?? 0}%</div>
                        <div className="list-meta">Emotion: {r.emotion || "-"}</div>
                        <div className="list-meta">Status: {r.status || "-"}</div>
                        <div className="list-meta">Exit reason: {r.exit_reason || "N/A"}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          )}
        </main>

        <aside className="sidebar-panel glass-card fade-in">
          <div className="sidebar-section">
            <h4>Menu</h4>
            <div className="sidebar-item active">
              <span>Current subject</span>
              <strong>{role === "parent" ? "Statistics" : subject}</strong>
            </div>
            <div className="sidebar-item">
              <span>Current live status</span>
              <strong>{currentLiveSession ? "Available" : "None"}</strong>
            </div>
            <div className="sidebar-item">
              <span>Recorded sessions</span>
              <strong>{recordedSessions.length}</strong>
            </div>
          </div>

          <div className="sidebar-section">
            <h4>Notifications</h4>
            <div className="sidebar-list">
              {sidebarNotifications.length === 0 ? (
                <div className="empty-state">No notifications yet.</div>
              ) : (
                sidebarNotifications.map((item) => (
                  <div key={item.id} className="notification-item">
                    {item.text}
                  </div>
                ))
              )}
            </div>
          </div>

          {role !== "parent" && (
            <div className="sidebar-section">
              <h4>Subjects</h4>
              {SUBJECTS.map((sub) => (
                <div
                  key={sub}
                  className={`sidebar-item ${subject === sub ? "active" : ""}`}
                  onClick={() => setSubject(sub)}
                >
                  <span>{sub}</span>
                  <strong>{subject === sub ? "Open" : ""}</strong>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function LiveRoom({ type, session, studentId, onTeacherEnd, onStudentDisconnect, onHeartbeat, onEmergency, onToast, onCleanup }) {
  return type === "teacher" ? (
    <TeacherRoom session={session} onEnd={onTeacherEnd} onToast={onToast} onCleanup={onCleanup} />
  ) : (
    <StudentRoom
      session={session}
      studentId={studentId}
      onDisconnect={onStudentDisconnect}
      onHeartbeat={onHeartbeat}
      onEmergency={onEmergency}
      onToast={onToast}
      onCleanup={onCleanup}
    />
  );
}

function TeacherRoom({ session, onEnd, onToast, onCleanup }) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const boardRef = useRef(null);

  const streamRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const recorderRef = useRef(null);
  const recorderStreamRef = useRef(null);
  const chunksRef = useRef([]);

  const lastPointRef = useRef(null);
  const selectedToolRef = useRef(null);
  const gestureLockRef = useRef({ key: null, since: 0 });
  const toastLockRef = useRef({ text: "", at: 0 });
  const handModeRef = useRef(true);

  const [selectedTool, setSelectedTool] = useState(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [strokes, setStrokes] = useState([]);
  const [handMode, setHandMode] = useState(true);

  useEffect(() => {
    handModeRef.current = handMode;
  }, [handMode]);

  useEffect(() => {
    let alive = true;

    const sync = async () => {
      try {
        const res = await fetch(`${API}/board-state/${session.subject}`);
        const data = await res.json();
        if (alive) setStrokes(Array.isArray(data) ? data : []);
      } catch { }
    };

    sync();
    const t = setInterval(sync, 600);

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [session.subject]);

  useEffect(() => {
    const canvas = boardRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    strokes.forEach((s) => {
      if (!s) return;
      ctx.beginPath();
      ctx.strokeStyle = s.color || "white";
      ctx.lineWidth = s.width || 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
      ctx.stroke();
      ctx.closePath();
    });
  }, [strokes]);

  useEffect(() => {
    startCamera();
    startRecording();

    onCleanup(() => {
      stopRecording(false);
      stopCamera();
    });

    return () => {
      onCleanup(null);
      stopRecording(false);
      stopCamera();
    };
  }, []);

  const showToolToast = (text) => {
    const now = Date.now();
    if (toastLockRef.current.text === text && now - toastLockRef.current.at < 1800) return;
    toastLockRef.current = { text, at: now };
    onToast(text);
  };

  const selectTool = (nextTool, key, label) => {
    const now = Date.now();

    if (gestureLockRef.current.key !== key) {
      gestureLockRef.current = { key, since: now };
      return;
    }

    if (now - gestureLockRef.current.since < 500) return;

    if (selectedToolRef.current !== nextTool) {
      selectedToolRef.current = nextTool;
      setSelectedTool(nextTool);
      showToolToast(label);
    }

    lastPointRef.current = null;
  };

  const clearBoard = async () => {
    setStrokes([]);
    lastPointRef.current = null;

    try {
      await fetch(`${API}/board-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: session.subject,
          teacher: session.doctor,
          action: "clear",
          color: "white",
          stroke: null
        })
      });
    } catch { }
  };

  const sendStroke = async (stroke, action = "draw") => {
    setStrokes((prev) => [...prev, stroke]);

    try {
      await fetch(`${API}/board-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: session.subject,
          teacher: session.doctor,
          action,
          color: stroke.color,
          stroke
        })
      });
    } catch { }
  };

  const countFingers = (lm, handednessLabel) => {
    const thumbTip = lm[4];
    const thumbIp = lm[3];
    const indexTip = lm[8];
    const indexPip = lm[6];
    const middleTip = lm[12];
    const middlePip = lm[10];
    const ringTip = lm[16];
    const ringPip = lm[14];
    const pinkyTip = lm[20];
    const pinkyPip = lm[18];

    const thumbOpen =
      handednessLabel === "Left"
        ? thumbTip.x > thumbIp.x + 0.02
        : thumbTip.x < thumbIp.x - 0.02;

    const indexOpen = indexTip.y < indexPip.y - 0.02;
    const middleOpen = middleTip.y < middlePip.y - 0.02;
    const ringOpen = ringTip.y < ringPip.y - 0.02;
    const pinkyOpen = pinkyTip.y < pinkyPip.y - 0.02;

    return { thumbOpen, indexOpen, middleOpen, ringOpen, pinkyOpen };
  };

  const stopCamera = () => {
    if (cameraRef.current) {
      try {
        cameraRef.current.stop();
      } catch { }
      cameraRef.current = null;
    }

    if (handsRef.current) {
      try {
        handsRef.current.close?.();
      } catch { }
      handsRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  };

  const startRecording = () => {
    const canvas = boardRef.current;
    if (!canvas?.captureStream || typeof MediaRecorder === "undefined") {
      onToast("Lecture recording unavailable in this browser");
      return;
    }

    try {
      const stream = canvas.captureStream(30);
      recorderStreamRef.current = stream;
      chunksRef.current = [];

      const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
      const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorderRef.current = recorder;
      recorder.start();
      onToast("Lecture recording started");
    } catch {
      onToast("Lecture recording unavailable in this browser");
    }
  };

  const stopRecording = (silent = true) =>
    new Promise((resolve) => {
      const rec = recorderRef.current;

      if (!rec || rec.state === "inactive") {
        if (recorderStreamRef.current) {
          recorderStreamRef.current.getTracks().forEach((t) => t.stop());
          recorderStreamRef.current = null;
        }
        resolve(null);
        return;
      }

      rec.onstop = () => {
        const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type: rec.mimeType || "video/webm" }) : null;

        if (recorderStreamRef.current) {
          recorderStreamRef.current.getTracks().forEach((t) => t.stop());
          recorderStreamRef.current = null;
        }

        recorderRef.current = null;
        chunksRef.current = [];

        if (!silent) onToast(blob ? "Lecture recording saved" : "Lecture recording was empty");
        resolve(blob);
      };

      try {
        rec.stop();
      } catch {
        resolve(null);
      }
    });

  const handleEnd = async () => {
    const blob = await stopRecording(true);
    const ok = await onEnd(blob, session.subject);
    if (ok) onToast("Session saved to recorded sessions");
    else onToast("Could not end session");
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;

      if (videoRef.current) videoRef.current.srcObject = stream;

      const overlayCanvas = overlayRef.current;
      const overlayCtx = overlayCanvas?.getContext("2d");

      const hands = new Hands({
        locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
      });

      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.75,
        minTrackingConfidence: 0.75
      });

      hands.onResults((results) => {
        if (!overlayCanvas || !overlayCtx) return;

        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        if (results.multiHandLandmarks?.length) {
          results.multiHandLandmarks.forEach((landmarks) => {
            drawLandmarks(overlayCtx, landmarks, {
              color: "#7c3aed",
              lineWidth: 2,
              radius: 3
            });
          });
        }

        const landmarks = results.multiHandLandmarks?.[0];
        const handednessLabel = results.multiHandedness?.[0]?.label || "Right";

        if (!landmarks || !handModeRef.current) {
          lastPointRef.current = null;
          gestureLockRef.current = { key: null, since: 0 };
          return;
        }

        const { thumbOpen, indexOpen, middleOpen, ringOpen, pinkyOpen } = countFingers(landmarks, handednessLabel);
        const fingerCount = [thumbOpen, indexOpen, middleOpen, ringOpen, pinkyOpen].filter(Boolean).length;

        if (fingerCount === 5) {
          selectTool("erase", "gesture-erase", "Tool selected: Erase");
          return;
        }

        if (fingerCount === 4) {
          selectTool("green", "gesture-green", "Tool selected: Green");
          return;
        }

        if (fingerCount === 3) {
          selectTool("red", "gesture-red", "Tool selected: Red");
          return;
        }

        if (fingerCount === 2) {
          selectTool("black", "gesture-black", "Tool selected: Black");
          return;
        }

        if (fingerCount === 1) {
          const board = boardRef.current;

          if (!board || !selectedToolRef.current) {
            lastPointRef.current = null;
            return;
          }

          const x = landmarks[8].x * board.width;
          const y = landmarks[8].y * board.height;
          const current = { x, y };

          if (!lastPointRef.current) {
            lastPointRef.current = current;
            return;
          }

          const isErase = selectedToolRef.current === "erase";
          const stroke = {
            x0: lastPointRef.current.x,
            y0: lastPointRef.current.y,
            x1: current.x,
            y1: current.y,
            color: isErase ? "#0b1020" : selectedToolRef.current,
            width: isErase ? 26 : 3
          };

          sendStroke(stroke, isErase ? "erase" : "draw");
          lastPointRef.current = current;
          return;
        }

        lastPointRef.current = null;
        gestureLockRef.current = { key: null, since: 0 };
      });

      const cam = new Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current) await hands.send({ image: videoRef.current });
        },
        width: 960,
        height: 720
      });

      handsRef.current = hands;
      cameraRef.current = cam;
      cam.start();
      setCameraOn(true);
    } catch {
      onToast("Camera permission denied");
    }
  };

  return (
    <div className="board-shell">
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />

      <div className="topbar">
        <div>
          <div className="eyebrow">Smart Class System</div>
          <h1>Live Board</h1>
          <p>
            {session.subject} · {session.doctor}
          </p>
        </div>

        <button className="control-btn danger small-logout" onClick={handleEnd}>
          End Session
        </button>
      </div>

      <div className="split-board-layout">
        <section className="camera-panel glass-card fade-in">
          <div className="panel-head">
            <div>
              <div className="section-kicker">Camera</div>
              <h2>Hand tracking view</h2>
            </div>
            <div className="status-pill">{cameraOn ? "Camera on" : "Camera off"}</div>
          </div>

          <div className="camera-stage">
            <video ref={videoRef} autoPlay playsInline muted className="camera-feed-large" />
            <canvas ref={overlayRef} width={960} height={720} className="hand-overlay" />
          </div>

          <div className="list-card" style={{ marginTop: 14 }}>
            <div className="list-title">Gesture map</div>
            <div className="list-meta">2 fingers = Black</div>
            <div className="list-meta">3 fingers = Red</div>
            <div className="list-meta">4 fingers = Green</div>
            <div className="list-meta">5 fingers = Erase</div>
            <div className="list-meta">1 finger = Draw with selected tool</div>
          </div>

          <div className="action-row">
            <button className="control-btn" onClick={startCamera}>
              Open Camera
            </button>
            <button className="control-btn secondary" onClick={() => setHandMode((v) => !v)}>
              {handMode ? "Disable Hand Mode" : "Enable Hand Mode"}
            </button>
          </div>
        </section>

        <section className="board-panel glass-card fade-in">
          <div className="panel-head">
            <div>
              <div className="section-kicker">Smart board</div>
              <h2>{session.subject}</h2>
            </div>
            <div className="status-pill">Editing</div>
          </div>

          <div className="board-tools">
            <button
              className={`mini-chip ${selectedTool === "black" ? "active" : ""}`}
              onClick={() => {
                selectedToolRef.current = "black";
                setSelectedTool("black");
                showToolToast("Tool selected: Black");
              }}
            >
              Black
            </button>
            <button
              className={`mini-chip ${selectedTool === "red" ? "active" : ""}`}
              onClick={() => {
                selectedToolRef.current = "red";
                setSelectedTool("red");
                showToolToast("Tool selected: Red");
              }}
            >
              Red
            </button>
            <button
              className={`mini-chip ${selectedTool === "green" ? "active" : ""}`}
              onClick={() => {
                selectedToolRef.current = "green";
                setSelectedTool("green");
                showToolToast("Tool selected: Green");
              }}
            >
              Green
            </button>
            <button
              className={`mini-chip ${selectedTool === "erase" ? "active" : ""}`}
              onClick={() => {
                selectedToolRef.current = "erase";
                setSelectedTool("erase");
                showToolToast("Tool selected: Erase");
              }}
            >
              Erase
            </button>
            <button className="mini-chip" onClick={clearBoard}>
              Clear
            </button>
          </div>

          <div className="list-card" style={{ marginTop: 14, marginBottom: 14 }}>
            <div className="list-title">Selected tool: {selectedTool || "none"}</div>
            <div className="list-meta">Pick a tool first with 2/3/4/5 fingers, then use one finger to write.</div>
          </div>

          <canvas ref={boardRef} width={1100} height={700} className="smart-board" />
        </section>
      </div>
    </div>
  );
}

function StudentRoom({ session, studentId, onDisconnect, onHeartbeat, onEmergency, onToast, onCleanup }) {
  const boardRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cameraRef = useRef(null);
  const faceMeshRef = useRef(null);
  const lowFocusSinceRef = useRef(null);
  const lastHeartbeatRef = useRef(0);

  const [strokes, setStrokes] = useState([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [focusPercent, setFocusPercent] = useState(0);
  const [emotion, setEmotion] = useState("unknown");

  useEffect(() => {
    let alive = true;

    const sync = async () => {
      try {
        const res = await fetch(`${API}/board-state/${session.subject}`);
        const data = await res.json();
        if (alive) setStrokes(Array.isArray(data) ? data : []);
      } catch { }
    };

    sync();
    const t = setInterval(sync, 500);

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [session.subject]);

  useEffect(() => {
    const canvas = boardRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    strokes.forEach((s) => {
      if (!s) return;
      ctx.beginPath();
      ctx.strokeStyle = s.color || "white";
      ctx.lineWidth = s.width || 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
      ctx.stroke();
      ctx.closePath();
    });
  }, [strokes]);

  useEffect(() => {
    startMonitorCamera();

    onCleanup(() => stopMonitorCamera());

    return () => {
      onCleanup(null);
      stopMonitorCamera();
    };
  }, []);

  const dist = (a, b) => Math.hypot(a.x - b.x, (a.y || 0) - (b.y || 0), (a.z || 0) - (b.z || 0));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const stopMonitorCamera = () => {
    if (cameraRef.current) {
      try {
        cameraRef.current.stop();
      } catch { }
      cameraRef.current = null;
    }

    if (faceMeshRef.current) {
      try {
        faceMeshRef.current.close?.();
      } catch { }
      faceMeshRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  };

  const computeMetrics = (lm) => {
    const nose = lm[1];
    const leftEyeTop = lm[159];
    const leftEyeBottom = lm[145];
    const leftEyeOuter = lm[33];
    const leftEyeInner = lm[133];
    const rightEyeTop = lm[386];
    const rightEyeBottom = lm[374];
    const rightEyeOuter = lm[263];
    const rightEyeInner = lm[362];
    const mouthTop = lm[13];
    const mouthBottom = lm[14];
    const mouthLeft = lm[61];
    const mouthRight = lm[291];

    const leftEyeOpen = dist(leftEyeTop, leftEyeBottom) / Math.max(0.0001, dist(leftEyeOuter, leftEyeInner));
    const rightEyeOpen = dist(rightEyeTop, rightEyeBottom) / Math.max(0.0001, dist(rightEyeOuter, rightEyeInner));
    const eyeOpenScore = clamp(((leftEyeOpen + rightEyeOpen) / 2) * 3.6, 0, 1);
    const mouthOpen = dist(mouthTop, mouthBottom) / Math.max(0.0001, dist(mouthLeft, mouthRight));
    const centerXScore = 1 - clamp(Math.abs(nose.x - 0.5) * 2, 0, 1);
    const centerYScore = 1 - clamp(Math.abs(nose.y - 0.45) * 2, 0, 1);

    const focus = Math.round(
      clamp(15 + eyeOpenScore * 45 + centerXScore * 25 + centerYScore * 15 - mouthOpen * 12, 0, 100)
    );

    let nextEmotion = "neutral";
    if (eyeOpenScore < 0.22) nextEmotion = "tired";
    else if (focus < 35) nextEmotion = "absent";
    else if (mouthOpen > 0.065 && focus > 70) nextEmotion = "happy";
    else if (focus > 80) nextEmotion = "focused";
    else if (focus < 55) nextEmotion = "confused";

    return { focus, emotion: nextEmotion };
  };

  const sendHeartbeat = (focus_percent, nextEmotion) => {
    const now = Date.now();
    if (now - lastHeartbeatRef.current < 3000) return;
    lastHeartbeatRef.current = now;
    onHeartbeat({ focus_percent, emotion: nextEmotion });
  };

  const startMonitorCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;

      if (videoRef.current) videoRef.current.srcObject = stream;

      stream.getTracks().forEach((track) => {
        track.onended = () => onEmergency("camera_lost");
      });

      setCameraOn(true);
      onToast("Monitoring camera opened");

      const faceMesh = new FaceMesh({
        locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.75,
        minTrackingConfidence: 0.75
      });

      faceMesh.onResults((results) => {
        const lm = results.multiFaceLandmarks?.[0];

        if (!lm) {
          setFocusPercent(0);
          setEmotion("absent");
          sendHeartbeat(0, "absent");

          if (!lowFocusSinceRef.current) lowFocusSinceRef.current = Date.now();
          if (Date.now() - lowFocusSinceRef.current >= 15000) {
            lowFocusSinceRef.current = null;
            onEmergency("camera_lost");
          }
          return;
        }

        const metrics = computeMetrics(lm);
        setFocusPercent(metrics.focus);
        setEmotion(metrics.emotion);
        sendHeartbeat(metrics.focus, metrics.emotion);

        if (metrics.focus < 50) {
          if (!lowFocusSinceRef.current) lowFocusSinceRef.current = Date.now();
          if (Date.now() - lowFocusSinceRef.current >= 15000) {
            lowFocusSinceRef.current = null;
            onEmergency("low_focus");
          }
        } else {
          lowFocusSinceRef.current = null;
        }
      });

      const cam = new Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current) await faceMesh.send({ image: videoRef.current });
        },
        width: 960,
        height: 720
      });

      faceMeshRef.current = faceMesh;
      cameraRef.current = cam;
      cam.start();
    } catch {
      setCameraError("Camera access denied");
      onToast("Camera access denied");
      onEmergency("camera_lost");
    }
  };

  return (
    <div className="board-shell">
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />

      <div className="topbar">
        <div>
          <div className="eyebrow">Smart Class System</div>
          <h1>Live Session</h1>
          <p>
            {session.subject} · {session.doctor}
          </p>
        </div>

        <button className="control-btn danger small-logout" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>

      <div className="student-live-layout">
        <section className="student-board-panel glass-card fade-in">
          <div className="panel-head">
            <div>
              <div className="section-kicker">Class board</div>
              <h2>{session.subject}</h2>
            </div>
            <div className="status-pill">Viewing</div>
          </div>

          <canvas ref={boardRef} width={1100} height={720} className="smart-board" />

          <div className="list-card" style={{ marginTop: 14 }}>
            <div className="list-title">Session file</div>
            <div className="list-action" onClick={() => window.open(session.pdf, "_blank")}>
              Open PDF
            </div>
          </div>
        </section>

        <aside className="student-monitor-panel glass-card fade-in">
          <div className="panel-head">
            <div>
              <div className="section-kicker">Monitoring</div>
              <h2>Camera check</h2>
            </div>
            <div className="status-pill">{cameraOn ? "Camera on" : "Camera off"}</div>
          </div>

          <video ref={videoRef} autoPlay playsInline muted className="camera-feed-large" style={{ height: 320 }} />

          <div className="stats-grid" style={{ marginTop: 14 }}>
            <div className="stat-card">
              <div className="stat-label">Focus</div>
              <div className="stat-value">{focusPercent}%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Emotion</div>
              <div className="stat-value">{emotion}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Status</div>
              <div className="stat-value">{cameraError ? "Error" : "Active"}</div>
            </div>
          </div>

          <div className="list-card" style={{ marginTop: 14 }}>
            <div className="list-title">Attendance</div>
            <div className="list-meta">Face scan completed before entry.</div>
            <div className="list-meta">Heartbeat updates are being saved while you stay in class.</div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function AttendanceGateModal({ session, onCancel, onComplete, onToast }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cameraRef = useRef(null);
  const faceMeshRef = useRef(null);
  const timerRef = useRef(null);
  const faceDetectedRef = useRef(false);

  const [cameraOn, setCameraOn] = useState(false);
  const [scan, setScan] = useState(false);
  const [count, setCount] = useState(5);

  useEffect(() => {
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        streamRef.current = stream;

        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraOn(true);

        const faceMesh = new FaceMesh({
          locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.75,
          minTrackingConfidence: 0.75
        });

        faceMesh.onResults((results) => {
          faceDetectedRef.current = !!results.multiFaceLandmarks?.[0];
        });

        const cam = new Camera(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current) await faceMesh.send({ image: videoRef.current });
          },
          width: 960,
          height: 720
        });

        faceMeshRef.current = faceMesh;
        cameraRef.current = cam;
        cam.start();
      } catch {
        onToast("Camera access denied");
      }
    };

    start();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);

      if (cameraRef.current) {
        try {
          cameraRef.current.stop();
        } catch { }
        cameraRef.current = null;
      }

      if (faceMeshRef.current) {
        try {
          faceMeshRef.current.close?.();
        } catch { }
        faceMeshRef.current = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [onToast]);

  const stopCamera = () => {
    if (cameraRef.current) {
      try {
        cameraRef.current.stop();
      } catch { }
      cameraRef.current = null;
    }

    if (faceMeshRef.current) {
      try {
        faceMeshRef.current.close?.();
      } catch { }
      faceMeshRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  };

  const startScan = () => {
    if (!cameraOn) {
      onToast("Open camera first");
      return;
    }

    setScan(true);
    setCount(5);

    let current = 5;

    timerRef.current = setInterval(async () => {
      current -= 1;
      setCount(current);

      if (current <= 0) {
        clearInterval(timerRef.current);
        timerRef.current = null;

        if (!faceDetectedRef.current) {
          onToast("Face not detected");
          setScan(false);
          setCount(5);
          return;
        }

        const ok = await onComplete();
        stopCamera();

        if (!ok) {
          setScan(false);
          setCount(5);
        }
      }
    }, 1000);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card glass-card fade-in" style={{ width: "min(920px, 96vw)" }}>
        <div className="panel-head">
          <div>
            <div className="section-kicker">Face scan</div>
            <h3>{session.subject}</h3>
          </div>
          <div className="status-pill">{cameraOn ? "Camera active" : "Camera off"}</div>
        </div>

        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="camera-feed-large"
          style={{ height: 420, width: "100%" }}
        />

        <div className="action-row">
          <button className="control-btn" onClick={startScan} disabled={scan}>
            {scan ? `Scanning... ${count}` : "Mark Attendance"}
          </button>
          <button
            className="control-btn secondary"
            onClick={() => {
              stopCamera();
              onCancel();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ title, body, onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card glass-card fade-in">
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="modal-actions">
          <button className="control-btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="control-btn danger" onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function WelcomeScreen({ name }) {
  return (
    <div className="welcome-screen">
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />

      <div className="welcome-card glass-card fade-in">
        <div className="welcome-kicker">Smart Class System</div>
        <h1>Welcome</h1>
        <p>{name}</p>
      </div>
    </div>
  );
}

function ToastStack({ items }) {
  return (
    <div className="toast-stack">
      {items.map((item) => (
        <div key={item.id} className="toast">
          {item.text}
        </div>
      ))}
    </div>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      html, body, #root { margin: 0; min-height: 100%; }
      body {
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0b1020;
        color: #f8fafc;
      }
      button, input { font: inherit; }
      .auth-shell, .dashboard-shell, .board-shell {
        min-height: 100vh;
        position: relative;
        overflow: hidden;
        background:
          radial-gradient(circle at top left, rgba(99,102,241,0.25), transparent 32%),
          radial-gradient(circle at bottom right, rgba(139,92,246,0.2), transparent 28%),
          linear-gradient(135deg, #0f172a 0%, #111827 50%, #0b1020 100%);
      }
      .welcome-screen {
        min-height: 100vh;
        position: relative;
        display: grid;
        place-items: center;
        overflow: hidden;
        background:
          radial-gradient(circle at top left, rgba(99,102,241,0.25), transparent 32%),
          radial-gradient(circle at bottom right, rgba(139,92,246,0.2), transparent 28%),
          linear-gradient(135deg, #0f172a 0%, #111827 50%, #0b1020 100%);
      }
      .orb {
        position: absolute;
        border-radius: 999px;
        pointer-events: none;
        filter: blur(24px);
        opacity: 0.65;
        animation: float 12s ease-in-out infinite;
      }
      .orb-a { width: 320px; height: 320px; background: rgba(99,102,241,0.18); top: -80px; left: -90px; }
      .orb-b { width: 260px; height: 260px; background: rgba(168,85,247,0.16); top: 120px; right: -80px; animation-delay: -3s; }
      .orb-c { width: 220px; height: 220px; background: rgba(56,189,248,0.12); bottom: -70px; left: 16%; animation-delay: -6s; }
      .glass-card {
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.08);
        backdrop-filter: blur(16px);
        box-shadow: 0 24px 70px rgba(0,0,0,0.35);
      }
      .fade-in { animation: fadeIn 0.45s ease; }
      .auth-grid, .dashboard-grid, .split-board-layout, .student-live-layout {
        position: relative;
        z-index: 1;
        width: min(1500px, 95vw);
        margin: 0 auto;
        padding: 22px 0 30px;
        display: grid;
        gap: 20px;
      }
      .auth-grid { min-height: 100vh; grid-template-columns: 1.1fr 0.9fr; align-items: center; }
      .dashboard-grid { grid-template-columns: 1.6fr 0.82fr; align-items: start; }
      .split-board-layout { grid-template-columns: 0.95fr 1.35fr; align-items: start; }
      .student-live-layout { grid-template-columns: 1.3fr 0.8fr; align-items: start; }
      .hero-panel, .auth-card, .main-panel, .sidebar-panel, .camera-panel, .board-panel, .student-board-panel, .student-monitor-panel, .soft-panel, .modal-card, .welcome-card {
        border-radius: 28px;
        overflow: hidden;
        padding: 22px;
      }
      .soft-panel {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
      }
      .inner-panel { margin-top: 18px; }
      .hero-panel { min-height: 640px; padding: 40px; display: flex; flex-direction: column; justify-content: space-between; }
      .eyebrow { text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; color: rgba(226,232,240,0.68); }
      .hero-title { margin: 18px 0 14px; font-size: clamp(42px, 5vw, 72px); line-height: 0.95; max-width: 760px; }
      .hero-copy { margin: 0; max-width: 620px; font-size: 16px; line-height: 1.8; color: rgba(226,232,240,0.78); }
      .feature-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 30px; }
      .feature-card { padding: 18px; border-radius: 18px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); transition: transform 0.25s ease; }
      .feature-card:hover, .subject-chip:hover, .mini-chip:hover, .tab-btn:hover, .control-btn:hover, .sidebar-item:hover { transform: translateY(-3px); }
      .feature-card h3 { margin: 0 0 8px; font-size: 15px; }
      .feature-card p { margin: 0; color: rgba(226,232,240,0.72); line-height: 1.6; font-size: 14px; }
      .auth-card { padding: 28px; }
      .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
      .panel-head h2, .panel-head h3 { margin: 6px 0 0; }
      .section-kicker { font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(226,232,240,0.55); }
      .status-pill { display: inline-flex; align-items: center; justify-content: center; padding: 10px 12px; border-radius: 999px; background: rgba(99,102,241,0.16); border: 1px solid rgba(99,102,241,0.28); color: #e0e7ff; font-size: 13px; white-space: nowrap; }
      .subject-row { display: flex; flex-wrap: wrap; gap: 12px; margin: 18px 0 18px; align-items: center; }
      .subject-chip, .mini-chip, .tab-btn, .control-btn, .sidebar-item {
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.04);
        color: #f8fafc;
        cursor: pointer;
        transition: transform 0.25s ease, background 0.25s ease, border-color 0.25s ease;
      }
      .subject-chip {
        width: 104px;
        height: 104px;
        border-radius: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
      }
      .subject-chip.active, .mini-chip.active, .tab-btn.active {
        background: linear-gradient(135deg, rgba(99,102,241,0.92), rgba(139,92,246,0.92));
        border-color: transparent;
      }
      .subject-chip.active {
        transform: translateY(-3px) scale(1.05);
        box-shadow: 0 18px 40px rgba(99,102,241,0.34);
      }
      .mini-chip {
        flex: 0 0 auto;
        min-width: 98px;
        padding: 12px 16px;
        border-radius: 999px;
      }
      .login-input, .file-input {
        width: 100%;
        border: 0;
        outline: 0;
        border-radius: 16px;
        padding: 15px 16px;
        margin-bottom: 12px;
        background: rgba(255,255,255,0.96);
        color: #0f172a;
      }
      .field-label { font-size: 14px; color: rgba(226,232,240,0.78); }
      .control-btn {
        width: 100%;
        padding: 14px 16px;
        border: 0;
        border-radius: 16px;
        background: linear-gradient(135deg, #6d28d9, #7c3aed 45%, #8b5cf6);
        color: #fff;
        font-weight: 600;
        box-shadow: 0 16px 30px rgba(99,102,241,0.25);
      }
      .control-btn.secondary { background: rgba(255,255,255,0.08); box-shadow: none; }
      .control-btn.danger { background: linear-gradient(135deg, #ef4444, #dc2626); box-shadow: 0 16px 30px rgba(239,68,68,0.2); }
      .small-logout {
        width: auto !important;
        min-width: 140px;
        flex: 0 0 auto;
        align-self: flex-start;
        padding: 12px 18px;
        border-radius: 16px;
      }
      .topbar {
        position: relative;
        z-index: 1;
        width: min(1500px, 95vw);
        margin: 0 auto;
        padding: 22px 0 0;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        flex-direction: row;
        flex-wrap: nowrap;
      }
      .topbar h1 { margin: 6px 0 4px; font-size: clamp(28px, 3vw, 40px); }
      .topbar p { margin: 0; color: rgba(226,232,240,0.72); }
      .main-panel { padding: 24px; }
      .sidebar-panel { padding: 20px; position: sticky; top: 20px; height: fit-content; }
      .camera-panel, .board-panel, .student-board-panel, .student-monitor-panel { min-height: 820px; }
      .camera-stage {
        position: relative;
        width: 100%;
        height: 420px;
        border-radius: 20px;
        overflow: hidden;
        background: #000;
        border: 1px solid rgba(255,255,255,0.08);
      }
      .camera-feed-large {
        width: 100%;
        height: 100%;
        object-fit: cover;
        background: #000;
        border-radius: 20px;
      }
      .hand-overlay {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      .smart-board {
        width: 100%;
        height: 720px;
        display: block;
        border-radius: 20px;
        background: #0b1020;
        border: 1px solid rgba(255,255,255,0.08);
      }
      .board-tools { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
      .action-row { display: flex; gap: 12px; align-items: center; margin-top: 14px; flex-wrap: wrap; }
      .action-row .control-btn { width: auto; min-width: 200px; flex: 1; }
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin-top: 18px;
      }
      .stat-card {
        border-radius: 18px;
        padding: 16px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.08);
      }
      .stat-label { font-size: 12px; color: rgba(226,232,240,0.65); margin-bottom: 8px; }
      .stat-value { font-size: 18px; font-weight: 700; }
      .list-grid { display: grid; gap: 10px; margin-top: 12px; }
      .list-card {
        padding: 14px;
        border-radius: 18px;
        background: rgba(15,23,42,0.6);
        border: 1px solid rgba(255,255,255,0.08);
      }
      .list-title { font-weight: 700; margin-bottom: 4px; }
      .list-meta { font-size: 13px; color: rgba(226,232,240,0.68); margin-top: 3px; }
      .list-action { margin-top: 10px; color: #c4b5fd; cursor: pointer; font-weight: 600; }
      .empty-state {
        padding: 16px;
        border-radius: 16px;
        background: rgba(255,255,255,0.04);
        border: 1px dashed rgba(255,255,255,0.12);
        color: rgba(226,232,240,0.72);
      }
      .sidebar-section { margin-bottom: 20px; }
      .sidebar-section h4 {
        margin: 0 0 10px;
        font-size: 13px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(226,232,240,0.58);
      }
      .sidebar-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(255,255,255,0.04);
        margin-bottom: 10px;
      }
      .sidebar-item.active {
        background: rgba(99,102,241,0.18);
        border-color: rgba(99,102,241,0.28);
      }
      .sidebar-list { display: grid; gap: 10px; }
      .notification-item {
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        line-height: 1.5;
      }
      .student-cta-row { margin-top: 6px; margin-bottom: 14px; }
      .student-cta-row .control-btn { width: auto; min-width: 280px; }
      .tab-row { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin: 18px 0 18px; }
      .tab-btn {
        flex: 0 0 auto;
        min-width: 190px;
        padding: 14px 20px;
        border-radius: 999px;
        font-weight: 600;
      }
      .tab-panel { margin-top: 6px; }
      .toast-stack {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 60;
        display: grid;
        gap: 10px;
        width: min(360px, 92vw);
      }
      .toast {
        padding: 14px 16px;
        border-radius: 16px;
        background: rgba(17,24,39,0.94);
        border: 1px solid rgba(255,255,255,0.08);
        box-shadow: 0 18px 40px rgba(0,0,0,0.35);
        animation: toastIn 0.3s ease;
      }
      .welcome-card {
        width: min(420px, 92vw);
        text-align: center;
      }
      .welcome-kicker {
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 12px;
        color: rgba(226,232,240,0.66);
        margin-bottom: 10px;
      }
      .welcome-card h1 { margin: 0; font-size: 42px; }
      .welcome-card p { margin: 10px 0 0; color: rgba(226,232,240,0.82); font-size: 18px; }
      .modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 70;
        background: rgba(2,6,23,0.66);
        display: grid;
        place-items: center;
        padding: 20px;
      }
      .modal-card h3 { margin: 0 0 10px; }
      .modal-card p { margin: 0 0 18px; color: rgba(226,232,240,0.8); }
      .modal-actions { display: flex; gap: 10px; margin-top: 14px; }
      .field-stack { display: grid; gap: 10px; }
      .auth-role-row { margin-top: 4px; }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes float {
        0%, 100% { transform: translateY(0px) translateX(0px); }
        50% { transform: translateY(18px) translateX(12px); }
      }
      @keyframes toastIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @media (max-width: 1120px) {
        .auth-grid, .dashboard-grid, .split-board-layout, .student-live-layout { grid-template-columns: 1fr; }
        .sidebar-panel { position: static; }
        .hero-panel { min-height: auto; }
        .stats-grid { grid-template-columns: 1fr; }
      }
      @media (max-width: 720px) {
        .topbar { flex-direction: column; flex-wrap: nowrap; }
        .subject-chip { width: 92px; height: 92px; border-radius: 24px; }
        .feature-grid { grid-template-columns: 1fr; }
        .modal-actions { flex-direction: column; }
        .tab-btn { min-width: 100%; }
        .student-cta-row .control-btn { width: 100%; }
      }
    `}</style>
  );
}