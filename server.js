"use strict";
const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const Database = require("better-sqlite3");

// ─── DB ───────────────────────────────────────────────────────────────────────
const DB_PATH    = process.env.DB_PATH || path.join(__dirname, "taskmanager.db");
const db         = new Database(DB_PATH);
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_in_production";

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    email        TEXT    NOT NULL UNIQUE,
    password     TEXT    NOT NULL,
    role         TEXT    NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
    avatar_color TEXT    NOT NULL DEFAULT '#6366f1',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT,
    status      TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS project_members (
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    role        TEXT    NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
    joined_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    description TEXT,
    status      TEXT    NOT NULL DEFAULT 'todo'   CHECK(status   IN ('todo','in_progress','review','done')),
    priority    TEXT    NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
    assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    due_date    TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Auth helpers ─────────────────────────────────────────────────────────────
const signToken = (user) => jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "7d" });

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user    = db.prepare(
      "SELECT id, name, email, role, avatar_color, created_at FROM users WHERE id = ?"
    ).get(payload.id);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireProjectMember(req, res, next) {
  const projectId = parseInt(req.params.projectId || req.params.id);
  const project   = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  if (req.user.role === "admin" || project.owner_id === req.user.id) {
    req.project = project; req.projectRole = "admin"; return next();
  }
  const membership = db
    .prepare("SELECT * FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(projectId, req.user.id);
  if (!membership) return res.status(403).json({ error: "You are not a member of this project" });
  req.project = project; req.projectRole = membership.role; next();
}

function requireProjectAdmin(req, res, next) {
  requireProjectMember(req, res, () => {
    if (req.projectRole !== "admin" && req.user.role !== "admin")
      return res.status(403).json({ error: "Project admin access required" });
    next();
  });
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════════════
const AVATAR_COLORS = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#8b5cf6","#ef4444","#14b8a6"];

app.post("/api/auth/signup", (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name?.trim())               return res.status(400).json({ error: "Name is required" });
  if (!email?.trim())              return res.status(400).json({ error: "Email is required" });
  if (!password || password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: "Invalid email format" });

  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase()))
    return res.status(409).json({ error: "Email already registered" });

  const hash    = bcrypt.hashSync(password, 10);
  const color   = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const count   = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
  const useRole = count === 0 ? "admin" : (role === "admin" ? "admin" : "member");

  const { lastInsertRowid } = db
    .prepare("INSERT INTO users (name, email, password, role, avatar_color) VALUES (?,?,?,?,?)")
    .run(name.trim(), email.toLowerCase(), hash, useRole, color);

  const user = db.prepare(
    "SELECT id, name, email, role, avatar_color, created_at FROM users WHERE id = ?"
  ).get(lastInsertRowid);

  res.status(201).json({ token: signToken(user), user });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: "Invalid credentials" });

  const { password: _, ...safeUser } = user;
  res.json({ token: signToken(safeUser), user: safeUser });
});

app.get("/api/auth/me", authenticate, (req, res) => res.json({ user: req.user }));

app.get("/api/auth/users", authenticate, (req, res) => {
  res.json({ users: db.prepare(
    "SELECT id, name, email, role, avatar_color, created_at FROM users ORDER BY name"
  ).all() });
});

app.patch("/api/auth/users/:id/role", authenticate, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  const { role } = req.body;
  if (!["admin","member"].includes(role)) return res.status(400).json({ error: "Invalid role" });
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, req.params.id);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════
// PROJECT ROUTES
// ════════════════════════════════════════════════════════════════════
app.get("/api/projects", authenticate, (req, res) => {
  const COLS = `p.*, u.name as owner_name,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as done_count,
    (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as member_count`;

  const projects = req.user.role === "admin"
    ? db.prepare(`SELECT ${COLS} FROM projects p JOIN users u ON p.owner_id = u.id ORDER BY p.created_at DESC`).all()
    : db.prepare(`SELECT ${COLS} FROM projects p JOIN users u ON p.owner_id = u.id
        WHERE p.owner_id = ? OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?)
        ORDER BY p.created_at DESC`).all(req.user.id, req.user.id);

  res.json({ projects });
});

app.post("/api/projects", authenticate, (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Project name is required" });

  const { lastInsertRowid } = db
    .prepare("INSERT INTO projects (name, description, owner_id) VALUES (?,?,?)")
    .run(name.trim(), description?.trim() || "", req.user.id);

  db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?,?,'admin')")
    .run(lastInsertRowid, req.user.id);

  const project = db.prepare(
    "SELECT p.*, u.name as owner_name FROM projects p JOIN users u ON p.owner_id = u.id WHERE p.id = ?"
  ).get(lastInsertRowid);

  res.status(201).json({ project });
});

