const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const app = express();

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || `http://localhost:${PORT}`;

const uploadsDir = path.join(__dirname, "uploads");
const recordingsDir = path.join(__dirname, "recordings");
const summariesDir = path.join(__dirname, "summaries");

for (const dir of [uploadsDir, recordingsDir, summariesDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use("/uploads", express.static(uploadsDir));
app.use("/recordings", express.static(recordingsDir));
app.use("/summaries", express.static(summariesDir));

const pool = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "railway",
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

const pdfStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
        const safeName = file.originalname.replace(/\s+/g, "_");
        cb(null, `${Date.now()}-${safeName}`);
    },
});

const recordingStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, recordingsDir),
    filename: (_req, _file, cb) => cb(null, `${Date.now()}-lecture.webm`),
});

const uploadPdf = multer({ storage: pdfStorage });
const uploadRecording = multer({ storage: recordingStorage });

const liveSessions = {};

async function dbQuery(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
}

function safeText(value) {
    return value == null ? "" : String(value).trim();
}

function normalizeRole(value) {
    return safeText(value).toLowerCase();
}

function slugify(value) {
    return safeText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "summary";
}

function reasonText(reason) {
    if (reason === "disconnect") return "Student disconnected manually";
    if (reason === "low_focus") return "Low focus for 15 seconds";
    if (reason === "camera_lost") return "Camera lost or face not detected";
    return reason || "Unknown";
}

function fileUrlToLocalPath(fileUrl, baseDir) {
    if (!fileUrl) return null;

    try {
        const u = new URL(fileUrl);
        const filename = decodeURIComponent(path.basename(u.pathname));
        return path.join(baseDir, filename);
    } catch {
        const filename = decodeURIComponent(path.basename(String(fileUrl)));
        return path.join(baseDir, filename);
    }
}

async function initTables() {
    await dbQuery(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INT PRIMARY KEY,
      name VARCHAR(100),
      email VARCHAR(150) UNIQUE,
      password VARCHAR(100)
    )
  `);

    await dbQuery(`
    CREATE TABLE IF NOT EXISTS parents (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(100),
      password VARCHAR(100),
      phone VARCHAR(50) NULL
    )
  `);

    await dbQuery(`
    CREATE TABLE IF NOT EXISTS students (
      id INT PRIMARY KEY,
      name VARCHAR(100),
      password VARCHAR(100),
      phone VARCHAR(50) NULL,
      parent_id INT NULL
    )
  `);

    await dbQuery(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      doctor VARCHAR(100),
      subject VARCHAR(50),
      pdf TEXT,
      recording TEXT NULL,
      started_at DATETIME,
      ended_at DATETIME NULL
    )
  `);

    await dbQuery(`
    CREATE TABLE IF NOT EXISTS summaries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      doctor VARCHAR(100),
      subject VARCHAR(50),
      title VARCHAR(255) NULL,
      file TEXT,
      session_id VARCHAR(100) NULL,
      created_at DATETIME
    )
  `);

    await dbQuery(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id INT,
      subject VARCHAR(50),
      date DATE,
      status VARCHAR(20),
      check_in_time DATETIME NULL,
      check_out_time DATETIME NULL,
      face_verified TINYINT DEFAULT 0,
      focus_percent INT DEFAULT 0,
      emotion VARCHAR(50) DEFAULT 'unknown',
      exit_reason VARCHAR(100) DEFAULT NULL,
      last_seen_at DATETIME NULL
    )
  `);

    await dbQuery(`
    CREATE TABLE IF NOT EXISTS student_reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id INT,
      subject VARCHAR(50),
      doctor VARCHAR(100),
      check_in_time DATETIME NULL,
      check_out_time DATETIME NULL,
      status VARCHAR(20),
      face_verified TINYINT DEFAULT 0,
      focus_percent INT DEFAULT 0,
      emotion VARCHAR(50) DEFAULT 'unknown',
      exit_reason VARCHAR(100) DEFAULT NULL,
      last_seen_at DATETIME NULL,
      created_at DATETIME
    )
  `);

    await dbQuery(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_role VARCHAR(20),
      title VARCHAR(255),
      body TEXT,
      created_at DATETIME
    )
  `);

    await dbQuery(`
    CREATE TABLE IF NOT EXISTS board_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      teacher VARCHAR(100),
      subject VARCHAR(50),
      action VARCHAR(50),
      color VARCHAR(20),
      created_at DATETIME
    )
  `);
}