app.get("/api/projects/:id", authenticate, requireProjectMember, (req, res) => {
  const members = db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar_color, u.role as global_role,
           pm.role as project_role, pm.joined_at
    FROM project_members pm JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ?`).all(req.params.id);

  const stats = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status='todo' THEN 1 ELSE 0 END) as todo,
      SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status='review' THEN 1 ELSE 0 END) as review,
      SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN due_date < date('now') AND status != 'done' THEN 1 ELSE 0 END) as overdue
    FROM tasks WHERE project_id = ?`).get(req.params.id);

  res.json({ project: req.project, members, stats, projectRole: req.projectRole });
});

app.put("/api/projects/:id", authenticate, requireProjectAdmin, (req, res) => {
  const { name, description, status } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Project name is required" });
  db.prepare("UPDATE projects SET name=?, description=?, status=? WHERE id=?")
    .run(name.trim(), description?.trim() || "", status || "active", req.params.id);
  res.json({ project: db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id) });
});

app.delete("/api/projects/:id", authenticate, requireProjectAdmin, (req, res) => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

app.get("/api/projects/:projectId/members", authenticate, requireProjectMember, (req, res) => {
  res.json({ members: db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar_color, pm.role as project_role, pm.joined_at
    FROM project_members pm JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ? ORDER BY pm.joined_at ASC`).all(req.params.projectId) });
});

app.post("/api/projects/:projectId/members", authenticate, requireProjectAdmin, (req, res) => {
  const { userId, role } = req.body;
  if (!userId) return res.status(400).json({ error: "userId is required" });
  if (!db.prepare("SELECT id FROM users WHERE id = ?").get(userId))
    return res.status(404).json({ error: "User not found" });
  db.prepare("INSERT OR REPLACE INTO project_members (project_id, user_id, role) VALUES (?,?,?)")
    .run(req.params.projectId, userId, role || "member");
  res.status(201).json({ success: true });
});

app.delete("/api/projects/:projectId/members/:userId", authenticate, requireProjectAdmin, (req, res) => {
  const project = db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(req.params.projectId);
  if (parseInt(req.params.userId) === project.owner_id)
    return res.status(400).json({ error: "Cannot remove project owner" });
  db.prepare("UPDATE tasks SET assignee_id = NULL WHERE project_id = ? AND assignee_id = ?")
    .run(req.params.projectId, req.params.userId);
  db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
    .run(req.params.projectId, req.params.userId);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════
// TASK ROUTES
// ════════════════════════════════════════════════════════════════════
const TASK_SELECT = `
  SELECT t.*, u.name as assignee_name, u.avatar_color as assignee_color, c.name as created_by_name
  FROM tasks t
  LEFT JOIN users u ON t.assignee_id = u.id
  LEFT JOIN users c ON t.created_by  = c.id`;

app.get("/api/projects/:projectId/tasks", authenticate, requireProjectMember, (req, res) => {
  const { status, priority, assignee, search } = req.query;
  let sql    = `${TASK_SELECT} WHERE t.project_id = ?`;
  const params = [req.params.projectId];

  if (status)   { sql += " AND t.status = ?";    params.push(status); }
  if (priority) { sql += " AND t.priority = ?";  params.push(priority); }
  if (assignee) { sql += " AND t.assignee_id = ?"; params.push(assignee); }
  if (search)   { sql += " AND (t.title LIKE ? OR t.description LIKE ?)";
                  params.push(`%${search}%`, `%${search}%`); }

  sql += " ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.created_at DESC";
  res.json({ tasks: db.prepare(sql).all(...params) });
});

app.post("/api/projects/:projectId/tasks", authenticate, requireProjectMember, (req, res) => {
  const { title, description, priority, assignee_id, due_date, status } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "Task title is required" });

  if (assignee_id) {
    const ok = db.prepare("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?").get(req.params.projectId, assignee_id)
            || db.prepare("SELECT 1 FROM projects WHERE id=? AND owner_id=?").get(req.params.projectId, assignee_id);
    if (!ok) return res.status(400).json({ error: "Assignee must be a project member" });
  }

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO tasks (project_id, title, description, priority, assignee_id, due_date, created_by, status)
    VALUES (?,?,?,?,?,?,?,?)`).run(
      req.params.projectId, title.trim(), description?.trim() || "",
      priority || "medium", assignee_id || null, due_date || null, req.user.id, status || "todo"
    );

  res.status(201).json({ task: db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(lastInsertRowid) });
});

app.put("/api/tasks/:id", authenticate, (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const project = db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(task.project_id);
  const member  = db.prepare("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?").get(task.project_id, req.user.id);
  if (req.user.role !== "admin" && project.owner_id !== req.user.id && !member)
    return res.status(403).json({ error: "Access denied" });

  const { title, description, status, priority, assignee_id, due_date } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "Task title is required" });

  db.prepare(`UPDATE tasks SET title=?, description=?, status=?, priority=?,
    assignee_id=?, due_date=?, updated_at=datetime('now') WHERE id=?`).run(
    title.trim(),
    description?.trim() ?? task.description,
    status    || task.status,
    priority  || task.priority,
    assignee_id !== undefined ? (assignee_id || null) : task.assignee_id,
    due_date    !== undefined ? (due_date    || null) : task.due_date,
    req.params.id
  );

  res.json({ task: db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(req.params.id) });
});

app.patch("/api/tasks/:id/status", authenticate, (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  const { status } = req.body;
  if (!["todo","in_progress","review","done"].includes(status))
    return res.status(400).json({ error: "Invalid status" });
  db.prepare("UPDATE tasks SET status=?, updated_at=datetime('now') WHERE id=?").run(status, req.params.id);
  res.json({ success: true, status });
});

app.delete("/api/tasks/:id", authenticate, (req, res) => {
  const task    = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  const project = db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(task.project_id);
  const mem     = db.prepare("SELECT role FROM project_members WHERE project_id=? AND user_id=?").get(task.project_id, req.user.id);
  if (req.user.role !== "admin" && project.owner_id !== req.user.id
      && task.created_by !== req.user.id && mem?.role !== "admin")
    return res.status(403).json({ error: "Only task creator or admin can delete" });
  db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════
app.get("/api/dashboard", authenticate, (req, res) => {
  const uid       = req.user.id;
  const isAdmin   = req.user.role === "admin";
  const pf        = isAdmin ? "" :
    `AND (p.owner_id = ${uid} OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ${uid}))`;

  const taskStats = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN t.status='todo'        THEN 1 ELSE 0 END) as todo,
      SUM(CASE WHEN t.status='in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN t.status='review'      THEN 1 ELSE 0 END) as review,
      SUM(CASE WHEN t.status='done'        THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN t.due_date < date('now') AND t.status != 'done' THEN 1 ELSE 0 END) as overdue
    FROM tasks t JOIN projects p ON t.project_id = p.id WHERE 1=1 ${pf}`).get();

  const myTasks = db.prepare(`
    SELECT t.*, p.name as project_name, u.name as assignee_name, u.avatar_color as assignee_color
    FROM tasks t JOIN projects p ON t.project_id = p.id LEFT JOIN users u ON t.assignee_id = u.id
    WHERE t.assignee_id = ? AND t.status != 'done'
    ORDER BY CASE WHEN t.due_date IS NOT NULL AND t.due_date < date('now') THEN 0 ELSE 1 END,
             t.due_date ASC, CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
    LIMIT 10`).all(uid);

  const overdueTasks = db.prepare(`
    SELECT t.*, p.name as project_name, u.name as assignee_name, u.avatar_color as assignee_color
    FROM tasks t JOIN projects p ON t.project_id = p.id LEFT JOIN users u ON t.assignee_id = u.id
    WHERE t.due_date < date('now') AND t.status != 'done' ${pf}
    ORDER BY t.due_date ASC LIMIT 8`).all();

  const recentActivity = db.prepare(`
    SELECT t.*, p.name as project_name, u.name as assignee_name, u.avatar_color as assignee_color
    FROM tasks t JOIN projects p ON t.project_id = p.id LEFT JOIN users u ON t.assignee_id = u.id
    WHERE 1=1 ${pf} ORDER BY t.updated_at DESC LIMIT 8`).all();

  const projects = db.prepare(`
    SELECT p.id, p.name, p.status,
      COUNT(t.id) as task_count,
      SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) as done_count,
      SUM(CASE WHEN t.due_date < date('now') AND t.status != 'done' THEN 1 ELSE 0 END) as overdue_count
    FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
    WHERE 1=1 ${pf} GROUP BY p.id ORDER BY p.created_at DESC LIMIT 6`).all();

  const teamSize = isAdmin ? db.prepare("SELECT COUNT(*) as c FROM users").get().c : null;
  res.json({ taskStats, myTasks, overdueTasks, recentActivity, projects, teamSize });
});

// ─── Health & SPA fallback ────────────────────────────────────────────────────
app.get("/api/health", (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use((err, req, res, _next) => { console.error(err); res.status(500).json({ error: "Server error" }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 TaskFlow running on http://localhost:${PORT}`));