async function addColumnIfMissing(tableName, columnName, definition) {
    const rows = await dbQuery(
        `SELECT COUNT(*) AS cnt
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?`,
        [tableName, columnName]
    );

    if (!rows[0] || rows[0].cnt === 0) {
        await dbQuery(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

async function ensureSchema() {
    await addColumnIfMissing("sessions", "recording", "TEXT NULL");
    await addColumnIfMissing("sessions", "ended_at", "DATETIME NULL");

    await addColumnIfMissing("summaries", "title", "VARCHAR(255) NULL");
    await addColumnIfMissing("summaries", "session_id", "VARCHAR(100) NULL");
    await addColumnIfMissing("summaries", "created_at", "DATETIME NULL");

    await addColumnIfMissing("attendance", "check_in_time", "DATETIME NULL");
    await addColumnIfMissing("attendance", "check_out_time", "DATETIME NULL");
    await addColumnIfMissing("attendance", "face_verified", "TINYINT DEFAULT 0");
    await addColumnIfMissing("attendance", "focus_percent", "INT DEFAULT 0");
    await addColumnIfMissing("attendance", "emotion", "VARCHAR(50) DEFAULT 'unknown'");
    await addColumnIfMissing("attendance", "exit_reason", "VARCHAR(100) DEFAULT NULL");
    await addColumnIfMissing("attendance", "last_seen_at", "DATETIME NULL");

    await addColumnIfMissing("student_reports", "doctor", "VARCHAR(100) NULL");
    await addColumnIfMissing("student_reports", "check_in_time", "DATETIME NULL");
    await addColumnIfMissing("student_reports", "check_out_time", "DATETIME NULL");
    await addColumnIfMissing("student_reports", "face_verified", "TINYINT DEFAULT 0");
    await addColumnIfMissing("student_reports", "focus_percent", "INT DEFAULT 0");
    await addColumnIfMissing("student_reports", "emotion", "VARCHAR(50) DEFAULT 'unknown'");
    await addColumnIfMissing("student_reports", "exit_reason", "VARCHAR(100) DEFAULT NULL");
    await addColumnIfMissing("student_reports", "last_seen_at", "DATETIME NULL");
}

async function notify(role, title, body) {
    try {
        await dbQuery(
            "INSERT INTO notifications (user_role, title, body, created_at) VALUES (?, ?, ?, NOW())",
            [safeText(role), safeText(title), safeText(body)]
        );
    } catch (err) {
        console.log("NOTIFY ERROR:", err.message);
    }
}

async function notifyAll(title, body) {
    await Promise.all([
        notify("teacher", title, body),
        notify("student", title, body),
        notify("parent", title, body),
    ]);
}

function getLiveSession(subject) {
    return liveSessions[subject] || null;
}

function createSummaryPdf(summaryText, meta) {
    return new Promise((resolve, reject) => {
        const filename = `summary-${Date.now()}-${slugify(meta.subject)}.pdf`;
        const filePath = path.join(summariesDir, filename);
        const doc = new PDFDocument({ margin: 48, size: "A4" });
        const stream = fs.createWriteStream(filePath);

        stream.on("finish", () => resolve({ filename, filePath }));
        stream.on("error", reject);
        doc.on("error", reject);

        doc.pipe(stream);

        doc.fontSize(22).text("Lecture Summary", { align: "center" });
        doc.moveDown(0.7);
        doc.fontSize(11);
        doc.text(`Subject: ${meta.subject}`);
        doc.text(`Doctor: ${meta.doctor}`);
        doc.text(`Generated at: ${new Date().toLocaleString()}`);
        doc.moveDown(1);

        const parts = String(summaryText || "").split("\n");
        for (const part of parts) {
            doc.fontSize(12).text(part || " ", { lineGap: 5 });
        }

        doc.end();
    });
}

async function generateAutoSummaryForSession(live, sessionDbId) {
    try {
        console.log("FORCE SUMMARY START");

        const lecturePdfPath = fileUrlToLocalPath(live.pdf, uploadsDir);
        let lectureText = "";

        if (lecturePdfPath && fs.existsSync(lecturePdfPath)) {
            lectureText = fs.readFileSync(lecturePdfPath, "utf8").toString();
        }

        const summaryText = `
Lecture Summary - ${live.subject}

Main ideas:
- The lecture was delivered by ${live.doctor}.
- Students should review the lecture content after the session.
- Focus on the key concepts, examples, and revision points.

Quick revision:
- Re-read the lecture PDF.
- Revise the main definitions and notes.
- Prepare for the next class by reviewing the important points.

Study tip:
- Keep the summary open while revising to save time before exams.

Reference note:
- ${lectureText ? "Lecture file was processed and saved in the system." : "Lecture PDF stored successfully."}
`;

        const createdPdf = await createSummaryPdf(summaryText, live);
        const summaryUrl = `${HOST}/summaries/${createdPdf.filename}`;

        await dbQuery(
            `
      INSERT INTO summaries (doctor, subject, title, file, session_id, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      `,
            [
                live.doctor,
                live.subject,
                `Auto Summary - ${live.subject}`,
                summaryUrl,
                String(sessionDbId || live.id || ""),
            ]
        );

        console.log("SUMMARY SAVED:", summaryUrl);
        return summaryUrl;
    } catch (err) {
        console.log("SUMMARY ERROR:", err.message);
        throw err;
    }
}

app.get("/login", async (req, res) => {
    try {
        const role = normalizeRole(req.query.role);
        const id = safeText(req.query.id);
        const email = safeText(req.query.email);
        const password = safeText(req.query.password);

        if (role === "teacher" || role === "doctor") {
            const rows = await dbQuery(
                `
        SELECT id, name, email, password
        FROM teachers
        WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))
          AND TRIM(password) = TRIM(?)
        LIMIT 1
        `,
                [email, password]
            );
            return res.json(rows.length ? { user: rows[0] } : {});
        }

        if (role === "student") {
            const rows = await dbQuery(
                `
        SELECT id, name, password, phone, parent_id
        FROM students
        WHERE CAST(id AS CHAR) = TRIM(?)
          AND TRIM(password) = TRIM(?)
        LIMIT 1
        `,
                [id, password]
            );
            return res.json(rows.length ? { user: rows[0] } : {});
        }

        if (role === "parent") {
            const rows = await dbQuery(
                `
        SELECT
          parents.id AS parent_id,
          parents.name AS parent_name,
          parents.password AS parent_password,
          parents.phone AS parent_phone,
          students.id AS student_id,
          students.name AS student_name
        FROM students
        JOIN parents ON students.parent_id = parents.id
        WHERE CAST(students.id AS CHAR) = TRIM(?)
        LIMIT 1
        `,
                [id]
            );

            if (rows.length && String(rows[0].parent_password).trim() === password) {
                return res.json({
                    user: {
                        id: rows[0].student_id,
                        name: rows[0].parent_name,
                        student_name: rows[0].student_name,
                        student_id: rows[0].student_id,
                        parent_id: rows[0].parent_id,
                        phone: rows[0].parent_phone,
                    },
                });
            }

            return res.json({});
        }

        return res.json({});
    } catch (err) {
        console.log("LOGIN ERROR:", err);
        return res.status(500).json({});
    }
});

app.post("/start-session", uploadPdf.single("pdf"), async (req, res) => {
    try {
        const doctor = safeText(req.body.doctor);
        const subject = safeText(req.body.subject);

        if (!req.file || !doctor || !subject) {
            return res.status(400).json({ ok: false, error: "Missing session data" });
        }

        const pdf = `${HOST}/uploads/${req.file.filename}`;

        const session = {
            id: Date.now().toString(),
            doctor,
            subject,
            pdf,
            recording: null,
            started_at: new Date().toISOString(),
            boardActions: [],
        };

        liveSessions[subject] = session;

        await notifyAll("Live session started", `${doctor} started ${subject}`);

        return res.json({ ok: true, session });
    } catch (err) {
        console.log("START SESSION ERROR:", err);
        return res.status(500).json({ ok: false, error: "Server error" });
    }
});

app.get("/live-session/:subject", (req, res) => {
    const live = getLiveSession(req.params.subject);
    return res.json(live || {});
});

app.get("/session/:subject", async (req, res) => {
    try {
        const live = getLiveSession(req.params.subject);
        if (live) return res.json(live);

        const rows = await dbQuery(
            "SELECT * FROM sessions WHERE subject=? ORDER BY id DESC LIMIT 1",
            [req.params.subject]
        );
        return res.json(rows[0] || {});
    } catch (err) {
        console.log("SESSION ERROR:", err);
        return res.status(500).json({});
    }
});

app.get("/sessions/:subject", async (req, res) => {
    try {
        const rows = await dbQuery(
            "SELECT * FROM sessions WHERE subject=? ORDER BY id DESC",
            [req.params.subject]
        );
        return res.json(rows || []);
    } catch (err) {
        console.log("SESSIONS ERROR:", err);
        return res.status(500).json([]);
    }
});

app.get("/summaries/:subject", async (req, res) => {
    try {
        const rows = await dbQuery(
            "SELECT * FROM summaries WHERE subject=? ORDER BY id DESC",
            [req.params.subject]
        );
        return res.json(rows || []);
    } catch (err) {
        console.log("SUMMARIES ERROR:", err);
        return res.status(500).json([]);
    }
});

app.post("/attendance/start", async (req, res) => {
    try {
        const studentId = Number(req.body.student_id);
        const subject = safeText(req.body.subject);

        if (!studentId || !subject) {
            return res.status(400).json({ ok: false, error: "Missing student or subject" });
        }

        const live = getLiveSession(subject);
        if (!live) {
            return res.status(400).json({ ok: false, error: "No live session" });
        }

        const studentRows = await dbQuery("SELECT id, name, parent_id FROM students WHERE id=?", [
            studentId,
        ]);

        if (!studentRows.length) {
            return res.status(404).json({ ok: false, error: "Student not found" });
        }

        const studentName = studentRows[0].name;
        const doctor = live.doctor || "Unknown";

        const openAttendance = await dbQuery(
            "SELECT * FROM attendance WHERE student_id=? AND subject=? AND check_out_time IS NULL ORDER BY id DESC LIMIT 1",
            [studentId, subject]
        );

        if (openAttendance.length) {
            return res.json({
                ok: true,
                attendance_id: openAttendance[0].id,
                student_name: studentName,
                subject,
                doctor,
                check_in_time: openAttendance[0].check_in_time,
                focus_percent: openAttendance[0].focus_percent || 0,
                emotion: openAttendance[0].emotion || "unknown",
                already: true,
            });
        }

        const attendanceResult = await dbQuery(
            `
      INSERT INTO attendance
      (student_id, subject, date, status, check_in_time, face_verified, last_seen_at, focus_percent, emotion)
      VALUES (?, ?, CURDATE(), 'present', NOW(), 1, NOW(), 0, 'unknown')
      `,
            [studentId, subject]
        );

        await dbQuery(
            `
      INSERT INTO student_reports
      (student_id, subject, doctor, check_in_time, status, focus_percent, emotion, face_verified, last_seen_at, created_at)
      VALUES (?, ?, ?, NOW(), 'present', 0, 'unknown', 1, NOW(), NOW())
      `,
            [studentId, subject, doctor]
        );

        await notify("teacher", "Student joined", `${studentName} joined ${subject} at ${new Date().toLocaleTimeString()}`);
        await notify("student", "Attendance recorded", `You joined ${subject} with ${doctor}`);
        await notify("parent", "Attendance recorded", `${studentName} joined ${subject} with ${doctor}`);

        return res.json({
            ok: true,
            attendance_id: attendanceResult.insertId || null,
            student_name: studentName,
            subject,
            doctor,
            check_in_time: new Date().toISOString(),
            focus_percent: 0,
            emotion: "unknown",
        });
    } catch (err) {
        console.log("ATTENDANCE START ERROR:", err);
        return res.status(500).json({ ok: false, error: "Database error" });
    }
});

app.post("/attendance/heartbeat", async (req, res) => {
    try {
        const studentId = Number(req.body.student_id);
        const subject = safeText(req.body.subject);
        const focus = Number(req.body.focus_percent || 0);
        const emotion = safeText(req.body.emotion || "unknown");

        await dbQuery(
            `
      UPDATE attendance
      SET focus_percent=?, emotion=?, last_seen_at=NOW()
      WHERE student_id=? AND subject=? AND check_out_time IS NULL
      ORDER BY id DESC
      LIMIT 1
      `,
            [focus, emotion, studentId, subject]
        );

        await dbQuery(
            `
      UPDATE student_reports
      SET focus_percent=?, emotion=?, last_seen_at=NOW()
      WHERE student_id=? AND subject=? AND check_out_time IS NULL
      ORDER BY id DESC
      LIMIT 1
      `,
            [focus, emotion, studentId, subject]
        );

        return res.json({ ok: true });
    } catch (err) {
        console.log("HEARTBEAT ERROR:", err);
        return res.status(500).json({ ok: false, error: "Database error" });
    }
});

app.post("/attendance/end", async (req, res) => {
    try {
        const studentId = Number(req.body.student_id);
        const subject = safeText(req.body.subject);
        const focus = Number(req.body.focus_percent || 0);
        const emotion = safeText(req.body.emotion || "unknown");
        const reason = safeText(req.body.reason || "disconnect");

        const studentRows = await dbQuery("SELECT name FROM students WHERE id=?", [studentId]);
        const studentName = studentRows[0]?.name || `Student ${studentId}`;

        await dbQuery(
            `
      UPDATE attendance
      SET check_out_time = NOW(),
          focus_percent = ?,
          emotion = ?,
          exit_reason = ?,
          status = 'left'
      WHERE student_id = ? AND subject = ? AND check_out_time IS NULL
      ORDER BY id DESC
      LIMIT 1
      `,
            [focus, emotion, reason, studentId, subject]
        );

        await dbQuery(
            `
      UPDATE student_reports
      SET check_out_time = NOW(),
          focus_percent = ?,
          emotion = ?,
          exit_reason = ?,
          status = 'left'
      WHERE student_id = ? AND subject = ? AND check_out_time IS NULL
      ORDER BY id DESC
      LIMIT 1
      `,
            [focus, emotion, reason, studentId, subject]
        );

        await notify("teacher", "Student left session", `${studentName} left ${subject}. Reason: ${reasonText(reason)}`);
        await notify("student", "Session ended", `You left ${subject}. Reason: ${reasonText(reason)}`);
        await notify("parent", "Student left session", `${studentName} left ${subject}. Reason: ${reasonText(reason)}`);

        return res.json({ ok: true });
    } catch (err) {
        console.log("ATTENDANCE END ERROR:", err);
        return res.status(500).json({ ok: false, error: "Database error" });
    }
});

app.post("/board-event", async (req, res) => {
    try {
        const { subject, teacher, action, color, stroke } = req.body;
        const live = getLiveSession(subject);

        if (live) {
            if (action === "clear") {
                live.boardActions = [];
            } else if (stroke) {
                live.boardActions.push(stroke);
            }
        }

        await dbQuery(
            "INSERT INTO board_events (teacher, subject, action, color, created_at) VALUES (?, ?, ?, ?, NOW())",
            [safeText(teacher), safeText(subject), safeText(action || "draw"), safeText(color || "white")]
        );

        return res.json({ ok: true });
    } catch (err) {
        console.log("BOARD EVENT ERROR:", err);
        return res.status(500).json({ ok: false, error: "Database error" });
    }
});

app.get("/board-state/:subject", async (req, res) => {
    try {
        const live = getLiveSession(req.params.subject);
        return res.json(live ? live.boardActions : []);
    } catch (err) {
        console.log("BOARD STATE ERROR:", err);
        return res.status(500).json([]);
    }
});

app.get("/board-events/:subject", async (req, res) => {
    try {
        const rows = await dbQuery(
            "SELECT * FROM board_events WHERE subject=? ORDER BY id DESC LIMIT 50",
            [req.params.subject]
        );
        return res.json(rows || []);
    } catch (err) {
        console.log("BOARD EVENTS ERROR:", err);
        return res.status(500).json([]);
    }
});

app.get("/notifications/:role", async (req, res) => {
    try {
        const rows = await dbQuery(
            "SELECT * FROM notifications WHERE user_role=? ORDER BY id DESC LIMIT 50",
            [safeText(req.params.role)]
        );
        return res.json(rows || []);
    } catch (err) {
        console.log("NOTIFICATIONS ERROR:", err);
        return res.status(500).json([]);
    }
});

app.get("/session-students/:subject", async (req, res) => {
    try {
        const rows = await dbQuery(
            "SELECT * FROM student_reports WHERE subject=? ORDER BY id DESC LIMIT 50",
            [req.params.subject]
        );
        return res.json(rows || []);
    } catch (err) {
        console.log("SESSION STUDENTS ERROR:", err);
        return res.status(500).json([]);
    }
});

app.get("/student-reports/:studentId", async (req, res) => {
    try {
        const rows = await dbQuery(
            "SELECT * FROM student_reports WHERE student_id=? ORDER BY id DESC",
            [Number(req.params.studentId)]
        );
        return res.json(rows || []);
    } catch (err) {
        console.log("STUDENT REPORTS ERROR:", err);
        return res.status(500).json([]);
    }
});

app.get("/parent-stats/:studentId", async (req, res) => {
    try {
        const studentId = Number(req.params.studentId);

        const studentRows = await dbQuery("SELECT id, name FROM students WHERE id=?", [studentId]);
        if (!studentRows.length) return res.json({});

        const statsRows = await dbQuery(
            `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) AS presentCount,
        MAX(date) AS lastDate,
        COALESCE(ROUND(AVG(focus_percent)), 0) AS averageFocus
      FROM attendance
      WHERE student_id=?
      `,
            [studentId]
        );

        const latestRows = await dbQuery(
            "SELECT * FROM student_reports WHERE student_id=? ORDER BY id DESC LIMIT 1",
            [studentId]
        );

        const total = Number(statsRows[0]?.total || 0);
        const presentCount = Number(statsRows[0]?.presentCount || 0);
        const averageFocus = Number(statsRows[0]?.averageFocus || 0);
        const percent = total > 0 ? Math.round((presentCount / total) * 100) : 0;

        return res.json({
            studentName: studentRows[0].name,
            attendancePercent: percent,
            presentCount,
            totalRecords: total,
            averageFocus,
            lastDate: statsRows[0]?.lastDate || null,
            statusText:
                percent >= 80
                    ? "Student is attending regularly"
                    : percent >= 50
                        ? "Attendance is medium"
                        : "Needs attention",
            latestReport: latestRows[0] || null,
        });
    } catch (err) {
        console.log("PARENT STATS ERROR:", err);
        return res.status(500).json({});
    }
});

function finalizeSession(req, res) {
    const subject = safeText(req.body?.subject);

    if (!subject) {
        return res.status(400).json({ ok: false, error: "Missing subject" });
    }

    const live = getLiveSession(subject);
    if (!live) {
        return res.status(400).json({ ok: false, error: "No live session" });
    }

    const recordingUrl = req.file ? `${HOST}/recordings/${req.file.filename}` : null;

    dbQuery(
        "INSERT INTO sessions (doctor, subject, pdf, recording, started_at, ended_at) VALUES (?, ?, ?, ?, NOW(), NOW())",
        [live.doctor, live.subject, live.pdf, recordingUrl]
    )
        .then(async (result) => {
            const sessionDbId = result?.insertId || null;

            try {
                await generateAutoSummaryForSession(live, sessionDbId);
                await notifyAll("Auto summary created", `${live.subject} summary was generated automatically`);
            } catch (err) {
                console.log("AUTO SUMMARY ERROR:", err.message);
            }

            delete liveSessions[subject];
            await notifyAll("Session recorded", `${live.subject} has been saved`);
            return res.json({ ok: true, recording: recordingUrl });
        })
        .catch((err) => {
            console.log("END SESSION DB ERROR:", err);
            return res.status(500).json({ ok: false, error: err.message || "Database error" });
        });
}

app.post("/end-session", (req, res) => {
    const contentType = req.headers["content-type"] || "";

    if (contentType.includes("multipart/form-data")) {
        return uploadRecording.single("recording")(req, res, (err) => {
            if (err) {
                console.log("UPLOAD RECORDING ERROR:", err);
                return res.status(500).json({ ok: false, error: err.message || "Upload error" });
            }
            return finalizeSession(req, res);
        });
    }

    return finalizeSession(req, res);
});

initTables()
    .then(ensureSchema)
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server running on ${HOST}`);
        });
    })
    .catch((err) => {
        console.log("INIT TABLES ERROR:", err);
        process.exit(1);
    });